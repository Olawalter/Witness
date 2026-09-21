"""Every shape a source can answer in, against the objective operators, with the
exact (result, observed) pair the contract must record.

WITNESS's central distinction is between "the evidence shows it did not happen"
and "the evidence cannot say": the first is NOT_FULFILLED and pays the recipient,
the second is INSUFFICIENT_EVIDENCE and splits on its own share. `observed` is
consensus-critical — validators compare it field by field — so every case pins
it as well as the result. The mutation sweep found three of these pairs unheld.
"""
import json

import pytest

from .conftest import (BOND, REPORT_BODY, REPORT_URL, SOURCES, STATUS_BODY, STATUS_URL, create,
                       verify)

NO_STATUS = json.dumps({"report": "Q3", "published_at": "2026-09-23T09:30:00Z"}).encode()
NOT_JSON = b"<html><body>the status page has moved</body></html>"


def _criteria(deployed, oid):
    vid = str(deployed.get_obligation(oid)["verification_id"])
    return {c["criterion_id"]: c for c in deployed.get_verification(vid)["criteria"]}


# (what E1 serves, C2 = EQUALS status, C3 = BEFORE_DEADLINE published_at, verdict)
SHAPES = {
    "readable and correct": ((200, STATUS_BODY), ("PASS", "published"),
                             ("PASS", "2026-09-23T09:30:00Z"), "FULFILLED"),
    # 404 and 410 are evidence of absence: the location states the thing is not there.
    "missing": ((404, b"not found"), ("FAIL", "MISSING"), ("FAIL", "MISSING"), "NOT_FULFILLED"),
    "gone": ((410, b"gone"), ("FAIL", "MISSING"), ("FAIL", "MISSING"), "NOT_FULFILLED"),
    # Anything else is absence of evidence and establishes nothing.
    "unreachable": ((503, b""), ("UNKNOWN", "UNAVAILABLE"), ("UNKNOWN", "UNAVAILABLE"),
                    "INSUFFICIENT_EVIDENCE"),
    "not json": ((200, NOT_JSON), ("UNKNOWN", "NOT_JSON"), ("UNKNOWN", "NOT_JSON"),
                 "INSUFFICIENT_EVIDENCE"),
    # The source answers but says nothing about the field this criterion names.
    "field absent": ((200, NO_STATUS), ("UNKNOWN", "ABSENT"), ("PASS", "2026-09-23T09:30:00Z"),
                     "INSUFFICIENT_EVIDENCE"),
}


@pytest.mark.parametrize("shape", list(SHAPES))
def test_each_shape_of_answer_records_one_exact_pair(direct_vm, deployed, direct_charlie, active, shape):
    served, c2, c3, verdict = SHAPES[shape]
    verify(direct_vm, deployed, direct_charlie, active,
           sources={STATUS_URL: served, REPORT_URL: (200, REPORT_BODY)})
    by_id = _criteria(deployed, active)
    assert (by_id["C2"]["result"], by_id["C2"]["observed"]) == c2
    assert (by_id["C3"]["result"], by_id["C3"]["observed"]) == c3
    assert deployed.get_obligation(active)["verdict"] == verdict


# ─── EXISTS, where "not there" and "cannot tell" are easiest to confuse ──────

EXISTS_CRITERIA = [{"kind": "OBJECTIVE", "required": True, "text": "An audit reference is recorded.",
                    "source_id": "E1", "op": "EXISTS", "field": "audit_ref"}]

EXISTS_CASES = {
    "present": ((200, json.dumps({"report": "Q3", "audit_ref": "AR-2026-114"}).encode()),
                ("PASS", "AR-2026-114"), "FULFILLED"),
    # The source answered, and the reference is not in it: that is a failure.
    "absent": ((200, json.dumps({"report": "Q3"}).encode()), ("FAIL", "ABSENT"), "NOT_FULFILLED"),
    "null": ((200, json.dumps({"report": "Q3", "audit_ref": None}).encode()), ("FAIL", "null"),
             "NOT_FULFILLED"),
    "missing": ((404, b"not found"), ("FAIL", "MISSING"), "NOT_FULFILLED"),
    # The source did not answer: nothing can be concluded, least of all a failure.
    "unreachable": ((503, b""), ("UNKNOWN", "UNAVAILABLE"), "INSUFFICIENT_EVIDENCE"),
    "not json": ((200, NOT_JSON), ("UNKNOWN", "NOT_JSON"), "INSUFFICIENT_EVIDENCE"),
}


@pytest.mark.parametrize("case", list(EXISTS_CASES))
def test_exists_separates_not_there_from_cannot_tell(direct_vm, deployed, direct_alice, direct_bob,
                                                     direct_charlie, case):
    served, pair, verdict = EXISTS_CASES[case]
    oid = create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie,
                 criteria=EXISTS_CRITERIA, sources=[SOURCES[0]])
    direct_vm.sender = direct_bob
    direct_vm.value = BOND
    deployed.fund_obligation(oid)
    direct_vm.value = 0

    verify(direct_vm, deployed, direct_charlie, oid, llm_json=None, sources={STATUS_URL: served})
    c = _criteria(deployed, oid)["C1"]
    assert (c["result"], c["observed"]) == pair
    assert deployed.get_obligation(oid)["verdict"] == verdict
