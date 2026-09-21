"use client";

import { rungsFor, type Rung, type TxState } from "@/lib/genlayer/tx";
import { configResult } from "@/lib/genlayer/config";
import { shortHash } from "@/lib/formatting/present";

/**
 * The write, rung by rung, as the brief's transaction state machine. A rung is
 * ticked only when the thing it names has been observed, so a wallet returning
 * a hash never reads as success and an accepted transaction never reads as
 * final.
 */

const LABEL: Record<Rung["stage"], string> = {
  SIGNATURE_REQUIRED: "Signature required",
  SUBMITTED: "Submitted",
  PENDING: "Pending consensus",
  DECIDED: "Decided and recorded",
  FINALIZED: "Final on GenLayer",
};

/** What the current rung is waiting on. Never phrased as done: a rung is
 * ticked, not described, once it has happened. */
const HINT: Record<Rung["stage"], string> = {
  SIGNATURE_REQUIRED: "Confirm the transaction in your wallet.",
  SUBMITTED: "Waiting for GenLayer to receive it.",
  PENDING: "Validators are executing it and voting. This can take minutes.",
  DECIDED: "Checking the contract's own state.",
  FINALIZED: "Accepted and recorded. The transaction becomes final when its appeal window closes.",
};

export function TxTracker({ state, done }: { state: TxState; done?: string }) {
  if (state.stage === "READY") return null;
  const explorer = configResult.ok ? configResult.config.explorer : "";

  return (
    <div className="grid gap-3 border border-rule bg-surface p-4" aria-live="polite">
      <ol className="grid gap-1.5 text-sm">
        {rungsFor(state).map(({ stage, state: state_ }) => {
          return (
            <li key={stage} className="flex items-baseline gap-2.5">
              <span
                className={`figure w-4 text-center text-xs ${
                  state_ === "failed" ? "text-not-fulfilled" : state_ === "done" ? "text-fulfilled" : "text-muted"
                }`}
                aria-hidden="true"
              >
                {state_ === "failed" ? "✕" : state_ === "done" ? "✓" : state_ === "current" ? "•" : "·"}
              </span>
              <span className={state_ === "todo" ? "text-muted" : state_ === "failed" ? "text-not-fulfilled" : ""}>
                {LABEL[stage]}
                <span className="sr-only">
                  {state_ === "done" ? ", done" : state_ === "current" ? ", in progress" : state_ === "failed" ? ", failed" : ", not yet"}
                </span>
                {state_ === "current" ? <span className="block text-xs text-muted">{HINT[stage]}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      {state.stage === "FAILED" && state.message ? (
        <p role="alert" className="border-l-2 border-not-fulfilled pl-3 text-sm">
          {state.message}
        </p>
      ) : null}
      {(state.stage === "DECIDED" || state.stage === "FINALIZED") && done ? (
        <p className="border-l-2 border-fulfilled pl-3 text-sm">{done}</p>
      ) : null}

      {state.hash ? (
        <a
          href={`${explorer}/tx/${state.hash}`}
          target="_blank"
          rel="noreferrer"
          className="figure w-fit text-xs text-muted underline underline-offset-4 hover:text-ink"
        >
          Transaction {shortHash(state.hash)}
          {state.protocolStatus ? ` · ${state.protocolStatus.toLowerCase().replace(/_/g, " ")}` : ""}
        </a>
      ) : null}
    </div>
  );
}
