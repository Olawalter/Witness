import type { AppConfig } from "@/lib/genlayer/config";
import type { GenLayerClient } from "@/lib/genlayer/client";
import type {
  Obligation,
  Page,
  ProofChain,
  ProtocolInfo,
  ReturnedDeposit,
  Verification,
} from "@/types/witness";
import {
  CRITERION_KINDS,
  EVIDENCE_STATUSES,
  RESULTS,
  SOURCE_TYPES,
  STATUSES,
  VERDICTS,
} from "@/types/witness";

/**
 * The WITNESS contract as GenLayer describes it. Every method name and
 * parameter below was read from `gen_getContractSchema` for the deployed
 * contract (scripts/inspect.py writes it to docs/deployment.json and
 * src/lib/contracts/witness-schema.json); nothing here is guessed from the
 * Python source. Every view is checked before the interface sees it.
 */

export const REQUIRED_METHODS = {
  create_obligation: ["description", "responsible_party", "consequence_recipient", "deadline",
                      "bond_required", "terms_json"],
  fund_obligation: ["obligation_id"],
  cancel_obligation: ["obligation_id"],
  verify_obligation: ["obligation_id"],
  finalize_verdict: ["obligation_id"],
  settle_obligation: ["obligation_id"],
  recover_obligation: ["obligation_id"],
  get_protocol_info: [],
  get_obligation: ["obligation_id"],
  get_terms: ["obligation_id"],
  get_verification: ["verification_id"],
  get_proof_chain: ["obligation_id"],
  list_obligations: ["offset", "limit"],
  list_by_creator: ["creator", "offset", "limit"],
  list_by_responsible: ["responsible_party", "offset", "limit"],
  get_returned_deposits: ["offset", "limit"],
} as const;

/** The only payable method: the bond is the transaction value. */
export const PAYABLE_METHODS = ["fund_obligation"] as const;

export type WriteMethod =
  | "create_obligation"
  | "fund_obligation"
  | "cancel_obligation"
  | "verify_obligation"
  | "finalize_verdict"
  | "settle_obligation"
  | "recover_obligation";

// ── reading ─────────────────────────────────────────────────────────────────

function fail(fn: string): never {
  throw new Error(`The contract's ${fn} answer did not match the WITNESS interface.`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const inList = <T extends readonly string[]>(list: T, v: unknown): v is T[number] =>
  isStr(v) && (list as readonly string[]).includes(v);

function checkObligation(v: unknown, fn: string): Obligation {
  if (!isObject(v)) fail(fn);
  const o = v as unknown as Obligation;
  if (!isStr(o.obligation_id) || !isStr(o.creator) || !isStr(o.responsible_party)) fail(fn);
  if (!inList(STATUSES, o.status)) fail(fn);
  if (o.verdict !== "" && !inList(VERDICTS, o.verdict)) fail(fn);
  if (!Array.isArray(o.criteria) || !Array.isArray(o.evidence_sources)) fail(fn);
  if (!isStr(o.bond_required) || !isStr(o.bond_deposited)) fail(fn);
  if (!isNum(o.deadline) || !isNum(o.created_at)) fail(fn);
  if (!isObject(o.consequences)) fail(fn);
  for (const s of o.evidence_sources) if (!inList(SOURCE_TYPES, s.source_type)) fail(fn);
  for (const c of o.criteria) if (!inList(CRITERION_KINDS, c.kind)) fail(fn);
  return o;
}

function checkVerification(v: unknown, fn: string): Verification {
  if (!isObject(v)) fail(fn);
  const r = v as unknown as Verification;
  if (!isNum(r.verification_id) || !inList(VERDICTS, r.verdict)) fail(fn);
  if (!Array.isArray(r.criteria) || !Array.isArray(r.evidence)) fail(fn);
  for (const c of r.criteria) {
    if (!inList(RESULTS, c.result) || !Array.isArray(c.evidence_refs)) fail(fn);
  }
  for (const e of r.evidence) if (!inList(EVIDENCE_STATUSES, e.status)) fail(fn);
  return r;
}

function checkPage<T>(v: unknown, fn: string, item: (x: unknown, fn: string) => T): Page<T> {
  if (!isObject(v) || !isNum(v.total) || !Array.isArray(v.items)) fail(fn);
  return { total: v.total, items: v.items.map((x) => item(x, fn)) };
}

async function view(client: GenLayerClient, config: AppConfig, fn: keyof typeof REQUIRED_METHODS,
                    args: (string | number)[]): Promise<unknown> {
  return client.readContract({
    address: config.contractAddress,
    functionName: fn,
    args,
    jsonSafeReturn: true,
  });
}

/** A view refusal ("does not exist") is an answer, not an outage. */
export function isMissing(err: unknown): boolean {
  return /does not exist/i.test(String((err as Error)?.message ?? err));
}

export const reads = {
  async protocol(c: GenLayerClient, cfg: AppConfig): Promise<ProtocolInfo> {
    const v = await view(c, cfg, "get_protocol_info", []);
    if (!isObject(v) || !isStr(v.protocol_version) || !isObject(v.limits)) fail("get_protocol_info");
    return v as unknown as ProtocolInfo;
  },
  async obligation(c: GenLayerClient, cfg: AppConfig, id: string): Promise<Obligation> {
    return checkObligation(await view(c, cfg, "get_obligation", [id]), "get_obligation");
  },
  async verification(c: GenLayerClient, cfg: AppConfig, id: string): Promise<Verification> {
    return checkVerification(await view(c, cfg, "get_verification", [id]), "get_verification");
  },
  async proofChain(c: GenLayerClient, cfg: AppConfig, id: string): Promise<ProofChain> {
    const v = await view(c, cfg, "get_proof_chain", [id]);
    if (!isObject(v)) fail("get_proof_chain");
    return {
      obligation: checkObligation(v.obligation, "get_proof_chain"),
      verification: v.verification == null ? null : checkVerification(v.verification, "get_proof_chain"),
    };
  },
  async list(c: GenLayerClient, cfg: AppConfig, offset = 0, limit = 50): Promise<Page<Obligation>> {
    return checkPage(await view(c, cfg, "list_obligations", [offset, limit]), "list_obligations", checkObligation);
  },
  async byCreator(c: GenLayerClient, cfg: AppConfig, who: string, offset = 0, limit = 50): Promise<Page<Obligation>> {
    return checkPage(await view(c, cfg, "list_by_creator", [who.toLowerCase(), offset, limit]),
                     "list_by_creator", checkObligation);
  },
  async byResponsible(c: GenLayerClient, cfg: AppConfig, who: string, offset = 0, limit = 50): Promise<Page<Obligation>> {
    return checkPage(await view(c, cfg, "list_by_responsible", [who.toLowerCase(), offset, limit]),
                     "list_by_responsible", checkObligation);
  },
  async returnedDeposits(c: GenLayerClient, cfg: AppConfig, offset = 0, limit = 20): Promise<Page<ReturnedDeposit>> {
    const v = await view(c, cfg, "get_returned_deposits", [offset, limit]);
    if (!isObject(v) || !isNum(v.total) || !Array.isArray(v.items)) fail("get_returned_deposits");
    return v as unknown as Page<ReturnedDeposit>;
  },
};

// ── deployment validation ───────────────────────────────────────────────────

export type DeploymentCheck = { ok: true; version: string } | { ok: false; reason: string };

/**
 * Is the configured address really a WITNESS deployment? The schema GenLayer
 * derived from the deployed code must expose every method this app calls with
 * the same parameters in the same order, the payable method must be the only
 * payable one, and the protocol view must name itself WITNESS.
 */
export function checkSchema(schema: unknown): string | null {
  const methods = (schema as { methods?: Record<string, { params?: [string, string][]; payable?: boolean | null }> })?.methods;
  if (!methods || typeof methods !== "object") return "No contract schema exists at the configured address.";
  for (const [name, params] of Object.entries(REQUIRED_METHODS)) {
    const m = methods[name];
    if (!m) return `The contract at the configured address has no ${name} method, so it is not WITNESS.`;
    const names = (m.params ?? []).map((p) => p[0]);
    if (names.join(",") !== (params as readonly string[]).join(",")) {
      return `The contract's ${name} method takes different parameters than WITNESS's.`;
    }
  }
  for (const [name, m] of Object.entries(methods)) {
    const payable = Boolean(m.payable);
    const expected = (PAYABLE_METHODS as readonly string[]).includes(name);
    if (payable !== expected) {
      return `The contract's ${name} method ${payable ? "accepts" : "refuses"} value, unlike WITNESS's.`;
    }
  }
  return null;
}

export async function validateDeployment(c: GenLayerClient, cfg: AppConfig): Promise<DeploymentCheck> {
  let schema: unknown;
  try {
    schema = await c.getContractSchema(cfg.contractAddress);
  } catch {
    return { ok: false, reason: "No contract could be read at the configured address on this network." };
  }
  const problem = checkSchema(schema);
  if (problem) return { ok: false, reason: problem };
  try {
    const info = await reads.protocol(c, cfg);
    if (!info.protocol_version.startsWith("WITNESS")) {
      return { ok: false, reason: "The contract at the configured address does not identify itself as WITNESS." };
    }
    return { ok: true, version: info.protocol_version };
  } catch {
    return { ok: false, reason: "The contract at the configured address did not answer as WITNESS." };
  }
}

// ── writing ─────────────────────────────────────────────────────────────────

export type TermsInput = {
  description: string;
  criteria: {
    kind: string;
    required: boolean;
    text: string;
    source_id?: string;
    op?: string;
    field?: string;
    expected?: string;
    source_ids?: string[];
  }[];
  evidence_sources: { source_type: string; location: string; description: string }[];
  consequences: Record<string, number>;
};

export type Call = { functionName: WriteMethod; args: (string | number)[]; value: bigint };

export function createCall(t: TermsInput, party: string, recipient: string, deadline: number,
                           bondAtto: string): Call {
  return {
    functionName: "create_obligation",
    args: [t.description, party, recipient, deadline, bondAtto, JSON.stringify({
      criteria: t.criteria, evidence_sources: t.evidence_sources, consequences: t.consequences,
    })],
    value: 0n,
  };
}

export function fundCall(obligationId: string, bondAtto: string): Call {
  // the only payable call: the bond is the value, never an argument
  return { functionName: "fund_obligation", args: [obligationId], value: BigInt(bondAtto) };
}

export function verbCall(fn: Exclude<WriteMethod, "create_obligation" | "fund_obligation">,
                         obligationId: string): Call {
  return { functionName: fn, args: [obligationId], value: 0n };
}

// ── reconciliation predicates (the contract's own state shows the write) ────

export function statusReaches(c: GenLayerClient, cfg: AppConfig, id: string, statuses: string[]) {
  return async (): Promise<boolean> => statuses.includes((await reads.obligation(c, cfg, id)).status);
}

export function obligationCreated(c: GenLayerClient, cfg: AppConfig, creator: string, known: number) {
  return async (): Promise<boolean> => (await reads.byCreator(c, cfg, creator, 0, 1)).total > known;
}

/**
 * How funding is confirmed. The contract never keeps a deposit it cannot use:
 * it returns it in the same transaction and records why. So "done" is the
 * obligation reading ACTIVE, and "declined" is a new returned-deposit record
 * from this sender for this obligation.
 */
export function fundingOutcome(c: GenLayerClient, cfg: AppConfig, id: string, sender: string) {
  return async (before: number): Promise<boolean | string> => {
    const page = await reads.returnedDeposits(c, cfg, 0, 20);
    const mine = page.items.find(
      (r) => r.obligation_id === id && r.sender.toLowerCase() === sender.toLowerCase() && r.index > before,
    );
    if (mine) {
      const reason = mine.reason.charAt(0).toUpperCase() + mine.reason.slice(1);
      return `The contract did not accept this bond and returned it to your wallet. ${reason}.`;
    }
    return (await reads.obligation(c, cfg, id)).status === "ACTIVE";
  };
}
