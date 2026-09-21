# Security

What WITNESS guarantees, where each guarantee is enforced, how it is tested, and what it cannot
promise.

## The boundary

| Owned by | What |
|---|---|
| Contract, deterministic | identity and authorization, the immutable terms, the bond ledger, the deadline, objective criteria, the verdict derivation, finality, settlement, recovery, every storage write |
| Contract, nondeterministic | fetching the permitted sources and, for semantic criteria only, reading them into one result per criterion with a source and a quote |
| Model | nothing else. It never names a verdict, an amount, a recipient or a source, and never sees the consequences |
| External evidence | untrusted data, fenced and sanitised, fetched fresh by every validator inside the verification transaction |
| Frontend | forms, previews, wallet signing, display. It holds no key and decides nothing |

## Economic attacks

| Attack | What stops it | Test |
|---|---|---|
| Double settlement | `settle_obligation` requires status FINALIZED, and `_payout` refuses when the ledger is zero or `settled` is true | `test_settlement_happens_once`, live `0x907665361b007920…` |
| Payout larger than the bond | the split is integer basis points of `bond_deposited`; the two shares are asserted to sum to it | `test_a_split_that_does_not_divide_evenly…`, `test_partially_fulfilled_splits_by_basis_points` |
| Wrong bond amount | funding compares `gl.message.value` with `bond_required` exactly; anything else is returned with its reason | `test_underfunding_and_overfunding_are_returned` |
| Zero bond | a call carrying no value is refused outright, since nothing needs returning | `test_a_zero_value_call_is_refused_outright` |
| Funding by a stranger, or twice | the sender must be the responsible party and the obligation must be awaiting its bond | `test_only_the_responsible_party_can_commit_the_bond`, `test_repeated_funding_is_returned` |
| Withdrawal by a party | there is no withdrawal path. The bond leaves only through settlement or recovery, and only on the terms' shares | `test_a_bonded_obligation_cannot_be_cancelled` |
| Re-entrancy on payout | the ledger is zeroed and `settled` set before any transfer is emitted | `test_the_ledger_is_zeroed_before_the_transfer` |
| A refused deposit stranding value | StudioNet credits the value of a refused payable transaction to the contract, so a deposit that cannot be accepted is returned in the same transaction and recorded | `test_every_returned_deposit_is_recorded_with_its_reason`, live record |

Money is integer arithmetic throughout: atto and basis points, no floating point anywhere near a
payout.

## Evidence attacks

| Attack | What stops it |
|---|---|
| Prompt injection in a page | evidence is fenced, the fence delimiters are stripped from page text and refused in party text, and the prompt states an order of authority in which evidence cannot instruct. Proven live: [`demo/injected-report.md`](../demo/injected-report.md) demands FULFILLED and the bond; the verdict was NOT_FULFILLED |
| A forged end-of-evidence marker | `_sanitize` removes `<<<` and `>>>` from every page before it reaches a prompt | `test_a_page_cannot_forge_or_close_its_own_fence` |
| A source added after the fact | sources are part of the frozen terms; there is no path that adds one | `test_creation_freezes_the_terms` |
| An unavailable or stale source | a non-2xx, empty, oversized or unreadable response is UNAVAILABLE and can establish nothing; 404 and 410 are MISSING, which is evidence of absence | `test_an_unreachable_source_cannot_establish_anything`, `test_a_missing_page_fails_its_availability_criterion` |
| Oversized content | responses over 1 MB are unreadable; what reaches a prompt is at most 6,000 characters per source | `test_oversized_and_empty_bodies_are_unavailable` |
| An irrelevant source | the model is shown only the sources a semantic criterion may be judged from, and a finding citing any other source is downgraded, even when the quote is really in that source | `test_each_ungrounded_shape_is_refused`, `test_a_finding_may_rest_only_on_a_source_its_criterion_permits` |

## Adjudication attacks

| Attack | What stops it |
|---|---|
| Malformed JSON, unknown verdict, missing criteria | the answer is parsed defensively: an answer that is not an object, omits a criterion, answers one twice or uses a result outside the enum raises `[LLM_ERROR]`, the round rotates, nothing is recorded | `test_malformed_model_output_records_nothing`, `test_a_result_outside_the_enum_is_a_model_error_not_a_boundary_refusal` |
| An invented quote | a PASS or FAIL must cite a permitted source and quote a passage of 12 to 240 characters found in that node's own copy; anything else becomes UNKNOWN | `test_a_claim_the_page_does_not_carry_becomes_unknown` |
| Leader-only acceptance | the validator repeats the whole task — its own fetches, its own model call, its own derivation — and compares every consensus-critical field | `test_a_leader_claiming_fulfilled_on_dead_sources_is_refused` |
| A validator that only checks formatting | there is no formatting-only path: the comparison is over the verdict, every criterion's result, its evidence references, an objective criterion's observed value, and each source's availability | `test_a_validator_compares_every_consensus_critical_field` |
| A leader-selected replacement quote | every stored quote must be present in the validator's own fetch of the cited source | `test_a_leader_selected_replacement_quote_is_refused` |
| A result that does not follow the rules | after consensus the contract re-derives the verdict from the agreed criterion results and refuses anything inconsistent, malformed, or citing an unknown source | the boundary check in `verify_obligation` |

## Lifecycle attacks

Verification before the deadline, settlement before finalization, a second verification, a second
settlement, recovery while a verdict stands, cancelling a bonded obligation, and finalizing before
the delay are each refused by an explicit check, each with its own sentence. All are covered by
`tests/direct/test_state_machine.py` and `tests/direct/test_recovery.py`, and every one of them was
refused live ([`e2e-verification.md`](e2e-verification.md)).

## Fail-closed behaviour

| Situation | Result |
|---|---|
| A source cannot be read | that criterion is UNKNOWN; a required UNKNOWN is INSUFFICIENT_EVIDENCE |
| A finding cannot be grounded | UNKNOWN, whichever way it pointed |
| The model answers badly | the transaction reverts; no verdict, no record |
| Validators disagree | the transaction is not accepted; nothing is written |
| The agreed result is inconsistent | the contract refuses it at the boundary |
| No verdict is ever reached | after seven days, recovery settles on the terms' insufficient-evidence share |

Uncertainty never becomes FULFILLED, and it never silently becomes NOT_FULFILLED either: the
contract distinguishes "the evidence shows it did not happen" from "the evidence cannot say".

## Recovery

`recover_obligation` is the only escape for a bond no verdict reached. It opens seven days after the
deadline, only while the obligation is still ACTIVE, is callable by anyone, and pays out on the
share the terms fixed for INSUFFICIENT_EVIDENCE. It cannot be used to choose a verdict, to change
terms, or to withdraw to whoever calls it.

## Frontend trust assumptions

The frontend is untrusted by design. It stores nothing, has no backend and no database, and holds no
key. Before any write it checks the wallet's chain and that the configured address exposes the
WITNESS schema and answers as WITNESS. Its draft validation mirrors the contract's rules as a
convenience; the contract re-validates everything. Every value on an obligation page is a field of
`get_proof_chain`. Anyone can run a modified copy of the interface: the only thing a modified copy
cannot change is what the contract recorded under consensus, which is why every guarantee here is
stated in terms of contract state.

## Wallet security

Writes are signed by the user's injected wallet, discovered through EIP-6963 (MetaMask, Rabby, Trust
Wallet and others). The app passes the connected address and that wallet's provider to genlayer-js,
which asks the wallet to `eth_sendTransaction`. No private key, seed phrase or API secret exists in
this repository or in the bundle, and there is no server-side signer.

## Limits worth stating plainly

- **The sources decide.** WITNESS rules on what the permitted sources say, not on what is true. A
  creator who names a page an interested party controls has handed that party the verdict. The
  demonstration page in `demo/` is controlled by this repository on purpose, and says so on its face.
- **A live page can change between validators.** Quotes are bound by containment in each node's own
  fetch rather than by byte equality, because two honest fetches of a live page differ. A page that
  changes mid-round produces disagreement, which records nothing, rather than a wrong verdict.
- **JavaScript-rendered pages** may be unreadable to `web.get`, which yields UNAVAILABLE.
- **Model variance.** Validators run different models. An ambiguously worded semantic criterion can
  prevent agreement; the result is no decision, not a wrong one.
- **Objective criteria read JSON.** A rule over a field needs a source that returns JSON; against an
  HTML page only `SOURCE_AVAILABLE` applies.
- **Finality is the contract's own.** A verdict is settleable only after `FINALITY_DELAY_SECONDS`
  (300), far longer than StudioNet's 30-second window, so the verification transaction is final
  first. A consumer acting on a verdict should require FINALIZED.

## Mutation sweep

`python scripts/mutate.py` breaks one guard at a time in a scratch copy and requires the direct
suite to fail. Every access check, every bond rule, every lifecycle gate, the payout arithmetic,
each objective operator, quote grounding, the verdict derivation and every consensus-critical
comparison is covered.

**49 of 53 killed, 4 documented equivalent, 0 undocumented.**

The first run found five guards the suite did not hold. The contract was right each time; the tests
under-specified it:

| Guard | What the suite missed | Now held by |
|---|---|---|
| a field criterion against a 404 source fails | only `SOURCE_AVAILABLE` was tested against a 404 | `test_each_shape_of_answer_records_one_exact_pair[missing]` |
| an absent field is UNKNOWN, not FAIL | a test named for it never omitted a field | `...[field absent]` |
| an unreadable source records `UNAVAILABLE` | `observed` is consensus-critical and was never asserted | `...[unreachable]`, `test_exists_separates_not_there_from_cannot_tell` |
| a finding may cite only its criterion's sources | the quote happened not to appear in the other source | `test_a_finding_may_rest_only_on_a_source_its_criterion_permits` |
| an out-of-enum result is `[LLM_ERROR]` in the round | the boundary also refuses it, and the test checked only that it reverted | `test_a_result_outside_the_enum_is_a_model_error_not_a_boundary_refusal` |

The fourth was a real fail-open in the suite's coverage, not only a precision gap: the
post-consensus boundary checks evidence references against the obligation's sources, not each
criterion's, so the grounding rule is the only thing that binds a finding to what its criterion may
be judged from.

The four equivalent mutants are guards no public call can reach, kept so a future caller cannot
bypass them:

| Guard | Why it cannot fire |
|---|---|
| `_payout` refuses an empty or settled ledger | both callers gate on status and set a terminal status after it; funding requires a bond above `MIN_BOND` |
| `_payout` refuses a split that does not balance | `_split` returns `(x, bond - x)` with `bps` validated into `[0, BPS]`; `test_payout_invariants.py` proves it over the domain |
| the boundary re-derives the verdict | the round derived it with the same `_derive` from the same results |
| the boundary checks evidence references | grounding clears every ungrounded reference first |
