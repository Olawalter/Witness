import Link from "next/link";
import type { ReactNode } from "react";

import {
  EVIDENCE_LABEL,
  PHASE_LABEL,
  RESULT_LABEL,
  SOURCE_LABEL,
  VERDICT_LABEL,
  formatDate,
  formatGen,
  phaseOf,
  ruleInWords,
  shortAddress,
} from "@/lib/formatting/present";
import type { Criterion, CriterionResult, EvidenceStatus, Obligation, Verdict } from "@/types/witness";

/** A ruled field: label above, value below, the dossier's unit. */
export function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1">
      <span className="label">{label}</span>
      <span className={`text-sm ${mono ? "figure break-all" : ""}`}>{children}</span>
    </div>
  );
}

export function Section({ no, title, children, aside }: { no: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-labelledby={`s-${no}`} className="rule pt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={`s-${no}`} className="flex items-baseline gap-3 text-xl">
          <span className="section-no">{no}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const VERDICT_TONE: Record<Verdict, string> = {
  FULFILLED: "text-fulfilled",
  PARTIALLY_FULFILLED: "text-partial",
  NOT_FULFILLED: "text-not-fulfilled",
  INSUFFICIENT_EVIDENCE: "text-insufficient",
};

/** The verdict, stamped. Always the word, never colour alone. */
export function VerdictStamp({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" | "lg" }) {
  const pad = size === "lg" ? "px-4 py-2.5 text-lg" : size === "md" ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs";
  return <span className={`stamp inline-block ${pad} ${VERDICT_TONE[verdict]}`}>{VERDICT_LABEL[verdict]}</span>;
}

const RESULT_MARK: Record<CriterionResult, { mark: string; tone: string }> = {
  PASS: { mark: "✓", tone: "text-fulfilled" },
  FAIL: { mark: "✕", tone: "text-not-fulfilled" },
  UNKNOWN: { mark: "?", tone: "text-insufficient" },
};

export function ResultMark({ result }: { result: CriterionResult }) {
  const { mark, tone } = RESULT_MARK[result];
  return (
    <span className={`figure ${tone}`}>
      <span aria-hidden="true">{mark}</span> {RESULT_LABEL[result]}
    </span>
  );
}

const EVIDENCE_TONE: Record<EvidenceStatus, string> = {
  OK: "text-fulfilled",
  MISSING: "text-not-fulfilled",
  UNAVAILABLE: "text-insufficient",
};

export function EvidenceMark({ status }: { status: EvidenceStatus }) {
  return <span className={`figure text-xs ${EVIDENCE_TONE[status]}`}>{EVIDENCE_LABEL[status]}</span>;
}

/** A criterion as the creator defined it: its kind, its weight and its rule. */
export function CriterionTerms({ criterion }: { criterion: Criterion }) {
  const objective = criterion.kind === "OBJECTIVE";
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="figure text-xs text-amber-deep">{criterion.criterion_id}</span>
        <span className="text-sm">{criterion.text}</span>
      </div>
      <p className="text-xs text-muted">
        {objective ? "Decided by contract code" : "Read by the validator panel"} ·{" "}
        {criterion.required ? "Required" : "Not critical"}
        {objective ? ` · ${ruleInWords(criterion.op, criterion.field, criterion.expected)}` : ""}
        {criterion.source_ids?.length ? ` · from ${criterion.source_ids.join(", ")}` : ""}
      </p>
    </div>
  );
}

export function SourceLine({ source }: { source: Obligation["evidence_sources"][number] }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="figure text-xs text-amber-deep">{source.source_id}</span>
        <span className="text-sm">{source.description || SOURCE_LABEL[source.source_type]}</span>
        <span className="label">{SOURCE_LABEL[source.source_type]}</span>
      </div>
      <a href={source.location} target="_blank" rel="noreferrer"
         className="figure text-xs break-all text-muted underline underline-offset-4 hover:text-ink">
        {source.location}
      </a>
    </div>
  );
}

/** One row of the register: what was promised, by whom, and where it stands. */
export function ObligationRow({ o, now }: { o: Obligation; now: number }) {
  const phase = phaseOf(o, now);
  return (
    <li>
      <Link href={`/obligations/${o.obligation_id}`} className="grid gap-2 border-b border-rule px-1 py-4 hover:bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="figure text-xs text-muted">WITNESS #{o.obligation_id.padStart(3, "0")}</span>
          {o.verdict ? <VerdictStamp verdict={o.verdict} size="sm" /> : <span className="label">{PHASE_LABEL[phase]}</span>}
        </div>
        <p className="text-[15px] leading-snug">{o.description}</p>
        <p className="text-xs text-muted">
          <span className="figure">{formatGen(o.bond_required)}</span> bonded by{" "}
          <span className="figure">{shortAddress(o.responsible_party)}</span> · {o.criteria.length} {o.criteria.length === 1 ? "criterion" : "criteria"} ·{" "}
          {o.evidence_sources.length} {o.evidence_sources.length === 1 ? "source" : "sources"} · deadline{" "}
          {formatDate(o.deadline)}
        </p>
      </Link>
    </li>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-rule px-6 py-10">
      <p className="text-base">{title}</p>
      {children ? <div className="mt-2 max-w-xl text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function LoadFailure({ what, error, onRetry }: { what: string; error: unknown; onRetry?: () => void }) {
  const text = String((error as Error)?.message ?? error);
  return (
    <div role="alert" className="border border-not-fulfilled/40 bg-surface px-5 py-4 text-sm">
      <p className="font-medium text-not-fulfilled">Could not read {what}.</p>
      <p className="mt-1 text-muted">{/rate limit|429/i.test(text) ? "The GenLayer RPC is rate limiting reads. Wait a minute and try again." : text}</p>
      {onRetry ? (
        <button type="button" className="mt-3 border border-ink px-2.5 py-1 text-xs hover:bg-ink hover:text-paper" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className = "h-24" }: { className?: string }) {
  return <div className={`animate-pulse bg-surface ${className}`} aria-hidden="true" />;
}
