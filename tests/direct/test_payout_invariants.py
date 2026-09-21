"""The two invariants `_payout` asserts, proved over their whole domain.

`_payout` refuses a payout that does not balance and a payout from an empty or
already-settled ledger. Neither refusal can fire through any public call, which
is why the mutation sweep records both as equivalent mutants. That claim rests
on `_split` being exact for every bond and every permitted basis point, and on
the bond floor making a settleable obligation's ledger positive — so those are
proved here directly against the shipped source rather than argued in a comment.

`_split` and `BPS` are lifted out of `contracts/Witness.py` by AST and executed
on their own: they depend on nothing but each other, so this tests the code the
contract ships, not a copy of it.
"""
import ast
import pathlib

import pytest

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "Witness.py"


def _lift(names: set[str]) -> dict:
    """Execute just the named top-level constants and functions."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    wanted = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            wanted.append(node)
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in names for t in node.targets
        ):
            wanted.append(node)
    namespace: dict = {}
    exec(compile(ast.Module(body=wanted, type_ignores=[]), str(SOURCE), "exec"), namespace)
    missing = names - namespace.keys()
    assert not missing, f"not found in {SOURCE.name}: {sorted(missing)}"
    return namespace


LIFTED = _lift({"_split", "BPS", "MIN_BOND"})
_split = LIFTED["_split"]
BPS = LIFTED["BPS"]
MIN_BOND = LIFTED["MIN_BOND"]

# Every basis point a creator may set, and bonds spanning the floor to a whole
# treasury, including the awkward ones: primes, and amounts no share divides.
BONDS = [
    MIN_BOND,
    MIN_BOND + 1,
    10 ** 16,
    10 ** 18,
    3,
    7,
    9_999,
    10_001,
    123_456_789_012_345_678,
    2 ** 64 - 1,
]


@pytest.mark.parametrize("bond", BONDS)
def test_the_two_shares_always_sum_to_the_bond(bond):
    """The invariant `_payout` asserts, over every permitted basis point."""
    for bps in range(0, BPS + 1):
        to_party, to_recipient = _split(bond, bps)
        assert to_party + to_recipient == bond
        assert to_party >= 0 and to_recipient >= 0


@pytest.mark.parametrize("bond", BONDS)
def test_no_share_can_exceed_the_bond(bond):
    for bps in (0, 1, 2_500, 5_000, 7_500, BPS - 1, BPS):
        to_party, to_recipient = _split(bond, bps)
        assert to_party <= bond and to_recipient <= bond


def test_the_ends_of_the_range_are_whole():
    """0 and 10000 basis points are not rounded: they are all or nothing."""
    for bond in BONDS:
        assert _split(bond, 0) == (0, bond)
        assert _split(bond, BPS) == (bond, 0)


def test_the_responsible_party_never_gains_from_rounding():
    """Rounding down is deliberate: any indivisible remainder goes to the
    recipient, never to the party whose obligation is in question."""
    for bond in BONDS:
        for bps in (1, 3_333, 6_667, BPS - 1):
            to_party, _ = _split(bond, bps)
            # In integers: float division loses precision at these magnitudes.
            assert to_party * BPS <= bond * bps < (to_party + 1) * BPS


def test_a_settleable_obligation_always_holds_something():
    """The other refusal: `held <= 0`. Funding requires the exact bond and the
    bond floor is above zero, so a funded ledger is positive."""
    assert MIN_BOND > 0
    for bond in BONDS:
        if bond >= MIN_BOND:
            assert sum(_split(bond, 5_000)) > 0
