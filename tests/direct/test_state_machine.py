"""The lifecycle: which transition is legal where, and who may cancel."""
from .conftest import (AFTER, BOND, DEADLINE, FINALITY_DELAY, T0, finalize, hex_of, settle, verify,
                       warp_to)


def test_the_happy_path_walks_the_states_in_order(direct_vm, deployed, direct_alice, direct_bob,
                                                  direct_charlie, created):
    assert deployed.get_obligation(created)["status"] == "CREATED"
    direct_vm.sender, direct_vm.value = direct_bob, BOND
    deployed.fund_obligation(created)
    direct_vm.value = 0
    assert deployed.get_obligation(created)["status"] == "ACTIVE"
    verify(direct_vm, deployed, direct_charlie, created)
    o = deployed.get_obligation(created)
    assert o["status"] == "VERDICT_PROPOSED" and o["verdict"] == "FULFILLED"
    assert o["proposed_at"] == AFTER and o["finalizable_at"] == AFTER + FINALITY_DELAY
    finalize(direct_vm, deployed, direct_alice, created)
    assert deployed.get_obligation(created)["status"] == "FINALIZED"
    settle(direct_vm, deployed, direct_alice, created)
    assert deployed.get_obligation(created)["status"] == "SETTLED"


def test_verification_before_the_deadline_is_refused(direct_vm, deployed, direct_charlie, active):
    with direct_vm.expect_revert("verification cannot start yet"):
        verify(direct_vm, deployed, direct_charlie, active, at=DEADLINE - 1)
    assert deployed.get_obligation(active)["status"] == "ACTIVE"
    assert deployed.get_protocol_info()["verification_count"] == 0


def test_an_unfunded_obligation_cannot_be_verified(direct_vm, deployed, direct_charlie, created):
    with direct_vm.expect_revert("only an active obligation can be verified; it is CREATED"):
        verify(direct_vm, deployed, direct_charlie, created)


def test_a_verdict_cannot_be_proposed_twice(direct_vm, deployed, direct_charlie, proposed):
    with direct_vm.expect_revert("only an active obligation can be verified; it is VERDICT_PROPOSED"):
        verify(direct_vm, deployed, direct_charlie, proposed, at=AFTER + 60)
    assert deployed.get_protocol_info()["verification_count"] == 1


def test_finalization_waits_for_the_finality_delay(direct_vm, deployed, direct_alice, proposed):
    with direct_vm.expect_revert("the verdict can be finalized at"):
        finalize(direct_vm, deployed, direct_alice, proposed, at=AFTER + FINALITY_DELAY - 1)
    assert deployed.get_obligation(proposed)["status"] == "VERDICT_PROPOSED"
    finalize(direct_vm, deployed, direct_alice, proposed)
    assert deployed.get_obligation(proposed)["finalized_at"] == AFTER + FINALITY_DELAY


def test_finalization_needs_a_proposed_verdict(direct_vm, deployed, direct_alice, active):
    warp_to(direct_vm, AFTER)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only a proposed verdict can be finalized; the obligation is ACTIVE"):
        deployed.finalize_verdict(active)


def test_settlement_needs_finalization(direct_vm, deployed, direct_alice, proposed, transfers):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only a finalized verdict can be settled; the obligation is VERDICT_PROPOSED"):
        deployed.settle_obligation(proposed)
    assert transfers == []
    assert deployed.get_obligation(proposed)["bond_deposited"] == str(BOND)


def test_the_creator_can_cancel_only_before_the_bond(direct_vm, deployed, direct_alice, direct_bob,
                                                     direct_charlie, created):
    for stranger in (direct_bob, direct_charlie):
        direct_vm.sender = stranger
        with direct_vm.expect_revert("only the creator can cancel"):
            deployed.cancel_obligation(created)
    direct_vm.sender = direct_alice
    deployed.cancel_obligation(created)
    o = deployed.get_obligation(created)
    assert o["status"] == "CANCELLED" and o["cancelled_at"] == T0
    with direct_vm.expect_revert("only an obligation awaiting its bond can be cancelled"):
        deployed.cancel_obligation(created)


def test_a_bonded_obligation_cannot_be_cancelled(direct_vm, deployed, direct_alice, active, transfers):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only an obligation awaiting its bond can be cancelled; it is ACTIVE"):
        deployed.cancel_obligation(active)
    assert transfers == []
    assert deployed.get_obligation(active)["bond_deposited"] == str(BOND)


def test_a_cancelled_obligation_refuses_the_bond(direct_vm, deployed, direct_alice, direct_bob,
                                                 created, transfers):
    direct_vm.sender = direct_alice
    deployed.cancel_obligation(created)
    direct_vm.sender, direct_vm.value = direct_bob, BOND
    out = deployed.fund_obligation(created)
    direct_vm.value = 0
    assert out == "RETURNED: the obligation is CANCELLED, not awaiting its bond"
    assert transfers == [(hex_of(direct_bob), BOND)]
