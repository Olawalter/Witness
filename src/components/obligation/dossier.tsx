"use client";

import Link from "next/link";

import { Acts } from "@/components/obligation/acts";
import {
  CriterionTerms,
  Empty,
  EvidenceMark,
  Field,
  LoadFailure,
  ResultMark,
  Section,
  Skeleton,
  SourceLine,
  VerdictStamp,
} from "@/components/obligation/pieces";
import { useNow, useProofChain } from "@/hooks/use-witness";
import { isMissing } from "@/lib/contracts/witness";
import { configResult } from "@/lib/genlayer/config";
import {
  PHASE_LABEL,
  VERDICT_MEANING,
  bpsInWords,
  formatGen,
  formatTime,
  phaseOf,
  waitingFor,
} from "@/lib/formatting/present";
import type { Obligation, Verification } from "@/types/witness";
import { VERDICTS } from "@/types/witness";

/**
 * One obligation, as a dossier. The sections are kept apart on purpose: the
 * terms that were defined, the evidence that was observed, the adjudication
 * that read it, the finalized result, and the settlement that followed. An
 * interpretation is never dressed as a finalized verdict.
 */
export function Dossier({ id }: { id: string }) {
  const now = useNow();
  const chain = useProofChain(id, 20_000);
  const explorer = configResult.ok ? configResult.config.explorer : "";

  if (chain.loading && !chain.data) return <Skeleton className="h-96" />;
  if (chain.error && !chain.data) {
    return isMissing(chain.error) ? (
      <Empty title={`Obligation #${id} does not exist.`}>
        <Link href="/obligations" className="underline underline-offset-4">
          Back to the register
        </Link>
      </Empty>
    ) : (
      <LoadFailure what={`obligation #${id}`} error={chain.error} onRetry={chain.reload} />
    );
  }
  if (!chain.data) return null;

  const { obligation: o, verification: v } = chain.data;
  const phase = phaseOf(o, now);

  return (
    <div className="grid gap-10">
      <header className="grid gap-4">
        <Link href="/obligations" className="text-sm text-muted underline underline-offset-4 hover:text-ink">
          The register
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <span className="figure text-sm text-muted">WITNESS #{o.obligation_id.padStart(3, "0")}</span>
          <span className="label">{PHASE_LABEL[phase]}</span>
        </div>
        <h1 className="max-w-3xl text-4xl leading-tight">{o.description}</h1>
        <p className="text-sm text-muted">{waitingFor(o, now)}</p>
        {o.verdict ? (
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <VerdictStamp verdict={o.verdict} size="lg" />
            <p className="max-w-xl text-sm text-muted">{VERDICT_MEANING[o.verdict]}</p>
          </div>
        ) : null}
      </header>

      <Acts obligation={o} now={now} onDone={chain.reload} />

      <Section no="01" title="Defined terms">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Responsible party" mono>{o.responsible_party}</Field>
          <Field label="Creator" mono>{o.creator}</Field>
          <Field label="Bond" mono>{formatGen(o.bond_required)}</Field>
          <Field label="Deadline" mono>{formatTime(o.deadline)}</Field>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="grid gap-3">
            <h3 className="label">Acceptance criteria</h3>
            <ul className="grid gap-3">
              {o.criteria.map((c) => (
                <li key={c.criterion_id} className="border-l-2 border-rule pl-3">
                  <CriterionTerms criterion={c} />
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-3">
            <h3 className="label">Permitted evidence sources</h3>
            <ul className="grid gap-3">
              {o.evidence_sources.map((s) => (
                <li key={s.source_id} className="border-l-2 border-rule pl-3">
                  <SourceLine source={s} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Only these sources may be read, and only as they answer at verification. They were fixed when the
              obligation was created and cannot be added to afterwards.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-3">
          <h3 className="label">Economic consequences</h3>
          <table className="w-full max-w-2xl text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th scope="col" className="py-2 font-medium">If the verdict is</th>
                <th scope="col" className="py-2 font-medium">The responsible party receives</th>
                <th scope="col" className="py-2 font-medium">The recipient receives</th>
              </tr>
            </thead>
            <tbody>
              {VERDICTS.map((verdict) => {
                const bps = o.consequences[verdict] ?? 0;
                return (
                  <tr key={verdict} className={`border-b border-rule ${o.verdict === verdict ? "bg-surface" : ""}`}>
                    <th scope="row" className="py-2 text-left font-normal">{verdict.replace(/_/g, " ").toLowerCase()}</th>
                    <td className="figure py-2">{bpsInWords(bps, o.bond_required)}</td>
                    <td className="figure py-2">{bpsInWords(10000 - bps, o.bond_required)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-xs text-muted">
            Fixed when the obligation was created, in basis points of the bond. Nobody chooses a payout afterwards, and
            the model never sees these numbers.
          </p>
        </div>
      </Section>

      <Section no="02" title="Observed evidence"
               aside={v ? <span className="label">Retrieved {formatTime(v.evaluated_at)}</span> : null}>
        {v ? (
          <ul className="grid gap-3">
            {v.evidence.map((e) => (
              <li key={e.source_id} className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
                <span className="grid gap-1">
                  <span className="figure text-xs text-amber-deep">{e.source_id}</span>
                  <a href={e.location} target="_blank" rel="noreferrer"
                     className="figure text-xs break-all underline underline-offset-4 hover:text-amber-deep">
                    {e.location}
                  </a>
                </span>
                <EvidenceMark status={e.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No evidence has been retrieved yet. It is fetched inside the verification transaction, by every validator,
            and never stored as a page: what the record keeps is what they agreed it showed.
          </p>
        )}
      </Section>

      <Section no="03" title="Adjudication"
               aside={v ? <span className="label">Rules {v.decision_rules}</span> : null}>
        {v ? (
          <ul className="grid gap-4">
            {v.criteria.map((c) => {
              const terms = o.criteria.find((x) => x.criterion_id === c.criterion_id);
              return (
                <li key={c.criterion_id} className="grid gap-2 border-b border-rule pb-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="flex items-baseline gap-3">
                      <span className="figure text-xs text-amber-deep">{c.criterion_id}</span>
                      <span className="text-sm">{terms?.text}</span>
                    </span>
                    <ResultMark result={c.result} />
                  </div>
                  <p className="text-xs text-muted">
                    {terms?.kind === "OBJECTIVE"
                      ? `Decided by contract code from ${c.evidence_refs.join(", ") || "the source"}${c.observed ? `; the source returned ${c.observed}` : ""}.`
                      : `Read by the validator panel${c.evidence_refs.length ? ` from ${c.evidence_refs.join(", ")}` : ""}.`}
                  </p>
                  {c.quote ? (
                    <blockquote className="border-l-2 border-amber pl-3 text-sm">
                      “{c.quote}”
                      <span className="figure ml-2 text-xs text-muted">{c.evidence_refs.join(", ")}</span>
                    </blockquote>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing has been adjudicated yet.</p>
        )}
      </Section>

      <Section no="04" title="Finalized result">
        {o.verdict ? (
          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <VerdictStamp verdict={o.verdict} size="lg" />
            <div className="grid gap-3">
              <p className="text-sm">{VERDICT_MEANING[o.verdict]}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Proposed" mono>{formatTime(o.proposed_at)}</Field>
                <Field label="Final" mono>
                  {o.finalized_at ? formatTime(o.finalized_at) : `Not yet; ready ${formatTime(o.finalizable_at)}`}
                </Field>
                <Field label="GenLayer" mono>
                  {o.finalized_at ? "Finalized" : "Accepted, appealable"}
                </Field>
              </div>
              <p className="text-xs text-muted">
                A verdict is recorded when the validator panel agrees, and becomes final only after the contract&apos;s
                own finality delay has passed, which is far longer than the network&apos;s appeal window.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No verdict has been proposed yet.</p>
        )}
      </Section>

      <Section no="05" title="Settlement">
        {o.settled ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="To the responsible party" mono>{formatGen(o.paid_responsible)}</Field>
            <Field label="To the consequence recipient" mono>{formatGen(o.paid_recipient)}</Field>
            <Field label="Bond remaining" mono>{formatGen(o.bond_deposited)}</Field>
            <div className="sm:col-span-3">
              <Field label="Settled" mono>{formatTime(o.settled_at || o.recovered_at)}</Field>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            The bond is still held by the contract: <span className="figure">{formatGen(o.bond_deposited)}</span>. It
            moves only after the verdict is final, and only as the terms above say.
          </p>
        )}
      </Section>

      <Section no="06" title="Verify this yourself">
        <div className="grid gap-3 text-sm">
          <p className="text-muted">
            Every value on this page is a field of the contract&apos;s own state, read through{" "}
            <span className="font-mono text-xs">get_proof_chain</span>. Nothing was produced by this interface.
          </p>
          <ul className="grid gap-2">
            <li>
              <a className="figure text-xs underline underline-offset-4 hover:text-amber-deep"
                 href={`${explorer}/address/${configResult.ok ? configResult.config.contractAddress : ""}`}
                 target="_blank" rel="noreferrer">
                The contract on the GenLayer explorer
              </a>
            </li>
            <li className="text-xs text-muted">
              Or from a terminal:{" "}
              <code className="font-mono">python scripts/inspect.py &lt;address&gt; --obligation {o.obligation_id}</code>
            </li>
          </ul>
        </div>
      </Section>
    </div>
  );
}

export type { Obligation, Verification };
