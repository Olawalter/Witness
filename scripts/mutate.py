"""Mutation sweep: break one guard at a time in a scratch copy of the contract
and require the direct suite to fail. A surviving mutant is a floor no test
holds.

    python scripts/mutate.py
"""
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "contracts" / "Witness.py").read_text(encoding="utf-8")

MUTANTS = [
    # ── access control and the immutable terms ──
    ("funding by anyone", 'if self._sender() != str(o.responsible_party).lower():\n            return "only the responsible party can commit the bond"',
     'if False:\n            return "only the responsible party can commit the bond"'),
    ("cancel by anyone", 'if self._sender() != str(o.creator).lower():\n            _fail("only the creator can cancel an obligation")',
     'if False:\n            _fail("only the creator can cancel an obligation")'),
    ("cancel after funding", 'if o.status != S_CREATED:\n            _fail(f"only an obligation awaiting its bond can be cancelled; it is {o.status}")',
     'if False:\n            _fail(f"only an obligation awaiting its bond can be cancelled; it is {o.status}")'),
    ("recipient may be the party", 'if str(party).lower() == str(recipient).lower():', 'if False:'),
    ("deadline may be in the past", 'if due < now + MIN_LEAD_SECONDS:', 'if False:'),
    ("bond floor removed", 'if bond < MIN_BOND:', 'if False:'),
    ("a mandate needs no required criterion", 'if not any(c["required"] for c in criteria):', 'if False:'),
    ("duplicate sources allowed", 'if norm in seen:', 'if False:'),
    ("github host unchecked", 'if stype == "GITHUB" and host not in GITHUB_HOSTS:', 'if False:'),
    ("consequences may exceed the bond", 'if bps < 0 or bps > BPS:', 'if False:'),

    # ── the bond ──
    ("inexact bond accepted", 'if sent != int(o.bond_required):\n            return f"the bond must be exactly',
     'if False:\n            return f"the bond must be exactly'),
    ("funding after the deadline", 'if _now() >= int(o.deadline):\n            return "the deadline has passed"',
     'if False:\n            return "the deadline has passed"'),
    ("second funding accepted", 'if o.status != S_CREATED:\n            return f"the obligation is {o.status}, not awaiting its bond"',
     'if False:\n            return f"the obligation is {o.status}, not awaiting its bond"'),
    ("a refused deposit is kept", 'self._send_gen(gl.message.sender_address, sent)', 'pass'),
    ("a returned deposit funds the obligation", 'if problem is not None:\n            if sent <= 0:', 'if False:\n            if sent <= 0:'),

    # ── the lifecycle ──
    ("verify before the deadline", 'if now < int(o.deadline):\n            _fail(f"verification cannot start yet',
     'if False:\n            _fail(f"verification cannot start yet'),
    ("verify twice", 'if o.status != S_ACTIVE:\n            _fail(f"only an active obligation can be verified; it is {o.status}")',
     'if False:\n            _fail(f"only an active obligation can be verified; it is {o.status}")'),
    ("finalize immediately", 'if now < ready:', 'if False:'),
    ("finalize without a verdict", 'if o.status != S_VERDICT_PROPOSED:', 'if False:'),
    ("settle before finality", 'if o.status != S_FINALIZED:\n            _fail(f"only a finalized verdict can be settled; the obligation is {o.status}")',
     'if False:\n            _fail(f"only a finalized verdict can be settled; the obligation is {o.status}")'),
    ("recover early", 'if now < opens:', 'if False:'),
    ("recover with a verdict", 'if o.status != S_ACTIVE:\n            _fail(f"recovery applies only to an active obligation with no verdict; it is {o.status}")',
     'if False:\n            _fail(f"recovery applies only to an active obligation with no verdict; it is {o.status}")'),

    # ── the payout ──
    ("double settlement", 'if held <= 0 or o.settled:', 'if False:'),
    ("ledger zeroed after the transfer", 'o.bond_deposited = u256(0)\n        o.settled = True', 'o.settled = True'),
    ("payout does not balance", 'if to_party + to_recipient != held or to_party < 0 or to_recipient < 0:', 'if False:'),
    ("basis points ignored", 'to_responsible = bond * bps // BPS', 'to_responsible = bond'),
    ("the remainder is lost", 'return to_responsible, bond - to_responsible', 'return to_responsible, 0'),
    ("recovery pays the fulfilled share", 'self._payout(o, V_INSUFFICIENT)', 'self._payout(o, V_FULFILLED)'),

    # ── objective criteria ──
    ("a missing source passes", 'out["result"] = R_PASS if ev["status"] == E_OK else (R_FAIL if ev["status"] == E_MISSING else R_UNKNOWN)',
     'out["result"] = R_PASS'),
    ("a missing source is only unknown", 'if ev["status"] == E_MISSING:\n        out["observed"] = E_MISSING\n        out["result"] = R_FAIL',
     'if ev["status"] == E_MISSING:\n        out["observed"] = E_MISSING\n        out["result"] = R_UNKNOWN'),
    ("an unreadable source passes", 'if ev["status"] != E_OK or ev["json"] is None:', 'if False:'),
    ("equality ignored", 'ok = (a == b) if op == "EQUALS" else ((a != b) if op == "NOT_EQUALS" else (b in a))', 'ok = True'),
    ("a late publication passes", 'if interval[1] <= deadline:\n                out["result"] = R_PASS\n            elif interval[0] > deadline:\n                out["result"] = R_FAIL',
     'if True:\n                out["result"] = R_PASS\n            elif interval[0] > deadline:\n                out["result"] = R_FAIL'),
    ("an absent field passes", 'if not found:\n        out["observed"] = "ABSENT"\n        return out', 'if False:\n        out["observed"] = "ABSENT"\n        return out'),

    # ── semantic criteria and the panel ──
    ("quote grounding removed", 'grounded = (ref in c["source_ids"] and ref in readable and len(quote) >= MIN_QUOTE\n                        and _squash(quote) in _squash(readable[ref]))',
     'grounded = True'),
    ("quote may come from any source", 'ref in c["source_ids"] and ref in readable', 'ref in readable'),
    ("a short quote grounds a finding",
     'len(quote) >= MIN_QUOTE\n                        and _squash(quote)',
     'len(quote) >= 0\n                        and _squash(quote)'),
    ("an unknown row may carry a quote", 'if result == R_UNKNOWN:\n            ref, quote = "", ""', 'if False:\n            ref, quote = "", ""'),
    ("a missing criterion is tolerated", 'if item is None:\n            raise gl.vm.UserError(f"{ERROR_LLM} answer omits criterion {c[\'criterion_id\']}")',
     'if item is None:\n            item = {"result": "PASS", "evidence_ref": "", "quote": ""}'),
    ("an invalid result is tolerated", 'if result not in RESULTS:', 'if False:'),
    ("evidence fences are not sanitised", 's = FENCE.sub("", str(text or ""))', 's = str(text or "")'),
    ("the model sees every source", 'judgeable = [s for s in sources if any(s["source_id"] in c["source_ids"] for c in semantic)]',
     'judgeable = list(sources)'),

    # ── the verdict ──
    ("a failed required criterion is fulfilled", 'if R_FAIL in required:\n        return V_NOT_FULFILLED',
     'if False:\n        return V_NOT_FULFILLED'),
    ("doubt becomes fulfilment", 'if R_UNKNOWN in required:\n        return V_INSUFFICIENT', 'if False:\n        return V_INSUFFICIENT'),
    ("a non-critical failure is ignored", 'if any(r != R_PASS for r in optional):\n        return V_PARTIAL',
     'if False:\n        return V_PARTIAL'),
    ("required and optional are the same", 'optional = [results[c["criterion_id"]] for c in criteria if not c["required"]]', 'optional = []'),

    # ── consensus ──
    ("validators skip the verdict", '"verdict": res["verdict"],\n        "criteria"', '"criteria"'),
    ("validators skip criterion results", '{"criterion_id": c["criterion_id"], "result": c["result"],\n                      "evidence_refs": c["evidence_refs"], "observed": c["observed"]}',
     '{"criterion_id": c["criterion_id"]}'),
    ("validators skip evidence availability", '"evidence": [{"source_id": e["source_id"], "status": e["status"]} for e in res["evidence"]],', ''),
    ("validators skip the quotes", 'if not quotes_hold(leader, visible(readable)):', 'if False:'),
    ("a quote need not be in the validator's own copy", 'if _squash(q) not in _squash(readable[refs[0]]):', 'if False:'),
    ("the contract accepts any agreed verdict", 'if res["verdict"] != _derive(terms["criteria"], {c["criterion_id"]: c["result"] for c in res["criteria"]}):', 'if False:'),
    ("the contract accepts unknown evidence refs", 'if not isinstance(refs, list) or len(refs) > 1 or any(r not in valid_refs for r in refs):', 'if False:'),
]


def main() -> int:
    survivors = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, old, new in MUTANTS:
            if SOURCE.count(old) != 1:
                print(f"BAD MUTANT {name!r}: pattern found {SOURCE.count(old)} times")
                survivors.append(name)
                continue
            path = pathlib.Path(tmp) / "Witness.py"
            path.write_bytes(SOURCE.replace(old, new).encode("utf-8"))
            env = {**os.environ, "WITNESS_CONTRACT": str(path), "PYTHONUTF8": "1"}
            proc = subprocess.run([sys.executable, "-m", "pytest", "tests/direct", "-q", "-x",
                                   "-p", "no:cacheprovider"],
                                  cwd=ROOT, env=env, capture_output=True, text=True)
            killed = proc.returncode != 0
            print(f"{'killed  ' if killed else 'SURVIVED'} {name}", flush=True)
            if not killed:
                survivors.append(name)
    print(f"\n{len(MUTANTS) - len(survivors)}/{len(MUTANTS)} mutants killed")
    if survivors:
        print("survivors:", ", ".join(survivors))
    return 1 if survivors else 0


if __name__ == "__main__":
    sys.exit(main())
