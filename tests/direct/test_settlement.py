"""Settlement: the finalized verdict maps to the consequences the terms fixed,
in integer basis points, once."""
import json

from .conftest import (AFTER, BOND, CONSEQUENCES, CRITERIA, REPORT_BODY, REPORT_URL, STATUS_BODY,
                       STATUS_URL, answer, create, crit, finalize, hex_of, settle, verify)


def run(direct_vm, deployed, alice, bob, charlie, llm_json=None, sources=None, criteria=None,
        consequences=None):
    """Create, fund, verify, finalize and settle one obligation."""
    from .conftest import BOND as bond
    oid = create(deployed, direct_vm, alice, bob, charlie,
                 **({"criteria": criteria} if criteria else {}),
                 **({"consequences": consequences} if consequences else {}))
    direct_vm.sender, direct_vm.value = bob, bond
    deployed.fund_obligation(oid)
    direct_vm.value = 0
    kwargs = {}
    if llm_json is not None:
        kwargs["llm_json"] = llm_json
    if sources is not None:
        kwargs["sources"] = sources
    verify(direct_vm, deployed, charlie, oid, **kwargs)
    finalize(direct_vm, deployed, alice, oid)
    settle(direct_vm, deployed, alice, oid)
    return oid


def test_fulfilled_returns_the_whole_bond(direct_vm, deployed, direct_alice, direct_bob,
                                          direct_charlie, transfers):
    oid = run(direct_vm, deployed, direct_alice, direct_bob, direct_charlie)
    o = deployed.get_obligation(oid)
    assert o["verdict"] == "FULFILLED" and o["status"] == "SETTLED" and o["settled"] is True
    assert o["bond_deposited"] == "0" and o["paid_responsible"] == str(BOND) and o["paid_recipient"] == "0"
    assert transfers == [(hex_of(direct_bob), BOND)]
    assert deployed.get_protocol_info()["total_bonded"] == "0"


def test_not_fulfilled_sends_the_whole_bond_to_the_recipient(direct_vm, deployed, direct_alice,
                                                             direct_bob, direct_charlie, transfers):
    missing = {STATUS_URL: (200, STATUS_BODY), REPORT_URL: (404, b"gone")}
    oid = run(direct_vm, deployed, direct_alice, direct_bob, direct_charlie, sources=missing,
              llm_json=answer(crit("C4", "UNKNOWN")))
    o = deployed.get_obligation(oid)
    assert o["verdict"] == "NOT_FULFILLED"
    assert o["paid_responsible"] == "0" and o["paid_recipient"] == str(BOND)
    assert transfers == [(hex_of(direct_charlie), BOND)]


def test_partially_fulfilled_splits_by_basis_points(direct_vm, deployed, direct_alice, direct_bob,
                                                    direct_charlie, transfers):
    """Every required criterion passes; a criterion the creator marked
    non-critical does not."""
    criteria = CRITERIA + [{"kind": "OBJECTIVE", "required": False,
                            "text": "The report runs to at least 30 pages.",
                            "source_id": "E1", "op": "GTE", "field": "pages", "expected": "30"}]
    oid = run(direct_vm, deployed, direct_alice, direct_bob, direct_charlie, criteria=criteria)
    o = deployed.get_obligation(oid)
    assert o["verdict"] == "PARTIALLY_FULFILLED"
    assert o["paid_responsible"] == str(BOND * 7500 // 10000)
    assert o["paid_recipient"] == str(BOND - BOND * 7500 // 10000)
    assert transfers == [(hex_of(direct_bob), 375 * 10 ** 15), (hex_of(direct_charlie), 125 * 10 ** 15)]


def test_insufficient_evidence_uses_its_own_predefined_split(direct_vm, deployed, direct_alice,
                                                             direct_bob, direct_charlie, transfers):
    down = {STATUS_URL: (503, b""), REPORT_URL: (503, b"")}
    oid = run(direct_vm, deployed, direct_alice, direct_bob, direct_charlie, sources=down)
    o = deployed.get_obligation(oid)
    assert o["verdict"] == "INSUFFICIENT_EVIDENCE"
    assert transfers == [(hex_of(direct_bob), BOND // 2), (hex_of(direct_charlie), BOND // 2)]


def test_a_split_that_does_not_divide_evenly_gives_the_remainder_to_the_recipient(
        direct_vm, deployed, direct_alice, direct_bob, direct_charlie, transfers):
    odd = {**CONSEQUENCES, "FULFILLED": 3333}
    oid = run(direct_vm, deployed, direct_alice, direct_bob, direct_charlie, consequences=odd)
    o = deployed.get_obligation(oid)
    paid = int(o["paid_responsible"]) + int(o["paid_recipient"])
    assert paid == BOND, "every atto of the bond is accounted for"
    assert int(o["paid_responsible"]) == BOND * 3333 // 10000
    assert sum(t[1] for t in transfers) == BOND


def test_settlement_happens_once(direct_vm, deployed, direct_alice, direct_bob, direct_charlie,
                                 transfers):
    oid = run(direct_vm, deployed, direct_alice, direct_bob, direct_charlie)
    before = list(transfers)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("only a finalized verdict can be settled; the obligation is SETTLED"):
        deployed.settle_obligation(oid)
    assert transfers == before
    assert deployed.get_obligation(oid)["bond_deposited"] == "0"


def test_anyone_may_finalize_and_settle(direct_vm, deployed, direct_alice, direct_bob, direct_charlie,
                                        proposed, transfers):
    finalize(direct_vm, deployed, direct_bob, proposed)      # the responsible party
    settle(direct_vm, deployed, direct_charlie, proposed)    # the recipient
    assert deployed.get_obligation(proposed)["status"] == "SETTLED"
    assert transfers == [(hex_of(direct_bob), BOND)]


def test_the_ledger_is_zeroed_before_the_transfer(direct_vm, deployed, direct_alice, direct_bob,
                                                  direct_charlie, proposed, transfers, monkeypatch):
    """The contract must not be able to pay twice even if a recipient could
    re-enter: at the moment of the first transfer the ledger already reads 0."""
    from gltest.direct import wasi_mock
    seen = []
    original = wasi_mock._handle_gl_call

    def recording(vm, request):
        if isinstance(request, dict) and "EthSend" in request:
            seen.append(deployed.get_obligation(proposed)["bond_deposited"])
        return original(vm, request)

    monkeypatch.setattr(wasi_mock, "_handle_gl_call", recording)
    finalize(direct_vm, deployed, direct_alice, proposed)
    settle(direct_vm, deployed, direct_alice, proposed)
    assert seen and all(v == "0" for v in seen), seen


def test_total_bonded_tracks_every_obligation(direct_vm, deployed, direct_alice, direct_bob,
                                              direct_charlie, active):
    second = create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender, direct_vm.value = direct_bob, BOND
    deployed.fund_obligation(second)
    direct_vm.value = 0
    assert deployed.get_protocol_info()["total_bonded"] == str(2 * BOND)
    verify(direct_vm, deployed, direct_charlie, active)
    finalize(direct_vm, deployed, direct_alice, active)
    settle(direct_vm, deployed, direct_alice, active)
    assert deployed.get_protocol_info()["total_bonded"] == str(BOND)
