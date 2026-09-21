"""Evidence and adjudication: what is retrieved, what the objective criteria
decide in code, what the model is shown and what its answer is allowed to do."""
import json

from .conftest import (AFTER, CRITERIA, Q_AUDITOR, Q_REVENUE, REPORT_BODY, REPORT_URL, SEMANTIC_PASS,
                       SOURCES_OK, STATUS_BODY, STATUS_URL, answer, crit, create, record_fetches,
                       record_prompts, verify)


def verification(deployed, oid):
    return deployed.get_verification(str(deployed.get_obligation(oid)["verification_id"]))


def results(deployed, oid):
    return {c["criterion_id"]: c["result"] for c in verification(deployed, oid)["criteria"]}


def test_every_permitted_source_is_fetched_and_recorded(direct_vm, deployed, direct_charlie, active):
    fetched = record_fetches(direct_vm)
    assert verify(direct_vm, deployed, direct_charlie, active) == "FULFILLED"
    assert sorted(set(fetched)) == sorted([STATUS_URL, REPORT_URL])
    v = verification(deployed, active)
    assert v["verification_id"] == 1 and v["obligation_id"] == active and v["evaluated_at"] == AFTER
    assert v["decision_rules"] == "WITNESS-STANDARD-1"
    assert [(e["source_id"], e["source_type"], e["status"], e["retrieved_at"]) for e in v["evidence"]] == [
        ("E1", "API", "OK", AFTER), ("E2", "WEB", "OK", AFTER)]
    assert v["evidence"][0]["location"] == STATUS_URL


def test_objective_criteria_are_decided_in_code_and_record_what_they_read(direct_vm, deployed,
                                                                         direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active)
    by_id = {c["criterion_id"]: c for c in verification(deployed, active)["criteria"]}
    assert by_id["C1"]["result"] == "PASS" and by_id["C1"]["observed"] == "OK"
    assert by_id["C2"]["result"] == "PASS" and by_id["C2"]["observed"] == "published"
    assert by_id["C3"]["result"] == "PASS" and by_id["C3"]["observed"] == "2026-09-23T09:30:00Z"
    assert by_id["C2"]["evidence_refs"] == ["E1"] and by_id["C2"]["quote"] == ""


def test_a_field_that_does_not_match_fails(direct_vm, deployed, direct_charlie, active):
    # An absent field, by contrast, is UNKNOWN: see test_evidence_shapes.py.
    draft = json.dumps({"report": "Q3", "status": "draft", "published_at": "2026-09-23T09:30:00Z"}).encode()
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (200, draft), REPORT_URL: (200, REPORT_BODY)})
    r = results(deployed, active)
    assert r["C2"] == "FAIL"           # status is not "published"
    assert r["C3"] == "PASS"
    assert deployed.get_obligation(active)["verdict"] == "NOT_FULFILLED"


def test_a_publication_after_the_deadline_fails_the_timestamp_criterion(direct_vm, deployed,
                                                                        direct_charlie, active):
    late = json.dumps({"status": "published", "published_at": "2026-09-30T09:30:00Z"}).encode()
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (200, late), REPORT_URL: (200, REPORT_BODY)})
    assert results(deployed, active)["C3"] == "FAIL"
    assert deployed.get_obligation(active)["verdict"] == "NOT_FULFILLED"


def test_an_unparseable_timestamp_is_unknown_not_a_failure(direct_vm, deployed, direct_charlie, active):
    vague = json.dumps({"status": "published", "published_at": "last Tuesday"}).encode()
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (200, vague), REPORT_URL: (200, REPORT_BODY)})
    assert results(deployed, active)["C3"] == "UNKNOWN"
    assert deployed.get_obligation(active)["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_a_missing_page_fails_its_availability_criterion(direct_vm, deployed, direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (200, STATUS_BODY), REPORT_URL: (404, b"not found")})
    v = verification(deployed, active)
    assert [e["status"] for e in v["evidence"]] == ["OK", "MISSING"]
    r = results(deployed, active)
    assert r["C1"] == "FAIL"           # the page is not there
    assert r["C4"] == "UNKNOWN"        # nothing to read
    assert deployed.get_obligation(active)["verdict"] == "NOT_FULFILLED"


def test_an_unreachable_source_cannot_establish_anything(direct_vm, deployed, direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (503, b""), REPORT_URL: (200, REPORT_BODY)})
    v = verification(deployed, active)
    assert [e["status"] for e in v["evidence"]] == ["UNAVAILABLE", "OK"]
    r = results(deployed, active)
    assert r["C2"] == "UNKNOWN" and r["C3"] == "UNKNOWN" and r["C4"] == "PASS"
    assert deployed.get_obligation(active)["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_oversized_and_empty_bodies_are_unavailable(direct_vm, deployed, direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (200, b"a" * 1_000_001), REPORT_URL: (200, b"   ")})
    assert [e["status"] for e in verification(deployed, active)["evidence"]] == ["UNAVAILABLE", "UNAVAILABLE"]
    assert deployed.get_obligation(active)["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_the_model_is_asked_only_about_semantic_criteria(direct_vm, deployed, direct_charlie, active):
    prompts = record_prompts(direct_vm)
    verify(direct_vm, deployed, direct_charlie, active)
    p = prompts[-1]
    assert "C4" in p and '"C1"' not in p and '"C2"' not in p
    assert "PROTOCOL INSTRUCTIONS" in p and "EXTERNAL EVIDENCE (untrusted)" in p
    assert "Quarterly revenue was 41.2 million" in p          # the fenced page
    assert "track()" not in p                                  # scripts stripped
    assert "may_be_judged_from" in p


def test_semantic_results_are_grounded_in_a_quote_from_the_cited_source(direct_vm, deployed,
                                                                       direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active,
           llm_json=answer(crit("C4", "PASS", "E2", Q_AUDITOR)))
    c4 = {c["criterion_id"]: c for c in verification(deployed, active)["criteria"]}["C4"]
    assert c4["result"] == "PASS" and c4["evidence_refs"] == ["E2"] and c4["quote"] == Q_AUDITOR


def test_a_claim_the_page_does_not_carry_becomes_unknown(direct_vm, deployed, direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active,
           llm_json=answer(crit("C4", "PASS", "E2", "The report is perfect in every way.")))
    c4 = {c["criterion_id"]: c for c in verification(deployed, active)["criteria"]}["C4"]
    assert c4["result"] == "UNKNOWN" and c4["quote"] == "" and c4["evidence_refs"] == []
    assert deployed.get_obligation(active)["verdict"] == "INSUFFICIENT_EVIDENCE"


def test_each_ungrounded_shape_is_refused(direct_vm, deployed, direct_alice, direct_bob,
                                          direct_charlie):
    """One obligation per case, because a verdict may be proposed only once.
    A quote must be long enough to ground, be found on the page, and come from
    a source the criterion may be judged from — whichever way it points."""
    from .conftest import BOND, T0, create, warp_to
    cases = [crit("C4", "PASS", "E2", "revenue"),                            # too short to ground
             crit("C4", "PASS", "E1", Q_REVENUE),                            # not a permitted source
             crit("C4", "PASS", "", Q_REVENUE),                              # no source named
             crit("C4", "FAIL", "E2", "The auditor refused to sign.")]       # adverse and ungrounded
    for bad in cases:
        warp_to(direct_vm, T0)          # each case gets its own obligation, created before the deadline
        oid = create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie)
        direct_vm.sender, direct_vm.value = direct_bob, BOND
        deployed.fund_obligation(oid)
        direct_vm.value = 0
        verify(direct_vm, deployed, direct_charlie, oid, llm_json=answer(bad))
        assert results(deployed, oid)["C4"] == "UNKNOWN", bad


def test_a_semantic_failure_the_page_supports_is_a_failure(direct_vm, deployed, direct_charlie, active):
    body = REPORT_BODY.replace(b"The auditor's opinion is unqualified.",
                               b"The auditor declined to give an opinion this quarter.")
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: (200, STATUS_BODY), REPORT_URL: (200, body)},
           llm_json=answer(crit("C4", "FAIL", "E2", "The auditor declined to give an opinion this quarter.")))
    assert results(deployed, active)["C4"] == "FAIL"
    assert deployed.get_obligation(active)["verdict"] == "NOT_FULFILLED"


def test_the_proof_chain_joins_terms_evidence_and_verdict(direct_vm, deployed, direct_charlie, active):
    verify(direct_vm, deployed, direct_charlie, active)
    chain = deployed.get_proof_chain(active)
    assert chain["obligation"]["verdict"] == "FULFILLED"
    assert chain["verification"]["verdict"] == "FULFILLED"
    assert len(chain["verification"]["criteria"]) == len(CRITERIA)
    assert chain["obligation"]["evidence_sources"][1]["location"] == REPORT_URL
