import { toAtto } from "@/lib/formatting/present";
import type { TermsInput } from "@/lib/contracts/witness";
import { CRITERION_KINDS, OBJECTIVE_OPS, SOURCE_TYPES, VERDICTS } from "@/types/witness";

/**
 * Form validation mirrors the contract's own rules so a person learns what is
 * wrong before signing. It is a convenience, never the authority: the contract
 * re-validates every field itself and refuses anything it cannot enforce.
 */

export const LIMITS = {
  description: 600,
  criterionText: 400,
  sourceDescription: 200,
  url: 300,
  fieldPath: 80,
  expected: 120,
  criteria: 8,
  sources: 4,
  minLeadSeconds: 120,
  maxHorizonDays: 366,
  minBondAtto: 10n ** 15n,
  bps: 10000,
} as const;

export const GITHUB_HOSTS = ["github.com", "api.github.com", "raw.githubusercontent.com"];
const FIELD_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const FENCE = /<<<|>>>/;
const FIELD_OPS = OBJECTIVE_OPS.filter((op) => op !== "SOURCE_AVAILABLE");
const VALUE_OPS = ["EQUALS", "NOT_EQUALS", "CONTAINS", "GTE", "LTE"] as const;

export type DraftSource = { source_type: string; location: string; description: string };
export type DraftCriterion = {
  kind: string;
  required: boolean;
  text: string;
  source_id?: string;
  op?: string;
  field?: string;
  expected?: string;
  source_ids?: string[];
};

export type Draft = {
  description: string;
  responsibleParty: string;
  consequenceRecipient: string;
  deadline: number;
  bond: string;
  criteria: DraftCriterion[];
  sources: DraftSource[];
  consequences: Record<string, number>;
  now: number;
};

export type Problems = Record<string, string>;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrl(url: string): string {
  const [scheme = "", rest = ""] = url.trim().split("://");
  const [netloc0 = "", ...path] = rest.split("/");
  let netloc = netloc0.toLowerCase();
  if (netloc.endsWith(":443")) netloc = netloc.slice(0, -4);
  if (netloc.startsWith("www.")) netloc = netloc.slice(4);
  return `${scheme.toLowerCase()}://${netloc}/${path.join("/").split("#")[0]!.replace(/\/+$/, "")}`;
}

/** Every problem with a draft, keyed by the field it belongs to. */
export function validateDraft(d: Draft): Problems {
  const p: Problems = {};

  const description = clean(d.description);
  if (!description) p.description = "Say what must happen.";
  else if (description.length > LIMITS.description) p.description = `At most ${LIMITS.description} characters.`;
  else if (FENCE.test(description)) p.description = "Cannot contain <<< or >>>.";

  if (!isAddress(d.responsibleParty)) p.responsibleParty = "Enter the responsible party's 0x address.";
  if (!isAddress(d.consequenceRecipient)) p.consequenceRecipient = "Enter the recipient's 0x address.";
  if (
    isAddress(d.responsibleParty) &&
    isAddress(d.consequenceRecipient) &&
    d.responsibleParty.trim().toLowerCase() === d.consequenceRecipient.trim().toLowerCase()
  ) {
    p.consequenceRecipient = "The recipient must differ from the responsible party.";
  }

  if (!d.deadline) p.deadline = "Choose a deadline.";
  else if (d.deadline < d.now + LIMITS.minLeadSeconds) p.deadline = "The deadline must be at least two minutes away.";
  else if (d.deadline > d.now + LIMITS.maxHorizonDays * 86400) p.deadline = "At most 366 days away.";

  const atto = toAtto(d.bond);
  if (atto === null) p.bond = "Enter an amount in GEN, like 0.5.";
  else if (BigInt(atto) < LIMITS.minBondAtto) p.bond = "The bond must be at least 0.001 GEN.";

  if (!d.sources.length) p.sources = "Add at least one evidence source.";
  if (d.sources.length > LIMITS.sources) p.sources = `At most ${LIMITS.sources} evidence sources.`;
  const seen = new Set<string>();
  d.sources.forEach((s, i) => {
    const key = `sources.${i}.location`;
    const host = hostOf(s.location);
    if (!(SOURCE_TYPES as readonly string[]).includes(s.source_type)) p[`sources.${i}.source_type`] = "Choose a type.";
    if (!/^https:\/\/\S+$/.test(s.location.trim()) || s.location.length > LIMITS.url || !host.includes(".")) {
      p[key] = "Use a full https address.";
    } else if (s.source_type === "GITHUB" && !GITHUB_HOSTS.includes(host)) {
      p[key] = `A GitHub source must be on ${GITHUB_HOSTS.join(", ")}.`;
    } else {
      const norm = normalizeUrl(s.location);
      if (seen.has(norm)) p[key] = "This repeats an earlier source.";
      seen.add(norm);
    }
    if (clean(s.description).length > LIMITS.sourceDescription) {
      p[`sources.${i}.description`] = `At most ${LIMITS.sourceDescription} characters.`;
    }
  });

  if (!d.criteria.length) p.criteria = "Add at least one acceptance criterion.";
  if (d.criteria.length > LIMITS.criteria) p.criteria = `At most ${LIMITS.criteria} criteria.`;
  if (d.criteria.length && !d.criteria.some((c) => c.required)) {
    p.criteria = "At least one criterion must be required.";
  }
  const sourceIds = d.sources.map((_, i) => `E${i + 1}`);
  d.criteria.forEach((c, i) => {
    const at = (k: string) => `criteria.${i}.${k}`;
    if (!(CRITERION_KINDS as readonly string[]).includes(c.kind)) p[at("kind")] = "Choose a kind.";
    const text = clean(c.text);
    if (!text) p[at("text")] = "Say what must be true.";
    else if (text.length > LIMITS.criterionText) p[at("text")] = `At most ${LIMITS.criterionText} characters.`;
    else if (FENCE.test(text)) p[at("text")] = "Cannot contain <<< or >>>.";

    if (c.kind === "OBJECTIVE") {
      if (!c.source_id || !sourceIds.includes(c.source_id)) p[at("source_id")] = "Name one evidence source.";
      if (!c.op || !(OBJECTIVE_OPS as readonly string[]).includes(c.op)) p[at("op")] = "Choose a rule.";
      if (c.op && (FIELD_OPS as readonly string[]).includes(c.op)) {
        const field = (c.field ?? "").trim();
        if (!FIELD_PATH.test(field) || field.length > LIMITS.fieldPath) {
          p[at("field")] = "Enter a JSON field path, like tag_name or assets.0.name.";
        }
      }
      if (c.op && (VALUE_OPS as readonly string[]).includes(c.op)) {
        const expected = clean(c.expected ?? "");
        if (!expected) p[at("expected")] = "Enter the value to compare against.";
        else if (expected.length > LIMITS.expected) p[at("expected")] = `At most ${LIMITS.expected} characters.`;
        else if ((c.op === "GTE" || c.op === "LTE") && !/^-?\d+(\.\d+)?$/.test(expected)) {
          p[at("expected")] = "Enter a number.";
        }
      }
    } else if (c.kind === "SEMANTIC") {
      const ids = c.source_ids ?? [];
      if (!ids.length) p[at("source_ids")] = "Choose the sources this may be judged from.";
      else if (ids.some((x) => !sourceIds.includes(x))) p[at("source_ids")] = "One of these sources no longer exists.";
    }
  });

  for (const v of VERDICTS) {
    const bps = d.consequences[v];
    if (!Number.isInteger(bps) || bps === undefined || bps < 0 || bps > LIMITS.bps) {
      p[`consequences.${v}`] = "Enter a share between 0 and 100 per cent.";
    }
  }

  return p;
}

/** Exactly what will be sent to the contract, from a valid draft. */
export function termsFromDraft(d: Draft): TermsInput {
  return {
    description: clean(d.description),
    criteria: d.criteria.map((c) =>
      c.kind === "OBJECTIVE"
        ? {
            kind: "OBJECTIVE",
            required: c.required,
            text: clean(c.text),
            source_id: c.source_id ?? "",
            op: c.op ?? "",
            ...(c.field ? { field: c.field.trim() } : {}),
            ...(c.expected ? { expected: clean(c.expected) } : {}),
          }
        : {
            kind: "SEMANTIC",
            required: c.required,
            text: clean(c.text),
            source_ids: c.source_ids ?? [],
          },
    ),
    evidence_sources: d.sources.map((s) => ({
      source_type: s.source_type,
      location: s.location.trim(),
      description: clean(s.description),
    })),
    consequences: { ...d.consequences },
  };
}

export function blankDraft(nowSeconds: number): Draft {
  return {
    description: "",
    responsibleParty: "",
    consequenceRecipient: "",
    deadline: nowSeconds + 7 * 86400 - ((nowSeconds + 7 * 86400) % 60),
    bond: "",
    criteria: [],
    sources: [],
    consequences: { FULFILLED: 10000, PARTIALLY_FULFILLED: 5000, NOT_FULFILLED: 0, INSUFFICIENT_EVIDENCE: 5000 },
    now: nowSeconds,
  };
}
