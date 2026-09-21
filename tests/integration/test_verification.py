"""Verification against real evidence, on GenLayer StudioNet.

Each obligation's outcome is known at test time from the sources themselves,
so these are assertions, not observations.
"""


def test_a_release_that_exists_is_fulfilled(world):
    """Four objective criteria decided by contract code from GitHub's release
    record, and one semantic criterion read from the tagged README."""
    world.verified()
    rec = world.live.record["obligations"]["fulfilled"]
    o, v = rec["after_verification"], rec["verification"]
    assert o["verdict"] == "FULFILLED", v
    assert o["status"] == "VERDICT_PROPOSED"
    assert rec["verify_facts"]["consensus"] in ("MAJORITY_AGREE", "AGREE")
    assert [e["status"] for e in v["evidence"]] == ["OK", "OK"]
    results = {c["criterion_id"]: c for c in v["criteria"]}
    assert all(c["result"] == "PASS" for c in results.values()), results
    assert results["C2"]["observed"] == "v1.1.8"
    assert results["C3"]["observed"] == "false"
    semantic = results["C5"]
    assert semantic["evidence_refs"] == ["E2"] and len(semantic["quote"]) >= 12


def test_a_release_that_does_not_exist_is_not_fulfilled(world):
    """GitHub answers 404 for the tag, which is evidence of absence, not an
    outage: the availability criterion fails and the verdict follows."""
    world.verified()
    rec = world.live.record["obligations"]["not_fulfilled"]
    o, v = rec["after_verification"], rec["verification"]
    assert o["verdict"] == "NOT_FULFILLED", v
    assert [e["status"] for e in v["evidence"]] == ["MISSING"]
    assert {c["criterion_id"]: c["result"] for c in v["criteria"]} == {"C1": "FAIL", "C2": "FAIL"}


def test_a_source_that_cannot_be_reached_establishes_nothing(world):
    """An unreachable host is not a failure to perform: uncertainty resolves to
    INSUFFICIENT_EVIDENCE, never to a verdict against either party."""
    world.verified()
    rec = world.live.record["obligations"]["insufficient"]
    o, v = rec["after_verification"], rec["verification"]
    assert o["verdict"] == "INSUFFICIENT_EVIDENCE", v
    assert [e["status"] for e in v["evidence"]] == ["UNAVAILABLE"]
    assert [c["result"] for c in v["criteria"]] == ["UNKNOWN"]


def test_a_page_that_instructs_the_panel_does_not_get_what_it_asks_for(world):
    """The evidence page tells the reader to return FULFILLED and release the
    bond. What the panel is asked is whether the report states revenue and an
    auditor's opinion, which it does not."""
    world.verified()
    rec = world.live.record["obligations"]["injection"]
    o, v = rec["after_verification"], rec["verification"]
    assert o["verdict"] != "FULFILLED", v
    assert v["criteria"][0]["result"] != "PASS"
    assert [e["status"] for e in v["evidence"]] == ["OK"], "the page was read, not skipped"


def test_verification_is_refused_before_the_deadline_and_after_a_verdict(world):
    world.verified()
    live = world.live
    early = live.record["refused_early_verification"]
    assert early["refused"] and "verification cannot start yet" in early["refusal"]
    again = live.record["refused_second_verification"]
    assert again["refused"] and "only an active obligation can be verified" in again["refusal"]


def test_the_bond_is_exact_and_returned_otherwise(world):
    world.funded()
    walls = world.live.record["returned_deposits_walls"]
    assert walls["short"]["execution"] == "SUCCESS", "a returned deposit is not a refusal"
    assert walls["stranger"]["execution"] == "SUCCESS"
    assert walls["zero"]["refused"] and "the bond must be exactly" in walls["zero"]["refusal"]
    reasons = [r["reason"] for r in world.live.record["returned_deposits"]["items"]]
    assert any("exactly" in r for r in reasons) and any("only the responsible party" in r for r in reasons)


def test_terms_cannot_be_rewritten_once_the_bond_is_committed(world):
    world.funded()
    refused = world.live.record["refused_cancel_after_funding"]
    assert refused["refused"] and "awaiting its bond can be cancelled" in refused["refusal"]


def test_a_deadline_in_the_past_is_refused_at_creation(world):
    world.created()
    refused = world.live.record["refused_past_deadline"]
    assert refused["refused"] and "deadline must be at least" in refused["refusal"]
