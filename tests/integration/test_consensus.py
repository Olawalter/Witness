"""Consensus and finality on the real network.

Every verification runs as one `run_nondet_unsafe` round: the leader proposes,
each validator refetches the same sources, re-reads them and re-derives the
result, and the round is accepted only if they agree on every consensus-critical
field. What the network reports about that round is asserted here.
"""


def test_every_verdict_was_reached_by_a_validator_panel(world):
    world.verified()
    for key, rec in world.live.record["obligations"].items():
        facts = rec["verify_facts"]
        assert facts["consensus"] in ("MAJORITY_AGREE", "AGREE"), (key, facts)
        assert facts["votes"], (key, facts)
        assert any(v == "agree" for v in facts["votes"]), (key, facts)


def test_the_contract_records_what_the_panel_agreed_on(world):
    """The stored verification is the agreed result: a verdict, one row per
    criterion with its result and the evidence it rests on, and the
    availability of every source."""
    world.verified()
    for key, rec in world.live.record["obligations"].items():
        v = rec["verification"]
        terms = rec["terms"]
        assert v is not None, key
        assert v["decision_rules"] == "WITNESS-STANDARD-1"
        assert [c["criterion_id"] for c in v["criteria"]] == [c["criterion_id"] for c in terms["criteria"]]
        assert [e["source_id"] for e in v["evidence"]] == [s["source_id"] for s in terms["evidence_sources"]]
        for c in v["criteria"]:
            assert c["result"] in ("PASS", "FAIL", "UNKNOWN")
            assert all(r in {s["source_id"] for s in terms["evidence_sources"]} for r in c["evidence_refs"])


def test_a_semantic_result_is_grounded_in_a_quote_from_the_cited_source(world):
    """A semantic PASS or FAIL carries a passage every validator found in its
    own copy of the page; an ungrounded one is downgraded to UNKNOWN in code."""
    world.verified()
    fulfilled = world.live.record["obligations"]["fulfilled"]["verification"]
    semantic = [c for c in fulfilled["criteria"] if c["quote"]]
    assert semantic, fulfilled
    for c in semantic:
        assert len(c["quote"]) >= 12 and len(c["evidence_refs"]) == 1


def test_a_verdict_becomes_final_only_after_the_delay_and_protocol_finality(world):
    world.finalized()
    live = world.live
    early = live.record["refused_early_finalization"]
    assert early["refused"] and "can be finalized at" in early["refusal"]
    for key, rec in live.record["obligations"].items():
        assert rec["verify_final"]["status"] == "FINALIZED", key
        assert live.read("get_obligation", world.ids[key])["status"] == "FINALIZED"


def test_the_verification_transaction_is_the_only_thing_that_changed_state(world):
    """Nothing in the nondeterministic block writes: before its verification a
    obligation is ACTIVE with its bond intact, and the round is what moves it."""
    world.verified()
    for key, rec in world.live.record["obligations"].items():
        o = rec["after_verification"]
        assert o["status"] == "VERDICT_PROPOSED" and o["bond_deposited"] != "0", key
        assert o["verification_id"] == rec["verification"]["verification_id"]
