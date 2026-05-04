# Poker Room Accounting — Design Spec

**Date:** 2026-05-03
**Status:** Approved (brainstorming)
**Next step:** Implementation plan via writing-plans skill

---

## 1. Summary

A web-based accounting and operations system for small private poker card rooms. Replaces the current Google Sheets workflow (which produces 2-3 hours of nightly reconciliation pain due to buggy formulas, no audit trail, and money held by multiple custodians during the night) with an append-only multi-account ledger, a runner-pickup workflow, and an owner-facing analytics dashboard.

Built primarily for a specific friend's card room with the intent that other small private clubs could adopt it. Production tool first, portfolio quality as a secondary outcome.

## 2. Problem statement

The friend operates a small private poker club:

- 4 tables, ~40-50 players per typical night, ~150-200 transactions per night
- One cashier handles all transactions on a Google Sheet with clunky and sometimes incorrect formulas
- Cash custody is fragmented during the night — sometimes a runner brings cash to the cashier, sometimes a host or dealer holds cash temporarily
- End-of-night reconciliation regularly takes 2-3 hours of manual detective work to find discrepancies between the cash on hand and what the spreadsheet says
- Players use multiple payment methods: cash, Zelle, Venmo, CashApp, Apple Pay, and occasionally non-cash collateral (e.g., a watch left in lieu of payment for a marker)
- Cross-method transactions are common (buy in via Zelle, cash out in cash) — the spreadsheet has no concept of separate accounts to reconcile, so any single-account discrepancy gets buried in the aggregate
- The spreadsheet can't answer questions like "what time did Player X buy in for $200?" — useful for resolving disputes
- Freerolls (house-funded prize chip giveaways) regularly throw off reconciliation because the prize chips appear in float without a corresponding cash event
- Hourly rake/tip drops from dealers are not tracked separately
- Tips paid to dealers and waitresses are taxed (~20% to the house, configurable per person), and the calculation is done by hand

## 3. Goals

1. **Eliminate the nightly reconciliation problem.** End-of-night close-out should take <10 minutes for a clean night, <30 minutes when there's a discrepancy to investigate.
2. **Localize discrepancies fast.** When something doesn't match, surface the offending account, transaction, and likely cause within seconds — not after hours of manual scanning.
3. **Maintain a complete audit trail.** Every money movement, every correction, every staff action is recorded with who/when/what. No silent edits.
4. **Multi-custodian support, but nudge toward single-custodian.** The system supports the current "runner picks up cash" workflow with a custody-tracked pickup flow, while making cashier-direct entry the path of least resistance.
5. **Owner insights.** Provide dashboards that answer the operator's actual business questions: revenue trends, top regulars, peak hours, freeroll ROI, F&B cost ratio, reconciliation health.
6. **Junior-developer-readable codebase.** Boring, conventional architecture — no clever abstractions, no premature framework adoption. The author should be able to navigate every file without surprises.

## 4. Non-goals (out of scope for v1)

- **Compliance reporting** (CTRs, SARs, state regulator filings) — private clubs only, no regulatory exposure
- **Payment provider integrations** — the app records that a Zelle/Venmo/CashApp transaction occurred but does not call those APIs to verify. The cashier confirms wallet balances manually at close-out.
- **Hardware integrations** — no cash drawer kicker, receipt printer, or chip-tracking RFID
- **Tournament management** — tournament fees and payouts are recorded as transactions, but no bracket management, blind structure tracking, or re-buy automation
- **Player-facing app** — no player accounts or self-service. Staff-only.
- **F&B revenue tracking** — F&B is a free cost-of-doing-business; only the cost side is tracked
- **Multi-property tenancy** — one card room per app instance. The data model is architecturally compatible with later expansion to multi-property, but not in v1.
- **External accounting export beyond CSV** — no QuickBooks integration, no automated 1099s
- **Historical data import from the existing spreadsheet** — clean-slate launch
- **True real-time concurrent transaction conflict resolution** — at expected scale (~200 tx/night) standard database transactions handle concurrency without anything special

## 5. Three load-bearing concepts

The whole design rests on three concepts. Get these right and the rest follows.

### 5.1 Append-only ledger

Every money movement is an immutable `Transaction` record. Mistakes are corrected by adding a *reversal* `Transaction` that explicitly references the original (`reverses_id`). The full history of any night is the ordered list of transactions since the session opened.

This is the standard accounting pattern. It buys us a complete audit trail, time-travel queries (`SUM(delta) WHERE created_at <= T` gives the balance at any moment), and natural reconciliation diagnostics.

### 5.2 Multi-account ledger

There is no single "balance" to reconcile. Each payment method, the chip float, the rake pool, etc. is its own independent account with its own running balance. End-of-night reconciliation happens **per account** — the cashier counts cash, screenshots Zelle/Venmo/CashApp balances, etc. — and any discrepancy localizes to a single account, dramatically narrowing the search space for the cause.

The accounts are:

| Account | Type | Game-scoped? | Description |
|---------|------|:------------:|-------------|
| `cash_drawer` | Asset | No | Physical bills in the cage drawer |
| `zelle` | Asset | No | Net Zelle activity (verified against the wallet at close-out) |
| `venmo` | Asset | No | Same for Venmo |
| `cashapp` | Asset | No | Same for CashApp |
| `apple_pay` | Asset | No | Same for Apple Pay |
| `chip_float` | Liability | No | Total chip value currently outside the cage (in players' hands, on tables, in dealer/waitress tip stacks pre-drop) |
| `marker_outstanding` | Asset (receivable) | No | Total open marker debt across all players |
| `tip_pool` | Liability | No | Tips owed to staff, accumulating from hourly drops and not yet paid out |
| `house_tax_pool` | Revenue | No | House cut of staff tips, accumulated from end-of-night `tip_house_tax` transactions |
| `rake_pool` | Revenue | **Yes** | Per-game rake collected; distributed to that game's hosts at close-out |
| `promo_pool` | Expense | **Yes** | House-funded freeroll prize chips issued; per-game cost of promotional play |
| `tournament_pool` | Liability | **Yes** | Per-game tournament fees collected, paid out to winners |
| `external` | Catch-all | No | The "other side" for any flow into/out of the cage's tracked universe — owner deposits the opening float, F&B/staff cash leaving for off-cage purposes, walked chips, written-off markers, etc. Net balance over a session = net flow between the cage and the outside world. Lets every transaction stay 2-leg without inventing a new account per use case. |

Three accounts are **game-scoped** (see §11): each Game in a session has its own `rake_pool`, `promo_pool`, and `tournament_pool`. All others are shared across games (one physical drawer, one chip set, one set of staff tips).

### 5.3 Sessions

The night is bracketed by an explicit `Session` (open at start, close at end). All transactions belong to a session. Sessions are **self-contained**: every account opens at $0 by default. The cashier may optionally enter a starting cash float (a small amount of bills for change-making), recorded as `Session.opening_cash` and an opening transaction. At close-out, the float is recovered before reconciliation. This eliminates cross-session coupling — tonight's books don't depend on what last night left behind.

## 6. Domain model

### 6.1 Entities

```
Session
├── id (PK)
├── opened_at, closed_at, opened_by → User, closed_by → User?
├── opening_cash (decimal, default 0)
├── closing_cash (decimal?)
└── notes (text?)

Game
├── id (PK)
├── session_id → Session
├── name (e.g. "Main Game")
├── game_type (enum)
├── stakes (string)
├── rake_split_config (JSON: how this game's rake is split among hosts)
├── opened_at, closed_at
└── active (bool)

Table
├── id (PK)
├── name (e.g. "Table 1")
├── game_id → Game (nullable when table is dark)
├── stakes (string, can override game default)
└── active (bool)

Transaction
├── id (PK)
├── session_id → Session
├── game_id → Game? (inherited from table for table-bound tx; null otherwise)
├── type (enum, see §6.2)
├── created_at (timestamp)
├── created_by → User
├── player_id → Player?
├── staff_id → User? (the recipient on tip/rake/marker tx, etc.)
├── table_id → Table?
├── amount (decimal)
├── method (enum: cash | zelle | venmo | cashapp | apple_pay | other)
├── note (text?)
├── reverses_id → Transaction? (set on reversal entries)
└── pickup_status (enum?: pending | settled | cancelled — only for pickup-flow buy-ins)

LedgerEntry
├── id (PK)
├── transaction_id → Transaction
├── account (enum, see §5.2 table)
├── game_id → Game? (mirrors the parent transaction; only populated for game-scoped accounts)
├── delta (decimal, signed)
└── created_at (timestamp)

User
├── id (PK)
├── google_sub (string, unique — stable Google identity)
├── email (string, unique)
├── name (string)
├── role_id → Role
├── status (enum: pending | active | disabled)
├── pin_hash (string?, argon2 — for shared-device quick-switch)
├── tip_tax_rate (decimal?, default null = use system default)
└── notes (text?)

Player
├── id (PK)
├── display_name (string)
├── phone (string?)
├── notes (text?)
└── created_at (timestamp)

Marker
├── id (PK)
├── player_id → Player
├── issued_in_session → Session
├── issued_tx → Transaction
├── amount (decimal)
├── repaid_amount (decimal, default 0)
├── status (enum: open | repaid | written_off)
└── collateral (text?, e.g. "gold watch")

SessionAccountClose
├── id (PK)
├── session_id → Session
├── account (enum)
├── game_id → Game? (for game-scoped accounts)
├── expected (decimal, computed)
├── counted (decimal, entered by user)
├── variance (decimal, computed)
├── counted_by → User
├── counted_at (timestamp)
└── note (text?)

RakeDistribution
├── id (PK)
├── session_id → Session
├── game_id → Game (which game's rake was being distributed)
├── recipient_user_id → User
├── amount (decimal)
└── tx_id → Transaction

CashierHandoff
├── id (PK)
├── session_id → Session
├── outgoing_user_id → User
├── incoming_user_id → User
├── handed_off_at (timestamp)
├── account_counts (JSON: per-account expected vs counted vs variance at handoff)
└── notes (text?)
   # Not a Transaction — no money moves. Pure metadata event.

Role
├── id (PK)
├── name (string)
├── is_system (bool, true for built-in roles)
├── description (text)
├── capabilities (string[] of capability keys)
└── marker_limit (decimal?, used for capability-with-limit)

UserCapabilityGrant
├── id (PK)
├── user_id → User
├── capability_key (string)
├── mode (enum: grant | revoke)
├── granted_by → User
├── granted_at (timestamp)
└── reason (text?)

```

Pickup state is **derived** from `Transaction.pickup_status` + the related fields (`created_by`, `created_at`) — no separate `PickupRecord` table in v1. Confirmation timestamps and escalation events are stored as additional fields on the same Transaction (`pickup_confirmed_at`, `pickup_confirmed_by`, `pickup_escalated_at`). Add a denormalized table later only if the dashboard query gets too expensive at scale.

### 6.2 Transaction types

Each row lists the two `LedgerEntry` legs the transaction creates, in `account: signed_delta` form. Sign convention is "balance change from the account's own perspective" (see §6.3). The balance check is type-aware (§7.1).

| Type | What happens | Leg 1 | Leg 2 | Notes |
|------|--------------|-------|-------|-------|
| `buy_in` | Player exchanges money for chips | `cash_drawer` (or method): `+X` | `chip_float`: `+X` | Game inferred from table |
| `cash_out` | Player exchanges chips for money | `cash_drawer` (or method): `-X` | `chip_float`: `-X` | Denomination-aware form by default |
| `rake` | Dealer drops rake chips | `chip_float`: `-X` | `rake_pool[game]`: `+X` | Game-scoped pool |
| `tournament_fee` | Player pays tournament entry | `cash_drawer` (or method): `+X` | `tournament_pool[game]`: `+X` | |
| `tournament_payout` | Tournament prize paid | `cash_drawer` (or method): `-X` | `tournament_pool[game]`: `-X` | Settles liability with asset |
| `tip_drop` | Dealer/waitress drops tip chips at the cage | `chip_float`: `-X` | `tip_pool`: `+X` | Tagged with `staff_id` |
| `tip_house_tax` | Staff tip's tax cut transferred to house | `tip_pool`: `-X` | `house_tax_pool`: `+X` | Internal transfer, no cash. `rounding_adjustment` field captures rounding delta |
| `tip_payout` | Net tip cash paid to staff at close-out | `cash_drawer` (or method): `-X` | `tip_pool`: `-X` | Settles liability with asset. Paired with `tip_house_tax` |
| `marker_issue` | Player given chips on credit | `chip_float`: `+X` | `marker_outstanding`: `+X` | May include `collateral` text |
| `marker_repay` | Player pays back marker | `cash_drawer` (or method): `+X` | `marker_outstanding`: `-X` | |
| `marker_write_off` | Marker written off as uncollectable | `marker_outstanding`: `-X` | `external`: `+X` | Note required (treated as bad-debt expense) |
| `freeroll_prize_payout` | Freeroll winner awarded chips | `chip_float`: `+X` | `promo_pool[game]`: `+X` | No cash moves; house funds chips |
| `jackpot_payout` | Bad-beat / high-hand payout in chips | `chip_float`: `+X` | `rake_pool[game]`: `-X` | Funded from rake; chip variant. (Cash variant: `cash_drawer: -X` / `rake_pool[game]: -X`) |
| `staff_advance` | Cash advance to staff | `cash_drawer`: `-X` | `external`: `+X` | Note required |
| `fnb_cost` | F&B expense paid from cage | `cash_drawer`: `-X` | `external`: `+X` | Note required |
| `chip_walk` | Player took chips home | `chip_float`: `-X` | `external`: `+X` | Closes a chip_float variance with a known cause |
| `chip_return` | Player brought back previously walked chips | `chip_float`: `+X` | `external`: `-X` | Auto-suggested when matching prior `chip_walk` |
| `drawer_count_adjust` | Recorded unexplained drawer variance | `cash_drawer`: `±X` | `external`: `∓X` | Note required; signs flip together |
| `chip_float_adjust` | Recorded unexplained float variance | `chip_float`: `±X` | `external`: `∓X` | Note required; signs flip together |
| `rake_distribution` | Per-game rake split paid to host | `cash_drawer` (or method): `-X` | `rake_pool[game]`: `-X` | One transaction per recipient |
| `house_tax_distribution` | House tax pool distributed | `cash_drawer` (or method): `-X` | `house_tax_pool`: `-X` | One transaction per recipient |
| `opening_float` | Starting cash float at session open | `cash_drawer`: `+X` | `external`: `-X` | Optional |
| `closing_float` | Float withdrawn at close-out | `cash_drawer`: `-X` | `external`: `+X` | Paired with `opening_float` |

### 6.3 Sign convention for `LedgerEntry.delta`

Each `delta` represents the change to that account's balance from its own perspective:

- **Asset** accounts (cash_drawer, payment methods, marker_outstanding): positive `delta` = balance grows
- **Liability** accounts (chip_float, tip_pool, tournament_pool): positive `delta` = balance grows (more owed)
- **Revenue** accounts (rake_pool, house_tax_pool): positive `delta` = revenue grows
- **Expense** accounts (promo_pool): positive `delta` = expense grows
- **External** account: positive `delta` = value flowed *out* of the cage to the outside world (an expense or asset depletion); negative `delta` = value flowed *in* (capital injection or recovery). Treated as natural sign +1 in the balance check.

Each transaction's ledger entries must form a **balanced journal entry** in standard double-entry terms. Validated by application logic (and a database trigger as defense in depth) on insert. The check is type-aware:

```
balanced := SUM(delta * natural_sign(account_type)) == 0
where natural_sign:
  asset, expense, external → +1
  liability, revenue        → −1
```

This is a small, well-tested function in `lib/ledger/`.

A transaction has **at minimum two** ledger entries. Standard accounting allows multi-leg journal entries (3+); v1 transactions are all designed as 2-leg for simplicity. The ledger module's API supports N-leg, even though no v1 transaction type uses it — keeps the door open for future cases without rewriting core logic.

## 7. Ledger mechanics & invariants

### 7.1 Hard invariants enforced by the database

1. **Append-only on `Transaction` and `LedgerEntry`.** No UPDATE, no DELETE. Enforced by Postgres triggers and by an INSERT-only application-level role.
2. **Each transaction's ledger entries balance.** Validated by trigger.
3. **Closed sessions are frozen.** No new transactions may be inserted with a closed `session_id`. Trigger-enforced.
4. **Account balances are derived, never stored.** No `current_balance` column anywhere; every balance is `SELECT SUM(delta) FROM ledger_entry WHERE account = ? AND ...`. At expected scale this is instant; at higher scale a materialized view per account is the natural escalation.

### 7.2 Balance computation

Standard balance for the open session:

```sql
SELECT SUM(le.delta) AS balance
FROM ledger_entry le
JOIN transaction tx ON le.transaction_id = tx.id
WHERE le.account = :account
  AND tx.session_id = :open_session_id;
```

Game-scoped balance:

```sql
SELECT SUM(le.delta) AS balance
FROM ledger_entry le
JOIN transaction tx ON le.transaction_id = tx.id
WHERE le.account = :account
  AND tx.session_id = :open_session_id
  AND le.game_id = :game_id;
```

Time-travel ("what was the balance at T?"):

```sql
SELECT SUM(le.delta) AS balance_at
FROM ledger_entry le
JOIN transaction tx ON le.transaction_id = tx.id
WHERE le.account = :account
  AND tx.session_id = :session_id
  AND tx.created_at <= :timestamp;
```

### 7.3 Corrections

To fix a bad transaction, the application inserts:
1. A reversal transaction with `reverses_id = bad_tx_id` and ledger entries that exactly negate the original.
2. (If a corrected entry is needed) A second new transaction with the correct values.

The original transaction stays in place forever. The UI shows the original with a strikethrough and a link to the correction(s). Both reversal and corrected transactions log who created them and why.

### 7.4 Reconciliation

End-of-night reconciliation operates per-account:

1. Cashier opens **Close session**.
2. For each account, the system computes `expected = SUM(delta WHERE session_id = current)`.
3. Cashier physically counts (cash drawer) or screenshots wallet balance (Zelle/Venmo/etc.) and enters the actual count.
4. `variance = counted − expected` is recorded in a `SessionAccountClose` row.

If any account has nonzero variance, the system runs heuristic checks:

- **Equal-and-opposite variances across accounts** → suggests a method-mistype. Flag candidate transactions of the variance amount.
- **Outlier amounts in the session** → unusually large transactions, decimal/zero typos.
- **Orphaned buy-ins** (player bought in but never cashed out, no marker, no chip walk recorded) → may indicate a missed cash-out.

If heuristics don't resolve it, the cashier opens the per-account **timeline view**: a chart of running balance over the night plus a transaction log with the running "balance after" computed inline for each row. Each row links to detailed inspection.

For `chip_float` variance specifically, the sign matters:

- **chip_float > 0** at close → chips physically left the room without being recorded. Triggers the **walk attribution** workflow: list players who bought in but never cashed out, with options to mark each as "Busted" or "Walked with $X." Total walked must equal the variance.
- **chip_float < 0** at close → chips appeared in the cage that weren't bought in tonight. Triggers the **return attribution** workflow: surface any players in tonight's session who have outstanding `chip_walk` records from prior sessions, suggest matching.

Unresolved variance can always be flushed via `drawer_count_adjust` or `chip_float_adjust` with a required note. These show up in the owner's reconciliation health dashboard.

## 8. Roles, capabilities, and authentication

### 8.1 Capability-based RBAC

Permissions are granular **capability keys**, not role-locked behavior. A `Role` is a named bundle of capabilities; per-user **grants** and **revocations** layer on top.

```
effective(user, cap) = (user.role.capabilities + user.grants) − user.revocations
```

Capability keys are defined in code as constants. Adding a new capability is a code change (deliberate); adding/removing capabilities to/from roles is admin-panel UI (configurable).

### 8.2 Built-in roles (defaults — all editable in admin panel)

- **Owner** — all capabilities, plus `system.transfer_ownership`. Cannot be revoked any capability via the admin UI.
- **Admin** — everything except `system.transfer_ownership`. Manages users, roles, and system settings.
- **Cashier** — runs the cage: session lifecycle, all transaction types, reconciliation, marker issue, tip payout, rake distribution.
- **Runner** — pickup workflow, player profile edit, marker issue (≤ $500 default limit), table management, marker repayment, rake distribution at close-out, view own performance dashboard.

Custom roles (e.g., "Senior Runner" with marker authority up to $1k) can be created by Owner/Admin in the admin panel.

### 8.3 Capability list (v1)

Sessions: `sessions.open`, `sessions.close`, `sessions.handoff_initiate`, `sessions.handoff_receive`

Transactions: `transactions.buyin.create`, `transactions.cashout.create`, `transactions.tip_payout.create`, `transactions.rake.distribute`, `transactions.correct`

Pickup: `pickup.create`, `pickup.confirm`

Markers: `markers.issue` (with optional limit), `markers.repay`, `markers.write_off`

Players & tables: `players.create`, `players.edit`, `players.view_history`, `tables.manage`

Games: `games.open`, `games.close`, `games.edit_split`

Reporting: `dashboards.view`, `dashboards.view_self`, `reports.export`

Administration: `users.approve`, `users.create`, `users.edit`, `users.edit_permissions`, `system.settings`, `system.transfer_ownership`

### 8.4 Authentication

- **Owner / Admin / Cashier / Runner — Google OAuth (Auth.js v5).** New sign-ins create a `User` row with `status = pending`; existing users with `active` status are signed in.
- **Approval workflow.** Pending users are reviewed by anyone with `users.approve` capability. Approval assigns a role and (optionally) sets a PIN.
- **PIN for shared device quick-switch.** A 4-6 digit PIN (argon2-hashed) is set per user. On a shared cage device, users tap their name and enter PIN to become the active user. Inactivity timeout (default 5 min) re-locks. PIN does not replace Google sign-in for personal devices.

## 9. Key workflows

### 9.1 Session open

1. Cashier taps **Open session.**
2. (Optional) Enters a starting cash float for change-making — recorded as `Session.opening_cash` and an `opening_float` transaction.
3. Session opens with all account balances at $0 (plus the float on `cash_drawer` if any).

### 9.2 Direct buy-in at the cage

Player walks up, hands over money, gets chips. Cashier:

1. Opens buy-in form.
2. Selects player (or creates a new player profile inline).
3. Enters amount and method. Selects table (auto-fills the game).
4. Confirms. `cash_drawer` (or other method) ↑, `chip_float` ↑.

### 9.3 Runner pickup workflow

1. Runner taps **+ New Pickup** on their phone.
2. Selects player, enters amount, selects method, selects table (auto-fills game).
3. Submits. The transaction is recorded immediately as a normal `buy_in` with `pickup_status = pending`. The cashier sees a notification on the live dashboard.
4. Runner walks to the cage, hands over the cash. Cashier verifies and taps **Confirm pickup.** Status flips to `settled`.
5. Runner walks chips back to the table.
6. **Escalation:** if not confirmed within 5 minutes (configurable in admin settings), notification fires to anyone with `users.approve` (typically owner/admin).
7. **Cancellation:** runner can cancel a pending pickup if the player changes their mind before delivery. Cancellation creates a reversal transaction.

### 9.4 Cash-out (denomination-aware default)

1. Cashier selects player.
2. Default form: per-denomination chip count grid. Total auto-computes (e.g., `5×$100 + 3×$25 + 5×$5 = $600`).
3. Selects payout method.
4. Confirms. If method = cash, `cash_drawer` ↓; otherwise corresponding wallet account ↓. `chip_float` ↓ in either case.
5. Quick-entry override (single amount field) available for trusted cashiers / small amounts.

### 9.5 Marker issue / repay

- **Issue:** Cashier (or Runner with `markers.issue` capability ≤ limit) records a marker. `marker_outstanding` ↑, `chip_float` ↑. Optional `collateral` field for non-cash security (watch, etc.).
- **Repay:** Player pays back the marker (in any method). `cash_drawer` (or method) ↑, `marker_outstanding` ↓. Marker's `repaid_amount` updates; if equal to amount, status → `repaid`.
- **Write-off:** Owner/admin only. Marker status → `written_off`, `marker_outstanding` ↓.

### 9.6 Hourly rake/tip drops

Every hour (cadence loosely enforced by the dashboard's drop tracker), each dealer brings their accumulated rake chips and tip chips to the cashier:

- **Rake drop:** `rake_pool[game]` ↑, `chip_float` ↓. Tagged with `staff_id` (the dealer who dropped) and `table_id`.
- **Tip drop:** `tip_pool` ↑ (tagged with `staff_id`), `chip_float` ↓.

The cashier dashboard's drop tracker shows each active dealer/waitress with their last drop time, color-coded (white = on time, amber = >1h, red = no drop yet).

### 9.7 Mid-session cashier handoff

Used when the cashier has to leave mid-session (emergency).

1. Outgoing cashier taps **Hand off cashier role.**
2. Selects receiving user (must have `sessions.handoff_receive`).
3. Both physically present. Outgoing counts each account; incoming enters the counts.
4. Both PIN-confirm.
5. A `CashierHandoff` row is created (not a Transaction — no money moves) with both user IDs, timestamp, and per-account counted-vs-expected JSON.
6. Even with mismatch, handoff goes through (it's an emergency); the variance is logged on the handoff record. Close-out can later show variance attributable to which cashier's window.

### 9.8 End-of-night close-out

1. Cashier taps **Close session.**
2. **Recover starting float** (if any) → `closing_float` transaction.
3. **Pay out tips** → for each staff with tip_pool balance:
   - System computes total, applies per-user tax rate, defaults rounded tax to nearest dollar.
   - Cashier can nudge tax ±$1 with arrows; net to staff updates accordingly.
   - Confirm records two linked transactions: `tip_house_tax` (tip_pool → house_tax_pool, with rounding adjustment captured) and `tip_payout` (cash_drawer → staff in their preferred method).
4. **Distribute rake — per game** → for each Game in the session:
   - System shows `rake_pool[game]` total.
   - Applies the game's `rake_split_config` to compute each host's share.
   - Cashier confirms; one `rake_distribution` transaction per recipient.
5. **Distribute house tax pool** → similar to rake distribution; `house_tax_pool` → owners per the system-wide split.
6. **Account close-out** → for each account, system shows expected; cashier enters counted; variance is recorded in `SessionAccountClose`.
7. **Resolve variances** if any, using the divergence-finder workflow (heuristics → timeline scrub → per-player check → manual `*_adjust` if necessary).
8. **Resolve chip walks/returns** if `chip_float` variance is nonzero.
9. **Lock session.** `Session.closed_at`, `closed_by`, `closing_cash` set. No further transactions accepted.

### 9.9 Freeroll prize award

1. Cashier records a `freeroll_prize_payout` for each freeroll winner: `chip_float` ↑, `promo_pool[game]` ↑. Tagged with player and game.
2. The winner's session record now reflects unredeemed promo chips.
3. When the winner approaches the cage to add cash to play in the cash game afterward, the buy-in form shows: *"Player W has $225 in unredeemed freeroll chips. Only enter the cash they're handing you."* This prevents the cashier from recording the full $500 stack as a buy-in when only $275 cash actually changed hands.

### 9.10 Walks and returns

- **Walks** (chip_float > 0 at close-out): assigned via the walk attribution UI. Each generates a `chip_walk` transaction.
- **Returns** (chip_float < 0 at close-out): suggested matches against prior `chip_walk` records for players in the session. Confirmation generates a `chip_return` transaction.
- **Unattributable variance**: `chip_float_adjust` with a required note; surfaces in owner reconciliation health dashboard.

## 10. Concurrent games (multi-game support)

A `Session` can host one or more concurrent `Game`s. Each Game has:

- Its own name, game type, and stakes
- Its own rake split configuration (`rake_split_config`)
- One or more `Table`s (a Table belongs to exactly one Game at a time)
- Its own `rake_pool[game]`, `promo_pool[game]`, and `tournament_pool[game]`

Tables can move between games via close-and-reopen (an exception flow). Rake collected before the move stays attributed to the original game; rake after the move flows to the new one. The transaction's `game_id` is captured at write time.

### 10.1 Cashier dashboard with concurrent games

A **Game switcher** at the top of the live session view offers three modes:

- **Single Game (e.g., "Main Game")** — accounts strip shows that game's per-game accounts plus the shared accounts. Transaction stream filtered. Quick actions pre-fill `game_id`.
- **All games (default)** — shared accounts shown once; per-game accounts shown side-by-side ("Rake — Main: $385 / Hi-Stakes: $620"). Transaction stream shows everything with a colored game tag.

When recording a transaction:

- If the cashier picks a table → the game is auto-selected.
- If the cashier picks a player without a table → prompted to pick a game from the active games in the session.

### 10.2 End-of-night with multiple games

- Reconciliation is on the **shared accounts** (one physical drawer to count, one chip set to count). No change.
- **Rake distribution becomes per-game** — distribute Game A's rake to its host roster per its split, then Game B's separately.
- Tip payout is per-staff (game-agnostic).

### 10.3 Game templates

The admin panel includes a **Game templates** section. Common configurations are saved (name, game type, stakes, default rake split). When opening a Game in a live session, the cashier picks a template; settings prefill and can be customized for that night.

## 11. UI structure

### 11.1 Two device contexts, one Next.js app

- **Desktop layout** (cage computer, default for cashier/owner/admin): persistent left sidebar; main content area to the right.
- **Mobile layout** (runner phones, also usable for any role on mobile): bottom tab bar; full-width content above. Touch targets ≥ 44px.

The same routes serve both. CSS responsive breakpoints + a few component variants.

### 11.2 Top-level navigation (varies by capability)

- **Live Session** — the cashier's main surface during the night
- **Players** — directory + per-player history
- **Tables** — table state, game assignments
- **Markers** — outstanding markers + history
- **Dashboards** — `Tonight (live) / Recent / Historical / Per-player / Per-staff / Reconciliation health` (visible if `dashboards.view`)
- **Admin** — Roles & capabilities, Users, Pending approvals, Tables & games, System settings, Rake & tax distribution (visible if `users.edit_permissions` etc.)
- **My activity** — own performance dashboard (always visible)

### 11.3 Visual style

- **Dark theme by default** (light theme as user preference)
- **Amber/gold for primary actions** (subtle nod to chip color)
- **Green / red / cyan** for positive / negative / informational signals
- **Monospace for all money values**, right-aligned, with thousands separators
- **Inter or system sans** for everything else
- **Decoration is functional, not playful** — this is accounting software, not a casino game

### 11.4 Real-time updates

The cashier dashboard subscribes to a **Server-Sent Events** stream scoped to the current session. New transactions, pickup status changes, and drop tracker updates push into the UI within ~1 second. SSE is simpler than WebSockets at this scale and supported natively by Next.js route handlers.

## 12. Insights & dashboards

### 12.1 Three lenses

- **Tonight (live)** — KPIs, live revenue meter, active reconciliation health, anomaly feed (auto-suggestions: late drops, oversized transactions, unconfirmed pickups).
- **Recent (default morning view, 30d range, configurable to 7/30/90/YTD/custom)** — see §12.2.
- **Historical / Query** — custom date range + filters (player, staff, table, transaction type, account, method); CSV export.

### 12.2 Recent dashboard contents

KPI strip: house revenue (rake + tip tax), sessions count, total players (with returning %), avg buy-in, promo spend.

Cards:

- **Nightly revenue** — stacked bars (rake + tip tax) with 7-day moving average overlay
- **Top regulars** — sorted by rake contribution
- **Activity heatmap** — day × hour player-hours grid (helps with staffing decisions)
- **Promo ROI** — for each $1 of freeroll prize, attributed incremental rake from freeroll-winning players over the next 7 days
- **F&B cost as % of revenue** — single number with a target-ceiling bar
- **Reconciliation health** — % of nights closed clean, variance count, avg variance, by-cashier breakdown
- **Outstanding markers** — sorted by age + amount, with collateral notes

### 12.3 Per-player and per-staff drill-downs

- **Player profile view** — every visit, every transaction, win/loss curve over time, marker history, walk/return history, contact info
- **Staff performance view** — rake attributable to their tables (for runners/hosts), tips received, hours worked (derived from session opens/handoffs), reconciliation variances during their windows (for cashiers)

## 13. Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) + TypeScript |
| UI | Tailwind CSS + Radix or shadcn/ui primitives |
| Database | Postgres (Neon) |
| ORM | Prisma |
| Auth | Auth.js v5 + Google OAuth + custom credentials provider for PIN |
| Real-time | Server-Sent Events (Next.js route handlers) |
| Validation | Zod |
| Money math | `Prisma.Decimal` / `decimal.js` (never JS floats) |
| Background jobs | Vercel Cron (e.g., for pickup escalation timeouts) |
| Testing | Vitest (unit) + Playwright (E2E for reconciliation flows) |
| Errors | Sentry (free tier) |

### 13.1 Repository layout (rough)

```
poker-room-accounting/
├── app/
│   ├── (auth)/              # sign-in, pending-approval
│   ├── (cashier)/           # live session, transactions, close-out
│   ├── (runner)/            # mobile pickup
│   ├── (owner)/             # dashboards, history, reports
│   ├── (admin)/             # users, roles, settings
│   └── api/                 # SSE endpoint, webhooks
├── lib/
│   ├── ledger/              # core append-only ledger logic (heavily tested)
│   ├── auth/                # Auth.js config + capability checks
│   ├── reconciliation/      # variance detection + suggestion heuristics
│   └── db.ts                # Prisma client singleton
├── prisma/
│   ├── schema.prisma        # entire data model
│   └── migrations/
├── components/              # shared UI (transaction row, account tile, etc.)
└── tests/
    ├── unit/
    └── e2e/
```

The `lib/ledger/` module is the heart of the system — small, mostly pure-functional, and exhaustively unit-tested. Every transaction type has tests proving the journal entries balance correctly, including the multi-leg cases (`tip_payout` with rounding adjustment, freeroll prizes).

### 13.2 Hosting & cost

| Service | Tier | Monthly |
|---------|------|---------|
| Vercel | Hobby (free) | $0 |
| Neon (Postgres) | Free | $0 |
| Sentry | Developer (free) | $0 |
| Domain | $12/yr | ~$1 |
| **Total** | | **~$1/month** |

Vercel Pro ($20/mo) and Neon Scale (~$20/mo) are the natural growth path if/when usage demands it. Not needed for v1.

## 14. In scope (v1) — final consolidated list

- Append-only multi-account ledger with all transaction types defined in §6.2
- Session lifecycle: open with optional float, transactions, close with reconciliation + tip payout + per-game rake distribution + house tax distribution
- Concurrent Games within a session, with per-game rake split configurations and Game templates
- Persistent player profiles with marker tracking + collateral notes
- Capability-based RBAC with 4 built-in editable roles + per-user grants
- Google OAuth + approval workflow + PIN for shared-device quick-switch
- Cashier desktop dashboard: live session view + reconciliation divergence finder + drop tracker + Game switcher
- Runner mobile PWA: pickup workflow with pending state + escalation
- Hourly drop tracking with cadence alerts
- Tip payout with per-staff configurable tax rate + whole-dollar rounding (with rounding adjustment captured)
- Freeroll prize accounting (`promo_pool`)
- Walk / chip return tracking (chip_float reconciliation in both directions)
- Owner dashboards: Tonight, Recent (30d default), Historical/Query, Per-player, Per-staff, Reconciliation health
- Reconciliation health metric with per-cashier variance attribution
- Promo ROI attribution (incremental rake from freeroll winners in subsequent days)
- Admin panel: users, roles, capabilities, system settings, rake/tax distribution rules, Game templates
- CSV export for owner

## 15. Out of scope (v1) — final consolidated list

- Compliance reporting (CTRs, SARs, regulator filings)
- Payment provider API integrations (Zelle/Venmo/CashApp/Apple Pay verification)
- Hardware integrations (cash drawer, receipt printer, RFID)
- Tournament management (brackets, blinds, re-buys)
- Player-facing app (no player accounts)
- F&B revenue tracking (only cost side)
- Multi-property tenancy (one card room per app instance — architecturally compatible with later expansion)
- External accounting integrations beyond CSV (no QuickBooks, no automated 1099)
- Historical data import from existing spreadsheet
- Per-game chip color separation (assumes one shared chip set across games)

## 16. Open questions / future work

- **Per-game chip color separation.** If a room uses different chip colors per game, `chip_float` would also need to become game-scoped. Not addressed in v1.
- **True multi-property tenancy.** The Game model coexists cleanly with a future `Property` entity layered above `Session`. Capability checks would gain a property scope.
- **Player-facing self-service** (account view, marker repayment via player phone, pre-buy-in via Zelle that the cashier just confirms) — natural future area but heavy in scope.
- **Mobile-first cashier mode** for very small rooms where the cashier might use a phone instead of a desktop.
- **Anomaly detection beyond heuristics** (e.g., ML-flagged cashier patterns over time). Out of scope; manual review of dashboard variance trends covers the immediate need.

## 17. Appendix: capability list (with default role assignments)

| Capability | Owner | Admin | Cashier | Runner |
|------------|:-----:|:-----:|:-------:|:------:|
| sessions.open | ✓ | ✓ | ✓ | — |
| sessions.close | ✓ | ✓ | ✓ | — |
| sessions.handoff_initiate | ✓ | ✓ | ✓ | — |
| sessions.handoff_receive | ✓ | ✓ | ✓ | ✓ |
| transactions.buyin.create | ✓ | ✓ | ✓ | — |
| transactions.cashout.create | ✓ | ✓ | ✓ | — |
| transactions.tip_payout.create | ✓ | ✓ | ✓ | — |
| transactions.rake.distribute | ✓ | ✓ | ✓ | ✓ |
| transactions.correct | ✓ | ✓ | ✓ | — |
| pickup.create | ✓ | ✓ | ✓ | ✓ |
| pickup.confirm | ✓ | ✓ | ✓ | — |
| markers.issue | ✓ | ✓ | ✓ | ≤ $500 |
| markers.repay | ✓ | ✓ | ✓ | ✓ |
| markers.write_off | ✓ | ✓ | — | — |
| players.create | ✓ | ✓ | ✓ | ✓ |
| players.edit | ✓ | ✓ | ✓ | ✓ |
| players.view_history | ✓ | ✓ | ✓ | ✓ |
| tables.manage | ✓ | ✓ | ✓ | ✓ |
| games.open | ✓ | ✓ | ✓ | — |
| games.close | ✓ | ✓ | ✓ | — |
| games.edit_split | ✓ | ✓ | — | — |
| dashboards.view | ✓ | ✓ | — | — |
| dashboards.view_self | ✓ | ✓ | ✓ | ✓ |
| reports.export | ✓ | ✓ | — | — |
| users.approve | ✓ | ✓ | — | — |
| users.create | ✓ | ✓ | — | — |
| users.edit | ✓ | ✓ | — | — |
| users.edit_permissions | ✓ | ✓ | — | — |
| system.settings | ✓ | ✓ | — | — |
| system.transfer_ownership | ✓ | — | — | — |
