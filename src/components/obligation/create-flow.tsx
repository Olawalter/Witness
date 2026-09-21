"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { TermsReview } from "@/components/obligation/terms-review";
import { TxTracker } from "@/components/obligation/tx-tracker";
import { useNow, useSend, useWitness } from "@/hooks/use-witness";
import { createCall, obligationCreated, reads } from "@/lib/contracts/witness";
import { formatGen, toAtto } from "@/lib/formatting/present";
import {
  blankDraft,
  termsFromDraft,
  validateDraft,
  type Draft,
  type DraftCriterion,
  type Problems,
} from "@/lib/validation/terms";
import { useWallet } from "@/lib/wallet/wallet";
import { OBJECTIVE_OPS, SOURCE_TYPES, VERDICTS } from "@/types/witness";

/**
 * The guided flow the brief lays out: obligation, responsible party, criteria,
 * evidence, deadline, bond, consequence, review, sign. Every field is
 * validated against the contract's own rules as it is typed, and the immutable
 * terms are shown in full before anything is signed.
 */

const STEPS = [
  { id: "obligation", no: "01", label: "Obligation", fields: ["description"] },
  { id: "party", no: "02", label: "Responsible party", fields: ["responsibleParty"] },
  { id: "criteria", no: "03", label: "Criteria", fields: ["criteria"] },
  { id: "evidence", no: "04", label: "Evidence", fields: ["sources"] },
  { id: "deadline", no: "05", label: "Deadline", fields: ["deadline"] },
  { id: "bond", no: "06", label: "Bond", fields: ["bond"] },
  { id: "consequence", no: "07", label: "Consequence", fields: ["consequences", "consequenceRecipient"] },
  { id: "review", no: "08", label: "Review", fields: [] },
  { id: "sign", no: "09", label: "Sign", fields: [] },
] as const;

const field =
  "w-full border border-rule bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none aria-[invalid=true]:border-not-fulfilled";

function toLocal(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 16);
}
function fromLocal(value: string): number {
  const ms = Date.parse(`${value}:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function problemsFor(problems: Problems, prefix: string[]): Problems {
  return Object.fromEntries(
    Object.entries(problems).filter(([k]) => prefix.some((f) => k === f || k.startsWith(`${f}.`))),
  );
}

export function CreateFlow() {
  const now = useNow();
  const router = useRouter();
  const wallet = useWallet();
  const { client, config } = useWitness();
  const sender = useSend();
  const [draft, setDraft] = useState<Draft>(() => blankDraft(Math.floor(Date.now() / 1000)));
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<Set<number>>(new Set());

  const live = useMemo(() => ({ ...draft, now }), [draft, now]);
  const problems = validateDraft(live);
  const stepProblems = (i: number) => problemsFor(problems, [...STEPS[i]!.fields]);
  const visible = shown.has(step) ? stepProblems(step) : {};
  const firstBad = STEPS.findIndex((s, i) => i < 7 && Object.keys(stepProblems(i)).length > 0);
  const ready = Object.keys(problems).length === 0;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setCriterion = (i: number, patch: Partial<DraftCriterion>) =>
    set({ criteria: draft.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const next = () => {
    setShown((s) => new Set(s).add(step));
    if (Object.keys(stepProblems(step)).length === 0) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const sign = async () => {
    if (!ready || !wallet.account) return;
    const known = (await reads.byCreator(client, config, wallet.account, 0, 1).catch(() => ({ total: 0 }))).total;
    const atto = toAtto(live.bond)!;
    const call = createCall(termsFromDraft(live), live.responsibleParty.trim(), live.consequenceRecipient.trim(),
                            live.deadline, atto);
    const final = await sender.send({
      call,
      reconciled: obligationCreated(client, config, wallet.account, known),
      onSettled: async () => {
        const page = await reads.byCreator(client, config, wallet.account!, 0, 1).catch(() => null);
        const id = page?.items[0]?.obligation_id;
        if (id) router.push(`/obligations/${id}`);
      },
    });
    return final;
  };

  const current = STEPS[step]!;
  const sourceIds = draft.sources.map((_, i) => `E${i + 1}`);

  return (
    <div className="grid gap-8">
      <header className="grid gap-3">
        <p className="label">New obligation</p>
        <h1 className="text-4xl">Define what must happen</h1>
        <p className="max-w-2xl text-sm text-muted">
          You are writing terms that cannot be changed once the bond is committed: what must happen, who is responsible,
          what the evidence must show, and what each verdict does with the bond.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <ol className="no-scrollbar flex gap-1 overflow-x-auto lg:grid lg:content-start" aria-label="Steps">
          {STEPS.map((s, i) => {
            const on = i === step;
            const complete = i < step && Object.keys(stepProblems(i)).length === 0;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={on ? "step" : undefined}
                  onClick={() => setStep(i)}
                  className={`flex w-full items-baseline gap-2.5 px-2 py-1.5 text-left text-sm ${on ? "bg-ink text-paper" : "hover:bg-surface"}`}
                >
                  <span className={`figure text-[11px] ${on ? "text-amber" : complete ? "text-fulfilled" : "text-muted"}`}>
                    {complete ? "✓" : s.no}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>

        <section className="grid gap-5" aria-labelledby="step-title">
          <h2 id="step-title" className="flex items-baseline gap-3 text-2xl">
            <span className="section-no">{current.no}</span>
            {current.label}
          </h2>

          {current.id === "obligation" ? (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">What must happen</span>
              <textarea
                rows={3}
                className={field}
                value={draft.description}
                aria-invalid={!!visible.description}
                placeholder="Publish the Q3 financial report on the investor site."
                onChange={(e) => set({ description: e.target.value })}
              />
              <span className="text-xs text-muted">
                {visible.description ?? "One sentence, in the words the parties would use. The panel reads this as the obligation."}
              </span>
            </label>
          ) : null}

          {current.id === "party" ? (
            <div className="grid gap-5">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Responsible party</span>
                <input
                  className={`${field} font-mono`}
                  value={draft.responsibleParty}
                  aria-invalid={!!visible.responsibleParty}
                  placeholder="0x…"
                  onChange={(e) => set({ responsibleParty: e.target.value })}
                />
                <span className="text-xs text-muted">
                  {visible.responsibleParty ?? "This address, and only this address, commits the bond."}
                </span>
              </label>
              {wallet.account ? (
                <button
                  type="button"
                  className="w-fit border border-rule px-2.5 py-1 text-xs hover:border-ink"
                  onClick={() => set({ responsibleParty: wallet.account! })}
                >
                  Use my connected wallet
                </button>
              ) : null}
            </div>
          ) : null}

          {current.id === "criteria" ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted">
                Objective criteria are decided by contract code from what a source returns. Semantic criteria are read
                by the validator panel. Mark a criterion required unless a failure should only reduce the settlement.
              </p>
              {visible.criteria ? <p className="text-sm text-not-fulfilled">{visible.criteria}</p> : null}
              <ul className="grid gap-4">
                {draft.criteria.map((c, i) => (
                  <li key={i} className="grid gap-3 border border-rule p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="figure text-xs text-amber-deep">C{i + 1}</span>
                      <select className="border border-rule bg-paper px-2 py-1 text-sm" value={c.kind}
                              onChange={(e) => setCriterion(i, { kind: e.target.value })}>
                        <option value="OBJECTIVE">Objective</option>
                        <option value="SEMANTIC">Semantic</option>
                      </select>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={c.required} onChange={(e) => setCriterion(i, { required: e.target.checked })} />
                        Required
                      </label>
                      <button type="button" className="ml-auto text-xs underline underline-offset-4"
                              onClick={() => set({ criteria: draft.criteria.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </div>
                    <input className={field} value={c.text} placeholder="What must be true"
                           aria-invalid={!!visible[`criteria.${i}.text`]}
                           onChange={(e) => setCriterion(i, { text: e.target.value })} />
                    {visible[`criteria.${i}.text`] ? (
                      <span className="text-xs text-not-fulfilled">{visible[`criteria.${i}.text`]}</span>
                    ) : null}

                    {c.kind === "OBJECTIVE" ? (
                      <div className="grid gap-2 sm:grid-cols-4">
                        <select className="border border-rule bg-paper px-2 py-2 text-sm" value={c.source_id ?? ""}
                                onChange={(e) => setCriterion(i, { source_id: e.target.value })}>
                          <option value="">Source…</option>
                          {sourceIds.map((id) => <option key={id} value={id}>{id}</option>)}
                        </select>
                        <select className="border border-rule bg-paper px-2 py-2 text-sm" value={c.op ?? ""}
                                onChange={(e) => setCriterion(i, { op: e.target.value })}>
                          <option value="">Rule…</option>
                          {OBJECTIVE_OPS.map((op) => <option key={op} value={op}>{op.toLowerCase().replace(/_/g, " ")}</option>)}
                        </select>
                        <input className={field} value={c.field ?? ""} placeholder="JSON field"
                               onChange={(e) => setCriterion(i, { field: e.target.value })} />
                        <input className={field} value={c.expected ?? ""} placeholder="Expected value"
                               onChange={(e) => setCriterion(i, { expected: e.target.value })} />
                        {["source_id", "op", "field", "expected"].map((k) =>
                          visible[`criteria.${i}.${k}`] ? (
                            <span key={k} className="text-xs text-not-fulfilled sm:col-span-4">{visible[`criteria.${i}.${k}`]}</span>
                          ) : null,
                        )}
                      </div>
                    ) : (
                      <div className="grid gap-1.5">
                        <span className="label">May be judged from</span>
                        <div className="flex flex-wrap gap-3">
                          {sourceIds.length === 0 ? <span className="text-xs text-muted">Add an evidence source first.</span> : null}
                          {sourceIds.map((id) => (
                            <label key={id} className="flex items-center gap-1.5 text-sm">
                              <input
                                type="checkbox"
                                checked={(c.source_ids ?? []).includes(id)}
                                onChange={(e) =>
                                  setCriterion(i, {
                                    source_ids: e.target.checked
                                      ? [...(c.source_ids ?? []), id]
                                      : (c.source_ids ?? []).filter((x) => x !== id),
                                  })
                                }
                              />
                              {id}
                            </label>
                          ))}
                        </div>
                        {visible[`criteria.${i}.source_ids`] ? (
                          <span className="text-xs text-not-fulfilled">{visible[`criteria.${i}.source_ids`]}</span>
                        ) : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="w-fit border border-ink px-3 py-1.5 text-sm hover:bg-ink hover:text-paper"
                onClick={() => set({ criteria: [...draft.criteria, { kind: "OBJECTIVE", required: true, text: "", op: "SOURCE_AVAILABLE", source_id: sourceIds[0] }] })}
              >
                Add criterion
              </button>
            </div>
          ) : null}

          {current.id === "evidence" ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted">
                The only sources that may ever be read for this obligation. Choose sources no party to it can quietly
                edit; they cannot be added to after the deadline.
              </p>
              {visible.sources ? <p className="text-sm text-not-fulfilled">{visible.sources}</p> : null}
              <ul className="grid gap-3">
                {draft.sources.map((s, i) => (
                  <li key={i} className="grid gap-2 border border-rule p-4 sm:grid-cols-[110px_minmax(0,1fr)_auto]">
                    <select className="border border-rule bg-paper px-2 py-2 text-sm" value={s.source_type}
                            onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, source_type: e.target.value } : x)) })}>
                      {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="grid gap-2">
                      <input className={`${field} font-mono`} value={s.location} placeholder="https://…"
                             aria-invalid={!!visible[`sources.${i}.location`]}
                             onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, location: e.target.value } : x)) })} />
                      <input className={field} value={s.description} placeholder="What this source is"
                             onChange={(e) => set({ sources: draft.sources.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                      {visible[`sources.${i}.location`] ? (
                        <span className="text-xs text-not-fulfilled">{visible[`sources.${i}.location`]}</span>
                      ) : null}
                    </div>
                    <button type="button" className="justify-self-start text-xs underline underline-offset-4"
                            onClick={() => set({ sources: draft.sources.filter((_, j) => j !== i) })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="w-fit border border-ink px-3 py-1.5 text-sm hover:bg-ink hover:text-paper"
                onClick={() => set({ sources: [...draft.sources, { source_type: "WEB", location: "", description: "" }] })}
              >
                Add evidence source
              </button>
            </div>
          ) : null}

          {current.id === "deadline" ? (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Deadline (UTC)</span>
              <input type="datetime-local" className={`${field} font-mono`} value={draft.deadline ? toLocal(draft.deadline) : ""}
                     aria-invalid={!!visible.deadline} onChange={(e) => set({ deadline: fromLocal(e.target.value) })} />
              <span className="text-xs text-muted">
                {visible.deadline ?? "Verification can only start after this moment, and the evidence is read as it stands then."}
              </span>
            </label>
          ) : null}

          {current.id === "bond" ? (
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Bond, in GEN</span>
                <input className={`${field} font-mono`} value={draft.bond} placeholder="0.5" inputMode="decimal"
                       aria-invalid={!!visible.bond} onChange={(e) => set({ bond: e.target.value })} />
                <span className="text-xs text-muted">
                  {visible.bond ?? "The responsible party must send exactly this amount. Anything else comes straight back to them."}
                </span>
              </label>
              <p className="border border-rule bg-surface p-4 text-sm">
                <span className="label">Economic commitment</span>
                <span className="mt-2 block text-muted">
                  The bond is held by the contract from the moment it is committed until the verdict is final. Nobody,
                  including you, can take it out early or change what it is for.
                </span>
              </p>
            </div>
          ) : null}

          {current.id === "consequence" ? (
            <div className="grid gap-5">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Consequence recipient</span>
                <input className={`${field} font-mono`} value={draft.consequenceRecipient} placeholder="0x…"
                       aria-invalid={!!visible.consequenceRecipient}
                       onChange={(e) => set({ consequenceRecipient: e.target.value })} />
                <span className="text-xs text-muted">
                  {visible.consequenceRecipient ?? "Whatever the responsible party does not receive goes here."}
                </span>
              </label>
              <div className="grid gap-2">
                <span className="label">What each verdict does with the bond</span>
                <table className="w-full max-w-xl text-sm">
                  <thead>
                    <tr className="border-b border-rule text-left">
                      <th scope="col" className="py-2 font-medium">Verdict</th>
                      <th scope="col" className="py-2 font-medium">To the responsible party</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VERDICTS.map((v) => (
                      <tr key={v} className="border-b border-rule">
                        <th scope="row" className="py-2 text-left font-normal">{v.replace(/_/g, " ").toLowerCase()}</th>
                        <td className="py-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              className="w-24 border border-rule bg-paper px-2 py-1 font-mono text-sm"
                              value={(draft.consequences[v] ?? 0) / 100}
                              onChange={(e) =>
                                set({ consequences: { ...draft.consequences, [v]: Math.round(Number(e.target.value) * 100) } })
                              }
                            />
                            <span className="text-xs text-muted">per cent</span>
                          </label>
                          {visible[`consequences.${v}`] ? (
                            <span className="block text-xs text-not-fulfilled">{visible[`consequences.${v}`]}</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {current.id === "review" || current.id === "sign" ? (
            <div className="grid gap-5">
              {firstBad >= 0 ? (
                <div role="alert" className="border border-not-fulfilled/40 bg-surface px-4 py-3 text-sm">
                  <p className="font-medium text-not-fulfilled">These terms are not complete yet.</p>
                  <p className="mt-1 text-muted">
                    {Object.values(stepProblems(firstBad))[0]}{" "}
                    <button type="button" className="underline underline-offset-4"
                            onClick={() => { setShown((s) => new Set(s).add(firstBad)); setStep(firstBad); }}>
                      Go to {STEPS[firstBad]!.label.toLowerCase()}
                    </button>
                  </p>
                </div>
              ) : null}
              <TermsReview draft={live} />
            </div>
          ) : null}

          {current.id === "sign" ? (
            <div className="grid gap-3 border-t border-rule pt-5">
              <p className="text-sm text-muted">
                Signing writes these terms to the WITNESS Intelligent Contract. It checks every field again and refuses
                anything it cannot enforce. The bond is committed separately, by the responsible party.
              </p>
              {!wallet.account ? <p className="text-sm text-partial">Connect a wallet to create this obligation.</p> : null}
              <button
                type="button"
                className="w-fit bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-amber-deep disabled:opacity-50"
                disabled={!ready || !wallet.account || sender.busy}
                onClick={sign}
              >
                {sender.busy ? "Sending…" : `Create obligation${ready ? ` · bond ${formatGen(toAtto(live.bond) ?? "0")}` : ""}`}
              </button>
              <TxTracker state={sender.state} done="The obligation is recorded on chain." />
            </div>
          ) : null}

          <div className="flex justify-between gap-3 border-t border-rule pt-5">
            <button type="button" className="border border-rule px-3 py-1.5 text-sm disabled:opacity-40" disabled={step === 0}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="border border-ink px-3 py-1.5 text-sm hover:bg-ink hover:text-paper" onClick={next}>
                {STEPS[step + 1]!.label}
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
