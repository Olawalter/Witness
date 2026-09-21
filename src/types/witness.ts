/**
 * The shapes the WITNESS contract's views return. These mirror
 * contracts/Witness.py and the deployed schema; every read is checked against
 * them at the boundary, so a response that is not what the contract returns is
 * an error rather than something the interface quietly renders.
 */

export const VERDICTS = ["FULFILLED", "PARTIALLY_FULFILLED", "NOT_FULFILLED", "INSUFFICIENT_EVIDENCE"] as const;
export const RESULTS = ["PASS", "FAIL", "UNKNOWN"] as const;
export const STATUSES = ["CREATED", "ACTIVE", "VERDICT_PROPOSED", "FINALIZED", "SETTLED", "CANCELLED", "RECOVERY"] as const;
export const SOURCE_TYPES = ["WEB", "API", "GITHUB", "DOCUMENT"] as const;
export const CRITERION_KINDS = ["OBJECTIVE", "SEMANTIC"] as const;
export const EVIDENCE_STATUSES = ["OK", "MISSING", "UNAVAILABLE"] as const;
export const OBJECTIVE_OPS = [
  "SOURCE_AVAILABLE",
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "EXISTS",
  "GTE",
  "LTE",
  "BEFORE_DEADLINE",
] as const;

export type Verdict = (typeof VERDICTS)[number];
export type CriterionResult = (typeof RESULTS)[number];
export type ObligationStatus = (typeof STATUSES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];
export type CriterionKind = (typeof CRITERION_KINDS)[number];
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type ObjectiveOp = (typeof OBJECTIVE_OPS)[number];

export type EvidenceSource = {
  source_id: string;
  source_type: SourceType;
  location: string;
  host: string;
  description: string;
  allowed: boolean;
};

export type Criterion = {
  criterion_id: string;
  kind: CriterionKind;
  required: boolean;
  text: string;
  source_ids?: string[];
  op?: ObjectiveOp;
  field?: string;
  expected?: string;
};

export type Consequences = Record<Verdict, number>;

export type Obligation = {
  obligation_id: string;
  creator: string;
  responsible_party: string;
  consequence_recipient: string;
  description: string;
  criteria: Criterion[];
  evidence_sources: EvidenceSource[];
  consequences: Consequences;
  decision_rules: string;
  created_at: number;
  deadline: number;
  bond_required: string;
  bond_deposited: string;
  status: ObligationStatus;
  funded_at: number;
  verification_id: number;
  verdict: Verdict | "";
  proposed_at: number;
  finalizable_at: number;
  finalized_at: number;
  settled: boolean;
  settled_at: number;
  cancelled_at: number;
  recovered_at: number;
  recovery_opens_at: number;
  paid_responsible: string;
  paid_recipient: string;
};

export type EvidenceRecord = {
  source_id: string;
  source_type: SourceType;
  location: string;
  status: EvidenceStatus;
  retrieved_at: number;
};

export type CriterionRecord = {
  criterion_id: string;
  result: CriterionResult;
  evidence_refs: string[];
  observed: string;
  quote: string;
};

export type Verification = {
  verification_id: number;
  obligation_id: string;
  evaluated_at: number;
  decision_rules: string;
  verdict: Verdict;
  evidence: EvidenceRecord[];
  criteria: CriterionRecord[];
};

export type ProofChain = { obligation: Obligation; verification: Verification | null };

export type ProtocolInfo = {
  protocol_version: string;
  decision_rules: string;
  verdicts: string[];
  criterion_kinds: string[];
  objective_ops: string[];
  source_types: string[];
  evidence_statuses: string[];
  limits: {
    max_criteria: number;
    max_sources: number;
    max_description: number;
    max_criterion_text: number;
    max_excerpt_chars: number;
    max_quote: number;
    min_bond_atto: string;
    min_lead_seconds: number;
    max_horizon_seconds: number;
    finality_delay_seconds: number;
    recovery_delay_seconds: number;
    basis_points: number;
  };
  obligation_count: number;
  verification_count: number;
  total_bonded: string;
  returned_deposit_count: number;
};

export type Page<T> = { total: number; items: T[] };

export type ReturnedDeposit = {
  index: number;
  obligation_id: string;
  sender: string;
  amount: number;
  reason: string;
  returned_at: number;
};
