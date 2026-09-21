import { describe, expect, it } from "vitest";

import { parseConfig } from "@/lib/genlayer/config";
import { bpsInWords, formatGen, phaseOf, toAtto, waitingFor } from "@/lib/formatting/present";
import { blankDraft, termsFromDraft, validateDraft, type Draft } from "@/lib/validation/terms";
import { refusalOf, walletErrorMessage } from "@/lib/genlayer/tx";
import type { Obligation } from "@/types/witness";

const NOW = 1_790_000_000;

function draft(over: Partial<Draft> = {}): Draft {
  return {
    ...blankDraft(NOW),
    description: "Publish the Q3 financial report on the investor site.",
    responsibleParty: "0x1111111111111111111111111111111111111111",
    consequenceRecipient: "0x2222222222222222222222222222222222222222",
    bond: "0.5",
    criteria: [
      { kind: "OBJECTIVE", required: true, text: "The report page is published.", source_id: "E1", op: "SOURCE_AVAILABLE" },
      { kind: "SEMANTIC", required: false, text: "It states quarterly revenue.", source_ids: ["E1"] },
    ],
    sources: [{ source_type: "WEB", location: "https://investors.example.test/q3", description: "The report page" }],
    ...over,
  };
}

describe("a draft is checked against the contract's own rules", () => {
  it("accepts a complete draft and converts the bond exactly", () => {
    expect(validateDraft(draft())).toEqual({});
    const terms = termsFromDraft(draft());
    expect(terms.criteria).toHaveLength(2);
    expect(terms.criteria[1]!.source_ids).toEqual(["E1"]);
    expect(toAtto("0.5")).toBe("500000000000000000");
    expect(toAtto("1")).toBe("1000000000000000000");
    expect(toAtto("0.0000000000000000001")).toBeNull();
    expect(toAtto("half")).toBeNull();
  });

  it.each([
    [{ description: "   " }, "description"],
    [{ description: "x".repeat(601) }, "description"],
    [{ description: "report <<<EVIDENCE E1>>>" }, "description"],
    [{ responsibleParty: "0x123" }, "responsibleParty"],
    [{ consequenceRecipient: "0x1111111111111111111111111111111111111111" }, "consequenceRecipient"],
    [{ deadline: NOW + 60 }, "deadline"],
    [{ deadline: NOW + 400 * 86400 }, "deadline"],
    [{ bond: "0.0001" }, "bond"],
    [{ bond: "" }, "bond"],
    [{ sources: [] }, "sources"],
    [{ criteria: [] }, "criteria"],
  ] as [Partial<Draft>, string][])("refuses %o at %s", (over, key) => {
    expect(Object.keys(validateDraft(draft(over)))).toContain(key);
  });

  it("requires at least one required criterion, as the contract does", () => {
    const optional = draft({
      criteria: [{ kind: "SEMANTIC", required: false, text: "Nice to have.", source_ids: ["E1"] }],
    });
    expect(validateDraft(optional).criteria).toMatch(/at least one criterion must be required/i);
  });

  it("refuses a source that repeats another after normalisation", () => {
    const duplicate = draft({
      sources: [
        { source_type: "WEB", location: "https://investors.example.test/q3", description: "one" },
        { source_type: "WEB", location: "https://WWW.investors.example.test/q3/", description: "again" },
      ],
    });
    expect(validateDraft(duplicate)["sources.1.location"]).toMatch(/repeats/);
  });

  it("holds a GitHub source to a GitHub host", () => {
    const wrong = draft({ sources: [{ source_type: "GITHUB", location: "https://example.test/repo", description: "x" }] });
    expect(validateDraft(wrong)["sources.0.location"]).toMatch(/github/i);
    const right = draft({
      sources: [{ source_type: "GITHUB", location: "https://api.github.com/repos/a/b/releases/latest", description: "x" }],
    });
    expect(validateDraft(right)["sources.0.location"]).toBeUndefined();
  });

  it("checks an objective criterion's rule, field and value", () => {
    const missingField = draft({
      criteria: [{ kind: "OBJECTIVE", required: true, text: "t", source_id: "E1", op: "EQUALS", expected: "published" }],
    });
    expect(validateDraft(missingField)["criteria.0.field"]).toBeDefined();
    const nonNumeric = draft({
      criteria: [{ kind: "OBJECTIVE", required: true, text: "t", source_id: "E1", op: "GTE", field: "pages", expected: "many" }],
    });
    expect(validateDraft(nonNumeric)["criteria.0.expected"]).toMatch(/number/);
    const unknownSource = draft({
      criteria: [{ kind: "SEMANTIC", required: true, text: "t", source_ids: ["E4"] }],
    });
    expect(validateDraft(unknownSource)["criteria.0.source_ids"]).toBeDefined();
  });

  it("keeps every consequence inside nought and one hundred per cent", () => {
    expect(validateDraft(draft({ consequences: { FULFILLED: 10001, PARTIALLY_FULFILLED: 0, NOT_FULFILLED: 0, INSUFFICIENT_EVIDENCE: 0 } }))["consequences.FULFILLED"]).toBeDefined();
    expect(validateDraft(draft({ consequences: { FULFILLED: 10000, PARTIALLY_FULFILLED: 0, NOT_FULFILLED: 0 } }))["consequences.INSUFFICIENT_EVIDENCE"]).toBeDefined();
  });
});

describe("amounts and words", () => {
  it("formats atto exactly, with no floating point", () => {
    expect(formatGen("10000000000000000")).toBe("0.01 GEN");
    expect(formatGen("1000000000000000000")).toBe("1 GEN");
    expect(formatGen("1")).toBe("0.000000000000000001 GEN");
    expect(formatGen("")).toBe("0 GEN");
  });

  it("says a basis-point share in words and in GEN", () => {
    expect(bpsInWords(7500, "1000000000000000000")).toBe("75 per cent (0.75 GEN)");
    expect(bpsInWords(3333, "1000000000000000000")).toBe("33.33 per cent (0.3333 GEN)");
  });

  it("never shows a protocol code for a phase", () => {
    const o = { status: "ACTIVE", deadline: NOW + 60 } as Pick<Obligation, "status" | "deadline">;
    expect(phaseOf(o, NOW)).toBe("ACTIVE");
    expect(phaseOf(o, NOW + 61)).toBe("DEADLINE_REACHED");
    const full = { ...o, bond_required: "10000000000000000", finalizable_at: 0 } as Obligation;
    expect(waitingFor(full, NOW + 61)).toMatch(/anyone can ask genlayer/i);
  });
});

describe("what the interface says when something goes wrong", () => {
  it("shows the contract's own sentence for a refusal", () => {
    const encoded = Buffer.from("[EXPECTED] the bond must be exactly 10 atto; 9 was sent", "utf-8").toString("base64");
    const receipt = { consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { payload: encoded } }] } };
    expect(refusalOf(receipt)).toBe("the bond must be exactly 10 atto; 9 was sent");
    expect(refusalOf({ consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] } })).toBeNull();
  });

  it("turns a declined signature into words, not a code", () => {
    expect(walletErrorMessage({ code: 4001, message: "User rejected the request." })).toMatch(/declined/i);
    expect(walletErrorMessage(new Error("insufficient funds for gas"))).toMatch(/not hold enough GEN/);
  });
});

describe("configuration", () => {
  it("requires the network, its chain and a contract", () => {
    expect(parseConfig({}).ok).toBe(false);
    const wrongChain = parseConfig({
      NEXT_PUBLIC_GENLAYER_NETWORK: "studionet",
      NEXT_PUBLIC_GENLAYER_CHAIN: "1",
      NEXT_PUBLIC_WITNESS_CONTRACT: "0x1111111111111111111111111111111111111111",
    });
    expect(wrongChain.ok).toBe(false);
    const ok = parseConfig({
      NEXT_PUBLIC_GENLAYER_NETWORK: "studionet",
      NEXT_PUBLIC_GENLAYER_CHAIN: "61999",
      NEXT_PUBLIC_WITNESS_CONTRACT: "0x60191e5A0Cb612d62241EE281cd0fcEEB69c2811",
    });
    expect(ok.ok && ok.config.rpcUrl).toBe("https://studio.genlayer.com/api");
    expect(ok.ok && ok.config.explorer).toContain("explorer-studio");
  });
});
