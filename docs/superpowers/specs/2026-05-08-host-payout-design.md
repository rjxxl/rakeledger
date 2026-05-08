# Host Payout — Per-Session Host Selection

**Status:** Draft (approved 2026-05-08)
**Author:** Richard Ujadu
**Pre-handoff blocker:** Yes — must ship before Alex Chavez gets the production URL.

## Context

`app/(cashier)/close/page.tsx` distributes the house-tax pool (Step 2) and rake pool (Step 3) at session close. Today, the default recipients for each pool are computed from `User.role` buckets:

```ts
const owners = await prisma.user.findMany({
  where: { role: { in: ["OWNER", "ADMIN", "CASHIER"] }, status: "ACTIVE" },
});
const hosts = await prisma.user.findMany({
  where: { role: { in: ["RUNNER", "CASHIER"] }, status: "ACTIVE" },
});
```

This is wrong in two ways:

1. **Job title is the wrong proxy for "did you host tonight?"** A CASHIER added purely for app login (e.g., the developer) lands in both lists by default. Alex (OWNER) lands in the house-tax list whether he was working that night or not.
2. **The recipient list is fixed at server-render time.** The existing `HouseTaxStep` and `RakeDistributionStep` components let the cashier edit per-recipient amounts, but they don't allow adding or removing recipients. Wrong defaults can only be zeroed out, leaving stale `$0.00` rows.

Real cardroom semantics: hosts vary night to night. Whoever's actually working the room takes the cut. We need a per-session selection mechanism.

## Goals

- Cashier explicitly selects which staff are "hosts working tonight" at session close.
- The selection drives the default recipient list for **both** house-tax (Step 2) and rake (Step 3) distribution.
- Selection persists across page reloads within the same session (so a refresh during close-out doesn't lose work).
- Existing per-recipient amount/method editing in Steps 2 and 3 is preserved unchanged.

## Non-Goals (YAGNI)

- **Per-pool divergent host lists** (rake hosts ≠ house-tax hosts). The two pools share the same selection. Future cardrooms that need divergence will add it then; the data model already keeps the pools independent end-to-end, so this is a future UI tweak, not a re-architecture.
- **No new role or flag** ("HOST" enum value, `isHost` boolean, etc.). The candidate list comes straight from active staff in the club.
- **Carryover across sessions** ("same hosts as last night"). Each new session starts with an empty selection.
- **Adding or removing staff from the close page.** Staff are still managed via the existing Staff page.
- **Filtering DEALERs out of the candidate list.** Dealers can be checked as hosts (a dealer who occasionally hosts on slow nights). Cashier is trusted not to double-dip a dealer who already received a tip payout.

## Design

### Data model

One additive schema change to `Session`:

```prisma
model Session {
  // ...existing fields...
  hostUserIds String[] @default([])
}
```

Postgres `text[]` column, default empty. No backfill needed — existing open and closed sessions get `[]` automatically. The array is a denormalized list of `User.id` values; we accept that integrity is by-convention rather than FK-enforced (users are DISABLED, not deleted, so dangling IDs are not a real concern; closed sessions intentionally keep historical IDs for audit).

### Candidate-staff query

In `app/(cashier)/close/page.tsx`, replace the `owners` and `hosts` queries with a single query:

```ts
const candidateStaff = await prisma.user.findMany({
  where: {
    clubId: activeClubId,
    status: "ACTIVE",
    role: { not: "WAITRESS" },
  },
  orderBy: { name: "asc" },
  select: { id: true, name: true, role: true },
});
```

WAITRESS is excluded (waitresses are tip-pool recipients only and never share rake/house-tax in practice). DEALER, RUNNER, CASHIER, ADMIN, and OWNER all appear in the checklist.

### UI

Insert one new component between Step 1 (tip payouts) and Step 2 (house tax). It is a client component because it owns interactive state.

**Layout sketch:**

```
┌─ HOSTS WORKING TONIGHT ─────────────────────────┐
│  [ ] Alex Chavez       OWNER                    │
│  [ ] Anna              DEALER                   │
│  [ ] Jake              DEALER                   │
│  [ ] Marcus            RUNNER                   │
│  [ ] Richard Ujadu     CASHIER                  │
│  [ ] Sally             RUNNER                   │
└─────────────────────────────────────────────────┘
```

- Sorted alphabetically by name.
- Each row: checkbox, staff name, role tag (small, muted).
- Toggling a checkbox is instant — no save button.

### State management

The new component (`HostSelector` working name) becomes the parent of the existing `HouseTaxStep` and `RakeDistributionStep` components. Lifting state up:

- `HostSelector` owns `selectedHostIds: Set<string>`, initialized from `session.hostUserIds` on mount.
- It derives a `recipients` array from the checked set + the relevant pool balance using existing `evenSplit()` logic, and passes that array down to `HouseTaxStep` and each `RakeDistributionStep` (one per game) as `initialRecipients`.
- `HouseTaxStep` and `RakeDistributionStep` keep their existing per-recipient amount/method editing — no internal changes beyond receiving recipients via props instead of computing defaults from role buckets.

When the cashier toggles a checkbox:
1. React state updates immediately (UI is responsive).
2. A debounced (~500ms) call to a new server action `updateSessionHosts(sessionId, userIds)` writes the full selection to `Session.hostUserIds`. Last-write-wins; the server always overwrites with the latest full set, so reordered network responses cannot corrupt state.

### Server action

```ts
// app/(cashier)/_actions/session.ts (or new payouts helper)
export async function updateSessionHosts(
  sessionId: string,
  userIds: string[]
): Promise<void> {
  // Validate: all userIds must belong to the active club + be ACTIVE.
  // Validate: session must be the active user's open session.
  // Update Session.hostUserIds.
}
```

Validation rules:
- Caller must be authenticated; `session.id` must match an open session in their active club.
- Each `userId` must reference a User row with `clubId == activeClubId` and `status == "ACTIVE"`.
- (Defensive — the UI only offers valid IDs, but server actions are the trust boundary.)

### Defaults & edge cases

- **First open of a fresh session's close page:** `hostUserIds = []`, all checkboxes unchecked. Cashier picks explicitly.
- **Refresh mid-close:** state restores from `Session.hostUserIds`.
- **No hosts checked + non-zero pool:** Step 2 / Step 3 render an empty recipient table with a "Select at least one host above" message; the **Distribute** button is disabled. (Prevents closing the session with stuck pool balances.)
- **No hosts checked + zero pool:** existing behavior preserved — "No house tax to distribute" / "No rake to distribute," step is auto-complete.
- **Cashier checks Marcus, then Marcus is later DISABLED via the admin UI mid-session:** Marcus's ID stays in `hostUserIds`. The recipient row shows him with `(disabled)` next to his name; cashier can manually uncheck him before submitting Step 2/3. (Soft handling; not a blocker.)

### Audit trail

The existing `RAKE_DISTRIBUTION` and `HOUSE_TAX_DISTRIBUTION` transaction types already record `staffId` per-recipient. No additional audit changes needed — the recipient set on each transaction is the source of truth for "who got paid what."

`Session.hostUserIds` is also retained on closed sessions (no cleanup) for forensics: "which hosts did the cashier *select* that night, even if some got $0?"

## Testing

**Unit tests:**
- `evenSplit(total, n)` invariant unchanged — already covered.
- `HostSelector` derives the correct recipient list from `selectedHostIds + poolBalance`. Test cases:
  - 0 hosts checked → empty recipient list, button disabled.
  - 1 host checked → 1 recipient with full pool.
  - 3 hosts checked, $100 pool → 3 recipients with $33.34, $33.33, $33.33 (remainder lands on first).
- `updateSessionHosts` server action:
  - Rejects userIds not in active club.
  - Rejects userIds whose User.status != ACTIVE.
  - Rejects when sessionId is for a different club's session.

**Integration / E2E:**
- Open session → record some rake and tip drops → navigate to close → check 2 hosts → verify Step 2 and Step 3 each show 2 recipients with even split → submit both → verify ledger entries created with correct `staffId` values.
- Refresh the close page mid-selection → verify checkbox state restores from server.

## Open questions

None. All design decisions made during 2026-05-08 brainstorm.

## Implementation order (preview)

1. Schema migration: add `hostUserIds String[] @default([])` to Session.
2. Server action: `updateSessionHosts(sessionId, userIds)` with validation.
3. Refactor close page query (replace dual role-buckets with single candidate-staff query).
4. New `HostSelector` client component (checklist + state + debounced save).
5. Wire `HostSelector` as parent of `HouseTaxStep` and `RakeDistributionStep`; pass recipients via props.
6. Empty-state messaging on Step 2 / Step 3 when no hosts selected.
7. Tests (unit + E2E).
