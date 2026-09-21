"use client";

import { useState } from "react";

import { TxTracker } from "@/components/obligation/tx-tracker";
import { useSend, useWitness } from "@/hooks/use-witness";
import { actsFor, type Act, type ActId } from "@/lib/contracts/acts";
import { fundCall, fundingOutcome, reads, statusReaches, verbCall } from "@/lib/contracts/witness";
import { formatGen } from "@/lib/formatting/present";
import { useWallet } from "@/lib/wallet/wallet";
import type { Obligation } from "@/types/witness";

/**
 * What can be done to this obligation now. Every act is the contract's own
 * verb; an act the contract would refuse is shown with its reason instead of a
 * button that fails.
 */
export function Acts({ obligation: o, now, onDone }: { obligation: Obligation; now: number; onDone: () => void }) {
  const { client, config } = useWitness();
  const wallet = useWallet();
  const sender = useSend();
  const [running, setRunning] = useState<ActId | null>(null);

  const acts = actsFor(o, { address: wallet.account }, now);
  const offered = acts.filter((a) => a.available);
  const blocked = acts.filter((a) => !a.available && a.reason);

  const run = async (act: Act) => {
    setRunning(act.id);
    if (act.id === "fund_obligation") {
      const before = (await reads.returnedDeposits(client, config, 0, 1).catch(() => ({ items: [] as { index: number }[] })))
        .items[0]?.index ?? 0;
      const outcome = fundingOutcome(client, config, o.obligation_id, wallet.account ?? "");
      await sender.send({
        call: fundCall(o.obligation_id, o.bond_required),
        reconciled: () => outcome(before),
        onSettled: onDone,
      });
      return;
    }
    const after: Record<Exclude<ActId, "fund_obligation">, string[]> = {
      cancel_obligation: ["CANCELLED"],
      verify_obligation: ["VERDICT_PROPOSED"],
      finalize_verdict: ["FINALIZED"],
      settle_obligation: ["SETTLED"],
      recover_obligation: ["RECOVERY"],
    };
    await sender.send({
      call: verbCall(act.id as Exclude<ActId, "create_obligation" | "fund_obligation">, o.obligation_id),
      reconciled: statusReaches(client, config, o.obligation_id, after[act.id as keyof typeof after]),
      onSettled: onDone,
    });
  };

  const active = acts.find((a) => a.id === running);

  return (
    <section aria-labelledby="acts" className="grid gap-4 border border-rule bg-surface p-5">
      <h2 id="acts" className="text-lg">What can be done now</h2>

      {offered.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing can be done to this obligation at the moment. The list below says why, and what would change that.
        </p>
      ) : (
        <ul className="grid gap-3">
          {offered.map((act) => (
            <li key={act.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">
                  {act.title}
                  {act.id === "fund_obligation" ? ` · ${formatGen(o.bond_required)}` : ""}
                </span>
                <span className="text-xs text-muted">
                  {act.detail}
                  {act.permissionless ? " Anyone may send it." : ""}
                </span>
              </span>
              <button
                type="button"
                className="justify-self-start bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:bg-amber-deep disabled:opacity-50 sm:justify-self-end"
                disabled={sender.busy}
                onClick={() => run(act)}
              >
                {sender.busy && running === act.id ? "Sending…" : act.title}
              </button>
            </li>
          ))}
        </ul>
      )}

      {blocked.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Acts that are not available yet</summary>
          <ul className="mt-2 grid gap-1.5">
            {blocked.map((act) => (
              <li key={act.id} className="text-xs text-muted">
                <span className="text-ink">{act.title}:</span> {act.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sender.state.stage !== "READY" ? (
        <TxTracker
          state={sender.state}
          done={active ? `${active.title} is recorded on chain.` : "The contract's state shows the change."}
        />
      ) : null}
    </section>
  );
}
