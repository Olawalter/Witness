"""Criteria and evidence sources: what a creator may define, and what the
contract refuses to hold."""
import pytest

from .conftest import CRITERIA, REPORT_URL, SOURCES, STATUS_URL, create


def only(*criteria):
    return list(criteria)


@pytest.mark.parametrize("criterion,message", [
    ({"kind": "GUESS", "required": True, "text": "t", "source_id": "E1", "op": "EXISTS", "field": "a"},
     "kind must be OBJECTIVE or SEMANTIC"),
    ({"kind": "OBJECTIVE", "required": True, "text": "", "source_id": "E1", "op": "EXISTS", "field": "a"},
     "text of C1 is required"),
    ({"kind": "OBJECTIVE", "required": "yes", "text": "t", "source_id": "E1", "op": "EXISTS", "field": "a"},
     "required must be true or false"),
    ({"kind": "OBJECTIVE", "required": True, "text": "t", "source_id": "E9", "op": "EXISTS", "field": "a"},
     "must name one of the evidence sources"),
    ({"kind": "OBJECTIVE", "required": True, "text": "t", "source_id": "E1", "op": "SOUNDS_RIGHT"},
     "op must be one of"),
    ({"kind": "OBJECTIVE", "required": True, "text": "t", "source_id": "E1", "op": "EQUALS", "field": "a b",
      "expected": "x"}, "needs a JSON field path"),
    ({"kind": "OBJECTIVE", "required": True, "text": "t", "source_id": "E1", "op": "EQUALS", "field": "status"},
     "expected value of C1 is required"),
    ({"kind": "OBJECTIVE", "required": True, "text": "t", "source_id": "E1", "op": "GTE", "field": "pages",
      "expected": "many"}, "expected value must be a number"),
    ({"kind": "SEMANTIC", "required": True, "text": "t"}, "must name the evidence sources"),
    ({"kind": "SEMANTIC", "required": True, "text": "t", "source_ids": ["E7"]}, "unknown evidence source E7"),
    ({"kind": "SEMANTIC", "required": True, "text": "t" * 401, "source_ids": ["E1"]}, "longer than 400"),
])
def test_invalid_criteria_are_refused(direct_vm, deployed, direct_alice, direct_bob, direct_charlie,
                                      criterion, message):
    with direct_vm.expect_revert(message):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, criteria=only(criterion))


def test_criteria_are_bounded_and_required(direct_vm, deployed, direct_alice, direct_bob, direct_charlie):
    with direct_vm.expect_revert("at least one acceptance criterion"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, criteria=[])
    with direct_vm.expect_revert("at most 8 criteria"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, criteria=CRITERIA * 3)


@pytest.mark.parametrize("source,message", [
    ({"source_type": "TELEPATHY", "location": STATUS_URL, "description": "d"}, "type must be one of"),
    ({"source_type": "API", "location": "http://insecure.test/a", "description": "d"}, "needs an https location"),
    ({"source_type": "API", "location": "https://nodot/a", "description": "d"}, "needs an https location"),
    ({"source_type": "GITHUB", "location": "https://example.com/repo", "description": "d"},
     "is GITHUB but is not on"),
    ({"source_type": "API", "location": STATUS_URL, "description": "x" * 201}, "longer than 200"),
])
def test_invalid_sources_are_refused(direct_vm, deployed, direct_alice, direct_bob, direct_charlie,
                                     source, message):
    with direct_vm.expect_revert(message):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, sources=[source],
               criteria=[{"kind": "SEMANTIC", "required": True, "text": "t", "source_ids": ["E1"]}])


def test_sources_are_bounded_and_deduplicated(direct_vm, deployed, direct_alice, direct_bob, direct_charlie):
    with direct_vm.expect_revert("at least one evidence source"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, sources=[])
    with direct_vm.expect_revert("at most 4 evidence sources"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie,
               sources=[{"source_type": "WEB", "location": f"https://s{i}.test/p", "description": "d"}
                        for i in range(5)],
               criteria=[{"kind": "SEMANTIC", "required": True, "text": "t", "source_ids": ["E1"]}])
    duplicate = [{"source_type": "WEB", "location": REPORT_URL, "description": "one"},
                 {"source_type": "WEB", "location": "https://FIXTURE-WITNESS.test/reports/q3/",
                  "description": "again"}]
    with direct_vm.expect_revert("repeats an earlier location"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, sources=duplicate,
               criteria=[{"kind": "SEMANTIC", "required": True, "text": "t", "source_ids": ["E1"]}])


def test_github_sources_are_accepted_on_github_hosts(direct_vm, deployed, direct_alice, direct_bob,
                                                     direct_charlie):
    oid = create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie,
                 sources=[{"source_type": "GITHUB",
                           "location": "https://api.github.com/repos/genlayerlabs/genlayer-js/releases/latest",
                           "description": "Release record"}],
                 criteria=[{"kind": "OBJECTIVE", "required": True, "text": "A release is published.",
                            "source_id": "E1", "op": "EXISTS", "field": "tag_name"}])
    assert deployed.get_obligation(oid)["evidence_sources"][0]["host"] == "api.github.com"
