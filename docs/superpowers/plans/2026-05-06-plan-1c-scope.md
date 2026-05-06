# Plan 1c — Cashier UX Polish (Scope)

> **Status:** Scope locked, full implementation plan not yet written. Driven by gaps surfaced during the 2026-05-06 playtest of Plan 1b.

**Goal:** Close the cashier-side UX gaps identified during playtest. Mid-session error correction, mid-session per-person/per-staff visibility, cleaner dashboard, and feedback after writes.

**Non-goals:** Auth (Plan 2). Owner dashboards / cross-session staff performance / historical query (Plan 3).

---

## Items

### 1. Transaction correction UI on tx stream rows
The cashier needs an in-product way to correct a recorded transaction (wrong method, wrong amount, wrong player). Today the only path is the one-shot `scripts/fix-yvonne-buyin.ts` script. Surface a "correct" affordance on each tx-stream row that wraps the existing reverse + re-create pattern (`lib/ledger/transaction.ts::reverseTransaction`).

**Drove this:** Yvonne's CASHAPP buy-in was supposed to be APPLE_PAY; correction required hand-running a script.

### 2. Hide zero-balance tiles in AccountStrip
The shared-account strip currently always renders all 7 method tiles. Most are $0 most of the night, which crowds the dashboard. Always show: **Cash drawer**, **Chip float**, **Tip pool**, **Rake**. For everything else (**Zelle, Venmo, CashApp, Apple Pay, Promo, Tournament**), only render the tile if its balance is non-zero in the current session.

**Drove this:** "The board looks clean with one complete line and one line with only two cards" — playtest comment.

### 3. MARKER_OUTSTANDING tile in AccountStrip
Add a `MARKER_OUTSTANDING` tile to the shared-tile list, with the same hide-when-zero rule as #2. Currently there's no place on the live dashboard that shows total outstanding markers; the cashier has no surface for "how much is the house out right now."

**Drove this:** After Reggie's marker was issued in playtest Step 5, nothing on the dashboard reflected it.

### 4. Toast/nudge after Quick Action submission
Successful submission of a Quick Action modal (BuyIn, CashOut, Rake, TipDrop, Marker, Tournament, Jackpot, Freeroll, Misc) should fire a brief acknowledgment ("Buy-in $500 recorded for Reggie Patel") so the cashier has confirmation that the entry landed. Today the modal closes and the dashboard updates, but with ~150-200 tx/night the cashier needs a positive signal per write.

**Drove this:** Playtest comment — no feedback after entries.

### 5. Per-player session tx view
Click a player name on the live transaction stream (or the tx-stream row) to open a panel/modal showing every transaction that player has in the **current session**, with running totals (buy-ins, cash-outs, markers, walks/returns, net). Helps the cashier verify their own data entry mid-session and spot issues like Yvonne's wrong-method buy-in seconds after recording it instead of post-mortem.

Scoped to current session only — historical/cross-session player profile lives in Plan 3 per spec §12.3.

### 6. Per-staff session tx view + summary
Click a staff name on the drop tracker (or in the close-page tip-payout list) to open a panel showing every `RAKE` and `TIP_DROP` they made tonight, with running totals (rake total, tip total, last-drop time, tx count). For cashier role, also show every transaction they created during their shift.

Scoped to current session only — historical staff performance lives in Plan 3 per spec §12.3.

---

## Notes for full-plan writing

- Items 1, 5, 6 are all "click an existing UI element → modal/panel" — share a `<DetailPanel>` component pattern.
- Items 2 and 3 are AccountStrip changes; should land in the same task.
- Item 4 needs a session-scoped toast container (Radix Toast or a small custom one). Server Actions revalidate, so the toast probably has to be triggered client-side after `formAction` resolves — fits the existing modal pattern.
- All items are cashier-side, no auth dependency. Can ship before Plan 2.
