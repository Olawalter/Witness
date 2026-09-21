import type { Obligation } from "@/types/witness";
import type { WriteMethod } from "@/lib/contracts/witness";

/**
 * Which acts the contract would accept right now, and for whom. A pure
 * function of (obligation, viewer, clock) so every state and role can be tested
 * without a browser or a chain.
 *
 * An act the contract would refuse is never offered as a button that fails: it
 * is listed with the reason, in words. An empty list says so rather than
 * vanishing.
 */

export type ActId = Exclude<WriteMethod, "create_obligation">;

export type Act = {
  id: ActId;
  title: string;
  /** What it does, for the person about to sign it. */
  detail: string;
  available: boolean;
  /** Why it is not available, when it is not. */
  reason?: string;
  /** Anyone may call it, whoever they are. */
  permissionless: boolean;
};

export type Viewer = { address?: string };

const is = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export function actsFor(o: Obligation, viewer: Viewer, now: number): Act[] {
  const party = is(viewer.address, o.responsible_party);
  const creator = is(viewer.address, o.creator);
  const connected = !!viewer.address;
  const acts: Act[] = [];

  acts.push({
    id: "fund_obligation",
    title: "Commit the bond",
    detail: "Sends exactly the required bond with the transaction. The obligation becomes active.",
    permissionless: false,
    available: o.status === "CREATED" && party && now < o.deadline,
    reason:
      o.status !== "CREATED"
        ? "The bond has already been committed."
        : !connected
          ? "Connect the responsible party's wallet."
          : !party
            ? "Only the responsible party can commit this bond."
            : now >= o.deadline
              ? "The deadline has passed, so the bond can no longer be committed."
              : undefined,
  });

  acts.push({
    id: "cancel_obligation",
    title: "Cancel",
    detail: "Withdraws an obligation nobody has bonded. Once the bond is committed the terms stand.",
    permissionless: false,
    available: o.status === "CREATED" && creator,
    reason:
      o.status !== "CREATED"
        ? "Only an obligation still awaiting its bond can be cancelled."
        : !connected
          ? "Connect the creator's wallet."
          : !creator
            ? "Only the creator can cancel this obligation."
            : undefined,
  });

  acts.push({
    id: "verify_obligation",
    title: "Witness the evidence",
    detail:
      "Asks GenLayer to fetch the permitted sources and adjudicate the criteria. The caller has no influence on the verdict.",
    permissionless: true,
    available: o.status === "ACTIVE" && now >= o.deadline,
    reason:
      o.status === "CREATED"
        ? "The bond has not been committed."
        : o.status !== "ACTIVE"
          ? "This obligation has already been verified."
          : now < o.deadline
            ? "Verification opens after the deadline."
            : undefined,
  });

  acts.push({
    id: "finalize_verdict",
    title: "Finalize the verdict",
    detail: "Marks the proposed verdict final once the contract's finality delay has passed.",
    permissionless: true,
    available: o.status === "VERDICT_PROPOSED" && now >= o.finalizable_at,
    reason:
      o.status !== "VERDICT_PROPOSED"
        ? "There is no proposed verdict to finalize."
        : now < o.finalizable_at
          ? "The finality delay has not passed yet."
          : undefined,
  });

  acts.push({
    id: "settle_obligation",
    title: "Settle the bond",
    detail: "Pays the bond out exactly as the terms map the finalized verdict. It can happen once.",
    permissionless: true,
    available: o.status === "FINALIZED",
    reason: o.status === "SETTLED" ? "The bond has already been paid out." : o.status !== "FINALIZED" ? "The verdict is not final yet." : undefined,
  });

  acts.push({
    id: "recover_obligation",
    title: "Recover the bond",
    detail:
      "The bounded escape when no verdict was ever reached: the bond settles on the terms' insufficient-evidence share.",
    permissionless: true,
    available: o.status === "ACTIVE" && now >= o.recovery_opens_at,
    reason:
      o.status !== "ACTIVE"
        ? "Recovery applies only while an obligation has no verdict."
        : now < o.recovery_opens_at
          ? "Recovery opens long after the deadline, and only if no verdict was reached."
          : undefined,
  });

  return acts;
}

/** The acts worth showing: available ones, plus the ones this viewer could
 * plausibly perform later, so a party is never left wondering. */
export function visibleActs(acts: Act[]): Act[] {
  return acts.filter((a) => a.available || a.reason !== undefined);
}
