"""Recovery: the bounded escape for a bond no verdict ever reached.

An obligation whose every verification attempt failed — sources permanently
gone, no agreement among validators — would otherwise hold its bond forever.
After a long, fixed delay past the deadline anyone may trigger recovery, and
the bond settles exactly as the terms map INSUFFICIENT_EVIDENCE. Nobody
chooses anything: not the caller, not the creator, not the responsible party.
"""
from .conftest import (AFTER, BOND, CONSEQUENCES, DEADLINE, RECOVERY_DELAY, create, finalize,
                       hex_of, settle, verify, warp_to)

OPENS = DEADLINE + RECOVERY_DELAY


def recover(direct_vm, deployed, who, oid, at=OPENS):
    warp_to(direct_vm, at)
    direct_vm.sender = who
    deployed.recover_obligation(oid)


def test_recovery_is_refused_until_its_delay_has_passed(direct_vm, deployed, direct_charlie, active,
                                                        transfers):
    for at in (AFTER, OPENS - 1):
        warp_to(direct_vm, at)
        direct_vm.sender = direct_charlie
        with direct_vm.expect_revert("recovery opens at"):
            deployed.recover_obligation(active)
    assert transfers == []
    assert deployed.get_obligation(active)["status"] == "ACTIVE"


def test_recovery_settles_on_the_predefined_insufficient_evidence_split(direct_vm, deployed,
                                                                        direct_bob, direct_charlie,
                                                                        active, transfers):
    recover(direct_vm, deployed, direct_charlie, active)
    o = deployed.get_obligation(active)
    assert o["status"] == "RECOVERY" and o["settled"] is True and o["recovered_at"] == OPENS
    assert o["bond_deposited"] == "0"
    assert o["paid_responsible"] == str(BOND // 2) and o["paid_recipient"] == str(BOND // 2)
    assert transfers == [(hex_of(direct_bob), BOND // 2), (hex_of(direct_charlie), BOND // 2)]
    assert deployed.get_protocol_info()["total_bonded"] == "0"
    assert o["verdict"] == "", "recovery is not a verdict"


def test_recovery_follows_the_terms_not_a_constant(direct_vm, deployed, direct_alice, direct_bob,
                                                   direct_charlie, transfers):
    to_recipient = {**CONSEQUENCES, "INSUFFICIENT_EVIDENCE": 0}
    oid = create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie,
                 consequences=to_recipient)
    direct_vm.sender, direct_vm.value = direct_bob, BOND
    deployed.fund_obligation(oid)
    direct_vm.value = 0
    recover(direct_vm, deployed, direct_alice, oid)
    assert transfers == [(hex_of(direct_charlie), BOND)]


def test_recovery_cannot_touch_an_obligation_with_a_verdict(direct_vm, deployed, direct_charlie,
                                                            proposed, transfers):
    warp_to(direct_vm, OPENS)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("recovery applies only to an active obligation"):
        deployed.recover_obligation(proposed)
    assert transfers == []
    assert deployed.get_obligation(proposed)["bond_deposited"] == str(BOND)


def test_recovery_cannot_run_twice_or_after_settlement(direct_vm, deployed, direct_alice, direct_bob,
                                                       direct_charlie, active, transfers):
    recover(direct_vm, deployed, direct_charlie, active)
    before = list(transfers)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("recovery applies only to an active obligation with no verdict; it is RECOVERY"):
        deployed.recover_obligation(active)
    with direct_vm.expect_revert("only a finalized verdict can be settled"):
        deployed.settle_obligation(active)
    assert transfers == before


def test_a_recovered_obligation_can_no_longer_be_verified(direct_vm, deployed, direct_charlie, active):
    recover(direct_vm, deployed, direct_charlie, active)
    with direct_vm.expect_revert("only an active obligation can be verified; it is RECOVERY"):
        verify(direct_vm, deployed, direct_charlie, active, at=OPENS + 60)


def test_an_unfunded_obligation_has_nothing_to_recover(direct_vm, deployed, direct_charlie, created,
                                                       transfers):
    warp_to(direct_vm, OPENS)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("recovery applies only to an active obligation with no verdict; it is CREATED"):
        deployed.recover_obligation(created)
    assert transfers == []


def test_the_view_says_when_recovery_opens(deployed, active):
    assert deployed.get_obligation(active)["recovery_opens_at"] == OPENS
    assert deployed.get_protocol_info()["limits"]["recovery_delay_seconds"] == RECOVERY_DELAY
