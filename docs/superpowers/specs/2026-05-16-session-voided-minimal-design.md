# Minimal Session VOIDED — Design

**Date:** 2026-05-16
**Status:** Approved (pending spec review)
**Scope:** Minimal — retire two pre-launch test sessions without destroying ledger data, and make the system safe against a non-OPEN session being treated as recordable.

## Problem

Two test sessions pollute production:

- **The Office** (production club) — session `cmp5bng6m0005lh045s24t6et`, currently `CLOSED`, the pre-launch smoke test (9 tx, 18 ledger entries, 1 REPAID marker, 13 account-closes).
- **Ante Up with Gracie** (demo club) — session `cmp6fr4p90001kq04ix5flcp6`, currently `OPEN` (4 tx, 8 ledger entries, 1 REPAID marker).

Hard-deleting these is wrong: RakeLedger is an append-only double-entry ledger; destroying `Transaction`/`LedgerEntry` history defeats its purpose and risks orphaning obligations. The ledger-correct move is a soft **void**: retain all rows, mark the session `VOIDED` so it is excluded from active flows and reporting, with an audit trail.

## Goal

1. Add a `VOIDED` terminal session status.
2. Ensure no system path treats a `VOIDED` session as if it were `OPEN` (the "don't break anything" guarantee).
3. Set the two test sessions to `VOIDED` via an audited, dry-run-first data migration. All rows retained.

## Context Audit — every `Session.status` consumer

| Consumer | Behavior with VOIDED | Change needed |
| --- | --- | --- |
| `getOpenSession` (`session.ts:66-67`) — `findFirst where status:"OPEN"` | Auto-excluded | None |
| `closeSession` optimistic lock (`session.ts:92`) — `where {id, status:"OPEN"}` | Won't act on VOIDED | None |
| `closeSession` game-close (`session.ts:143`) — operates on Game status | N/A to session | None |
| `/close` page (`close/page.tsx:17`) — loads via `getOpenSession()` | Never receives a VOIDED session | None |
| `games.ts:30` — `if (session.status !== "OPEN") throw` | Already blocks VOIDED | None |
| **`ensureSessionOpen` (`transactions.ts:22`) — `if (s.status === "CLOSED") throw`** | **VOIDED slips through → transactions could be recorded** | **FIX** |
| Reports / cross-session aggregates | None exist in the app | None |

The only real break is `ensureSessionOpen`. Everything else already keys off `status: "OPEN"` (allow-list semantics), so VOIDED is excluded for free.

## Design

### 1. Schema

```prisma
enum SessionStatus {
  OPEN
  CLOSED
  VOIDED
}
```

Single additive Prisma migration (enum value only). **No column changes.** Void metadata reuses existing `Session` columns:

- `closedAt` → timestamp the session was voided
- `closedById` → user who voided it
- `notes` → human reason, format `"VOIDED: <reason>"`

### 2. Behavioral fix

`app/(cashier)/_actions/transactions.ts`, `ensureSessionOpen` (line 22):

```ts
// before
if (s.status === "CLOSED") {
  throw new Error("Cannot record transactions on a closed session.");
}
// after
if (s.status !== "OPEN") {
  throw new Error("Cannot record transactions on a closed or voided session.");
}
```

This is the sole code change. It hardens the guard to an allow-list (only `OPEN` may receive transactions), which is correct for `CLOSED` today and `VOIDED` going forward.

### 3. Data migration

A one-off script `scripts/void-test-sessions.ts`:

- **Strict allow-list**: operates only on the two hard-coded session IDs above. No "all sessions" logic, ever.
- **Dry-run by default**: prints exactly what it would change (current status → VOIDED, the metadata to be written, child-row counts confirming nothing is deleted). Requires an explicit `--execute` flag to write.
- For each allow-listed session, in a single `prisma.$transaction`:
  - `status = "VOIDED"`
  - `closedAt = new Date()` (only if currently null — The Office already has a real `closedAt`/`closedById` from its earlier close; preserve those, only overwrite if null)
  - `closedById = "cmp6aizfk0001slggyz34dwmg"` (RJ) only if currently null
  - `notes`: prefix with the void reason without clobbering any existing note —
    `"VOIDED: pre-launch test session cleanup (2026-05-16)" + (existing ? " | " + existing : "")`
- The OPEN Ante Up session transitions **directly** `OPEN → VOIDED`. The close/reconciliation flow is **not** invoked — running it would fabricate bogus `SessionAccountClose`/payout/rake-distribution records for a test session. This bypass is the entire point of voiding vs. closing.
- No `Transaction`, `LedgerEntry`, `Marker`, `Game`, or `SessionAccountClose` rows are touched. Both sessions' markers are already `REPAID`, so there is no open obligation to cancel.
- User runs `--execute` after reviewing the dry-run output (permanent production write).

### 4. Tests

- New: `ensureSessionOpen` throws when the session is `VOIDED` (regression for the one real break). Place alongside existing transaction-action tests.
- New: `getOpenSession` excludes a `VOIDED` session (locks in the auto-exclusion assumption; extends the existing `get-open-session.test.ts`).
- Existing full suite must stay green — no other consumer changes.

## Out of Scope (Minimal)

- No in-app void UI or server action (no session-list/history UI exists to surface voided sessions anyway).
- No marker-cancellation cascade (both markers already `REPAID`).
- No un-void, no `Club.isDemo` flag, no struck-through display.
- No change to `closeSession`, reporting, or reconciliation.

## Risks & Mitigations

- **A VOIDED session accepting transactions** — mitigated by the `ensureSessionOpen` fix + a regression test.
- **Accidentally voiding the wrong session** — mitigated by the script's hard-coded two-ID allow-list and dry-run-first/`--execute` gate, run by the user.
- **Enum migration on Postgres** — adding a value to a Prisma enum is an additive, non-breaking migration; no existing rows change.
