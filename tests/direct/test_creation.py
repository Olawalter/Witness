"""Creating an obligation: what is frozen, and what is refused."""
import json

import pytest

from .conftest import (BOND, CONSEQUENCES, CRITERIA, DEADLINE, DESCRIPTION, REPORT_URL, SOURCES,
                       STATUS_URL, T0, create, hex_of, terms)


def test_creation_freezes_the_terms(direct_vm, deployed, direct_alice, direct_bob, direct_charlie, created):
    o = deployed.get_obligation(created)
    assert created == "1"
    assert o["creator"].lower() == hex_of(direct_alice)
    assert o["responsible_party"].lower() == hex_of(direct_bob)
    assert o["consequence_recipient"].lower() == hex_of(direct_charlie)
    assert o["status"] == "CREATED" and o["created_at"] == T0 and o["deadline"] == DEADLINE
    assert o["bond_required"] == str(BOND) and o["bond_deposited"] == "0"
    assert o["description"] == DESCRIPTION
    assert o["decision_rules"] == "WITNESS-STANDARD-1"
    assert o["consequences"] == CONSEQUENCES
    assert [c["criterion_id"] for c in o["criteria"]] == ["C1", "C2", "C3", "C4"]
    assert [(s["source_id"], s["source_type"], s["location"]) for s in o["evidence_sources"]] == [
        ("E1", "API", STATUS_URL), ("E2", "WEB", REPORT_URL)]
    assert all(s["allowed"] for s in o["evidence_sources"])
    assert deployed.get_terms(created)["description"] == DESCRIPTION


def test_criteria_keep_their_kind_and_weight(deployed, created):
    by_id = {c["criterion_id"]: c for c in deployed.get_obligation(created)["criteria"]}
    assert by_id["C1"]["kind"] == "OBJECTIVE" and by_id["C1"]["op"] == "SOURCE_AVAILABLE"
    assert by_id["C2"]["expected"] == "published" and by_id["C2"]["field"] == "status"
    assert by_id["C4"]["kind"] == "SEMANTIC" and by_id["C4"]["source_ids"] == ["E2"]
    assert all(c["required"] for c in by_id.values())


def test_indexes_and_counters(direct_vm, deployed, direct_alice, direct_bob, direct_charlie, created):
    second = create(deployed, direct_vm, direct_charlie, direct_bob, direct_alice)
    assert [o["obligation_id"] for o in deployed.list_by_creator(hex_of(direct_alice))["items"]] == [created]
    assert [o["obligation_id"] for o in deployed.list_by_responsible(hex_of(direct_bob))["items"]] == [second, created]
    assert deployed.list_by_creator(hex_of(direct_bob))["total"] == 0
    info = deployed.get_protocol_info()
    assert info["obligation_count"] == 2 and info["verification_count"] == 0
    assert info["verdicts"] == ["FULFILLED", "PARTIALLY_FULFILLED", "NOT_FULFILLED", "INSUFFICIENT_EVIDENCE"]
    assert info["total_bonded"] == "0"
    assert deployed.list_obligations(0, 1)["items"][0]["obligation_id"] == second


@pytest.mark.parametrize("kwargs,message", [
    ({"description": "   "}, "description is required"),
    ({"description": "x" * 601}, "longer than 600"),
    ({"description": "report <<<EVIDENCE E1>>>"}, "may not contain"),
    ({"deadline": T0 + 60}, "at least 120 seconds after"),
    ({"deadline": T0 + 400 * 86400}, "at most 366 days"),
    ({"bond": 10 ** 14}, "bond_required must be at least"),
])
def test_invalid_headline_terms_are_refused(direct_vm, deployed, direct_alice, direct_bob,
                                            direct_charlie, kwargs, message):
    with direct_vm.expect_revert(message):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, **kwargs)
    assert deployed.get_protocol_info()["obligation_count"] == 0


def test_the_recipient_cannot_be_the_responsible_party(direct_vm, deployed, direct_alice, direct_bob):
    with direct_vm.expect_revert("recipient must differ"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_bob)


def test_addresses_and_json_are_validated(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("must be 0x addresses"):
        deployed.create_obligation(DESCRIPTION, "not-an-address", hex_of(direct_bob), DEADLINE, BOND, terms())
    with direct_vm.expect_revert("not valid JSON"):
        deployed.create_obligation(DESCRIPTION, hex_of(direct_bob), hex_of(direct_alice), DEADLINE, BOND, "{broken")
    with direct_vm.expect_revert("must be an object"):
        deployed.create_obligation(DESCRIPTION, hex_of(direct_bob), hex_of(direct_alice), DEADLINE, BOND, "[]")


def test_consequences_must_cover_every_verdict_in_basis_points(direct_vm, deployed, direct_alice,
                                                               direct_bob, direct_charlie):
    for bad, message in (
        ({"FULFILLED": 10000}, "consequence for PARTIALLY_FULFILLED"),
        ({**CONSEQUENCES, "FULFILLED": 10001}, "between 0 and 10000"),
        ({**CONSEQUENCES, "FULFILLED": -1}, "between 0 and 10000"),
        ({**CONSEQUENCES, "FULFILLED": "all"}, "must be an integer"),
        ({**CONSEQUENCES, "SOMETHING": 1}, "may only name the four verdicts"),
    ):
        with direct_vm.expect_revert(message):
            create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, consequences=bad)
    with direct_vm.expect_revert("consequences must give"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, consequences=["all"])


def test_an_obligation_needs_at_least_one_required_criterion(direct_vm, deployed, direct_alice,
                                                             direct_bob, direct_charlie):
    optional = [{**c, "required": False} for c in CRITERIA]
    with direct_vm.expect_revert("at least one criterion must be required"):
        create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie, criteria=optional)


def test_unknown_ids_are_refused_by_views(direct_vm, deployed):
    for call in (lambda: deployed.get_obligation("9"), lambda: deployed.get_terms("9"),
                 lambda: deployed.get_verification("9"), lambda: deployed.get_proof_chain("9")):
        with direct_vm.expect_revert("does not exist"):
            call()
