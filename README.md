# WITNESS

> **Did it actually happen?** A creator defines an obligation: what must happen, who is responsible,
> the criteria that decide it, the only evidence sources that may be read, a deadline, a GEN bond,
> and what each possible verdict does with that bond. The responsible party commits the bond. After
> the deadline, GenLayer witnesses the evidence — validators fetch the permitted sources, read them
> independently, and must agree before a verdict is recorded. Once it is final, the bond settles
> exactly as the terms said.

One Intelligent Contract and a static web app. No backend, no database, no admin key, no oracle
operator, no server-side signer.

| | |
|---|---|
| Contract | [`0x60191e5A0Cb612d62241EE281cd0fcEEB69c2811`](https://explorer-studio.genlayer.com/address/0x60191e5A0Cb612d62241EE281cd0fcEEB69c2811) on GenLayer StudioNet (chain 61999), byte-identical to [`contracts/Witness.py`](contracts/Witness.py) |
| Live suite | 17 of 17 on StudioNet — [`docs/live-e2e.json`](docs/live-e2e.json), [`docs/e2e-verification.md`](docs/e2e-verification.md) |
| Direct suite | 94 tests in GenVM direct mode |
| Frontend | 36 tests, strict TypeScript, Next.js App Router |
| Frontend deployment | not deployed yet (see [Frontend setup](#frontend-setup)) |

---

## 1. What WITNESS is

Somebody promises something that happens in the world: a report published by a date, a release cut,
a disclosure made, a payment confirmed on a public ledger. Today the argument afterwards is settled
by whoever is trusted to look — a platform, an escrow agent, an oracle operator. Whoever looks
controls the money.

WITNESS records the promise, the bond behind it and the evidence that may settle it, all before the
fact, and then lets a validator panel look — together, independently, with the result recorded only
if they agree.

## 2. Why GenLayer

Half of this is ordinary contract logic, and WITNESS keeps it that way: who is responsible, whether
the bond is exact, whether the deadline has passed, whether a JSON field equals a value, whether a
timestamp falls before the deadline. A conventional chain does all of that.

What it cannot do is the other half: read a published document and judge whether it substantively
satisfies what was promised. That judgment is why the product exists, and every other way of getting
it introduces a trusted party. On GenLayer the judgment itself is the thing consensus is reached on:
several validators fetch the same page, read it themselves, and a verdict is recorded only when they
agree on every field the settlement depends on — including the exact passage each finding rests on.

Proven live, in one obligation: four criteria decided by contract code from GitHub's release API, and
one criterion — *the documentation explains how to install the SDK and shows how to use it in code* —
read by the panel from the README and grounded in a quote every validator found for itself.

## 3. Architecture

```text
 CREATOR ── create_obligation ───────────▶ ┌──────────────────────────────────────────────┐
 (defines terms, never touches the bond)   │  WITNESS INTELLIGENT CONTRACT (GenVM, Python) │
                                           │                                               │
 RESPONSIBLE PARTY ── fund_obligation ────▶│  terms (immutable)   bond ledger   lifecycle  │
 (sends exactly the bond as tx value)      │                                               │
                                           │  verify_obligation, after the deadline:       │
 ANYONE ── verify_obligation ─────────────▶│    ┌───────────────────────────────────────┐  │
                                           │    │ gl.vm.run_nondet_unsafe               │  │
 EVIDENCE SOURCES ◀── gl.nondet.web.get ───│    │  leader and every validator:          │  │
 (web, API, GitHub, document)              │    │   fetch each permitted source         │  │
                                           │    │   objective criteria  → in code       │  │
                                           │    │   semantic criteria   → exec_prompt   │  │
                                           │    │   ground each quote in its own fetch  │  │
                                           │    │   derive the verdict  → in code       │  │
                                           │    │ validator compares every stored field │  │
                                           │    └───────────────────────────────────────┘  │
                                           │           ▼ agreed, then re-validated         │
                                           │  verification record · verdict · finality     │
 ANYONE ── finalize_verdict ──────────────▶│                                               │
 ANYONE ── settle_obligation ─────────────▶│  bond → basis points fixed at creation        │
                                           └──────────────────────────────────────────────┘
                                                            │
 NEXT.JS APP (reads state, wallet-signed writes) ◀──────────┘
```

## 4. Obligation lifecycle

```text
CREATED ──fund (exact bond, by the responsible party)──▶ ACTIVE ──deadline──▶ (verifiable)
   │                                                        │
   └──cancel (creator, before the bond)──▶ CANCELLED         ├──verify──▶ VERDICT_PROPOSED
                                                             │                    │
                                                             │        finality delay (300 s)
                                                             │                    ▼
                          7 days with no verdict ──▶ RECOVERY │              FINALIZED
                                                             │                    │
                                                             ▼                 settle
                                                        (bond paid)  ──────▶  SETTLED
```

`DEADLINE_REACHED` is ACTIVE with the deadline passed. The brief's VERIFICATION_PENDING,
EVIDENCE_COLLECTED and ADJUDICATION_PENDING all happen inside the one verification transaction and
are that transaction's own phases, which the interface shows from GenLayer's status rather than
inventing contract states for.

## 5. Bond model

`bond_required` is part of the terms; `bond_deposited` is what the contract holds. The authoritative
amount is `gl.message.value`, never an argument. For a 0.5 GEN bond: 0.5 accepted; 0.499 returned;
0.501 returned; 0 refused outright. A deposit the contract cannot accept is sent straight back in
the same transaction and recorded with its reason, because StudioNet credits the value of a refused
payable transaction to the contract — refusing would strand it.

Payout order, every time: read the ledger, compute the split, zero the ledger, mark settled, then
transfer. Basis points are integers; 10000 is the whole bond; the responsible party's share rounds
down and the recipient takes exactly the rest, so the two always sum to the bond.

## 6. Evidence model

A mandate names up to four sources, each `WEB`, `API`, `GITHUB` or `DOCUMENT`, with an https
location and a description. They are fixed at creation and cannot be added to afterwards. Pages are
fetched fresh inside the verification transaction by every node and never stored; what the record
keeps is what the panel agreed they showed, with each source's availability: `OK`, `MISSING` (404 or
410, which is evidence of absence) or `UNAVAILABLE`.

## 7. Objective criteria

Decided by contract code, not by a model: `SOURCE_AVAILABLE`, `EQUALS`, `NOT_EQUALS`, `CONTAINS`,
`EXISTS`, `GTE`, `LTE`, `BEFORE_DEADLINE` — the last four over a JSON field named by a dot path.
Values are normalised before comparison and the observed value is recorded, so the reader sees what
the source actually returned.

## 8. Semantic criteria

Read by the validator panel, from the sources the criterion names and no others. The panel answers
PASS, FAIL or UNKNOWN per criterion with the source it rests on and a verbatim quote. It is never
shown the verdicts, the bond or the consequences, and it never chooses an outcome.

## 9. Nondeterministic execution

One `gl.vm.run_nondet_unsafe` round per verification. Nothing is written from inside it: it returns
a result, the contract re-validates that result — the verdict must follow from the criterion results
by the same derivation, every criterion must be present, references must name permitted sources —
and only then does deterministic code write the verification record and move the lifecycle.

## 10. Equivalence Principle

A custom validator, not a similarity judgment. The validator does the whole task again and agrees
only if every consensus-critical field is exactly equal:

| Compared exactly | Not compared |
|---|---|
| the verdict | reasoning prose |
| each criterion's result | wording or style |
| each criterion's evidence references | the page bytes themselves |
| an objective criterion's observed value | |
| each source's availability | |

Quotes are bound differently, and deliberately: a stored quote must be *contained in the validator's
own fetch* of the cited source. Byte equality would split honest validators whenever a live page
moves; containment still stops a leader storing a passage nobody else can find.

## 11. Validator independence

Each validator fetches every source itself, calls the model itself, grounds the quotes against its
own bytes and re-derives the verdict. It never adopts the leader's reading. A leader that claims
FULFILLED while the sources are down is refused, and so is one that changes a single finding, source
reference, observed value or availability flag.

## 12. Consensus

The round is accepted only when the panel agrees. Malformed model output raises `[LLM_ERROR]`, which
rotates the leader. Disagreement records nothing at all: no verdict, no evidence record, no
settlement.

## 13. Finalization

A verdict is recorded as VERDICT_PROPOSED and becomes FINALIZED only after the contract's own
`FINALITY_DELAY_SECONDS` (300) has passed, ten times StudioNet's finality window, so the verification
transaction itself is final first. The interface never calls an accepted transaction final.

## 14. Settlement

`settle_obligation` is permissionless and can run once. The finalized verdict picks a share in basis
points from the terms; the responsible party receives that share of the bond and the consequence
recipient receives the rest. `recover_obligation` is the bounded escape when no verdict was ever
reached: seven days after the deadline, anyone may settle it on the terms' insufficient-evidence
share.

## 15. Security invariants

The full matrix, with the test that holds each one, is in [`docs/security.md`](docs/security.md).
In short: settlement happens once and only after finality; a payout never exceeds the bond and the
ledger is zeroed before any transfer; terms never change once bonded; external evidence is data, not
instructions; the model never controls funds; uncertainty never becomes FULFILLED; and nothing is
written from inside nondeterministic execution.

## 16. Development setup

Requires Python 3.12 and Node.js 20.9 or newer.

```bash
python -m pip install -r requirements.txt
python scripts/fetch_genvm_bundle.py            # seeds the GenVM runner bundle; needed once
npm install
cp .env.example .env.local
npm run dev
```

Direct-mode tests run a real GenVM, which needs the runner bundle in
`~/.cache/{genvm-linter,gltest-direct}`. On a cold cache `gltest` asks for the release asset under a
name the v0.3.0-rc line no longer publishes, so the tests fail at import while the linter still
passes. `fetch_genvm_bundle.py` fetches whichever asset exists, checks that the archive opens, and
seeds both caches. It is a no-op once they are warm.

## 17. Testing

```bash
GENVM_VERSION=v0.3.0-rc7 genvm-lint check contracts/Witness.py --json   # PYTHONUTF8=1 on Windows
python -m pytest tests/direct -q                       # 94 tests, GenVM direct mode
python scripts/mutate.py                               # mutation sweep over the direct suite
SKIP_INTEGRATION=0 python -m pytest tests/integration -v -s   # the live StudioNet suite, ~16 min
npm run lint && npm run typecheck && npm test && npm run build
```

`gltest tests/integration -v -s` collects the same live tests. Direct tests mock the web and the
model — test fixtures, and only there — to prove what the contract decides from a given retrieval;
the live suite uses real validators, real pages and real models.

## 18. Deployment

```bash
python scripts/deploy.py                        # throwaway faucet-funded deployer, waits for FINALIZED
python scripts/inspect.py <address> --write-deployment
```

`deploy.py` deploys the bytes git holds, then reads the code back from the chain and requires it to
be byte-identical before reporting success. `inspect.py` re-verifies any deployment and writes
[`docs/deployment.json`](docs/deployment.json) plus the schema fixture the frontend's tests pin
against. Recorded for this deployment: network, address, transaction, schema, protocol version,
runner, code hash and the toolchain versions.

## 19. Environment configuration

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_GENLAYER_NETWORK` | `studionet` |
| `NEXT_PUBLIC_GENLAYER_CHAIN` | `61999` |
| `NEXT_PUBLIC_WITNESS_CONTRACT` | `0x60191e5A0Cb612d62241EE281cd0fcEEB69c2811` |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | optional; defaults to StudioNet's RPC |
| `SKIP_INTEGRATION` | tests only; `0` runs the live suite |
| `WITNESS_CONTRACT` | tests only; reuse a deployment instead of deploying |
| `GENVM_VERSION` | tooling only; pins the GenVM bundle that carries this runner (`v0.3.0-rc7`) |

Nothing secret is configured anywhere: no private keys, no seed phrases, no API secrets.

## 20. Frontend architecture

Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, no state-management or wallet
libraries. Server components render the shells; client components are only where a wallet, a live
read or a form is needed.

```text
src/app/              landing, /obligations, /obligations/new, /obligations/[id], loading, error, not-found
src/components/       shell, wallet, obligation (dossier, register, acts, create flow, tx tracker)
src/hooks/            reads with their own loading and error states; one write at a time
src/lib/contracts/    the schema-first adapter, the acts a viewer may perform, the deployed schema
src/lib/genlayer/     config, clients, the transaction state machine
src/lib/validation/   draft rules mirroring the contract's
src/lib/formatting/   every word the interface says about contract state
src/lib/wallet/       EIP-6963 discovery and the connected provider
```

The transaction state machine is explicit: `SIGNATURE_REQUIRED → SUBMITTED → PENDING → DECIDED →
FINALIZED`, with `FAILED` carrying the contract's own refusal sentence. A wallet returning a hash is
never shown as success.

### Frontend setup

```bash
npm install && cp .env.example .env.local && npm run dev
```

To deploy: any Next.js host, root directory this repository, the three public variables above. No
other service is needed.

## 21. Live E2E verification

[`docs/e2e-verification.md`](docs/e2e-verification.md) has every transaction hash, the four
obligations and their verdicts, every wall the contract refused in its own words, the settlement
figures, and the commands a reviewer runs to reconstruct all of it from the chain alone.

## 22. Known limitations

- **The sources decide.** WITNESS rules on what the permitted sources say, not on what is true.
- **StudioNet only.** A development network.
- **A human wallet run is outstanding.** Every live transaction was signed by the test suite with
  throwaway keys.
- **PARTIALLY_FULFILLED and recovery are proven in the direct suite**, not live: one needs a
  non-critical criterion failing on a real source at a chosen moment, the other a seven-day wait.
- **Objective rules need JSON.** Against an HTML page only `SOURCE_AVAILABLE` applies.
- **JavaScript-rendered pages** may be unreadable to `web.get`.
- **Model variance** can prevent agreement on an ambiguous criterion, which records nothing.
- **No fee estimate is shown**: genlayer-js 1.1.8 has no `estimateTransactionFeesForWrite`.
