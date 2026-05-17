# Minimal Session VOIDED Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `VOIDED` session status that no system path treats as `OPEN`, then retire two pre-launch test sessions via an audited data migration without destroying ledger data.

**Architecture:** One additive Prisma enum migration; harden the two transaction-admission gates (app `ensureSessionOpen` + DB trigger `check_session_open()`) from "block CLOSED" to "require OPEN"; everything else already filters on `status:"OPEN"` so VOIDED is excluded for free. A strict-allowlist, dry-run-first script voids the two known sessions in production.

**Tech Stack:** Next.js 16 server actions, Prisma 6 + Postgres (plpgsql triggers), Vitest, decimal.js.

> **Next.js / Prisma note:** non-standard Next.js (`AGENTS.md`). All work here is server-action / Prisma / SQL — no Next framework surface changes. Local Postgres must be running; the test DB is `rakeledger_test` (`.env.test`), dev DB via `.env`.

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `prisma/schema.prisma` | Add `VOIDED` to `SessionStatus` enum | Modify (lines 82-85) |
| `prisma/migrations/<ts>_add_session_voided_status/migration.sql` | `ALTER TYPE` enum add | Create (via `prisma migrate dev`) |
| `prisma/migrations/<ts>_void_blocks_transactions/migration.sql` | Replace `check_session_open()` to require OPEN | Create (`--create-only` + manual SQL) |
| `app/(cashier)/_actions/transactions.ts` | Harden `ensureSessionOpen` to OPEN-only | Modify (lines 22-24) |
| `tests/unit/actions/session-voided.test.ts` | App-guard + getOpenSession VOIDED regressions | Create |
| `tests/unit/ledger/voided-session.test.ts` | DB-trigger VOIDED regression | Create |
| `scripts/void-test-sessions.ts` | Allowlist, dry-run-first prod data migration | Create |

---

## Task 1: Add `VOIDED` to the `SessionStatus` enum

**Files:**
- Modify: `prisma/schema.prisma:82-85`
- Create: `prisma/migrations/<timestamp>_add_session_voided_status/migration.sql` (generated)
- Test: `tests/unit/actions/session-voided.test.ts` (created here, first test)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/actions/session-voided.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testPrisma, resetDatabase } from "../test-db";

describe("SessionStatus VOIDED enum", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a session can be created with status VOIDED", async () => {
    const s = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    expect(s.status).toBe("VOIDED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/actions/session-voided.test.ts`
Expected: FAIL — Prisma rejects `status: "VOIDED"` (invalid enum value / type error), because the test DB enum has only `OPEN`,`CLOSED`.

- [ ] **Step 3: Edit the schema**

In `prisma/schema.prisma`, change the enum (currently lines 82-85):

```prisma
enum SessionStatus {
  OPEN
  CLOSED
  VOIDED
}
```

- [ ] **Step 4: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_session_voided_status`
Expected: creates `prisma/migrations/<timestamp>_add_session_voided_status/migration.sql` containing `ALTER TYPE "SessionStatus" ADD VALUE 'VOIDED';`, applies it to the dev DB, and regenerates the client. (Enum-add is additive; no rows change. The migration does not *use* the new value, so there is no Postgres "unsafe use of new enum value" hazard.)

Then apply to the test DB:

Run: `npx dotenv -e .env.test -- npx prisma migrate deploy`
Expected: the new migration applies; "All migrations have been applied."

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/actions/session-voided.test.ts`
Expected: PASS — 1/1.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (the generated client now includes `"VOIDED"`).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/unit/actions/session-voided.test.ts
git commit -m "feat: add VOIDED to SessionStatus enum"
```

---

## Task 2: Harden the app guard `ensureSessionOpen`

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts:22-24`
- Test: `tests/unit/actions/session-voided.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/actions/session-voided.test.ts` — add these imports at the top (after the existing imports) and a new `describe` at the end of the file:

Top of file, add:
```ts
import { vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { recordBuyIn } from "@/app/(cashier)/_actions/transactions";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, v);
  return f;
}
```

End of file, add:
```ts
describe("ensureSessionOpen rejects VOIDED (app guard)", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.TEST_USER_EMAIL = "test-cashier@dev";
  });

  it("recordBuyIn throws when the session is VOIDED", async () => {
    const session = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    const game = await testPrisma.game.create({
      data: { sessionId: session.id, name: "G", rakeSplitConfig: {} },
    });
    const player = await testPrisma.player.create({
      data: { displayName: "P", clubId: "test-club" },
    });
    await expect(
      recordBuyIn(fd({
        sessionId: session.id, gameId: game.id, playerId: player.id,
        amount: "100", method: "CASH",
      }))
    ).rejects.toThrow(/closed or voided/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/actions/session-voided.test.ts -t "app guard"`
Expected: FAIL — `ensureSessionOpen` currently only throws on `=== "CLOSED"`, so a VOIDED session is admitted and `recordBuyIn` proceeds (then likely fails later with a different/no error, not `/closed or voided/i`).

- [ ] **Step 3: Implement the guard change**

In `app/(cashier)/_actions/transactions.ts`, replace the body of `ensureSessionOpen` (lines 22-24):

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/actions/session-voided.test.ts`
Expected: PASS — all tests in the file (enum test + app-guard test).

- [ ] **Step 5: Regression — full transaction-action + ledger suites**

Run: `npx vitest run tests/unit/actions tests/unit/ledger`
Expected: PASS, no regressions (existing tests use OPEN sessions; the narrowed guard still admits OPEN and still rejects CLOSED).

- [ ] **Step 6: Commit**

```bash
git add "app/(cashier)/_actions/transactions.ts" tests/unit/actions/session-voided.test.ts
git commit -m "fix: ensureSessionOpen requires OPEN (blocks VOIDED, not just CLOSED)"
```

---

## Task 3: Harden the DB trigger `check_session_open()`

**Files:**
- Create: `prisma/migrations/<timestamp>_void_blocks_transactions/migration.sql`
- Test: `tests/unit/ledger/voided-session.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger/voided-session.test.ts` (mirrors `tests/unit/ledger/closed-session.test.ts`, status `VOIDED`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";

describe("voided session is frozen at the DB layer", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({
      data: {
        clubId: "test-club",
        openedById: "test-cashier",
        status: "VOIDED",
        closedAt: new Date(),
        closedById: "test-cashier",
      },
    });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "X", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("the DB trigger rejects a transaction inserted into a voided session", async () => {
    await expect(
      createTransaction({
        sessionId, gameId, type: "BUY_IN",
        createdById: "test-cashier",
        amount: new Decimal(100), method: "CASH",
        entries: [
          { account: "CASH_DRAWER", delta: new Decimal(100) },
          { account: "CHIP_FLOAT", delta: new Decimal(100) },
        ],
      })
    ).rejects.toThrow(/non-open session/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger/voided-session.test.ts`
Expected: FAIL — the current trigger only raises on `s_status = 'CLOSED'`, so the insert into a VOIDED session succeeds and no error is thrown.

- [ ] **Step 3: Scaffold the migration**

Run: `npx prisma migrate dev --create-only --name void_blocks_transactions`
Expected: creates an empty `prisma/migrations/<timestamp>_void_blocks_transactions/migration.sql`.

- [ ] **Step 4: Write the migration SQL**

Put exactly this in the new `migration.sql` (replaces the function in place; the trigger `tx_session_must_be_open` keeps pointing at it):

```sql
CREATE OR REPLACE FUNCTION check_session_open() RETURNS trigger AS $$
DECLARE
  s_status text;
BEGIN
  SELECT status INTO s_status FROM "Session" WHERE id = NEW."sessionId";
  IF s_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Cannot insert Transaction into non-open session % (status %)', NEW."sessionId", s_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 5: Apply the migration to dev and test DBs**

Run: `npx prisma migrate dev`
Expected: applies `void_blocks_transactions` to the dev DB (no schema drift; it's a function replace).

Run: `npx dotenv -e .env.test -- npx prisma migrate deploy`
Expected: "All migrations have been applied." (trigger now updated in `rakeledger_test`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/ledger/voided-session.test.ts`
Expected: PASS — 1/1, error matches `/non-open session/i`.

- [ ] **Step 7: Regression — closed-session still frozen**

Run: `npx vitest run tests/unit/ledger/closed-session.test.ts`
Expected: PASS — the CLOSED test still throws. Note its assertion is `/closed session/i`; the new message for CLOSED is `"Cannot insert Transaction into non-open session <id> (status CLOSED)"`, which does NOT contain "closed session" as a phrase. **If `closed-session.test.ts` fails on the message regex, update its assertion** from `/closed session/i` to `/non-open session/i` (the freeze behavior is unchanged; only the message wording changed). Re-run to confirm PASS, and include that file in the Step 8 commit if modified.

- [ ] **Step 8: Commit**

```bash
git add prisma/migrations tests/unit/ledger/voided-session.test.ts
# also add tests/unit/ledger/closed-session.test.ts if its regex was updated in Step 7
git commit -m "fix: check_session_open trigger requires OPEN (blocks VOIDED)"
```

---

## Task 4: Lock in `getOpenSession` VOIDED exclusion (regression)

**Files:**
- Test: `tests/unit/actions/get-open-session.test.ts` (add one test to the existing `describe`)

- [ ] **Step 1: Add the regression test**

Append this test inside the existing `describe("getOpenSession club scoping", ...)` block in `tests/unit/actions/get-open-session.test.ts` (the file already imports `getOpenSession`, `testPrisma`, `resetDatabase`, seeds `test-club`/`test-cashier@dev`, and mocks `next/cache`):

```ts
  it("excludes a VOIDED session in the active club", async () => {
    await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0", status: "VOIDED" },
    });
    const result = await getOpenSession();
    expect(result).toBeNull();
  });
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/actions/get-open-session.test.ts`
Expected: PASS immediately (no code change) — `getOpenSession` filters `where: { status: "OPEN", clubId }`, so a VOIDED session is never returned. This test characterizes and locks that guarantee.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/actions/get-open-session.test.ts
git commit -m "test: lock getOpenSession excludes VOIDED sessions"
```

---

## Task 5: Audited data migration script for the two prod test sessions

**Files:**
- Create: `scripts/void-test-sessions.ts`

This is a one-off operational script (pattern: the prior clubId backfill). It is not unit-tested; it is **dry-run by default** and the destructive `--execute` against production is run by the user after reviewing the dry run.

- [ ] **Step 1: Write the script**

Create `scripts/void-test-sessions.ts`:

```ts
// One-off, idempotent, STRICT ALLOW-LIST. Voids exactly the two pre-launch test
// sessions. Dry-run by default; pass --execute to write. Never deletes rows.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Hard-coded allow-list — this script can NEVER touch any other session.
const TARGETS = [
  "cmp5bng6m0005lh045s24t6et", // The Office  (currently CLOSED)
  "cmp6fr4p90001kq04ix5flcp6", // Ante Up with Gracie (currently OPEN)
];
const VOIDER_USER_ID = "cmp6aizfk0001slggyz34dwmg"; // RJ
const VOID_REASON = "VOIDED: pre-launch test session cleanup (2026-05-16)";

async function main() {
  const execute = process.argv.includes("--execute");
  console.log(execute ? "*** EXECUTE MODE — will write ***\n" : "DRY RUN (no writes). Pass --execute to apply.\n");

  for (const id of TARGETS) {
    const s = await prisma.session.findUnique({
      where: { id },
      select: { id: true, status: true, clubId: true, closedAt: true, closedById: true, notes: true,
        club: { select: { name: true } } },
    });
    if (!s) { console.log(`  MISSING  ${id} — not found, skipping`); continue; }

    const [txs, ledger, markers] = await Promise.all([
      prisma.transaction.count({ where: { sessionId: id } }),
      prisma.ledgerEntry.count({ where: { transaction: { sessionId: id } } }),
      prisma.marker.count({ where: { sessionId: id } }),
    ]);

    const newNotes = VOID_REASON + (s.notes ? ` | ${s.notes}` : "");
    const newClosedAt = s.closedAt ?? new Date();
    const newClosedById = s.closedById ?? VOIDER_USER_ID;

    console.log(`  ${s.club?.name} session ${id}`);
    console.log(`    status:     ${s.status} -> VOIDED`);
    console.log(`    closedAt:   ${s.closedAt ? "(preserved) " + s.closedAt.toISOString() : "(set) " + newClosedAt.toISOString()}`);
    console.log(`    closedById: ${s.closedById ? "(preserved) " + s.closedById : "(set) " + newClosedById}`);
    console.log(`    notes:      ${JSON.stringify(newNotes)}`);
    console.log(`    RETAINED (not deleted): transactions=${txs} ledgerEntries=${ledger} markers=${markers}`);

    if (execute) {
      await prisma.session.update({
        where: { id },
        data: { status: "VOIDED", closedAt: newClosedAt, closedById: newClosedById, notes: newNotes },
      });
      console.log(`    -> WRITTEN`);
    }
  }
  console.log(`\n${execute ? "Done (executed)." : "Dry run complete. Re-run with --execute to apply."}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e); await prisma.$disconnect(); process.exit(1);
});
```

- [ ] **Step 2: Run the DRY RUN against production (read-only — safe)**

Run: `npx -y dotenv-cli -e .env.production -- npx tsx scripts/void-test-sessions.ts`
Expected: prints both sessions, `status: CLOSED -> VOIDED` (The Office, closedAt/closedById preserved) and `status: OPEN -> VOIDED` (Ante Up, closedAt/closedById set to now/RJ), retained-row counts non-zero, and "Dry run complete." No writes performed. Paste this output for the user.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/void-test-sessions.ts
git commit -m "chore: add dry-run-first script to void the two pre-launch test sessions"
```

- [ ] **Step 4: Hand off the production write to the user**

Do **not** run `--execute` automatically. Report to the user with the exact command for them to run after reviewing the dry-run output:

`npx -y dotenv-cli -e .env.production -- npx tsx scripts/void-test-sessions.ts --execute`

State explicitly that this is a permanent production write (status → VOIDED on the two allow-listed sessions; no rows deleted).

---

## Final Verification

- [ ] `npx vitest run` — full suite green (DB-backed; local Postgres + migrated `rakeledger_test` required).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx prisma migrate status` — no pending/failed migrations on dev; `npx dotenv -e .env.test -- npx prisma migrate status` clean for test DB.
- [ ] Dispatch a final code reviewer over the whole diff, then use `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Schema enum `VOIDED` → Task 1.
- App guard hardened to OPEN-only (break 2a) → Task 2.
- DB trigger hardened to OPEN-only (break 2b) → Task 3.
- "Everything else auto-excludes VOIDED" assumption (`getOpenSession`) → Task 4 regression lock.
- Audited dry-run-first data migration, allow-list of 2 IDs, reuse `closedAt`/`closedById`/`notes` (preserve if set, prefix notes), OPEN→VOIDED directly without running close/reconciliation, no rows deleted, user runs `--execute` → Task 5.
- Tests: trigger regression (mirrors closed-session), app-guard regression, getOpenSession exclusion → Tasks 1-4.
- Out-of-scope items (no in-app UI, no marker cascade, no un-void, no isDemo) — correctly absent from all tasks.

**Placeholder scan:** none — every step has concrete code/SQL and exact commands with expected output. Migration directory timestamps are `<timestamp>` only because Prisma generates them; the SQL contents are fully specified.

**Type/identifier consistency:** `SessionStatus.VOIDED`, `check_session_open()`, trigger `tx_session_must_be_open`, `ensureSessionOpen`, `recordBuyIn`, `getOpenSession`, script `TARGETS`/`--execute` are consistent across tasks. Session IDs (`cmp5bng6m…`, `cmp6fr4p9…`) and RJ user id (`cmp6aizfk0001slggyz34dwmg`) match the spec and the production audits. The closed-session message-regex risk is explicitly handled in Task 3 Step 7.
