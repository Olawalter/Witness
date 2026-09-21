import { describe, expect, it } from "vitest";

import schema from "@/lib/contracts/witness-schema.json";
import { PAYABLE_METHODS, REQUIRED_METHODS, checkSchema, createCall, fundCall, isMissing, verbCall } from "@/lib/contracts/witness";
import { actsFor } from "@/lib/contracts/acts";
import type { Obligation } from "@/types/witness";

/**
 * The schema is the one GenLayer derived from the deployment of record
 * (scripts/inspect.py --write-deployment). A contract call is an untyped
 * array, so nothing else catches a wrong name, a wrong arity or value sent to
 * a method that cannot take it.
 */

const TERMS = {
  description: "Publish the Q3 report",
  criteria: [{ kind: "OBJECTIVE", required: true, text: "It is published", source_id: "E1", op: "SOURCE_AVAILABLE" }],
  evidence_sources: [{ source_type: "WEB", location: "https://example.test/q3", description: "The report" }],
  consequences: { FULFILLED: 10000, PARTIALLY_FULFILLED: 5000, NOT_FULFILLED: 0, INSUFFICIENT_EVIDENCE: 5000 },
};

const PARTY = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";

type Methods = Record<string, { params: [string, string][]; readonly: boolean; payable?: boolean | null }>;
const methods = (schema as unknown as { methods: Methods }).methods;

describe("the app is wired against the deployed schema", () => {
  it("every method and parameter the app uses exists on the deployment", () => {
    expect(checkSchema(schema)).toBeNull();
  });

  it("every write the contract exposes is reachable from the app", () => {
    const writes = Object.entries(methods).filter(([, m]) => !m.readonly).map(([n]) => n).sort();
    expect(writes).toEqual([
      "cancel_obligation", "create_obligation", "finalize_verdict", "fund_obligation",
      "recover_obligation", "settle_obligation", "verify_obligation",
    ]);
    for (const w of writes) expect(Object.keys(REQUIRED_METHODS)).toContain(w);
  });

  it("only fund_obligation is payable, and it is the only call that carries value", () => {
    const payable = Object.entries(methods).filter(([, m]) => m.payable).map(([n]) => n);
    expect(payable).toEqual([...PAYABLE_METHODS]);
    expect(fundCall("1", "5000").value).toBe(5000n);
    for (const fn of ["cancel_obligation", "verify_obligation", "finalize_verdict", "settle_obligation", "recover_obligation"] as const) {
      expect(verbCall(fn, "1").value, fn).toBe(0n);
    }
    expect(createCall(TERMS, PARTY, RECIPIENT, 1, "5000").value).toBe(0n);
  });

  it("every composed call matches the schema's arity and order", () => {
    const calls = [
      createCall(TERMS, PARTY, RECIPIENT, 1_790_000_000, "10000000000000000"),
      fundCall("1", "10000000000000000"),
      verbCall("cancel_obligation", "1"),
      verbCall("verify_obligation", "1"),
      verbCall("finalize_verdict", "1"),
      verbCall("settle_obligation", "1"),
      verbCall("recover_obligation", "1"),
    ];
    for (const call of calls) {
      const m = methods[call.functionName];
      expect(m, call.functionName).toBeDefined();
      expect(call.args.length, call.functionName).toBe(m!.params.length);
    }
  });

  it("the terms a create call carries are the JSON the contract parses", () => {
    const call = createCall(TERMS, PARTY, RECIPIENT, 1_790_000_000, "10000000000000000");
    expect(call.args[0]).toBe(TERMS.description);
    expect(call.args[1]).toBe(PARTY);
    expect(call.args[2]).toBe(RECIPIENT);
    const terms = JSON.parse(String(call.args[5]));
    expect(Object.keys(terms).sort()).toEqual(["consequences", "criteria", "evidence_sources"]);
    expect(terms.criteria[0].op).toBe("SOURCE_AVAILABLE");
  });

  it("an impostor contract is refused, naming what is wrong", () => {
    const withoutVerify = structuredClone(methods) as Methods;
    delete withoutVerify.verify_obligation;
    expect(checkSchema({ methods: withoutVerify })).toMatch(/no verify_obligation method/);

    const renamed = structuredClone(methods) as Methods;
    renamed.settle_obligation!.params = [["id", "string"]];
    expect(checkSchema({ methods: renamed })).toMatch(/settle_obligation method takes different parameters/);

    const greedy = structuredClone(methods) as Methods;
    greedy.settle_obligation!.payable = true;
    expect(checkSchema({ methods: greedy })).toMatch(/settle_obligation method accepts value/);

    expect(checkSchema(null)).toMatch(/No contract schema/);
  });

  it("a view refusal reads as an answer, not an outage", () => {
    expect(isMissing(new Error("[EXPECTED] obligation 9 does not exist"))).toBe(true);
    expect(isMissing(new Error("fetch failed"))).toBe(false);
  });
});

// ── which acts the contract would accept ────────────────────────────────────

const BASE: Obligation = {
  obligation_id: "1",
  creator: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  responsible_party: PARTY,
  consequence_recipient: RECIPIENT,
  description: "Publish the Q3 report",
  criteria: [],
  evidence_sources: [],
  consequences: { FULFILLED: 10000, PARTIALLY_FULFILLED: 5000, NOT_FULFILLED: 0, INSUFFICIENT_EVIDENCE: 5000 },
  decision_rules: "WITNESS-STANDARD-1",
  created_at: 1000,
  deadline: 2000,
  bond_required: "10000000000000000",
  bond_deposited: "0",
  status: "CREATED",
  funded_at: 0,
  verification_id: 0,
  verdict: "",
  proposed_at: 0,
  finalizable_at: 0,
  finalized_at: 0,
  settled: false,
  settled_at: 0,
  cancelled_at: 0,
  recovered_at: 0,
  recovery_opens_at: 2000 + 7 * 86400,
  paid_responsible: "0",
  paid_recipient: "0",
};

const offered = (o: Partial<Obligation>, address: string | undefined, now: number) =>
  actsFor({ ...BASE, ...o }, { address }, now).filter((a) => a.available).map((a) => a.id);

describe("acts mirror the contract's own gates", () => {
  it("only the responsible party commits the bond, and only before the deadline", () => {
    expect(offered({}, PARTY, 1500)).toContain("fund_obligation");
    expect(offered({}, BASE.creator, 1500)).not.toContain("fund_obligation");
    expect(offered({}, undefined, 1500)).not.toContain("fund_obligation");
    expect(offered({}, PARTY, 2500)).not.toContain("fund_obligation");
  });

  it("only the creator cancels, and only while nobody has bonded", () => {
    expect(offered({}, BASE.creator, 1500)).toContain("cancel_obligation");
    expect(offered({}, PARTY, 1500)).not.toContain("cancel_obligation");
    expect(offered({ status: "ACTIVE" }, BASE.creator, 1500)).not.toContain("cancel_obligation");
  });

  it("verification is open to anyone, but only after the deadline", () => {
    expect(offered({ status: "ACTIVE" }, undefined, 2500)).toContain("verify_obligation");
    expect(offered({ status: "ACTIVE" }, "0x9999999999999999999999999999999999999999", 2500)).toContain("verify_obligation");
    expect(offered({ status: "ACTIVE" }, PARTY, 1999)).not.toContain("verify_obligation");
    expect(offered({ status: "CREATED" }, PARTY, 2500)).not.toContain("verify_obligation");
  });

  it("finalization waits for the delay, and settlement for finalization", () => {
    const proposed = { status: "VERDICT_PROPOSED", verdict: "FULFILLED", proposed_at: 2100, finalizable_at: 2400 } as Partial<Obligation>;
    expect(offered(proposed, undefined, 2300)).not.toContain("finalize_verdict");
    expect(offered(proposed, undefined, 2400)).toContain("finalize_verdict");
    expect(offered(proposed, undefined, 2400)).not.toContain("settle_obligation");
    expect(offered({ status: "FINALIZED" }, undefined, 2500)).toContain("settle_obligation");
    expect(offered({ status: "SETTLED", settled: true }, undefined, 2500)).toEqual([]);
  });

  it("recovery opens only long after the deadline, and only with no verdict", () => {
    const late = BASE.recovery_opens_at;
    expect(offered({ status: "ACTIVE" }, undefined, late - 1)).not.toContain("recover_obligation");
    expect(offered({ status: "ACTIVE" }, undefined, late)).toContain("recover_obligation");
    expect(offered({ status: "VERDICT_PROPOSED" }, undefined, late)).not.toContain("recover_obligation");
  });

  it("an act that is not available says why", () => {
    const acts = actsFor({ ...BASE, status: "ACTIVE" }, { address: PARTY }, 1500);
    const verify = acts.find((a) => a.id === "verify_obligation")!;
    expect(verify.available).toBe(false);
    expect(verify.reason).toMatch(/after the deadline/);
    expect(acts.every((a) => a.available || a.reason)).toBe(true);
  });
});
