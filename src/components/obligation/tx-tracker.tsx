"use client";

import { STAGES, type Stage, type TxState } from "@/lib/genlayer/tx";
import { configResult } from "@/lib/genlayer/config";
import { shortHash } from "@/lib/formatting/present";

/**
 * The write, rung by rung, as the brief's transaction state machine. A rung is
 * ticked only when the thing it names has been observed, so a wallet returning
 * a hash never reads as success and an accepted transaction never reads as
 * final.
 */

const LABEL: Record<(typeof STAGES)[number], string> = {
  READY: "Ready",
  SIGNATURE_REQUIRED: "Signature required",
  SUBMITTED: "Submitted",
  PENDING: "Pending consensus",
  DECIDED: "Decided and recorded",
  FINALIZED: "Finalized",
};

const HINT: Record<(typeof STAGES)[number], string> = {
  READY: "",
  SIGNATURE_REQUIRED: "Confirm the transaction in your wallet.",
  SUBMITTED: "GenLayer has the transaction.",
  PENDING: "Validators are executing it and voting. This can take minutes.",
  DECIDED: "Accepted, and the contract's own state shows it. Not final yet.",
  FINALIZED: "The appeal window has closed.",
};

function positionOf(state: TxState): { index: number; failedAt: number | null } {
  const reached = STAGES.indexOf(state.reached);
  if (state.stage === "FAILED") return { index: reached, failedAt: Math.min(reached + 1, STAGES.length - 1) };
  return { index: STAGES.indexOf(state.stage as (typeof STAGES)[number]), failedAt: null };
}

export function TxTracker({ state, done }: { state: TxState; done?: string }) {
  if (state.stage === "READY") return null;
  const { index, failedAt } = positionOf(state);
  const explorer = configResult.ok ? configResult.config.explorer : "";

  return (
    <div className="grid gap-3 border border-rule bg-surface p-4" aria-live="polite">
      <ol className="grid gap-1.5 text-sm">
        {STAGES.slice(1).map((stage) => {
          const i = STAGES.indexOf(stage);
          const state_ = failedAt === i ? "failed" : i <= index ? "done" : i === index + 1 ? "current" : "todo";
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
                {LABEL[stage as Stage as (typeof STAGES)[number]]}
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
