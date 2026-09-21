/**
 * The write lifecycle as the interface reports it. The rule under test is the
 * one the tracker promises: a step is ticked only once it has been observed, so
 * a returned hash never reads as success and an accepted transaction never
 * reads as final. The in-app end-to-end run found the tracker breaking it,
 * ticking consensus while validators were still voting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "./config";
import { rungsFor, runWrite, STAGES, type TxState } from "./tx";

const at = (stage: TxState["stage"], reached: TxState["reached"] = stage as TxState["reached"]): TxState => ({ stage, reached });
const view = (s: TxState) => Object.fromEntries(rungsFor(s).map((r) => [r.stage, r.state]));

describe("rungsFor", () => {
  it("does not tick the signature while the wallet is still asking", () => {
    expect(view(at("SIGNATURE_REQUIRED"))).toEqual({
      SIGNATURE_REQUIRED: "current", SUBMITTED: "todo", PENDING: "todo", DECIDED: "todo", FINALIZED: "todo",
    });
  });

  it("does not tick consensus while validators are still voting", () => {
    expect(view(at("PENDING"))).toEqual({
      SIGNATURE_REQUIRED: "done", SUBMITTED: "done", PENDING: "current", DECIDED: "todo", FINALIZED: "todo",
    });
  });

  it("shows an accepted transaction as waiting for finality, not final", () => {
    expect(view(at("DECIDED"))).toEqual({
      SIGNATURE_REQUIRED: "done", SUBMITTED: "done", PENDING: "done", DECIDED: "done", FINALIZED: "current",
    });
  });

  it("ticks everything only once final", () => {
    expect(rungsFor(at("FINALIZED")).every((r) => r.state === "done")).toBe(true);
  });

  it("marks the step that failed, not the one after it", () => {
    expect(view(at("FAILED", "SIGNATURE_REQUIRED")).SIGNATURE_REQUIRED).toBe("failed");
    expect(view(at("FAILED", "PENDING"))).toEqual({
      SIGNATURE_REQUIRED: "done", SUBMITTED: "done", PENDING: "failed", DECIDED: "todo", FINALIZED: "todo",
    });
  });

  it("never reads as final before FINALIZED is observed", () => {
    for (const stage of STAGES.filter((s) => s !== "FINALIZED")) {
      expect(view(at(stage)).FINALIZED, stage).not.toBe("done");
    }
  });
});

describe("runWrite", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const HASH = `0x${"ab".repeat(32)}` as const;
  const config = { contractAddress: "0x60191e5A0Cb612d62241EE281cd0fcEEB69c2811" } as unknown as AppConfig;

  function harness(statuses: string[], reconciled: () => Promise<boolean | string>) {
    const seen: TxState["stage"][] = [];
    let n = 0;
    const poller = { getTransaction: async () => ({ statusName: statuses[Math.min(n++, statuses.length - 1)] }) };
    const client = { writeContract: async () => HASH };
    const run = runWrite({
      config, client: client as never, poller: poller as never, pollMs: 1000,
      functionName: "fund_obligation", args: ["5"], value: 1n, reconciled,
      onUpdate: (s) => { if (seen.at(-1) !== s.stage) seen.push(s.stage); },
    });
    return { seen, run };
  }

  it("reports DECIDED only after the contract's own state shows the write", async () => {
    let caughtUp = false;
    const { seen, run } = harness(["PENDING", "PROPOSING", "ACCEPTED", "ACCEPTED", "FINALIZED"], async () => caughtUp);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(seen).toEqual(["SIGNATURE_REQUIRED", "SUBMITTED", "PENDING"]);   // accepted, not yet reflected
    caughtUp = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen.at(-1)).toBe("DECIDED");
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await run).stage).toBe("FINALIZED");
    expect(seen).toEqual(["SIGNATURE_REQUIRED", "SUBMITTED", "PENDING", "DECIDED", "FINALIZED"]);
  });

  it("fails without deciding when validators reach no decision", async () => {
    const { seen, run } = harness(["PENDING", "UNDETERMINED"], async () => true);
    await vi.advanceTimersByTimeAsync(20_000);
    const final = await run;
    expect(final.stage).toBe("FAILED");
    expect(final.reached).toBe("PENDING");
    expect(seen).not.toContain("DECIDED");
  });

  it("fails with the contract's own words when its views show it declined", async () => {
    const { run } = harness(["ACCEPTED"], async () => "the bond must be exactly 10000000000000000 atto; 0 was sent");
    await vi.advanceTimersByTimeAsync(20_000);
    const final = await run;
    expect(final.stage).toBe("FAILED");
    expect(final.message).toMatch(/the bond must be exactly/);
  });
});
