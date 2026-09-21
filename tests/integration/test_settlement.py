"""Settlement on the real network: the finalized verdict decides where the
bond goes, in the basis points the terms fixed before anything was witnessed."""

from .conftest import BOND


def test_the_bond_moves_exactly_as_the_terms_said(world):
    balances = world.settled()
    # FULFILLED returns the whole bond; NOT_FULFILLED sends it to the recipient;
    # INSUFFICIENT_EVIDENCE splits it evenly. The injection obligation is not
    # FULFILLED, so its bond does not come back whole either.
    assert balances["before"]["contract"] == 4 * BOND
    assert balances["after"]["contract"] == 0
    assert balances["delta"]["party"] > 0 and balances["delta"]["recipient"] > 0
    assert balances["delta"]["party"] + balances["delta"]["recipient"] == 4 * BOND


def test_each_obligation_paid_what_its_verdict_maps_to(world):
    world.settled()
    for key, rec in world.live.record["obligations"].items():
        o = rec["settled"]
        verdict = o["verdict"]
        bps = rec["terms"]["consequences"][verdict]
        expected_party = BOND * bps // 10000
        assert o["settled"] is True and o["status"] == "SETTLED", key
        assert o["bond_deposited"] == "0", key
        assert int(o["paid_responsible"]) == expected_party, (key, verdict)
        assert int(o["paid_recipient"]) == BOND - expected_party, (key, verdict)


def test_settlement_needs_finalization_and_happens_once(world):
    world.settled()
    live = world.live
    early = live.record["refused_settle_before_final"]
    assert early["refused"] and "only a finalized verdict can be settled" in early["refusal"]
    again = live.record["refused_second_settlement"]
    assert again["refused"] and "the obligation is SETTLED" in again["refusal"]


def test_the_proof_chain_reads_back_from_the_chain_alone(world):
    """Bond, terms, evidence, adjudication, verdict and settlement, as one read
    a reviewer can repeat without this repository."""
    world.settled()
    for key, rec in world.live.record["obligations"].items():
        chain = rec["proof_chain"]
        o, v = chain["obligation"], chain["verification"]
        assert o["status"] == "SETTLED" and o["verdict"] == v["verdict"], key
        assert o["bond_required"] == str(BOND)
        assert len(v["criteria"]) == len(o["criteria"])
        assert v["evaluated_at"] > 0 and o["finalized_at"] >= v["evaluated_at"]
        assert o["settled_at"] >= o["finalized_at"]
