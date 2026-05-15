# Marker-Aware Cash-Out — Design

**Date:** 2026-05-15
**Status:** Approved (pending spec review)

## Problem

The cash-out modal (`app/(cashier)/live/_components/tx-cashout-modal-client.tsx`)
records a `CASH_OUT` transaction for the full chip value a player turns in, with
no regard for any outstanding marker (player debt to the house). A player who
borrowed $100 against the house and turns in $500 of chips is paid the full
$500 — the $100 marker stays open and is easily forgotten, so the house silently
eats the loss.

## Goal

Show the cashier (and the player looking over their shoulder) an itemized
receipt of the true payout after deducting outstanding markers, and let the
cashier choose how aggressively to apply that deduction.

## Behavior

The modal gains a **Marker deduction** selector with three options, and an
itemized **receipt** that recomputes live as the cashier changes the selected
player, the amount, or the selector:

| Option                   | Markers in scope                                            |
| ------------------------ | ----------------------------------------------------------- |
| All open markers *(default)* | Every `OPEN` marker for the player, across all sessions |
| Tonight's markers only   | `OPEN` markers issued in the **current** session only       |
| None                     | No deduction — full payout, markers untouched (today's behavior) |

Let `X` = chip value turned in, `M` = sum of `(amount − repaidAmount)` over the
markers in scope, ordered oldest-first (FIFO).

- **`X ≥ M`** → payout = `X − M`; every in-scope marker fully repaid (status `REPAID`).
- **`X < M`** → payout = `$0`; markers repaid FIFO until `X` is exhausted: the
  oldest marker is repaid (fully if `X` covers its remaining, else partially),
  then the next, until `X` runs out. Markers not reached, or only partially
  covered, keep status `OPEN` with an updated `repaidAmount`.
- **None** → exactly today's behavior: a single `CASH_OUT` for `X`, no markers touched.

## Data Flow

New server action `getOpenMarkersForPlayer(playerId)`:

- Returns `OPEN` markers for the player as
  `{ id, amount, repaidAmount, sessionId, issuedAt, isCurrentSession }[]`,
  ordered oldest-first by `createdAt`.
- Club-scoped via `getActiveClubId()` — never returns another tenant's markers.
- `isCurrentSession` is computed by comparing the marker's `sessionId` to the
  modal's current `sessionId` prop, so the client can filter "Tonight's markers
  only" without a second round-trip.

The modal calls this action when a player is selected. All receipt math is pure
client-side from the returned list — amount and scope changes never re-fetch.
Re-fetch happens only on player change.

## Ledger Mechanics

The "difference" cash-out decomposes into existing ledger primitives, all on the
**same payment method** the cashier selected for the payout:

1. **One `CASH_OUT` tx for the full chip value `X`** — unchanged `recordCashOut`
   shape: `{ <method>: −X }, { CHIP_FLOAT: −X }`.
2. **One `MARKER_REPAY` tx per marker repaid**, reusing the existing
   `repayMarker` logic verbatim: `{ <method>: +amount }, { MARKER_OUTSTANDING: −amount }`,
   updating the marker's `repaidAmount`, flipping `status` to `REPAID` when fully
   covered, and keeping `repayMarker`'s existing overpayment guard.

Net effect on the method account = `−X + Σ(repayAmounts) = −(payout)`. Each
transaction independently satisfies `validateBalanced` (≥2 entries, signed sum
zero), so no change to ledger validation is required.

**Why same method:** the marker repayment is funded by surrendered chips, not a
separate tender. Keeping the repay legs on the same payment account as the
cash-out makes the net land in exactly one account and accurately represents
"the player's chips paid down the debt." Splitting methods would fabricate a
tender movement that never happened.

**Atomicity:** the `CASH_OUT` tx plus all `MARKER_REPAY` txs run inside one
`prisma.$transaction`, cash-out first then repays in FIFO order, so a
mid-sequence failure can never pay out without repaying (or vice-versa).

## Receipt UI (itemized)

Placed between the amount input and the submit button, below the marker-scope
`<select>`:

```
Chips turned in                      $500.00
─ Marker (May 8)                    −$100.00
─ Marker (tonight)                   −$50.00
─────────────────────────────────────────────
Payout to player                     $350.00
```

- One deduction line per in-scope marker, labelled with a human date
  ("tonight" when `isCurrentSession`, else the issue date).
- When `X < M`, a partially-covered marker shows the amount actually applied,
  plus a muted sub-line for the remaining balance, e.g.
  `Marker (May 8): $30.00 still open`. Markers not reached at all also show as
  `still open` with their full remaining.
- Payout line shows `$0.00` when `X < M`.
- No open markers (or scope = None) → receipt collapses to a single
  `Payout to player  $X` line; no behavior change.
- Submit button label reflects the payout: e.g. `Pay out $350.00`, or
  `Record (no payout)` when payout is `$0.00`.

## Edge Cases

- **No open markers** — selector still renders; receipt is the single payout
  line; submits a plain `CASH_OUT` exactly as today.
- **"Tonight's markers only" with no current-session markers** — behaves like
  None (empty scope → no deduction).
- **`X = M` exactly** — payout `$0.00`; all in-scope markers `REPAID`.
- **Overpayment** — `repayMarker`'s existing guard
  (`repay ≤ amount − repaidAmount`) is never tripped because each FIFO step caps
  the repay at that marker's remaining balance.
- **Player switched after markers loaded** — every player-select re-fetches;
  amount-only and scope-only changes reuse the cached list.
- **Zero / negative amount** — receipt shows `$0.00` payout, no markers repaid;
  existing amount validation in `cashOutSchema` still applies on submit.

## Testing

**Pure allocator (unit):** extract
`allocateMarkerRepayments(chipValue, markers[])` →
`{ payout, repayments: [{ markerId, amount }], stillOpen: [{ markerId, remaining }] }`.
Cases:

- `X > M` — payout = `X − M`, all markers fully repaid, `stillOpen` empty.
- `X = M` — payout `0`, all fully repaid.
- `X < M`, single marker — payout `0`, one partial repayment, remaining correct.
- `X < M`, multiple markers — FIFO: oldest fully repaid, next partial, rest
  untouched; remaining balances correct.
- Zero markers — payout = `X`, no repayments.
- Scope = None — payout = `X`, no repayments (allocator given empty list).

**Integration:** a full "difference" cash-out produces one balanced `CASH_OUT`
plus N balanced `MARKER_REPAY` txs; marker `repaidAmount`/`status` correct;
sum of all ledger entries on the method account equals `−payout`; whole
sequence atomic (inject a failure on the 2nd repay → nothing persists).

## Out of Scope

- Changing marker issuance.
- Cross-player marker netting.
- Any UI for `WRITTEN_OFF` markers (excluded from scope entirely).
- Mixed payment methods for payout vs. repayment (explicitly disallowed).
