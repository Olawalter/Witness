"""Inspect a deployed WITNESS contract: code, schema and on-chain records.

    python scripts/inspect.py <address> [--revision HEAD] [--obligation 1] [--write-deployment]

Everything printed is read from GenLayer StudioNet, never from this repository
or the frontend:

  code        `gen_getContractCode` compared byte for byte with
              contracts/Witness.py at the revision (exit 1 on any difference)
  schema      the methods, parameters and types GenLayer derived from the
              deployed code — what the frontend is wired against
  protocol    get_protocol_info
  obligations every obligation with its status, verdict and bond
  obligation  with --obligation: the frozen terms, the verification record and
              the settlement, as get_proof_chain returns them

--write-deployment records the address, code hash and schema in
docs/deployment.json and the schema in src/lib/contracts/witness-schema.json.
"""
import pathlib
import sys

_HERE = pathlib.Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if pathlib.Path(p or ".").resolve() != _HERE]

import argparse  # noqa: E402
import base64  # noqa: E402
import hashlib  # noqa: E402
import json  # noqa: E402
import subprocess  # noqa: E402
import time  # noqa: E402
import urllib.request  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
RPC = "https://studio.genlayer.com/api"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json",
                                                          "User-Agent": UA})
    out = json.load(urllib.request.urlopen(req, timeout=120))
    if "error" in out:
        raise SystemExit(f"RPC error from {method}: {out['error']}")
    return out["result"]


def show(title, value):
    print(f"\n-- {title} --")
    print(json.dumps(value, indent=2, default=str))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("address")
    ap.add_argument("--revision", default="HEAD")
    ap.add_argument("--obligation")
    ap.add_argument("--write-deployment", action="store_true")
    args = ap.parse_args()

    from eth_account import Account
    from genlayer_py import create_client
    from genlayer_py.chains import studionet

    client = create_client(chain=studionet, account=Account.create())   # read-only, never funded

    def view(fn, *a):
        return client.read_contract(address=args.address, function_name=fn, args=list(a))

    source = subprocess.run(["git", "show", f"{args.revision}:contracts/Witness.py"], cwd=ROOT,
                            capture_output=True, check=True).stdout.replace(b"\r\n", b"\n")
    code = base64.b64decode(rpc("gen_getContractCode", [args.address]))
    match = code == source
    print(f"on-chain  {args.address}  {len(code)} bytes  sha256 {hashlib.sha256(code).hexdigest()}")
    print(f"git       {args.revision:<42}  {len(source)} bytes  sha256 {hashlib.sha256(source).hexdigest()}")
    print("MATCH - the deployment is byte-identical to the repository source" if match
          else "DIFFER - the deployment is not this source")

    schema = client.get_contract_schema(args.address)
    methods = {name: {"params": m.get("params"), "kwparams": m.get("kwparams"), "ret": m.get("ret"),
                      "readonly": m.get("readonly"), "payable": m.get("payable")}
               for name, m in sorted((schema.get("methods") or {}).items())}
    show("schema methods", methods)
    info = view("get_protocol_info")
    show("get_protocol_info", info)

    page = view("list_obligations", 0, 50)
    show(f"list_obligations(0, 50) - {page['total']} total",
         [{"obligation_id": o["obligation_id"], "status": o["status"], "verdict": o["verdict"],
           "bond_required": o["bond_required"], "bond_deposited": o["bond_deposited"],
           "description": o["description"][:60]} for o in page["items"]])

    if args.obligation:
        show(f"get_proof_chain({args.obligation})", view("get_proof_chain", args.obligation))

    if args.write_deployment:
        revision = subprocess.run(["git", "rev-parse", args.revision], cwd=ROOT, capture_output=True,
                                  text=True, check=True).stdout.strip()
        record = {
            "network": "GenLayer StudioNet", "chain_id": studionet.id, "rpc": RPC,
            "explorer": f"https://explorer-studio.genlayer.com/address/{args.address}",
            "contract_address": args.address, "protocol_version": info["protocol_version"],
            "source": "contracts/Witness.py", "source_revision": revision,
            "source_sha256": hashlib.sha256(source).hexdigest(),
            "code_bytes": len(code), "onchain_sha256": hashlib.sha256(code).hexdigest(),
            "byte_identical": match, "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "genvm_runner": source.decode("utf-8").splitlines()[0].split('"')[3],
            "toolchain": {"genlayer_cli": "0.39.2", "genlayer_py": "0.16.3", "genlayer_test": "0.29.2",
                          "genvm_linter": "0.11.0", "genlayer_js": "1.1.8"},
            "schema_methods": methods,
        }
        (ROOT / "docs").mkdir(exist_ok=True)
        (ROOT / "docs" / "deployment.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        fixture = ROOT / "src" / "lib" / "contracts" / "witness-schema.json"
        fixture.parent.mkdir(parents=True, exist_ok=True)
        fixture.write_text(json.dumps(schema, indent=2, default=str) + "\n", encoding="utf-8")
        print(f"\nwrote docs/deployment.json and {fixture.relative_to(ROOT)}")
    return 0 if match else 1


if __name__ == "__main__":
    raise SystemExit(main())
