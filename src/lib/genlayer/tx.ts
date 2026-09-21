import type { AppConfig } from "@/lib/genlayer/config";
import { readClient, type GenLayerClient } from "@/lib/genlayer/client";

/**
 * The frontend transaction state machine.
 *
 *   READY              nothing sent
 *   SIGNATURE_REQUIRED the wallet has been asked to sign
 *   SUBMITTED          the wallet returned a hash and GenLayer knows it
 *   PENDING            validators are executing and voting
 *   DECIDED            accepted, and the contract's own state shows the write
 *   FINALIZED          GenLayer marked the transaction final
 *   FAILED             declined, refused by the contract, or not decided
 *
 * A wallet returning a hash is not success, an accepted transaction is not a
 * final one, and a receipt is not state: each stage is entered only when the
 * thing it names has been observed.
 */

export const STAGES = ["READY", "SIGNATURE_REQUIRED", "SUBMITTED", "PENDING", "DECIDED", "FINALIZED"] as const;
export type Stage = (typeof STAGES)[number] | "FAILED";

export type TxState = {
  stage: Stage;
  /** The last stage reached before a failure, so a tracker can show where it stopped. */
  reached: (typeof STAGES)[number];
  hash?: `0x${string}`;
  /** GenLayer's own status name for the transaction, as last read. */
  protocolStatus?: string;
  message?: string;
};

export const initialTx: TxState = { stage: "READY", reached: "READY" };

/**
 * Two kinds of stage share one list. SIGNATURE_REQUIRED and PENDING mean
 * "waiting here": the wallet has not signed, the validators have not decided.
 * SUBMITTED, DECIDED and FINALIZED mean "reached". A tracker that read every
 * stage as reached would tick consensus while validators were still voting.
 */
const WAITING: ReadonlySet<string> = new Set(["SIGNATURE_REQUIRED", "PENDING"]);

export type Rung = { stage: Exclude<(typeof STAGES)[number], "READY">; state: "done" | "current" | "todo" | "failed" };

/** Each step of a write as a tracker should show it: ticked only once observed. */
export function rungsFor(s: TxState): Rung[] {
  const at = s.stage === "FAILED" ? s.reached : s.stage;
  const index = STAGES.indexOf(at);
  const current = WAITING.has(at) ? index : index + 1;
  return STAGES.slice(1).map((stage) => {
    const i = STAGES.indexOf(stage);
    const state = i < current ? "done" : i > current ? "todo" : s.stage === "FAILED" ? "failed" : "current";
    return { stage: stage as Rung["stage"], state };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PENDING = new Set(["PENDING", "ACTIVATED", "PROPOSING", "COMMITTING", "REVEALING"]);
const APPEAL = new Set(["APPEAL_REVEALING", "APPEAL_COMMITTING", "READY_TO_FINALIZE"]);
const UNDECIDED = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

export function isAccepted(status: string | undefined): boolean {
  return status === "ACCEPTED" || status === "FINALIZED" || (!!status && APPEAL.has(status));
}

export function isPending(status: string | undefined): boolean {
  return !!status && PENDING.has(status);
}

// ── the contract's own refusal text ─────────────────────────────────────────

const TAGS = ["[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]"];

function base64Text(s: string): string {
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    let i = 0;
    while (i < text.length && text.charCodeAt(i) < 0x20) i++;
    return text.slice(i);
  } catch {
    return "";
  }
}

function findTagged(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    for (const candidate of [value, /^[A-Za-z0-9+/=]{8,}$/.test(value) ? base64Text(value) : ""]) {
      const hits = TAGS.map((t) => candidate.indexOf(t)).filter((i) => i >= 0);
      if (hits.length) return candidate.slice(Math.min(...hits)).split(/\r?\n/)[0]!.trim();
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findTagged(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

type Receipt = {
  statusName?: string;
  consensus_data?: {
    leader_receipt?:
      | { execution_result?: string; result?: unknown }[]
      | { execution_result?: string; result?: unknown };
  };
};

export function leaderOf(tx: Receipt) {
  const lr = tx.consensus_data?.leader_receipt;
  return Array.isArray(lr) ? lr[0] : lr;
}

/** The contract's own sentence for refusing a write, or null when it executed. */
export function refusalOf(tx: Receipt): string | null {
  const leader = leaderOf(tx);
  if (!leader || leader.execution_result !== "ERROR") return null;
  const tagged = findTagged(leader.result);
  return (tagged ?? "The contract refused this transaction.").replace(/^\[[A-Z_]+\]\s*/, "");
}

/** Wallet and transport failures, in words a person can act on. */
export function walletErrorMessage(err: unknown): string {
  const text = [
    (err as { shortMessage?: string })?.shortMessage,
    (err as { message?: string })?.message,
    (err as { details?: string })?.details,
  ]
    .filter(Boolean)
    .join(" ");
  const code = (err as { code?: number })?.code ?? (err as { cause?: { code?: number } })?.cause?.code;
  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(text)) {
    return "You declined the request in your wallet. Nothing was sent.";
  }
  if (/rate limit/i.test(text)) return "The GenLayer RPC is rate limiting requests. Wait a minute and try again.";
  if (/insufficient funds/i.test(text)) return "Your wallet does not hold enough GEN for this transaction.";
  const tagged = findTagged(text);
  if (tagged) return tagged.replace(/^\[[A-Z_]+\]\s*/, "");
  return text ? text.split("\n")[0]!.slice(0, 240) : "The transaction could not be sent.";
}

// ── the runner ──────────────────────────────────────────────────────────────

export type RunOptions = {
  config: AppConfig;
  client: GenLayerClient;
  functionName: string;
  args: (string | number)[];
  value: bigint;
  /**
   * Resolves true once the contract's own view reflects the write, or a
   * sentence when the contract's views show it declined the write without
   * refusing the transaction (a returned bond).
   */
  reconciled: () => Promise<boolean | string>;
  onUpdate: (s: TxState) => void;
  /** A fresh read-only client for polling; defaults to one built from config. */
  poller?: GenLayerClient;
  pollMs?: number;
};

export async function runWrite(o: RunOptions): Promise<TxState> {
  let state: TxState = { ...initialTx };
  const set = (patch: Partial<TxState>) => {
    state = { ...state, ...patch };
    if (patch.stage && patch.stage !== "FAILED") state.reached = patch.stage as (typeof STAGES)[number];
    o.onUpdate(state);
    return state;
  };
  const fail = (message: string) => set({ stage: "FAILED", message });
  const poller = o.poller ?? readClient(o.config);
  const pollMs = o.pollMs ?? 3000;

  set({ stage: "SIGNATURE_REQUIRED" });
  let hash: `0x${string}`;
  try {
    hash = (await o.client.writeContract({
      address: o.config.contractAddress,
      functionName: o.functionName,
      args: o.args,
      value: o.value,
    })) as `0x${string}`;
  } catch (err) {
    return fail(walletErrorMessage(err));
  }
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail("The wallet did not return a transaction hash.");

  // SUBMITTED only once GenLayer itself can read the transaction back
  let tx: Receipt | null = null;
  for (let i = 0; i < 20 && !tx; i++) {
    try {
      tx = (await poller.getTransaction({ hash: hash as never })) as Receipt;
    } catch {
      await sleep(pollMs);
    }
  }
  if (!tx) return fail("The wallet returned a hash, but GenLayer has no record of the transaction.");
  set({ stage: "SUBMITTED", hash, protocolStatus: tx.statusName });

  set({ stage: "PENDING" });
  const started = Date.now();
  while (true) {
    const status = tx.statusName;
    set({ protocolStatus: status });
    if (isAccepted(status)) break;
    if (status && UNDECIDED.has(status)) {
      return fail("Validators did not reach a decision on this transaction, so it changed nothing.");
    }
    if (Date.now() - started > 20 * 60_000) {
      return fail("Consensus is taking longer than twenty minutes. The transaction may still complete; reload later.");
    }
    await sleep(pollMs + 2000);
    try {
      tx = (await poller.getTransaction({ hash: hash as never })) as Receipt;
    } catch {
      /* transient read failure: keep polling */
    }
  }

  const refusal = refusalOf(tx);
  if (refusal) return fail(refusal);

  // the contract's own state
  let updated = false;
  for (let i = 0; i < 40 && !updated; i++) {
    let outcome: boolean | string = false;
    try {
      outcome = await o.reconciled();
    } catch {
      outcome = false;
    }
    if (typeof outcome === "string") return fail(outcome);
    updated = outcome;
    if (!updated) await sleep(pollMs);
  }
  if (!updated) {
    return fail("The transaction was accepted, but the contract's state has not caught up yet. Reload in a minute.");
  }
  set({ stage: "DECIDED" });

  // GenLayer's own finality, tracked after the flow unblocks
  for (let i = 0; i < 90 && state.protocolStatus !== "FINALIZED"; i++) {
    await sleep(10_000);
    try {
      const t = (await poller.getTransaction({ hash: hash as never })) as Receipt;
      set({ protocolStatus: t.statusName });
    } catch {
      /* keep the last known status */
    }
  }
  if (state.protocolStatus === "FINALIZED") set({ stage: "FINALIZED" });
  return state;
}
