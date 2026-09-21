"use client";

import Link from "next/link";
import { useState } from "react";

import { Empty, LoadFailure, ObligationRow, Skeleton } from "@/components/obligation/pieces";
import { useMine, useNow, useObligations } from "@/hooks/use-witness";
import { useWallet } from "@/lib/wallet/wallet";
import type { Obligation } from "@/types/witness";

type Scope = "all" | "created" | "responsible";

export function Register() {
  const now = useNow();
  const wallet = useWallet();
  const [scope, setScope] = useState<Scope>("all");
  const all = useObligations(50);
  const mine = useMine(scope === "all" ? undefined : wallet.account);

  const rows: Obligation[] | undefined =
    scope === "all" ? all.data?.items : scope === "created" ? mine.data?.created.items : mine.data?.responsible.items;
  const query = scope === "all" ? all : mine;

  const tabs: { id: Scope; label: string }[] = [
    { id: "all", label: "All obligations" },
    { id: "created", label: "Created by me" },
    { id: "responsible", label: "I am responsible for" },
  ];

  return (
    <>
      <header className="mb-8 grid gap-3">
        <p className="label">The register</p>
        <h1 className="text-4xl">Obligations</h1>
        <p className="max-w-2xl text-sm text-muted">
          Every obligation this contract holds, newest first: what was promised, who bonded it, the criteria that decide
          it and where it stands.
        </p>
      </header>

      <div role="tablist" aria-label="Which obligations" className="mb-6 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={scope === t.id}
            onClick={() => setScope(t.id)}
            className={`border px-3 py-1.5 text-sm ${scope === t.id ? "border-ink bg-ink text-paper" : "border-rule hover:border-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {scope !== "all" && !wallet.account ? (
        <Empty title="Connect a wallet to see your own obligations.">
          The contract indexes obligations by the creator&apos;s address and by the responsible party&apos;s.
        </Empty>
      ) : (
        <>
          {query.loading ? <Skeleton className="h-48" /> : null}
          {query.error ? <LoadFailure what="obligations" error={query.error} onRetry={query.reload} /> : null}
          {rows && rows.length === 0 ? (
            <Empty title={scope === "all" ? "No obligations yet." : "Nothing here for this wallet."}>
              <Link href="/obligations/new" className="underline underline-offset-4">
                Create an obligation
              </Link>{" "}
              to define what must happen, who is responsible for it, and what the evidence must show.
            </Empty>
          ) : null}
          {rows && rows.length > 0 ? (
            <ul className="border-t border-rule">
              {rows.map((o) => (
                <ObligationRow key={o.obligation_id} o={o} now={now} />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </>
  );
}
