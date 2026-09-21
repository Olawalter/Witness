"use client";

import Link from "next/link";

import { Empty, LoadFailure, ObligationRow, Skeleton, VerdictStamp } from "@/components/obligation/pieces";
import { useNow, useObligations, useProtocol } from "@/hooks/use-witness";
import { formatGen } from "@/lib/formatting/present";

/**
 * The landing page's live part: the protocol's own totals and the most recent
 * records. Nothing here is invented — if the contract holds nothing yet, the
 * page says so, and a failed read says that instead of looking empty.
 */
export function Landing() {
  const now = useNow();
  const protocol = useProtocol();
  const obligations = useObligations(6);

  // A worked example reads best when it is a record that ran the whole way and
  // paid out; any settled record will do if none did.
  const done = obligations.data?.items.filter((o) => o.status === "SETTLED" && o.verdict) ?? [];
  const settled = done.find((o) => o.verdict === "FULFILLED") ?? done[0];

  return (
    <div className="grid gap-10">
      <section aria-label="Protocol totals" className="rule grid grid-cols-2 gap-6 pt-8 sm:grid-cols-4">
        {protocol.error ? (
          <div className="col-span-full">
            <LoadFailure what="the contract" error={protocol.error} onRetry={protocol.reload} />
          </div>
        ) : null}
        {[
          ["Obligations", protocol.data ? String(protocol.data.obligation_count) : null],
          ["Verifications", protocol.data ? String(protocol.data.verification_count) : null],
          ["Bonded now", protocol.data ? formatGen(protocol.data.total_bonded) : null],
          ["Protocol", protocol.data?.protocol_version ?? null],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1">
            <span className="label">{label}</span>
            {value === null ? <Skeleton className="h-7 w-20" /> : <span className="figure text-2xl">{value}</span>}
          </div>
        ))}
      </section>

      {settled ? (
        <section aria-labelledby="worked" className="rule grid gap-4 pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="worked" className="text-xl">A settled record</h2>
            <Link href={`/obligations/${settled.obligation_id}`} className="text-sm underline underline-offset-4">
              Read the proof chain
            </Link>
          </div>
          <div className="grid gap-3 border border-rule bg-surface p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="grid gap-2">
              <span className="figure text-xs text-muted">WITNESS #{settled.obligation_id.padStart(3, "0")}</span>
              <p className="text-lg">{settled.description}</p>
              <p className="text-sm text-muted">
                {settled.criteria.length} {settled.criteria.length === 1 ? "criterion" : "criteria"} ·{" "}
                {settled.evidence_sources.length}{" "}
                {settled.evidence_sources.length === 1 ? "source" : "sources"} ·{" "}
                <span className="figure">{formatGen(settled.bond_required)}</span> bonded ·{" "}
                <span className="figure">{formatGen(settled.paid_responsible)}</span> returned to the responsible party
              </p>
            </div>
            {settled.verdict ? <VerdictStamp verdict={settled.verdict} size="md" /> : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="recent" className="rule grid gap-4 pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent" className="text-xl">The register</h2>
          <Link href="/obligations" className="text-sm underline underline-offset-4">
            Every obligation
          </Link>
        </div>
        {obligations.loading ? <Skeleton className="h-40" /> : null}
        {obligations.error ? (
          <LoadFailure what="the register" error={obligations.error} onRetry={obligations.reload} />
        ) : null}
        {obligations.data && obligations.data.items.length === 0 ? (
          <Empty title="No obligations yet.">
            The first one will appear here as soon as somebody defines it. Nothing on this page is example data.
          </Empty>
        ) : null}
        {obligations.data && obligations.data.items.length > 0 ? (
          <ul className="border-t border-rule">
            {obligations.data.items.map((o) => (
              <ObligationRow key={o.obligation_id} o={o} now={now} />
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
