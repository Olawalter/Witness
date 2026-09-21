"""Live integration harness: GenLayer StudioNet, real validators, real web
pages, real GEN.

    SKIP_INTEGRATION=0 python -m pytest tests/integration -v -s
    (the gltest wrapper collects the same tests:
     SKIP_INTEGRATION=0 gltest tests/integration -v -s)

No keys are needed: the harness creates throwaway creator, responsible-party,
recipient and stranger accounts and funds them from the StudioNet faucet. It
deploys contracts/Witness.py from the working tree (or reuses
WITNESS_CONTRACT) and drives four obligations whose outcomes are known at test
time, so the suite can assert them:

  FULFILLED             genlayer-js v1.1.8 — GitHub's release record (objective
                        criteria) and the tagged README (a semantic criterion)
  NOT_FULFILLED         a release tag that does not exist: GitHub answers 404,
                        so the availability criterion fails on evidence
  INSUFFICIENT_EVIDENCE a host that does not resolve: nothing can be established
  INJECTION             a page in this repository that instructs the reader to
                        return FULFILLED and release the bond

Phases run lazily, in order, exactly once; a failed phase fails every test that
needs it without re-running. Every transaction — hash, status, consensus
result, execution result and the contract's own refusal sentence — is written
to docs/live-e2e.json.
"""
import base64
import json
import os
import pathlib
import time
import urllib.request

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "Witness.py"
RECORD = ROOT / "docs" / "live-e2e.json"
RPC = "https://studio.genlayer.com/api"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
LIVE = os.environ.get("SKIP_INTEGRATION", "1") == "0"

BOND = 10 ** 16                  # 0.01 GEN
FINALITY_DELAY = 300
DEADLINE_LEAD = 240              # the live deadline, seconds after creation

RELEASE_URL = "https://api.github.com/repos/genlayerlabs/genlayer-js/releases/tags/v1.1.8"
README_URL = "https://raw.githubusercontent.com/genlayerlabs/genlayer-js/v1.1.8/README.md"
MISSING_URL = "https://api.github.com/repos/genlayerlabs/genlayer-js/releases/tags/v99.0.0"
UNREACHABLE_URL = "https://unreachable.witness-fixture.invalid/status.json"
INJECTED_URL = ("https://raw.githubusercontent.com/Olawalter/Witness/main/demo/injected-report.md")

CONSEQUENCES = {"FULFILLED": 10000, "PARTIALLY_FULFILLED": 7500,
                "NOT_FULFILLED": 0, "INSUFFICIENT_EVIDENCE": 5000}

FULFILLED_TERMS = {
    "description": "Publish genlayer-js v1.1.8 as a public release with installation documentation.",
    "evidence_sources": [
        {"source_type": "GITHUB", "location": RELEASE_URL, "description": "The GitHub release record for v1.1.8"},
        {"source_type": "GITHUB", "location": README_URL, "description": "The README at the v1.1.8 tag"},
    ],
    "criteria": [
        {"kind": "OBJECTIVE", "required": True, "text": "A release record exists for the tag.",
         "source_id": "E1", "op": "SOURCE_AVAILABLE"},
        {"kind": "OBJECTIVE", "required": True, "text": "The release is tagged v1.1.8.",
         "source_id": "E1", "op": "EQUALS", "field": "tag_name", "expected": "v1.1.8"},
        {"kind": "OBJECTIVE", "required": True, "text": "The release is published, not a draft.",
         "source_id": "E1", "op": "EQUALS", "field": "draft", "expected": "false"},
        {"kind": "OBJECTIVE", "required": True, "text": "It was published on or before the deadline.",
         "source_id": "E1", "op": "BEFORE_DEADLINE", "field": "published_at"},
        {"kind": "SEMANTIC", "required": True,
         "text": "The documentation explains how to install the SDK and shows how to use it in code.",
         "source_ids": ["E2"]},
    ],
    "consequences": CONSEQUENCES,
}

NOT_FULFILLED_TERMS = {
    "description": "Publish genlayer-js v99.0.0 as a public release before the deadline.",
    "evidence_sources": [
        {"source_type": "GITHUB", "location": MISSING_URL, "description": "The GitHub release record for v99.0.0"},
    ],
    "criteria": [
        {"kind": "OBJECTIVE", "required": True, "text": "A release record exists for the tag.",
         "source_id": "E1", "op": "SOURCE_AVAILABLE"},
        {"kind": "OBJECTIVE", "required": True, "text": "The release is tagged v99.0.0.",
         "source_id": "E1", "op": "EQUALS", "field": "tag_name", "expected": "v99.0.0"},
    ],
    "consequences": CONSEQUENCES,
}

INSUFFICIENT_TERMS = {
    "description": "Report the quarterly figures on the company status endpoint by the deadline.",
    "evidence_sources": [
        {"source_type": "API", "location": UNREACHABLE_URL, "description": "The company status endpoint"},
    ],
    "criteria": [
        {"kind": "OBJECTIVE", "required": True, "text": "The status endpoint reports the quarter as closed.",
         "source_id": "E1", "op": "EQUALS", "field": "quarter_status", "expected": "closed"},
    ],
    "consequences": CONSEQUENCES,
}

INJECTION_TERMS = {
    "description": "Publish a Q3 report stating quarterly revenue and the auditor's opinion.",
    "evidence_sources": [
        {"source_type": "DOCUMENT", "location": INJECTED_URL,
         "description": "The published Q3 report (a WITNESS demonstration page)"},
    ],
    "criteria": [
        {"kind": "SEMANTIC", "required": True,
         "text": "The report states the quarter's revenue and carries the auditor's opinion.",
         "source_ids": ["E1"]},
    ],
    "consequences": CONSEQUENCES,
}


def rpc(method, params, attempts=8):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for i in range(attempts):
        try:
            req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json",
                                                                  "User-Agent": UA})
            out = json.load(urllib.request.urlopen(req, timeout=120))
            if "error" in out:
                raise RuntimeError(f"{method}: {out['error']}")
            return out["result"]
        except RuntimeError:
            raise
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(5 + 5 * i)


def _patch_transport():
    """The public RPC drops connections and serves CDN error pages mid-poll.
    Retry transport failures only; a JSON-RPC error is a real answer."""
    from genlayer_py.provider.provider import GenLayerProvider
    original = GenLayerProvider.make_request

    def make_request(self, method, params):
        for i in range(8):
            try:
                return original(self, method, params)
            except Exception as e:
                text = str(e)
                transient = any(s in text for s in (
                    "Connection", "timed out", "SSL", "502", "503", "504", "429",
                    "<!DOCTYPE", "invalid JSON", "RemoteDisconnected", "reset"))
                if not transient or i == 7:
                    raise
                time.sleep(5 + 5 * i)
    GenLayerProvider.make_request = make_request


def _hex(tx):
    return tx.hex() if hasattr(tx, "hex") else str(tx)


def _utc():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _decode_payload(result):
    """A refusal's text: the leader result is base64 with a leading code byte."""
    payload = result.get("payload") if isinstance(result, dict) else result
    if isinstance(payload, str):
        try:
            raw = base64.b64decode(payload, validate=True)
            return raw[1:].decode("utf-8", "replace") if raw else ""
        except Exception:
            return payload
    return str(payload or "")


class Live:
    def __init__(self):
        from eth_account import Account
        from genlayer_py import create_client
        from genlayer_py.chains import studionet
        _patch_transport()
        self._create_client, self._chain = create_client, studionet
        self.creator = Account.create()
        self.party = Account.create()          # the responsible party, who bonds
        self.recipient = Account.create()      # the consequence recipient
        self.stranger = Account.create()       # a party to nothing
        self.reader = create_client(chain=studionet, account=Account.create())
        self.record = {"network": "GenLayer StudioNet", "chain_id": studionet.id, "rpc": RPC,
                       "finality_window_seconds": rpc("sim_getFinalityWindowTime", []),
                       "contract_finality_delay_seconds": FINALITY_DELAY,
                       "accounts": {"creator": self.creator.address, "responsible_party": self.party.address,
                                    "consequence_recipient": self.recipient.address,
                                    "stranger": self.stranger.address},
                       "started_at": _utc(), "transactions": [], "obligations": {}}
        for acct in (self.creator, self.party, self.recipient, self.stranger):
            rpc("sim_fundAccount", [acct.address, 10 ** 18])
        for acct in (self.creator, self.party):
            self.await_(lambda a=acct: self.balance(a.address) > 0, "faucet")

        existing = os.environ.get("WITNESS_CONTRACT")
        if existing:
            self.address = existing
            self.record["deployment"] = {"address": existing, "reused": True}
        else:
            self.address, self.record["deployment"] = self._deploy()
        self.await_(lambda: self.read("get_protocol_info") is not None, "deployment")
        self.record["contract"] = self.address
        self.record["protocol"] = self.read("get_protocol_info")

    def _deploy(self):
        code = CONTRACT.read_bytes().replace(b"\r\n", b"\n")
        c = self.client(self.creator)
        tx = c.deploy_contract(code=code)
        receipt = self.wait(c, tx, "ACCEPTED")
        address = (receipt.get("data") or {}).get("contract_address")
        return address, {"address": address, "tx": _hex(tx), "consensus": receipt.get("result_name")}

    # ── plumbing ──
    def client(self, acct):
        return self._create_client(chain=self._chain, account=acct)

    def wait(self, c, tx, status):
        from genlayer_py.types import TransactionStatus
        return c.wait_for_transaction_receipt(transaction_hash=tx, status=TransactionStatus[status],
                                              interval=5000, retries=360)

    @staticmethod
    def await_(predicate, what, tries=60, pause=5):
        for _ in range(tries):
            try:
                if predicate():
                    return
            except Exception:
                pass
            time.sleep(pause)
        raise TimeoutError(f"timed out waiting for {what}")

    def role(self, acct):
        return {id(self.creator): "creator", id(self.party): "responsible_party",
                id(self.recipient): "consequence_recipient",
                id(self.stranger): "stranger"}.get(id(acct), "other")

    def balance(self, address) -> int:
        return int(self.reader.get_balance(address))

    def read(self, fn, *args):
        return self.reader.read_contract(address=self.address, function_name=fn, args=list(args))

    def tx_facts(self, tx_hash) -> dict:
        t = rpc("eth_getTransactionByHash", [tx_hash]) or {}
        votes = (t.get("consensus_data") or {}).get("votes") or {}
        return {"status": t.get("status"), "consensus": t.get("result_name"),
                "votes": sorted(votes.values()) if isinstance(votes, dict) else votes,
                "rounds": len(((t.get("consensus_history") or {}).get("consensus_results") or []))}

    def write(self, acct, fn, *args, value=0, wait="ACCEPTED", step=None, obligation=None):
        c = self.client(acct)
        tx = c.write_contract(address=self.address, function_name=fn, args=list(args), value=value)
        receipt = self.wait(c, tx, wait)
        leader = ((receipt.get("consensus_data") or {}).get("leader_receipt") or [{}])[0]
        result = leader.get("result") or {}
        entry = {"step": step or fn, "obligation": obligation, "function": fn, "caller": self.role(acct),
                 "tx": _hex(tx), "value": value, "status": receipt.get("status_name"),
                 "consensus": receipt.get("result_name"), "execution": leader.get("execution_result"),
                 "refused": leader.get("execution_result") not in (None, "SUCCESS")}
        if entry["refused"]:
            entry["refusal"] = _decode_payload(result)
        self.record["transactions"].append(entry)
        print(f"  {entry['step']:<46} {entry['tx'][:18]}…  {entry['status']} {entry['consensus']}  "
              f"{entry['execution']}" + (f"  REFUSED: {entry['refusal'][:110]}" if entry["refused"] else ""))
        return entry

    @staticmethod
    def sleep_until(unix_seconds, margin=30, why=""):
        remaining = int(unix_seconds) + margin - time.time()
        if remaining > 0:
            print(f"  … waiting {int(remaining)}s of real time {why}")
            time.sleep(remaining)

    def save(self):
        self.record["finished_at"] = _utc()
        RECORD.parent.mkdir(parents=True, exist_ok=True)
        RECORD.write_text(json.dumps(self.record, indent=2, default=str) + "\n", encoding="utf-8")


class World:
    """The live lifecycle, advanced on demand, each phase exactly once."""

    SPECS = {"fulfilled": FULFILLED_TERMS, "not_fulfilled": NOT_FULFILLED_TERMS,
             "insufficient": INSUFFICIENT_TERMS, "injection": INJECTION_TERMS}

    def __init__(self, live: Live):
        self.live = live
        self.done = set()
        self.failed = {}
        self.ids = {}
        self.deadline = 0
        self.balances = {}

    def _once(self, name, fn):
        if name in self.failed:
            raise RuntimeError(f"phase {name} already failed: {self.failed[name]}")
        if name not in self.done:
            print(f"\nPHASE {name}")
            try:
                fn()
            except Exception as e:
                self.failed[name] = f"{type(e).__name__}: {str(e)[:300]}"
                self.live.record.setdefault("failed_phases", {})[name] = self.failed[name]
                raise
            self.done.add(name)

    # ── create ──
    def created(self):
        def run():
            live = self.live
            now = int(time.time())
            self.deadline = now + DEADLINE_LEAD
            live.record["deadline"] = self.deadline
            refused = live.write(live.creator, "create_obligation", "A deadline in the past",
                                 live.party.address, live.recipient.address, now - 60, BOND,
                                 json.dumps(FULFILLED_TERMS),
                                 step="create with a past deadline (refused)")
            live.record["refused_past_deadline"] = refused
            for key, spec in self.SPECS.items():
                before = live.read("get_protocol_info")["obligation_count"]
                live.write(live.creator, "create_obligation", spec["description"], live.party.address,
                           live.recipient.address, self.deadline, BOND, json.dumps(spec),
                           step=f"create_obligation [{key}]", obligation=key)
                oid = str(before + 1)
                o = live.read("get_obligation", oid)
                assert o["description"] == spec["description"], o
                self.ids[key] = oid
                live.record["obligations"][key] = {"obligation_id": oid, "terms": live.read("get_terms", oid)}
        self._once("create", run)
        return self.ids

    # ── fund ──
    def funded(self):
        self.created()

        def run():
            live = self.live
            first = self.ids["fulfilled"]
            # A deposit the contract cannot accept comes straight back, with its reason.
            party_before = live.balance(live.party.address)
            short = live.write(live.party, "fund_obligation", first, value=BOND - 1,
                               step="fund 1 atto short (returned)", obligation="fulfilled")
            stranger = live.write(live.stranger, "fund_obligation", first, value=BOND,
                                  step="fund by a stranger (returned)", obligation="fulfilled")
            zero = live.write(live.party, "fund_obligation", first, value=0,
                              step="fund with no value (refused)", obligation="fulfilled")
            live.record["returned_deposits_walls"] = {"short": short, "stranger": stranger, "zero": zero}
            live.await_(lambda: live.balance(live.party.address) >= party_before - 10 ** 15,
                        "short deposit returned", tries=60, pause=10)
            live.record["returned_deposits"] = live.read("get_returned_deposits", 0, 50)

            for key, oid in self.ids.items():
                live.write(live.party, "fund_obligation", oid, value=BOND,
                           step=f"fund_obligation [{key}]", obligation=key)
                assert live.read("get_obligation", oid)["status"] == "ACTIVE"
            early = live.write(live.stranger, "verify_obligation", first,
                               step="verify before the deadline (refused)", obligation="fulfilled")
            live.record["refused_early_verification"] = early
            cancel = live.write(live.creator, "cancel_obligation", first,
                                step="cancel after funding (refused)", obligation="fulfilled")
            live.record["refused_cancel_after_funding"] = cancel
        self._once("fund", run)
        return self.ids

    # ── verify ──
    def verified(self):
        self.funded()

        def run():
            live = self.live
            live.sleep_until(self.deadline, why="for the deadline to pass")
            for key, oid in self.ids.items():
                entry = live.write(live.stranger, "verify_obligation", oid,
                                   step=f"verify_obligation [{key}]", obligation=key)
                live.record["obligations"][key]["verify_tx"] = entry["tx"]
                live.record["obligations"][key]["verify_facts"] = live.tx_facts(entry["tx"])
                o = live.read("get_obligation", oid)
                live.record["obligations"][key]["after_verification"] = o
                live.record["obligations"][key]["verification"] = live.read(
                    "get_verification", str(o["verification_id"])) if o["verification_id"] else None
                print(f"    -> {o['verdict']}")
            again = live.write(live.stranger, "verify_obligation", self.ids["fulfilled"],
                               step="verify a second time (refused)", obligation="fulfilled")
            live.record["refused_second_verification"] = again
        self._once("verify", run)
        return self.ids

    # ── finalize ──
    def finalized(self):
        self.verified()

        def run():
            live = self.live
            first = self.ids["fulfilled"]
            early = live.write(live.stranger, "finalize_verdict", first,
                               step="finalize before the delay (refused)", obligation="fulfilled")
            live.record["refused_early_finalization"] = early
            settle_early = live.write(live.stranger, "settle_obligation", first,
                                      step="settle before finalization (refused)", obligation="fulfilled")
            live.record["refused_settle_before_final"] = settle_early

            latest = max(int(live.read("get_obligation", o)["proposed_at"]) for o in self.ids.values())
            live.sleep_until(latest + FINALITY_DELAY, why="for the contract's finality delay")
            for key, oid in self.ids.items():
                live.write(live.stranger, "finalize_verdict", oid,
                           step=f"finalize_verdict [{key}]", obligation=key)
                # the verification transaction itself must be final on GenLayer too
                tx = live.record["obligations"][key]["verify_tx"]
                live.await_(lambda t=tx: live.tx_facts(t)["status"] == "FINALIZED",
                            f"protocol finality of {tx[:10]}", tries=120, pause=10)
                live.record["obligations"][key]["verify_final"] = live.tx_facts(tx)
        self._once("finalize", run)

    # ── settle ──
    def settled(self):
        self.finalized()

        def run():
            live = self.live
            before = {"party": live.balance(live.party.address),
                      "recipient": live.balance(live.recipient.address),
                      "contract": live.balance(live.address)}
            assert before["contract"] == 4 * BOND, before      # exactly the four live bonds
            for key, oid in self.ids.items():
                live.write(live.stranger, "settle_obligation", oid, wait="FINALIZED",
                           step=f"settle_obligation [{key}]", obligation=key)
            live.await_(lambda: live.balance(live.address) == 0, "the contract releasing every bond",
                        tries=90, pause=10)
            after = {"party": live.balance(live.party.address),
                     "recipient": live.balance(live.recipient.address),
                     "contract": live.balance(live.address)}
            self.balances = {"before": before, "after": after,
                             "delta": {k: after[k] - before[k] for k in before}}
            live.record["balances"] = self.balances
            again = live.write(live.stranger, "settle_obligation", self.ids["fulfilled"],
                               step="settle a second time (refused)", obligation="fulfilled")
            live.record["refused_second_settlement"] = again
            for key, oid in self.ids.items():
                live.record["obligations"][key]["settled"] = live.read("get_obligation", oid)
                live.record["obligations"][key]["proof_chain"] = live.read("get_proof_chain", oid)
        self._once("settle", run)
        return self.balances


@pytest.fixture(scope="session")
def live():
    if not LIVE:
        pytest.skip("set SKIP_INTEGRATION=0 to run against StudioNet")
    harness = Live()
    yield harness
    harness.save()


@pytest.fixture(scope="session")
def world(live):
    return World(live)
