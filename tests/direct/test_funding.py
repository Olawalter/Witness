"""The bond: exact amount, by the responsible party, before the deadline.

A deposit the contract cannot accept is returned in the same transaction and
recorded with its reason, because GenLayer StudioNet credits the value of a
refused payable transaction to the contract: refusing would strand it.
"""
from .conftest import BOND, DEADLINE, T0, create, hex_of, warp_to


def fund(direct_vm, deployed, who, oid, value=BOND):
    direct_vm.sender = who
    direct_vm.value = value
    try:
        return deployed.fund_obligation(oid)
    finally:
        direct_vm.value = 0


def test_exact_funding_activates_the_obligation(direct_vm, deployed, direct_bob, created, transfers):
    warp_to(direct_vm, T0 + 60)
    assert fund(direct_vm, deployed, direct_bob, created) == "ACTIVE"
    o = deployed.get_obligation(created)
    assert o["status"] == "ACTIVE" and o["bond_deposited"] == str(BOND) and o["funded_at"] == T0 + 60
    assert deployed.get_protocol_info()["total_bonded"] == str(BOND)
    assert transfers == []


def test_underfunding_and_overfunding_are_returned(direct_vm, deployed, direct_bob, created, transfers):
    for value in (BOND - 1, BOND + 1):
        out = fund(direct_vm, deployed, direct_bob, created, value)
        assert out.startswith("RETURNED: the bond must be exactly")
    assert [t[1] for t in transfers] == [BOND - 1, BOND + 1]
    assert all(t[0] == hex_of(direct_bob) for t in transfers)
    o = deployed.get_obligation(created)
    assert o["status"] == "CREATED" and o["bond_deposited"] == "0"
    assert deployed.get_protocol_info()["total_bonded"] == "0"


def test_a_zero_value_call_is_refused_outright(direct_vm, deployed, direct_bob, created, transfers):
    direct_vm.sender = direct_bob
    direct_vm.value = 0
    with direct_vm.expect_revert("the bond must be exactly"):
        deployed.fund_obligation(created)
    assert transfers == []
    assert deployed.get_obligation(created)["status"] == "CREATED"


def test_only_the_responsible_party_can_commit_the_bond(direct_vm, deployed, direct_alice,
                                                        direct_charlie, created, transfers):
    for stranger in (direct_alice, direct_charlie):
        out = fund(direct_vm, deployed, stranger, created)
        assert out == "RETURNED: only the responsible party can commit the bond"
    assert [t[0] for t in transfers] == [hex_of(direct_alice), hex_of(direct_charlie)]
    assert [t[1] for t in transfers] == [BOND, BOND]
    assert deployed.get_obligation(created)["status"] == "CREATED"


def test_repeated_funding_is_returned(direct_vm, deployed, direct_bob, active, transfers):
    out = fund(direct_vm, deployed, direct_bob, active)
    assert out == "RETURNED: the obligation is ACTIVE, not awaiting its bond"
    assert transfers == [(hex_of(direct_bob), BOND)]
    o = deployed.get_obligation(active)
    assert o["bond_deposited"] == str(BOND)
    assert deployed.get_protocol_info()["total_bonded"] == str(BOND)


def test_funding_after_the_deadline_is_returned(direct_vm, deployed, direct_bob, created, transfers):
    warp_to(direct_vm, DEADLINE)
    assert fund(direct_vm, deployed, direct_bob, created) == "RETURNED: the deadline has passed"
    assert transfers == [(hex_of(direct_bob), BOND)]
    assert deployed.get_obligation(created)["status"] == "CREATED"


def test_a_deposit_for_an_unknown_obligation_is_returned(direct_vm, deployed, direct_bob, transfers):
    assert fund(direct_vm, deployed, direct_bob, "404") == "RETURNED: the obligation does not exist"
    assert transfers == [(hex_of(direct_bob), BOND)]


def test_every_returned_deposit_is_recorded_with_its_reason(direct_vm, deployed, direct_alice,
                                                            direct_bob, created):
    fund(direct_vm, deployed, direct_bob, created, BOND - 1)
    fund(direct_vm, deployed, direct_alice, created)
    page = deployed.get_returned_deposits(0, 10)
    assert page["total"] == 2
    newest = page["items"][0]
    assert newest["sender"].lower() == hex_of(direct_alice) and newest["amount"] == BOND
    assert "only the responsible party" in newest["reason"]
    assert page["items"][1]["amount"] == BOND - 1
    assert deployed.get_protocol_info()["returned_deposit_count"] == 2


def test_a_returned_deposit_never_touches_the_bond_ledger(direct_vm, deployed, direct_alice,
                                                          direct_bob, direct_charlie, created):
    second = create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie)
    fund(direct_vm, deployed, direct_charlie, second)
    fund(direct_vm, deployed, direct_bob, second, BOND + 5)
    assert deployed.get_obligation(second)["bond_deposited"] == "0"
    assert deployed.get_protocol_info()["total_bonded"] == "0"
    assert fund(direct_vm, deployed, direct_bob, second) == "ACTIVE"
    assert deployed.get_protocol_info()["total_bonded"] == str(BOND)
