import type {
  CriterionResult,
  EvidenceStatus,
  Obligation,
  ObligationStatus,
  ObjectiveOp,
  SourceType,
  Verdict,
} from "@/types/witness";

/**
 * Every word the interface shows about contract state comes from here, so a
 * protocol code never reaches a screen and the same state reads the same way
 * everywhere. Nothing is invented: each function only renames or formats a
 * field the contract returned.
 */

export const VERDICT_LABEL: Record<Verdict, string> = {
  FULFILLED: "Fulfilled",
  PARTIALLY_FULFILLED: "Partially fulfilled",
  NOT_FULFILLED: "Not fulfilled",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
};

export const VERDICT_MEANING: Record<Verdict, string> = {
  FULFILLED: "Every criterion was satisfied by the permitted evidence.",
  PARTIALLY_FULFILLED: "Every required criterion was satisfied; something the creator marked non-critical was not.",
  NOT_FULFILLED: "The evidence establishes that a required criterion was not met.",
  INSUFFICIENT_EVIDENCE: "The permitted evidence could not establish a required criterion either way.",
};

export const STATUS_LABEL: Record<ObligationStatus, string> = {
  CREATED: "Awaiting bond",
  ACTIVE: "Active",
  VERDICT_PROPOSED: "Verdict proposed",
  FINALIZED: "Finalized",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
  RECOVERY: "Recovered",
};

export const RESULT_LABEL: Record<CriterionResult, string> = {
  PASS: "Satisfied",
  FAIL: "Not satisfied",
  UNKNOWN: "Not established",
};

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  OK: "Retrieved",
  MISSING: "Not there",
  UNAVAILABLE: "Could not be read",
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  WEB: "Web page",
  API: "API",
  GITHUB: "GitHub",
  DOCUMENT: "Document",
};

export const OP_LABEL: Record<ObjectiveOp, string> = {
  SOURCE_AVAILABLE: "the source is published",
  EQUALS: "equals",
  NOT_EQUALS: "does not equal",
  CONTAINS: "contains",
  EXISTS: "is present",
  GTE: "is at least",
  LTE: "is at most",
  BEFORE_DEADLINE: "is on or before the deadline",
};

/** An objective criterion's rule, in words. */
export function ruleInWords(op: ObjectiveOp | undefined, field?: string, expected?: string): string {
  if (!op) return "";
  if (op === "SOURCE_AVAILABLE") return "The source is published and can be read.";
  const what = field ? `The field ${field}` : "The field";
  if (op === "EXISTS") return `${what} is present.`;
  if (op === "BEFORE_DEADLINE") return `${what} is a time on or before the deadline.`;
  return `${what} ${OP_LABEL[op]} ${expected}.`;
}

// ── addresses, hashes, amounts, time ────────────────────────────────────────

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

const GEN = 10n ** 18n;

/** Atto to GEN, exact: no floating point ever touches an amount. */
export function formatGen(atto: string | bigint): string {
  let value: bigint;
  try {
    value = typeof atto === "bigint" ? atto : BigInt(atto || "0");
  } catch {
    return "0 GEN";
  }
  const negative = value < 0n;
  if (negative) value = -value;
  const whole = value / GEN;
  const fraction = (value % GEN).toString().padStart(18, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return `${negative ? "-" : ""}${text} GEN`;
}

/** A GEN amount typed by a person to atto, or null when it is not a clean amount. */
export function toAtto(text: string): string | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,18})?$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  const value = BigInt(whole) * GEN + BigInt(fraction.padEnd(18, "0") || "0");
  return value.toString();
}

/** Basis points as a share of the bond, in words. */
export function bpsInWords(bps: number, bond?: string): string {
  const percent = bps / 100;
  const share = `${Number.isInteger(percent) ? percent : percent.toFixed(2)} per cent`;
  if (!bond) return share;
  try {
    const amount = (BigInt(bond) * BigInt(bps)) / 10000n;
    return `${share} (${formatGen(amount)})`;
  } catch {
    return share;
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                "October", "November", "December"];

/** A UTC timestamp in words: 22 September 2026, 14:05 UTC */
export function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return "Not recorded";
  const d = new Date(unixSeconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "Not recorded";
  const d = new Date(unixSeconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function relativeTo(unixSeconds: number, nowSeconds: number): string {
  const delta = unixSeconds - nowSeconds;
  const abs = Math.abs(delta);
  const [n, unit] =
    abs >= 86400 ? [Math.round(abs / 86400), "day"] :
    abs >= 3600 ? [Math.round(abs / 3600), "hour"] :
    [Math.max(1, Math.round(abs / 60)), "minute"];
  const words = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return delta >= 0 ? `in ${words}` : `${words} ago`;
}

// ── the stage an obligation is at, for a reader ─────────────────────────────

export type Phase =
  | "AWAITING_BOND"
  | "ACTIVE"
  | "DEADLINE_REACHED"
  | "VERDICT_PROPOSED"
  | "FINALIZED"
  | "SETTLED"
  | "CANCELLED"
  | "RECOVERY";

/** Stored status, plus the stored deadline read against the viewer's clock.
 * Display only: the contract decides against the transaction time. */
export function phaseOf(o: Pick<Obligation, "status" | "deadline">, nowSeconds: number): Phase {
  if (o.status === "ACTIVE") return nowSeconds >= o.deadline ? "DEADLINE_REACHED" : "ACTIVE";
  if (o.status === "CREATED") return "AWAITING_BOND";
  return o.status as Phase;
}

export const PHASE_LABEL: Record<Phase, string> = {
  AWAITING_BOND: "Awaiting bond",
  ACTIVE: "Active",
  DEADLINE_REACHED: "Deadline reached",
  VERDICT_PROPOSED: "Verdict proposed",
  FINALIZED: "Finalized",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
  RECOVERY: "Recovered",
};

/** What the obligation is waiting for, in one sentence. */
export function waitingFor(o: Obligation, nowSeconds: number): string {
  switch (phaseOf(o, nowSeconds)) {
    case "AWAITING_BOND":
      return `The responsible party has not committed the ${formatGen(o.bond_required)} bond yet.`;
    case "ACTIVE":
      return `Verification can start after the deadline, ${relativeTo(o.deadline, nowSeconds)}.`;
    case "DEADLINE_REACHED":
      return "The deadline has passed. Anyone can ask GenLayer to witness the evidence.";
    case "VERDICT_PROPOSED":
      return nowSeconds < o.finalizable_at
        ? `The verdict can be finalized ${relativeTo(o.finalizable_at, nowSeconds)}.`
        : "The verdict is ready to be finalized.";
    case "FINALIZED":
      return "The verdict is final. Anyone can settle the bond.";
    case "SETTLED":
      return "The bond has been paid out as the terms said.";
    case "CANCELLED":
      return "The creator withdrew this obligation before it was bonded.";
    case "RECOVERY":
      return "No verdict could be reached, so the bond settled on the terms' fallback.";
  }
}
