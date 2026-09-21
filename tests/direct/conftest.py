"""Shared fixtures for the WITNESS direct suite.

Direct mode (the official `genlayer-test` runner) executes the contract in a
real GenVM Python runner. Transaction time comes from `direct_vm.warp()`, the
web from `direct_vm.mock_web`, and the model from `direct_vm.mock_llm`. These
are official test mechanisms and exist only here: they prove what the CONTRACT
decides from a given retrieval. Whether a real model reads a real page
correctly is the integration suite's job.

A model mock returns per-criterion RESULTS with quotes, never a verdict: the
contract accepts no verdict from the model.
"""
import datetime
import json
import os
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
# WITNESS_CONTRACT points the suite at another copy (used by the mutation sweep).
CONTRACT = pathlib.Path(os.environ.get("WITNESS_CONTRACT") or ROOT / "contracts" / "Witness.py")

GEN = 10 ** 18
BOND = 5 * 10 ** 17                     # 0.5 GEN
HOUR = 3600
DAY = 86400
T0 = 1_790_035_200                      # 2026-09-22T00:00:00Z — every suite starts here
DEADLINE = T0 + 2 * DAY
AFTER = DEADLINE + HOUR
FINALITY_DELAY = 300
RECOVERY_DELAY = 7 * DAY

STATUS_URL = "https://api.fixture-witness.test/reports/q3/status.json"
REPORT_URL = "https://fixture-witness.test/reports/q3"

SOURCES = [
    {"source_type": "API", "location": STATUS_URL, "description": "Publisher status endpoint"},
    {"source_type": "WEB", "location": REPORT_URL, "description": "The published report page"},
]

CRITERIA = [
    {"kind": "OBJECTIVE", "required": True, "text": "The report page is published and reachable.",
     "source_id": "E2", "op": "SOURCE_AVAILABLE"},
    {"kind": "OBJECTIVE", "required": True, "text": "The publisher records the report as published.",
     "source_id": "E1", "op": "EQUALS", "field": "status", "expected": "published"},
    {"kind": "OBJECTIVE", "required": True, "text": "It was published on or before the deadline.",
     "source_id": "E1", "op": "BEFORE_DEADLINE", "field": "published_at"},
    {"kind": "SEMANTIC", "required": True,
     "text": "The report states quarterly revenue and carries the auditor's opinion.",
     "source_ids": ["E2"]},
]

CONSEQUENCES = {"FULFILLED": 10000, "PARTIALLY_FULFILLED": 7500,
                "NOT_FULFILLED": 0, "INSUFFICIENT_EVIDENCE": 5000}

DESCRIPTION = "Publish the Q3 financial report on the investor site by the deadline."

STATUS_BODY = json.dumps({"report": "Q3", "status": "published",
                          "published_at": "2026-09-23T09:30:00Z", "pages": 24}).encode()
REPORT_BODY = (b"<!doctype html><html><body><h1>Q3 financial report</h1>"
               b"<p>Quarterly revenue was 41.2 million dollars, up 6 per cent on Q2.</p>"
               b"<p>The auditor's opinion is unqualified.</p>"
               b"<script>track()</script></body></html>")

SOURCES_OK = {STATUS_URL: (200, STATUS_BODY), REPORT_URL: (200, REPORT_BODY)}

Q_REVENUE = "Quarterly revenue was 41.2 million dollars, up 6 per cent on Q2."
Q_AUDITOR = "The auditor's opinion is unqualified."


# ─── time ────────────────────────────────────────────────────────────────────

def iso(unix_seconds: int) -> str:
    return datetime.datetime.fromtimestamp(
        int(unix_seconds), tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def warp_to(direct_vm, unix_seconds: int) -> None:
    direct_vm.warp(iso(unix_seconds))


# ─── what a model reader reports ─────────────────────────────────────────────

def crit(cid, result="PASS", ref="", quote=""):
    return {"criterion_id": cid, "result": result, "evidence_ref": ref, "quote": quote}


def answer(*criteria) -> str:
    return json.dumps({"reasoning": "per criterion, from the fences", "criteria": list(criteria)})


SEMANTIC_PASS = answer(crit("C4", "PASS", "E2", Q_REVENUE))


def mock_round(direct_vm, llm_json=SEMANTIC_PASS, sources=None) -> None:
    """Register what the sources serve and what a model reader reports. Mocks
    are first-registered-wins, so clear first."""
    direct_vm.clear_mocks()
    for url, (status, body) in (sources if sources is not None else SOURCES_OK).items():
        direct_vm.mock_web("^" + re.escape(url) + "$", {"status": status, "body": body})
    if llm_json is not None:
        direct_vm.mock_llm(r".*validator panel for WITNESS.*", llm_json)


def record_prompts(direct_vm) -> list:
    seen = []
    original = direct_vm._match_llm_mock

    def recording(prompt):
        seen.append(prompt)
        return original(prompt)

    direct_vm._match_llm_mock = recording
    return seen


def record_fetches(direct_vm) -> list:
    seen = []
    original = direct_vm._match_web_mock

    def recording(url, method="GET"):
        seen.append(url)
        return original(url, method)

    direct_vm._match_web_mock = recording
    return seen


def hex_of(account) -> str:
    raw = account.as_bytes if hasattr(account, "as_bytes") else bytes(account)
    return "0x" + raw.hex()


def round_index(direct_vm) -> int:
    captured = direct_vm._captured_validators
    for i in range(len(captured) - 1, -1, -1):
        result = captured[i][0]
        if isinstance(result, dict) and "verdict" in result and "criteria" in result:
            return i
    raise AssertionError("no verification round captured")


# ─── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def transfers(monkeypatch):
    """Every GEN transfer the contract emits, as (recipient_hex, atto)."""
    from gltest.direct import wasi_mock
    sent = []
    original = wasi_mock._handle_gl_call

    def recording(vm, request):
        if isinstance(request, dict) and "EthSend" in request:
            op = request["EthSend"]
            addr = op["address"]
            raw = addr.as_bytes if hasattr(addr, "as_bytes") else bytes(addr)
            sent.append(("0x" + raw.hex(), int(op["value"])))
        return original(vm, request)

    monkeypatch.setattr(wasi_mock, "_handle_gl_call", recording)
    return sent


@pytest.fixture
def contract_path():
    return str(CONTRACT)


@pytest.fixture
def deployed(direct_vm, direct_deploy, contract_path):
    warp_to(direct_vm, T0)
    return direct_deploy(contract_path)


def terms(criteria=None, sources=None, consequences=None) -> str:
    return json.dumps({
        "criteria": criteria if criteria is not None else CRITERIA,
        "evidence_sources": sources if sources is not None else SOURCES,
        "consequences": consequences if consequences is not None else CONSEQUENCES,
    })


def create(deployed, direct_vm, creator, party, recipient, description=DESCRIPTION,
           deadline=DEADLINE, bond=BOND, **terms_over) -> str:
    direct_vm.sender = creator
    return deployed.create_obligation(description, hex_of(party), hex_of(recipient),
                                      deadline, bond, terms(**terms_over))


@pytest.fixture
def created(direct_vm, deployed, direct_alice, direct_bob, direct_charlie):
    """A CREATED obligation: Alice is the creator, Bob the responsible party,
    Charlie the consequence recipient."""
    return create(deployed, direct_vm, direct_alice, direct_bob, direct_charlie)


@pytest.fixture
def active(direct_vm, deployed, direct_bob, created):
    direct_vm.sender = direct_bob
    direct_vm.value = BOND
    deployed.fund_obligation(created)
    direct_vm.value = 0
    return created


def verify(direct_vm, deployed, sender, oid, at=AFTER, llm_json=SEMANTIC_PASS, sources=None) -> str:
    warp_to(direct_vm, at)
    mock_round(direct_vm, llm_json, sources)
    direct_vm.sender = sender
    return deployed.verify_obligation(oid)


def finalize(direct_vm, deployed, sender, oid, at=None):
    o = deployed.get_obligation(oid)
    warp_to(direct_vm, at if at is not None else int(o["proposed_at"]) + FINALITY_DELAY)
    direct_vm.sender = sender
    deployed.finalize_verdict(oid)


def settle(direct_vm, deployed, sender, oid):
    direct_vm.sender = sender
    deployed.settle_obligation(oid)


@pytest.fixture
def proposed(direct_vm, deployed, direct_charlie, active):
    """Verified after the deadline; every criterion passes."""
    verify(direct_vm, deployed, direct_charlie, active)
    return active
