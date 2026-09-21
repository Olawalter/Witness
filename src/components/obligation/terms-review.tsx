import { Field } from "@/components/obligation/pieces";
import { bpsInWords, formatTime, ruleInWords, toAtto, formatGen, SOURCE_LABEL } from "@/lib/formatting/present";
import type { Draft } from "@/lib/validation/terms";
import { VERDICTS, type ObjectiveOp, type SourceType } from "@/types/witness";

/** The immutable terms, in full, before anything is signed. */
export function TermsReview({ draft }: { draft: Draft }) {
  const atto = toAtto(draft.bond);
  return (
    <div className="grid gap-6 border border-rule bg-surface p-5">
      <p className="label">These terms cannot be changed once the bond is committed</p>

      <Field label="Obligation">{draft.description || "Not written yet"}</Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Responsible party" mono>{draft.responsibleParty || "Not set"}</Field>
        <Field label="Consequence recipient" mono>{draft.consequenceRecipient || "Not set"}</Field>
        <Field label="Deadline" mono>{draft.deadline ? formatTime(draft.deadline) : "Not set"}</Field>
        <Field label="Bond" mono>{atto ? formatGen(atto) : "Not set"}</Field>
      </div>

      <div className="grid gap-2">
        <span className="label">Acceptance criteria</span>
        {draft.criteria.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="grid gap-2">
            {draft.criteria.map((c, i) => (
              <li key={i} className="grid gap-0.5 border-l-2 border-rule pl-3">
                <span className="text-sm">
                  <span className="figure mr-2 text-xs text-amber-deep">C{i + 1}</span>
                  {c.text || "Not written yet"}
                </span>
                <span className="text-xs text-muted">
                  {c.kind === "OBJECTIVE" ? "Decided by contract code" : "Read by the validator panel"} ·{" "}
                  {c.required ? "Required" : "Not critical"}
                  {c.kind === "OBJECTIVE"
                    ? ` · ${c.source_id ?? "no source"}: ${ruleInWords(c.op as ObjectiveOp | undefined, c.field, c.expected)}`
                    : ` · from ${(c.source_ids ?? []).join(", ") || "no source"}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <span className="label">Permitted evidence sources</span>
        {draft.sources.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="grid gap-2">
            {draft.sources.map((s, i) => (
              <li key={i} className="grid gap-0.5 border-l-2 border-rule pl-3">
                <span className="text-sm">
                  <span className="figure mr-2 text-xs text-amber-deep">E{i + 1}</span>
                  {s.description || SOURCE_LABEL[s.source_type as SourceType] || s.source_type}
                </span>
                <span className="figure text-xs break-all text-muted">{s.location || "No location"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <span className="label">Consequences</span>
        <table className="w-full max-w-xl text-sm">
          <tbody>
            {VERDICTS.map((v) => (
              <tr key={v} className="border-b border-rule">
                <th scope="row" className="py-1.5 text-left font-normal">{v.replace(/_/g, " ").toLowerCase()}</th>
                <td className="figure py-1.5">
                  {bpsInWords(draft.consequences[v] ?? 0, atto ?? undefined)} to the responsible party
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
