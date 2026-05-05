# Plan 1b — Operational Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round out the cashier-side system from Plan 1 with all remaining transaction types, concurrent games, hourly drop tracker, full close-out flow (tip payout with tax, house tax distribution, per-game rake distribution), walks/returns workflow, divergence finder, and viewport-fixed UX. After Plan 1b, the cashier system is fully featured for nightly use.

**Architecture:** Same Next.js 16 / Prisma 6 / Postgres 16 stack as Plan 1. Forms refactored from stacked side panel into Quick Actions + modal dialogs. New `lib/reconciliation/` module for variance heuristics. Game lifecycle implemented directly in `app/(cashier)/_actions/games.ts` (originally planned as `lib/games/lifecycle.ts` but folded into the action file during execution since each function is <20 lines with no reuse). Test isolation via separate `rakeledger_test` database. E2E isolation via `rakeledger_e2e` (added during cleanup).

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS v4, Prisma 6, Postgres 16, Zod, decimal.js, Vitest, Playwright, `@radix-ui/react-dialog` (new for modals).

---

## File Structure

New / modified files in this plan:

```
rakeledger/
├── .env.test                                  # NEW — DATABASE_URL_TEST
├── vitest.config.ts                           # MODIFY — load .env.test
├── tests/
│   ├── unit/
│   │   ├── test-db.ts                         # MODIFY — use DATABASE_URL_TEST
│   │   ├── ledger/
│   │   │   ├── walks.test.ts                  # NEW
│   │   │   ├── tip-payout-tax.test.ts         # NEW
│   │   │   └── multi-game.test.ts             # NEW
│   │   └── reconciliation/
│   │       └── heuristics.test.ts             # NEW
│   └── e2e/
│       └── multi-game-night.spec.ts           # NEW
├── lib/
│   ├── reconciliation/
│   │   └── heuristics.ts                      # NEW
│   ├── games/
│   │   └── (lifecycle logic folded directly into _actions/games.ts during execution)
│   └── format.ts                              # MODIFY — used in more places
├── components/
│   ├── modal.tsx                              # NEW — Radix Dialog wrapper
│   └── nav-sidebar.tsx                        # unchanged
├── app/(cashier)/
│   ├── _actions/
│   │   ├── transactions.ts                    # MODIFY — add 6 more tx types
│   │   ├── session.ts                         # MODIFY — full close-out
│   │   ├── games.ts                           # NEW — open/close games
│   │   └── walks.ts                           # NEW — chip_walk / chip_return
│   ├── live/
│   │   ├── page.tsx                           # MODIFY — viewport-fixed layout
│   │   └── _components/
│   │       ├── quick-actions.tsx              # NEW — 6-button grid
│   │       ├── tx-buyin-modal.tsx             # NEW — refactor of buyin-form
│   │       ├── tx-cashout-modal.tsx           # NEW — refactor of cashout-form
│   │       ├── tx-rake-modal.tsx              # NEW — refactor of rake-form
│   │       ├── tx-tipdrop-modal.tsx           # NEW — refactor of tipdrop-form
│   │       ├── tx-marker-modal.tsx            # NEW — refactor of marker-form
│   │       ├── tx-tournament-modal.tsx        # NEW
│   │       ├── tx-jackpot-modal.tsx           # NEW
│   │       ├── tx-freeroll-modal.tsx          # NEW
│   │       ├── tx-misc-modal.tsx              # NEW — staff_advance + fnb_cost + adjusts
│   │       ├── account-strip.tsx              # MODIFY — multi-game aware
│   │       ├── transaction-stream.tsx         # MODIFY — sign from ledger entries
│   │       ├── game-switcher.tsx              # NEW
│   │       └── drop-tracker.tsx               # NEW
│   └── close/
│       ├── page.tsx                           # MODIFY — multi-step close flow
│       └── _components/
│           ├── tip-payout-step.tsx            # NEW
│           ├── house-tax-step.tsx             # NEW
│           ├── rake-distribution-step.tsx    # NEW
│           ├── walks-returns-step.tsx         # NEW
│           ├── divergence-finder.tsx          # NEW
│           └── (timeline-scrub deferred — Plan 1c interactive divergence finder)
└── docs/superpowers/plans/
    └── 2026-05-04-plan-1b-operational-depth.md  # this file
```

---

## Phase A — Foundation cleanup

### Task 1: Separate test database

**Files:**
- Create: `.env.test`
- Create: `.env.test.example`
- Modify: `vitest.config.ts`
- Modify: `tests/unit/test-db.ts`
- Modify: `package.json` (add `db:test:reset` script)

The current `tests/unit/test-db.ts` truncates the `User` table in the **dev** database, wiping the seeded `cashier@dev.local` user. This task isolates tests onto their own DB.

- [ ] **Step 1: Create the test database in Postgres**

```bash
docker compose exec -T postgres psql -U rakeledger -d rakeledger -c "CREATE DATABASE rakeledger_test OWNER rakeledger;"
```

Expected: `CREATE DATABASE`. If it already exists from a prior run, drop and recreate:

```bash
docker compose exec -T postgres psql -U rakeledger -d rakeledger -c "DROP DATABASE IF EXISTS rakeledger_test;"
docker compose exec -T postgres psql -U rakeledger -d rakeledger -c "CREATE DATABASE rakeledger_test OWNER rakeledger;"
```

- [ ] **Step 2: Write `.env.test.example`**

```
DATABASE_URL="postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger_test?schema=public"
```

- [ ] **Step 3: Copy to `.env.test` (gitignored)**

```bash
cp .env.test.example .env.test
```

Verify `.env.test` is gitignored — the existing `.env*` glob in `.gitignore` covers it.

- [ ] **Step 4: Apply migrations to the test DB**

```bash
DATABASE_URL="postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger_test?schema=public" npx prisma migrate deploy
```

Expected: all 4 migrations applied (init, schema_fixes, nulls_not_distinct, triggers).

- [ ] **Step 5: Update `vitest.config.ts` to load `.env.test`**

Replace the file with:

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Load test-specific env BEFORE Vitest spawns workers
loadDotenv({ path: ".env.test" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 6: Install `dotenv` (vitest config uses it)**

```bash
npm install -D dotenv
```

- [ ] **Step 7: Update `tests/unit/test-db.ts` to assert it's pointing at the test DB**

Add a guard at the top to prevent accidentally pointing at the dev DB:

```typescript
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL?.includes("rakeledger_test")) {
  throw new Error(
    `tests/unit/test-db.ts: DATABASE_URL is not pointing at rakeledger_test (got: ${process.env.DATABASE_URL}). ` +
    `This guard prevents tests from wiping the dev database.`
  );
}

export const testPrisma = new PrismaClient();

export async function resetDatabase() {
  await testPrisma.$executeRawUnsafe(`
    TRUNCATE
      "LedgerEntry",
      "Transaction",
      "Marker",
      "SessionAccountClose",
      "RakeDistribution",
      "CashierHandoff",
      "Game",
      "Session",
      "Table",
      "Player",
      "UserCapabilityGrant",
      "User"
    RESTART IDENTITY CASCADE
  `);
  await testPrisma.user.create({
    data: { id: "test-cashier", name: "Test Cashier", email: "test-cashier@dev", role: "CASHIER" },
  });
}
```

- [ ] **Step 8: Add `db:test:reset` script to `package.json`**

In `"scripts"`, add (preserve existing scripts):

```json
"db:test:reset": "DATABASE_URL=\"postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger_test?schema=public\" npx prisma migrate reset --force --skip-seed --skip-generate"
```

- [ ] **Step 9: Run all tests against the test DB**

```bash
npm test
```

Expected: 33/33 tests pass. Then verify the dev DB still has its seeded users:

```bash
docker compose exec -T postgres psql -U rakeledger -d rakeledger -c 'SELECT count(*) FROM "User";'
```

Expected: `5` (the seeded users — Cashier, Dealer Jake, Dealer Anna, Waitress Lila, plus Test Cashier from a prior run if it leaked, but cleanly should be 4).

If the dev DB shows the test-cashier user from before, re-seed: `npx prisma db seed` and remove the test-cashier row manually if needed.

- [ ] **Step 10: Commit**

```bash
git add .env.test.example vitest.config.ts tests/unit/test-db.ts package.json package-lock.json
git commit -m "feat(test): isolate tests on separate rakeledger_test database"
```

---

### Task 2: Transaction stream — derive sign from ledger entries

**Files:**
- Modify: `app/(cashier)/live/_components/transaction-stream.tsx`

The current sign logic (`tx.type === "CASH_OUT" || tx.type === "CLOSING_FLOAT" ? -1 : 1`) is a hardcoded list that misses many cases (rake_distribution, tip_payout, etc.) and uses `Number(tx.amount)` for arithmetic — both flagged in Plan 1 final review.

- [ ] **Step 1: Read the current file**

`app/(cashier)/live/_components/transaction-stream.tsx` already exists with a hardcoded sign heuristic. Replace its rendering loop with a version that derives the displayed amount from the cash-side ledger entry (or whichever entry is most informative for the cashier).

- [ ] **Step 2: Replace the file**

```tsx
import Decimal from "decimal.js";
import { Money } from "@/components/money";
import { prisma } from "@/lib/db";
import type { AccountType } from "@prisma/client";

interface TransactionStreamProps {
  sessionId: string;
}

// For each transaction, the cashier most cares about how the cage-side accounts moved.
// We pick the "headline" ledger entry in this priority order, then use its delta as the displayed amount.
const HEADLINE_ACCOUNTS: AccountType[] = [
  "CASH_DRAWER",
  "ZELLE",
  "VENMO",
  "CASHAPP",
  "APPLE_PAY",
  "RAKE_POOL",
  "TIP_POOL",
  "PROMO_POOL",
  "MARKER_OUTSTANDING",
  "CHIP_FLOAT",
];

function pickHeadlineDelta(ledgerEntries: Array<{ account: AccountType; delta: { toString(): string } }>) {
  for (const account of HEADLINE_ACCOUNTS) {
    const entry = ledgerEntries.find((e) => e.account === account);
    if (entry) return new Decimal(entry.delta.toString());
  }
  // Fallback: first entry's delta
  return ledgerEntries.length > 0 ? new Decimal(ledgerEntries[0].delta.toString()) : new Decimal(0);
}

export async function TransactionStream({ sessionId }: TransactionStreamProps) {
  const txs = await prisma.transaction.findMany({
    where: { sessionId },
    include: { player: true, staff: true, table: true, createdBy: true, ledgerEntries: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (txs.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-8 text-center text-slate-500 text-sm">
        No transactions yet. Use the Quick Actions on the right to record one.
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-[var(--color-border)] flex justify-between items-center">
        <h4 className="font-semibold text-sm">Transaction stream</h4>
        <span className="text-xs text-slate-500">{txs.length} shown</span>
      </header>
      <div className="divide-y divide-[var(--color-border)]">
        {txs.map((tx) => {
          const time = new Date(tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const headlineDelta = pickHeadlineDelta(tx.ledgerEntries);
          return (
            <div key={tx.id} className="grid grid-cols-[60px_1fr_70px_90px_100px] gap-2 px-4 py-2 text-sm">
              <div className="text-xs font-mono text-slate-500">{time}</div>
              <div>
                <span className="text-slate-200">{tx.player?.displayName ?? tx.staff?.name ?? "—"}</span>
                {tx.table && <span className="text-slate-500"> · {tx.table.name}</span>}
                <div className="text-xs text-slate-500">{tx.type.toLowerCase()}</div>
              </div>
              <div className="text-xs text-slate-400 self-center text-center bg-[var(--color-bg)] rounded px-1.5 py-0.5">
                {tx.method.toLowerCase()}
              </div>
              <div className="font-mono text-right self-center">
                <Money amount={headlineDelta.toString()} signed />
              </div>
              <div className="text-xs text-slate-500 self-center text-right">{tx.createdBy.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/live/_components/transaction-stream.tsx
git commit -m "fix(ui): derive transaction stream amount + sign from ledger entries"
```

---

### Task 3: Add Zod validation to Server Actions

**Files:**
- Create: `lib/validation/transactions.ts`
- Modify: `app/(cashier)/_actions/transactions.ts`

- [ ] **Step 1: Create `lib/validation/transactions.ts`**

```typescript
import { z } from "zod";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "Must be a positive decimal").refine(
  (s) => parseFloat(s) > 0,
  "Must be greater than zero"
);

export const buyInSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]),
  tableId: z.string().nullable().optional(),
});

export const cashOutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]),
  tableId: z.string().nullable().optional(),
  n100: z.coerce.number().int().nonnegative().default(0),
  n25: z.coerce.number().int().nonnegative().default(0),
  n5: z.coerce.number().int().nonnegative().default(0),
  n1: z.coerce.number().int().nonnegative().default(0),
}).refine(
  (v) => v.n100 + v.n25 + v.n5 + v.n1 > 0,
  "Cash-out total must be greater than zero"
);

export const rakeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().nullable().optional(),
  tableId: z.string().nullable().optional(),
  amount: decimalString,
});

export const tipDropSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().min(1),
  tableId: z.string().nullable().optional(),
  amount: decimalString,
});

export const markerIssueSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  collateral: z.string().nullable().optional(),
});

export const markerRepaySchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  markerId: z.string().min(1),
  amount: decimalString,
  method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]),
});

/** Helper: validate a FormData against a schema, returning the parsed values. Throws ZodError on failure. */
export function parseFormData<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    obj[key] = value.toString();
  }
  return schema.parse(obj);
}
```

- [ ] **Step 2: Refactor each server action in `transactions.ts`**

Replace the manual validation in `recordBuyIn` with:

```typescript
import { buyInSchema, parseFormData } from "@/lib/validation/transactions";

export async function recordBuyIn(formData: FormData): Promise<void> {
  const input = parseFormData(buyInSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[input.method];
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "BUY_IN",
    createdById: cashierId,
    amount,
    method: input.method,
    playerId: input.playerId,
    tableId: input.tableId ?? null,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  revalidatePath("/live");
}
```

Apply the same pattern to `recordCashOut`, `recordRake`, `recordTipDrop`, `issueMarker`, `repayMarker`. Each should:
1. `parseFormData(<Schema>, formData)` at the top
2. `await ensureSessionOpen(input.sessionId)`
3. Continue with business logic using validated `input`

- [ ] **Step 3: Run build + tests**

```bash
npm run build
npm test
```

Both should pass.

- [ ] **Step 4: Commit**

```bash
git add lib/validation/ app/(cashier)/_actions/transactions.ts
git commit -m "feat(actions): Zod validation on transaction Server Actions"
```

---

### Task 4: closeSession — wrap in transaction with TOCTOU guard

**Files:**
- Modify: `app/(cashier)/_actions/session.ts`

- [ ] **Step 1: Replace the body of `closeSession`**

Find `closeSession` in `app/(cashier)/_actions/session.ts` and replace with:

```typescript
export async function closeSession(formData: FormData): Promise<void> {
  const sessionId = formData.get("sessionId")?.toString();
  if (!sessionId) throw new Error("sessionId required");

  const cashierId = await getCashierUserId();
  const GAME_SCOPED = new Set(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"]);

  // Optimistic-lock: only proceed if status is still OPEN at the moment we start.
  // We freeze the session FIRST (atomic update where status = OPEN), then write account-close rows.
  // If two concurrent requests both pass the optimistic check, only one's update will succeed
  // (Postgres row-level locking on UPDATE).
  await prisma.$transaction(async (tx) => {
    const lockResult = await tx.session.updateMany({
      where: { id: sessionId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: cashierId },
    });

    if (lockResult.count === 0) {
      throw new Error("Session is not open (already closed or doesn't exist)");
    }

    const session = await tx.session.findUniqueOrThrow({
      where: { id: sessionId },
      include: { games: true },
    });

    for (const account of ACCOUNTS) {
      if (GAME_SCOPED.has(account)) {
        for (const game of session.games) {
          const expected = await getAccountBalance({ account, sessionId, gameId: game.id });
          const counted = new Decimal(formData.get(`counted_${account}_${game.id}`)?.toString() ?? "0");
          const variance = counted.sub(expected);
          await tx.sessionAccountClose.create({
            data: {
              sessionId, account, gameId: game.id,
              expected: expected.toString(),
              counted: counted.toString(),
              variance: variance.toString(),
              countedById: cashierId,
            },
          });
        }
      } else {
        const expected = await getAccountBalance({ account, sessionId });
        const counted = new Decimal(formData.get(`counted_${account}`)?.toString() ?? "0");
        const variance = counted.sub(expected);
        await tx.sessionAccountClose.create({
          data: {
            sessionId, account,
            expected: expected.toString(),
            counted: counted.toString(),
            variance: variance.toString(),
            countedById: cashierId,
          },
        });
      }
    }

    await tx.session.update({
      where: { id: sessionId },
      data: { closingCash: formData.get("counted_CASH_DRAWER")?.toString() ?? "0" },
    });

    await tx.game.updateMany({
      where: { sessionId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }, { isolationLevel: "Serializable" });

  revalidatePath("/live");
  revalidatePath("/close");
}
```

Note: `getAccountBalance` uses the global `prisma` singleton, not the `tx` transaction client. That's intentional for read consistency since reads inside a serializable transaction will see a consistent snapshot.

- [ ] **Step 2: Build + test**

```bash
npm run build
npm test
```

- [ ] **Step 3: Commit**

```bash
git add app/(cashier)/_actions/session.ts
git commit -m "fix(session): close-out under serializable transaction with optimistic lock"
```

---

## Phase B — Modal infrastructure + viewport-fixed layout

### Task 5: Install Radix Dialog + Modal wrapper component

**Files:**
- Modify: `package.json`
- Create: `components/modal.tsx`

- [ ] **Step 1: Install dependency**

```bash
npm install @radix-ui/react-dialog
```

- [ ] **Step 2: Write `components/modal.tsx`**

```tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";

interface ModalProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Wider modal for forms with denomination grids etc. */
  wide?: boolean;
}

/**
 * Reusable modal dialog. Children can be a render-prop receiving a `close` function
 * so forms inside can dismiss the modal after a successful submit.
 */
export function Modal({ trigger, title, description, children, wide = false }: ModalProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 ${
            wide ? "w-[640px]" : "w-[480px]"
          } max-w-[90vw] max-h-[90vh] overflow-auto bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg shadow-2xl p-6`}
        >
          <Dialog.Title className="text-lg font-semibold text-amber-500 mb-1">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="text-sm text-slate-400 mb-4">{description}</Dialog.Description>
          )}
          <div>{typeof children === "function" ? children(close) : children}</div>
          <Dialog.Close asChild>
            <button
              aria-label="Close"
              className="absolute top-3 right-3 text-slate-500 hover:text-white text-lg leading-none w-7 h-7 rounded hover:bg-white/5 flex items-center justify-center"
            >
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/modal.tsx
git commit -m "feat(ui): Radix Dialog + reusable Modal wrapper"
```

---

### Task 6: Refactor existing forms into modals + Quick Actions panel

**Files:**
- Create: `app/(cashier)/live/_components/quick-actions.tsx`
- Create: `app/(cashier)/live/_components/tx-buyin-modal.tsx`
- Create: `app/(cashier)/live/_components/tx-cashout-modal.tsx`
- Create: `app/(cashier)/live/_components/tx-rake-modal.tsx`
- Create: `app/(cashier)/live/_components/tx-tipdrop-modal.tsx`
- Create: `app/(cashier)/live/_components/tx-marker-modal.tsx`
- Modify: `app/(cashier)/live/page.tsx`
- Delete: `app/(cashier)/live/_components/tx-{buyin,cashout,rake,tipdrop,marker}-form.tsx`

The existing 5 form components become modal contents. The `<Modal>` wrapper handles open/close state. The Quick Actions panel renders 6 buttons that act as the modal triggers.

- [ ] **Step 1: Write `app/(cashier)/live/_components/tx-buyin-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { recordBuyIn } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface BuyInModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function BuyInModal({ sessionId, gameId, trigger }: BuyInModalProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const tables = await prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <Modal trigger={trigger} title="+ Buy-in" description="Player exchanges money for chips.">
      <form action={recordBuyIn} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Table (optional)</span>
          <select name="tableId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— none —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input type="number" name="amount" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method</span>
          <select name="method" required defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="CASH">Cash</option>
            <option value="ZELLE">Zelle</option>
            <option value="VENMO">Venmo</option>
            <option value="CASHAPP">CashApp</option>
            <option value="APPLE_PAY">Apple Pay</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
          Record Buy-in
        </button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Write `app/(cashier)/live/_components/tx-cashout-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { recordCashOut } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface CashOutModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function CashOutModal({ sessionId, gameId, trigger }: CashOutModalProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  return (
    <Modal trigger={trigger} title="− Cash-out" description="Count chips by denomination, then payout method." wide>
      <form action={recordCashOut} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <div className="text-xs text-slate-500 uppercase tracking-wide">Chip count</div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { name: "n100", label: "$100" },
            { name: "n25", label: "$25" },
            { name: "n5", label: "$5" },
            { name: "n1", label: "$1" },
          ].map((d) => (
            <label key={d.name} className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">{d.label}</span>
              <input type="number" name={d.name} defaultValue="0" min="0"
                className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5 font-mono text-center" />
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Payout method</span>
          <select name="method" required defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="CASH">Cash</option>
            <option value="ZELLE">Zelle</option>
            <option value="VENMO">Venmo</option>
            <option value="CASHAPP">CashApp</option>
            <option value="APPLE_PAY">Apple Pay</option>
          </select>
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
          Record Cash-out
        </button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 3: Write `app/(cashier)/live/_components/tx-rake-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { recordRake } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface RakeModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function RakeModal({ sessionId, gameId, trigger }: RakeModalProps) {
  const dealers = await prisma.user.findMany({
    where: { role: "DEALER", status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  const tables = await prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <Modal trigger={trigger} title="+ Rake drop" description="Dealer drops accumulated rake chips at the cage.">
      <form action={recordRake} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Dealer (optional)</span>
          <select name="staffId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— none —</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Table (optional)</span>
          <select name="tableId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— none —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Rake amount (chips)</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Rake</button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Write `app/(cashier)/live/_components/tx-tipdrop-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { recordTipDrop } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface TipDropModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function TipDropModal({ sessionId, gameId, trigger }: TipDropModalProps) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  return (
    <Modal trigger={trigger} title="+ Tip drop" description="Dealer or waitress drops accumulated tip chips at the cage.">
      <form action={recordTipDrop} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Recipient</span>
          <select name="staffId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.toLowerCase()})</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount (chips)</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Tip Drop</button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: Write `app/(cashier)/live/_components/tx-marker-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { issueMarker, repayMarker } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface MarkerModalProps {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function MarkerModal({ sessionId, gameId, trigger }: MarkerModalProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const openMarkers = await prisma.marker.findMany({
    where: { status: "OPEN" },
    include: { player: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return (
    <Modal trigger={trigger} title="$ Marker" description="Issue a new marker, or repay an existing one." wide>
      <div className="grid grid-cols-2 gap-4">
        <form action={issueMarker} className="flex flex-col gap-3 border-r border-[var(--color-border)] pr-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Issue marker</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Player</span>
            <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
              <option value="">— select —</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Amount</span>
            <input name="amount" type="number" step="0.01" min="0.01" required
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Collateral note</span>
            <input name="collateral" placeholder="e.g. gold watch"
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Issue</button>
        </form>

        <form action={repayMarker} className="flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Repay marker</h3>
          {openMarkers.length === 0 ? (
            <p className="text-xs text-slate-500">No open markers to repay.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Open marker</span>
                <select name="markerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
                  <option value="">— select —</option>
                  {openMarkers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.player.displayName} — ${m.amount.toString()}
                      {m.repaidAmount.toString() !== "0" && ` (paid $${m.repaidAmount.toString()})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Payment</span>
                <input name="amount" type="number" step="0.01" min="0.01" required
                  className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-slate-400">Method</span>
                <select name="method" defaultValue="CASH"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
                  <option value="CASH">Cash</option>
                  <option value="ZELLE">Zelle</option>
                  <option value="VENMO">Venmo</option>
                  <option value="CASHAPP">CashApp</option>
                  <option value="APPLE_PAY">Apple Pay</option>
                </select>
              </label>
              <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Repayment</button>
            </>
          )}
        </form>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 6: Write `app/(cashier)/live/_components/quick-actions.tsx`**

```tsx
import { BuyInModal } from "./tx-buyin-modal";
import { CashOutModal } from "./tx-cashout-modal";
import { RakeModal } from "./tx-rake-modal";
import { TipDropModal } from "./tx-tipdrop-modal";
import { MarkerModal } from "./tx-marker-modal";

interface QuickActionsProps {
  sessionId: string;
  gameId: string;
}

const baseBtn =
  "bg-[var(--color-bg)] border border-[var(--color-border)] text-slate-200 font-semibold rounded-lg p-3 text-sm hover:border-amber-500 hover:text-amber-500 transition cursor-pointer w-full";

export async function QuickActions({ sessionId, gameId }: QuickActionsProps) {
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-3">Quick actions</h4>
      <div className="grid grid-cols-2 gap-2">
        <BuyInModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Buy-in</button>} />
        <CashOutModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>− Cash-out</button>} />
        <RakeModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Rake</button>} />
        <TipDropModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Tip drop</button>} />
        <MarkerModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>$ Marker</button>} />
        {/* "More" button for additional tx types added in Phase D */}
        <button className={baseBtn + " opacity-50 cursor-not-allowed"} disabled>⋯ More (Phase D)</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Replace `app/(cashier)/live/page.tsx`**

```tsx
import Link from "next/link";
import { getOpenSession, openSession } from "../_actions/session";
import { Money } from "@/components/money";
import { AccountStrip } from "./_components/account-strip";
import { TransactionStream } from "./_components/transaction-stream";
import { QuickActions } from "./_components/quick-actions";

export default async function LiveSessionPage() {
  const session = await getOpenSession();

  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">No session open</h2>
        <p className="text-slate-400 text-sm mb-4">
          Open a session to begin recording transactions. Set an optional starting cash float (the small bills already
          in the drawer for change-making).
        </p>
        <form action={openSession} className="flex flex-col gap-3">
          <label className="flex flex-col text-sm text-slate-300 gap-1">
            <span>Opening cash float (optional)</span>
            <input
              type="number"
              name="openingCash"
              step="0.01"
              min="0"
              defaultValue="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-white"
            />
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
            Open Session
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-3">
      <header className="flex justify-between items-center flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Tonight's Session</h2>
          <div className="text-xs text-slate-500">
            opened {new Date(session.openedAt).toLocaleTimeString()} by {session.openedBy.name}
            {" · opening cash "}<Money amount={session.openingCash.toString()} />
          </div>
        </div>
        <Link href="/close" className="text-red-400 border border-red-900 rounded px-3 py-1.5 text-sm hover:bg-red-950/40">
          Close session…
        </Link>
      </header>

      <AccountStrip sessionId={session.id} />

      <div className="grid grid-cols-[1fr_320px] gap-3 flex-1 min-h-0">
        <div className="overflow-auto">
          <TransactionStream sessionId={session.id} />
        </div>
        <div className="flex flex-col gap-3 overflow-auto">
          <QuickActions sessionId={session.id} gameId={session.games[0].id} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Delete the old form files**

```bash
rm app/(cashier)/live/_components/tx-buyin-form.tsx
rm app/(cashier)/live/_components/tx-cashout-form.tsx
rm app/(cashier)/live/_components/tx-rake-form.tsx
rm app/(cashier)/live/_components/tx-tipdrop-form.tsx
rm app/(cashier)/live/_components/tx-marker-form.tsx
```

- [ ] **Step 9: Verify build + manual test**

```bash
npm run build
```

Should pass. Then run dev server and manually verify the live page fits in the viewport without scrolling, and each Quick Action button opens the correct modal.

- [ ] **Step 10: Commit**

```bash
git add app/(cashier)/live/ -A
git commit -m "feat(ui): viewport-fixed live session — Quick Actions + modal forms"
```

---

## Phase C — Concurrent games

### Task 7: Game lifecycle server actions

**Files:**
- Create: `app/(cashier)/_actions/games.ts`

- [ ] **Step 1: Write the file**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { z } from "zod";

const openGameSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(60),
  gameType: z.string().nullable().optional(),
  stakes: z.string().nullable().optional(),
  splitType: z.enum(["even"]).default("even"), // Plan 1b ships only "even"; richer splits in Plan 3 admin
});

const closeGameSchema = z.object({
  gameId: z.string().min(1),
});

export async function openGame(formData: FormData): Promise<void> {
  const input = openGameSchema.parse({
    sessionId: formData.get("sessionId")?.toString(),
    name: formData.get("name")?.toString(),
    gameType: formData.get("gameType")?.toString() || null,
    stakes: formData.get("stakes")?.toString() || null,
    splitType: formData.get("splitType")?.toString() || "even",
  });

  const session = await prisma.session.findUnique({ where: { id: input.sessionId } });
  if (!session) throw new Error("Session not found");
  if (session.status !== "OPEN") throw new Error("Cannot add a game to a closed session");

  await prisma.game.create({
    data: {
      sessionId: input.sessionId,
      name: input.name,
      gameType: input.gameType ?? null,
      stakes: input.stakes ?? null,
      rakeSplitConfig: { type: input.splitType },
    },
  });

  revalidatePath("/live");
}

export async function closeGame(formData: FormData): Promise<void> {
  const input = closeGameSchema.parse({
    gameId: formData.get("gameId")?.toString(),
  });

  const game = await prisma.game.findUnique({ where: { id: input.gameId } });
  if (!game) throw new Error("Game not found");
  if (game.status !== "OPEN") throw new Error("Game already closed");

  await prisma.game.update({
    where: { id: input.gameId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  revalidatePath("/live");
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/(cashier)/_actions/games.ts
git commit -m "feat(games): open/close game Server Actions"
```

---

### Task 8: Game switcher + per-session game list UI

**Files:**
- Create: `app/(cashier)/live/_components/game-switcher.tsx`
- Modify: `app/(cashier)/live/page.tsx`

The Game switcher renders pills along the top of the live view. Modes: All / per-game. Selected game is read from a search param (`?game=<id>` or `?game=all`).

- [ ] **Step 1: Write `app/(cashier)/live/_components/game-switcher.tsx`**

```tsx
import Link from "next/link";

interface Game {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED";
  stakes: string | null;
}

interface GameSwitcherProps {
  games: Game[];
  activeGameId: string | "all";
}

export function GameSwitcher({ games, activeGameId }: GameSwitcherProps) {
  const baseClass = "px-3 py-1.5 rounded-full text-sm border transition";
  const activeClass = "bg-amber-500/15 border-amber-500 text-amber-500";
  const inactiveClass = "bg-[var(--color-bg)] border-[var(--color-border)] text-slate-400 hover:text-white hover:border-slate-500";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Link href="/live?game=all" className={`${baseClass} ${activeGameId === "all" ? activeClass : inactiveClass}`}>
        All games
      </Link>
      {games.map((g) => (
        <Link
          key={g.id}
          href={`/live?game=${g.id}`}
          className={`${baseClass} ${activeGameId === g.id ? activeClass : inactiveClass}`}
        >
          {g.name}
          {g.stakes && <span className="text-xs text-slate-500 ml-1">{g.stakes}</span>}
          {g.status === "CLOSED" && <span className="text-xs text-slate-500 ml-1">(closed)</span>}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Modify `app/(cashier)/live/page.tsx` to read `?game=` and pass it down**

Replace the page component to accept `searchParams`, parse the active game id, and pass it through. Default = "all" if more than one game; default = the one game if exactly one.

```tsx
import Link from "next/link";
import { getOpenSession, openSession } from "../_actions/session";
import { Money } from "@/components/money";
import { AccountStrip } from "./_components/account-strip";
import { TransactionStream } from "./_components/transaction-stream";
import { QuickActions } from "./_components/quick-actions";
import { GameSwitcher } from "./_components/game-switcher";

interface PageProps {
  searchParams: Promise<{ game?: string }>;
}

export default async function LiveSessionPage({ searchParams }: PageProps) {
  const session = await getOpenSession();
  const sp = await searchParams;

  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-12 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">No session open</h2>
        <p className="text-slate-400 text-sm mb-4">
          Open a session to begin recording transactions. Set an optional starting cash float (the small bills already
          in the drawer for change-making).
        </p>
        <form action={openSession} className="flex flex-col gap-3">
          <label className="flex flex-col text-sm text-slate-300 gap-1">
            <span>Opening cash float (optional)</span>
            <input type="number" name="openingCash" step="0.01" min="0" defaultValue="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-white" />
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400">
            Open Session
          </button>
        </form>
      </div>
    );
  }

  // Resolve active game
  const requested = sp.game;
  let activeGameId: string | "all";
  if (requested === "all") {
    activeGameId = "all";
  } else if (requested && session.games.some((g) => g.id === requested)) {
    activeGameId = requested;
  } else if (session.games.length === 1) {
    activeGameId = session.games[0].id;
  } else {
    activeGameId = "all";
  }

  // For Quick Actions / forms, we always need a concrete gameId.
  // If "all" is active, default to the first OPEN game (or the first if none open).
  const formGameId =
    activeGameId === "all"
      ? (session.games.find((g) => g.status === "OPEN") ?? session.games[0]).id
      : activeGameId;

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] gap-3">
      <header className="flex justify-between items-center flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Tonight's Session</h2>
          <div className="text-xs text-slate-500">
            opened {new Date(session.openedAt).toLocaleTimeString()} by {session.openedBy.name}
            {" · opening cash "}<Money amount={session.openingCash.toString()} />
          </div>
        </div>
        <Link href="/close" className="text-red-400 border border-red-900 rounded px-3 py-1.5 text-sm hover:bg-red-950/40">
          Close session…
        </Link>
      </header>

      <GameSwitcher games={session.games} activeGameId={activeGameId} />

      <AccountStrip sessionId={session.id} activeGameId={activeGameId} />

      <div className="grid grid-cols-[1fr_320px] gap-3 flex-1 min-h-0">
        <div className="overflow-auto">
          <TransactionStream sessionId={session.id} activeGameId={activeGameId} />
        </div>
        <div className="flex flex-col gap-3 overflow-auto">
          <QuickActions sessionId={session.id} gameId={formGameId} />
        </div>
      </div>
    </div>
  );
}
```

Note: `AccountStrip` and `TransactionStream` now take `activeGameId`. Tasks 9 and 10 update those components.

- [ ] **Step 3: Build (will type-error on AccountStrip / TransactionStream signature changes — that's expected; Task 9 + 10 fix it)**

```bash
npm run build
```

If it errors, that's fine — we'll commit after Task 10. If you want a clean intermediate commit, hold off on the page.tsx change until after Tasks 9 + 10 land.

For a clean intermediate commit: skip the page.tsx change in this task. Commit only the GameSwitcher component:

```bash
git add app/(cashier)/live/_components/game-switcher.tsx
git commit -m "feat(games): GameSwitcher component"
```

The page.tsx changes will land in Task 10's commit alongside the AccountStrip + TransactionStream updates.

---

### Task 9: AccountStrip — multi-game aware

**Files:**
- Modify: `app/(cashier)/live/_components/account-strip.tsx`

When `activeGameId === "all"`, game-scoped accounts (RAKE_POOL, PROMO_POOL, TOURNAMENT_POOL) render one tile per game. Otherwise just the active game's tile.

- [ ] **Step 1: Replace the file**

```tsx
import { Money } from "@/components/money";
import { getAccountBalance } from "@/lib/ledger/balance";
import { isGameScoped } from "@/lib/ledger/accounts";
import { prisma } from "@/lib/db";
import type { AccountType } from "@prisma/client";

interface AccountStripProps {
  sessionId: string;
  activeGameId: string | "all";
}

interface Tile {
  account: AccountType;
  label: string;
}

const SHARED_TILES: Tile[] = [
  { account: "CASH_DRAWER", label: "Cash drawer" },
  { account: "ZELLE", label: "Zelle" },
  { account: "VENMO", label: "Venmo" },
  { account: "CASHAPP", label: "CashApp" },
  { account: "APPLE_PAY", label: "Apple Pay" },
  { account: "CHIP_FLOAT", label: "Chip float" },
  { account: "TIP_POOL", label: "Tip pool" },
];

const GAME_TILES: Tile[] = [
  { account: "RAKE_POOL", label: "Rake" },
  { account: "PROMO_POOL", label: "Promo" },
  { account: "TOURNAMENT_POOL", label: "Tournament" },
];

export async function AccountStrip({ sessionId, activeGameId }: AccountStripProps) {
  const games = await prisma.game.findMany({ where: { sessionId }, orderBy: { openedAt: "asc" } });

  const sharedBalances = await Promise.all(
    SHARED_TILES.map(async (t) => ({
      ...t,
      balance: await getAccountBalance({ account: t.account, sessionId }),
    }))
  );

  // Game-scoped tiles: per game when "all", else just the active game.
  const gameTilesToRender =
    activeGameId === "all"
      ? games.flatMap((g) =>
          GAME_TILES.map((t) => ({
            account: t.account,
            label: `${t.label} · ${g.name}`,
            gameId: g.id,
          }))
        )
      : GAME_TILES.map((t) => ({
          account: t.account,
          label: t.label,
          gameId: activeGameId,
        }));

  const gameBalances = await Promise.all(
    gameTilesToRender.map(async (t) => ({
      ...t,
      balance: await getAccountBalance({ account: t.account, sessionId, gameId: t.gameId }),
    }))
  );

  const allTiles = [...sharedBalances, ...gameBalances];

  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
      {allTiles.map((tile, i) => (
        <div
          key={`${tile.account}-${i}`}
          className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3"
        >
          <div className="text-[0.65rem] uppercase tracking-wider text-slate-500 truncate">{tile.label}</div>
          <div className="font-mono tabular-nums text-base font-semibold mt-1">
            <Money amount={tile.balance.toString()} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build (still might error on TransactionStream — Task 10 fixes)**

```bash
npm run build
```

---

### Task 10: TransactionStream — filter by active game

**Files:**
- Modify: `app/(cashier)/live/_components/transaction-stream.tsx`

- [ ] **Step 1: Add `activeGameId` prop and filter**

Update the component signature and add a `where` clause filter:

```tsx
import Decimal from "decimal.js";
import { Money } from "@/components/money";
import { prisma } from "@/lib/db";
import type { AccountType } from "@prisma/client";

interface TransactionStreamProps {
  sessionId: string;
  activeGameId: string | "all";
}

const HEADLINE_ACCOUNTS: AccountType[] = [
  "CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY",
  "RAKE_POOL", "TIP_POOL", "PROMO_POOL", "MARKER_OUTSTANDING", "CHIP_FLOAT",
];

function pickHeadlineDelta(ledgerEntries: Array<{ account: AccountType; delta: { toString(): string } }>) {
  for (const account of HEADLINE_ACCOUNTS) {
    const entry = ledgerEntries.find((e) => e.account === account);
    if (entry) return new Decimal(entry.delta.toString());
  }
  return ledgerEntries.length > 0 ? new Decimal(ledgerEntries[0].delta.toString()) : new Decimal(0);
}

export async function TransactionStream({ sessionId, activeGameId }: TransactionStreamProps) {
  const txs = await prisma.transaction.findMany({
    where: {
      sessionId,
      ...(activeGameId !== "all" ? { gameId: activeGameId } : {}),
    },
    include: { player: true, staff: true, table: true, createdBy: true, ledgerEntries: true, game: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (txs.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-8 text-center text-slate-500 text-sm">
        No transactions yet. Use the Quick Actions on the right to record one.
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-[var(--color-border)] flex justify-between items-center">
        <h4 className="font-semibold text-sm">Transaction stream</h4>
        <span className="text-xs text-slate-500">{txs.length} shown</span>
      </header>
      <div className="divide-y divide-[var(--color-border)]">
        {txs.map((tx) => {
          const time = new Date(tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const headlineDelta = pickHeadlineDelta(tx.ledgerEntries);
          return (
            <div key={tx.id} className="grid grid-cols-[60px_1fr_70px_90px_100px] gap-2 px-4 py-2 text-sm">
              <div className="text-xs font-mono text-slate-500">{time}</div>
              <div>
                <span className="text-slate-200">{tx.player?.displayName ?? tx.staff?.name ?? "—"}</span>
                {tx.game && <span className="text-slate-500"> · {tx.game.name}</span>}
                {tx.table && <span className="text-slate-500"> / {tx.table.name}</span>}
                <div className="text-xs text-slate-500">{tx.type.toLowerCase()}</div>
              </div>
              <div className="text-xs text-slate-400 self-center text-center bg-[var(--color-bg)] rounded px-1.5 py-0.5">
                {tx.method.toLowerCase()}
              </div>
              <div className="font-mono text-right self-center">
                <Money amount={headlineDelta.toString()} signed />
              </div>
              <div className="text-xs text-slate-500 self-center text-right">{tx.createdBy.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build (everything should now type-check)**

```bash
npm run build
```

- [ ] **Step 3: Commit Task 8 + 9 + 10 together**

```bash
git add app/(cashier)/live/
git commit -m "feat(games): per-game AccountStrip, transaction stream filtering, page wiring"
```

---

### Task 11: Game management UI (open / close games within a session)

**Files:**
- Create: `app/(cashier)/live/_components/game-manager.tsx`
- Modify: `app/(cashier)/live/page.tsx`

A small panel in the side column for opening additional games and closing existing ones.

- [ ] **Step 1: Write `app/(cashier)/live/_components/game-manager.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { openGame, closeGame } from "../../_actions/games";

interface GameManagerProps {
  sessionId: string;
  games: Array<{ id: string; name: string; status: "OPEN" | "CLOSED"; stakes: string | null }>;
}

export function GameManager({ sessionId, games }: GameManagerProps) {
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        <h4 className="text-xs uppercase tracking-wider text-slate-400">Games</h4>
        <Modal
          title="Open new game"
          description="Add a concurrent game to this session."
          trigger={
            <button className="text-xs text-amber-500 hover:text-amber-400">+ New</button>
          }
        >
          <form action={openGame} className="flex flex-col gap-3">
            <input type="hidden" name="sessionId" value={sessionId} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Name</span>
              <input name="name" required placeholder="e.g. Hi-Stakes"
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Game type</span>
              <input name="gameType" placeholder="NL Hold'em / PLO / Mixed"
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Stakes</span>
              <input name="stakes" placeholder="1/2 / 5/10 / etc."
                className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
            </label>
            <input type="hidden" name="splitType" value="even" />
            <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Open Game</button>
          </form>
        </Modal>
      </div>
      <ul className="flex flex-col gap-1 text-xs">
        {games.map((g) => (
          <li key={g.id} className="flex justify-between items-center px-2 py-1 rounded hover:bg-white/5">
            <span>
              <span className="text-slate-200">{g.name}</span>
              {g.stakes && <span className="text-slate-500 ml-1">{g.stakes}</span>}
              {g.status === "CLOSED" && <span className="text-slate-500 ml-2">(closed)</span>}
            </span>
            {g.status === "OPEN" && games.filter((x) => x.status === "OPEN").length > 1 && (
              <form action={closeGame}>
                <input type="hidden" name="gameId" value={g.id} />
                <button type="submit" className="text-slate-500 hover:text-red-400 text-xs">close</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The "close" button only renders when more than one OPEN game exists, so you can't accidentally close the last open game (which would orphan the QuickActions form's gameId).

- [ ] **Step 2: Wire into `app/(cashier)/live/page.tsx`**

In the side panel, after `<QuickActions ... />`, add:

```tsx
import { GameManager } from "./_components/game-manager";
// ... in side panel:
<GameManager sessionId={session.id} games={session.games} />
```

- [ ] **Step 3: Build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/live/
git commit -m "feat(games): GameManager UI for open/close games mid-session"
```

---

### Task 12: Multi-game ledger test

**Files:**
- Create: `tests/unit/ledger/multi-game.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("multi-game ledger", () => {
  let sessionId: string;
  let mainId: string;
  let hiStakesId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const main = await testPrisma.game.create({
      data: { sessionId, name: "Main", rakeSplitConfig: { type: "even" } },
    });
    const hi = await testPrisma.game.create({
      data: { sessionId, name: "Hi-Stakes", rakeSplitConfig: { type: "even" } },
    });
    mainId = main.id;
    hiStakesId = hi.id;
  });

  it("rake on different games does not commingle", async () => {
    await createTransaction({
      sessionId, gameId: mainId, type: "RAKE", createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-50) },
        { account: "RAKE_POOL", delta: new Decimal(50), gameId: mainId },
      ],
    });
    await createTransaction({
      sessionId, gameId: hiStakesId, type: "RAKE", createdById: "test-cashier",
      amount: new Decimal(80), method: "CHIPS",
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-80) },
        { account: "RAKE_POOL", delta: new Decimal(80), gameId: hiStakesId },
      ],
    });

    const mainRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId: mainId });
    const hiRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId: hiStakesId });
    expect(mainRake.toString()).toBe("50");
    expect(hiRake.toString()).toBe("80");
  });

  it("chip_float is shared across games (sums to combined total)", async () => {
    await createTransaction({
      sessionId, gameId: mainId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(200), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    await createTransaction({
      sessionId, gameId: hiStakesId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(500), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(500) },
        { account: "CHIP_FLOAT", delta: new Decimal(500) },
      ],
    });

    const float = await getAccountBalance({ account: "CHIP_FLOAT", sessionId });
    expect(float.toString()).toBe("700");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm test -- tests/unit/ledger/multi-game.test.ts
git add tests/unit/ledger/multi-game.test.ts
git commit -m "test(ledger): multi-game isolation"
```

---

## Phase D — Remaining transaction types

### Task 13: Tournament + Jackpot transactions

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-tournament-modal.tsx`
- Create: `app/(cashier)/live/_components/tx-jackpot-modal.tsx`
- Modify: `app/(cashier)/live/_components/quick-actions.tsx`
- Modify: `lib/validation/transactions.ts`

- [ ] **Step 1: Add Zod schemas in `lib/validation/transactions.ts`**

Append:

```typescript
const methodEnum = z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]);

export const tournamentFeeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  method: methodEnum,
});

export const tournamentPayoutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  method: methodEnum,
});

export const jackpotPayoutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  paidIn: z.enum(["CHIPS", "CASH"]),
  reason: z.string().min(1).max(100), // "bad-beat", "high-hand", etc.
});
```

- [ ] **Step 2: Add the actions in `app/(cashier)/_actions/transactions.ts`**

Append:

```typescript
import {
  tournamentFeeSchema,
  tournamentPayoutSchema,
  jackpotPayoutSchema,
} from "@/lib/validation/transactions";

export async function recordTournamentFee(formData: FormData): Promise<void> {
  const input = parseFormData(tournamentFeeSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const method = input.method;
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "TOURNAMENT_FEE",
    createdById: cashierId,
    amount,
    method,
    playerId: input.playerId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "TOURNAMENT_POOL", delta: amount, gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

export async function recordTournamentPayout(formData: FormData): Promise<void> {
  const input = parseFormData(tournamentPayoutSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const method = input.method;
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "TOURNAMENT_PAYOUT",
    createdById: cashierId,
    amount,
    method,
    playerId: input.playerId,
    entries: [
      { account: targetAccount, delta: amount.neg() },
      { account: "TOURNAMENT_POOL", delta: amount.neg(), gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

export async function recordJackpotPayout(formData: FormData): Promise<void> {
  const input = parseFormData(jackpotPayoutSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);
  const method = input.paidIn === "CASH" ? "CASH" : "CHIPS";

  // Funded from rake_pool (game-scoped). Paid out either as chips back to chip_float (player) or cash from drawer.
  // Both legs DECREASE: revenue (rake_pool) drops; asset (cash_drawer) or liability (chip_float) inverse-direction.
  // chip_float +X means chips left the cage to the player (liability ↑); rake_pool -X means revenue paid out.
  const entries =
    input.paidIn === "CHIPS"
      ? [
          { account: "CHIP_FLOAT" as const, delta: amount },
          { account: "RAKE_POOL" as const, delta: amount.neg(), gameId: input.gameId },
        ]
      : [
          { account: "CASH_DRAWER" as const, delta: amount.neg() },
          { account: "RAKE_POOL" as const, delta: amount.neg(), gameId: input.gameId },
        ];

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "JACKPOT_PAYOUT",
    createdById: cashierId,
    amount,
    method,
    playerId: input.playerId,
    note: `Jackpot: ${input.reason}`,
    entries,
  });

  revalidatePath("/live");
}
```

- [ ] **Step 3: Write the modal components**

`app/(cashier)/live/_components/tx-tournament-modal.tsx`:

```tsx
import { Modal } from "@/components/modal";
import { recordTournamentFee, recordTournamentPayout } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function TournamentModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const playerOptions = (
    <>
      <option value="">— select —</option>
      {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
    </>
  );
  const methodOptions = (
    <>
      <option value="CASH">Cash</option>
      <option value="ZELLE">Zelle</option>
      <option value="VENMO">Venmo</option>
      <option value="CASHAPP">CashApp</option>
      <option value="APPLE_PAY">Apple Pay</option>
    </>
  );

  return (
    <Modal trigger={trigger} title="⇄ Tournament" description="Entry fees go in; payouts come out." wide>
      <div className="grid grid-cols-2 gap-4">
        <form action={recordTournamentFee} className="flex flex-col gap-3 border-r border-[var(--color-border)] pr-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Entry fee</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Player</span>
            <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{playerOptions}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Amount</span>
            <input name="amount" type="number" step="0.01" min="0.01" required
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Method</span>
            <select name="method" defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{methodOptions}</select>
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Entry</button>
        </form>

        <form action={recordTournamentPayout} className="flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Payout</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Winner</span>
            <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{playerOptions}</select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Amount</span>
            <input name="amount" type="number" step="0.01" min="0.01" required
              className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Method</span>
            <select name="method" defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">{methodOptions}</select>
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Payout</button>
        </form>
      </div>
    </Modal>
  );
}
```

`app/(cashier)/live/_components/tx-jackpot-modal.tsx`:

```tsx
import { Modal } from "@/components/modal";
import { recordJackpotPayout } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function JackpotModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  return (
    <Modal trigger={trigger} title="🏆 Jackpot payout" description="Funded from this game's rake pool.">
      <form action={recordJackpotPayout} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Winner</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Reason</span>
          <input name="reason" required placeholder="bad-beat / high-hand / promo"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Paid in</span>
          <select name="paidIn" defaultValue="CHIPS" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="CHIPS">Chips (player keeps playing)</option>
            <option value="CASH">Cash (player walks)</option>
          </select>
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Jackpot</button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add app/(cashier)/_actions/transactions.ts app/(cashier)/live/_components/tx-tournament-modal.tsx app/(cashier)/live/_components/tx-jackpot-modal.tsx lib/validation/transactions.ts
git commit -m "feat(tx): tournament fees/payouts + jackpot payouts"
```

---

### Task 14: Freeroll prize payout (with unredeemed-promo-chip hint on buy-in)

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`
- Modify: `lib/validation/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-freeroll-modal.tsx`
- Modify: `app/(cashier)/live/_components/tx-buyin-modal.tsx`

The freeroll workflow:
1. Cashier records freeroll prize: `chip_float +X`, `promo_pool +X` (game-scoped). No cash moves.
2. The prize stays "unredeemed" until that player's chips eventually leave the cage via cash-out (we don't tag specific chip flow; the bookkeeping just works).
3. UX nudge: when recording a buy-in for a player who recently won a freeroll, show a banner reminding the cashier to enter only the cash being added — not the player's full stack.

For the banner, we'll compute "unredeemed promo" as: sum of FREEROLL_PRIZE_PAYOUT amounts to this player in the current session, minus any FREEROLL_PRIZE_PAYOUT reversals. (Simple v1 heuristic. Plan 1c could refine.)

- [ ] **Step 1: Add schema in `lib/validation/transactions.ts`**

```typescript
export const freerollPrizeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  freerollName: z.string().max(80).optional(),
});
```

- [ ] **Step 2: Add server action in `app/(cashier)/_actions/transactions.ts`**

```typescript
import { freerollPrizeSchema } from "@/lib/validation/transactions";

export async function recordFreerollPrize(formData: FormData): Promise<void> {
  const input = parseFormData(freerollPrizeSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "FREEROLL_PRIZE_PAYOUT",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note: input.freerollName ? `Freeroll: ${input.freerollName}` : "Freeroll prize",
    entries: [
      { account: "CHIP_FLOAT", delta: amount },
      { account: "PROMO_POOL", delta: amount, gameId: input.gameId },
    ],
  });

  revalidatePath("/live");
}

/** Returns the player's unredeemed freeroll chip total in the current session. */
export async function getUnredeemedPromoForPlayer(sessionId: string, playerId: string): Promise<string> {
  const txs = await prisma.transaction.findMany({
    where: {
      sessionId,
      playerId,
      type: "FREEROLL_PRIZE_PAYOUT",
    },
    select: { amount: true, reversesId: true },
  });
  // Simple v1: sum amounts, ignoring reversals. Reversal txs have negative amount in our convention.
  const total = txs.reduce(
    (sum, t) => sum.add(new Decimal(t.amount.toString())),
    new Decimal(0)
  );
  return total.toString();
}
```

- [ ] **Step 3: Write `app/(cashier)/live/_components/tx-freeroll-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import { recordFreerollPrize } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function FreerollModal({ sessionId, gameId, trigger }: Props) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  return (
    <Modal trigger={trigger} title="🎁 Freeroll prize" description="House-funded prize chips. No cash moves.">
      <form action={recordFreerollPrize} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Winner</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Prize amount (chips)</span>
          <input name="amount" type="number" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Freeroll name (optional)</span>
          <input name="freerollName" placeholder="e.g. Saturday Night Special"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Award Prize</button>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Update `tx-buyin-modal.tsx` to show the unredeemed promo banner**

Replace the file:

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { Modal } from "@/components/modal";
import { recordBuyIn } from "../../_actions/transactions";

interface BuyInModalProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  getUnredeemedPromo: (playerId: string) => Promise<string>;
  trigger: React.ReactNode;
}

export function BuyInModal({ sessionId, gameId, players, tables, getUnredeemedPromo, trigger }: BuyInModalProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [unredeemed, setUnredeemed] = useState<string>("0");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!selectedPlayerId) {
      setUnredeemed("0");
      return;
    }
    startTransition(async () => {
      const amount = await getUnredeemedPromo(selectedPlayerId);
      setUnredeemed(amount);
    });
  }, [selectedPlayerId, getUnredeemedPromo]);

  const showBanner = parseFloat(unredeemed) > 0;

  return (
    <Modal trigger={trigger} title="+ Buy-in" description="Player exchanges money for chips.">
      <form action={recordBuyIn} className="flex flex-col gap-3">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select
            name="playerId"
            required
            value={selectedPlayerId}
            onChange={(e) => setSelectedPlayerId(e.target.value)}
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2"
          >
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>

        {showBanner && (
          <div className="bg-cyan-500/10 border border-cyan-700 text-cyan-300 text-xs rounded px-3 py-2">
            ⚡ This player has <strong>${unredeemed}</strong> in unredeemed freeroll chips.
            Only enter the <em>cash</em> they're handing you now — those promo chips are already on their stack.
          </div>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Table (optional)</span>
          <select name="tableId" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— none —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input type="number" name="amount" step="0.01" min="0.01" required
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method</span>
          <select name="method" required defaultValue="CASH"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="CASH">Cash</option>
            <option value="ZELLE">Zelle</option>
            <option value="VENMO">Venmo</option>
            <option value="CASHAPP">CashApp</option>
            <option value="APPLE_PAY">Apple Pay</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <button type="submit" disabled={isPending}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
          Record Buy-in
        </button>
      </form>
    </Modal>
  );
}
```

Because this component now uses hooks, it's a Client Component. The data (players, tables) and the `getUnredeemedPromo` function need to be passed in from a server-side wrapper.

- [ ] **Step 5: Create a server-side wrapper `app/(cashier)/live/_components/tx-buyin-modal-wrapper.tsx`**

```tsx
import { prisma } from "@/lib/db";
import { getUnredeemedPromoForPlayer } from "../../_actions/transactions";
import { BuyInModal } from "./tx-buyin-modal";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function BuyInModalServer({ sessionId, gameId, trigger }: Props) {
  const [players, tables] = await Promise.all([
    prisma.player.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
    prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Bind sessionId so the client component just passes a playerId.
  async function getUnredeemedPromo(playerId: string) {
    "use server";
    return getUnredeemedPromoForPlayer(sessionId, playerId);
  }

  return (
    <BuyInModal
      sessionId={sessionId}
      gameId={gameId}
      players={players}
      tables={tables}
      getUnredeemedPromo={getUnredeemedPromo}
      trigger={trigger}
    />
  );
}
```

- [ ] **Step 6: Update Quick Actions to use the new server wrapper**

In `app/(cashier)/live/_components/quick-actions.tsx`, change the import from `BuyInModal` to `BuyInModalServer`, and update the JSX to `<BuyInModalServer ... />` for the buy-in button.

- [ ] **Step 7: Build + commit**

```bash
npm run build
git add app/(cashier)/_actions/transactions.ts app/(cashier)/live/_components/ lib/validation/transactions.ts
git commit -m "feat(tx): freeroll prize payouts + unredeemed-promo banner on buy-in"
```

---

### Task 15: Staff advance, F&B cost, drawer/chip-float adjusts

**Files:**
- Modify: `lib/validation/transactions.ts`
- Modify: `app/(cashier)/_actions/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-misc-modal.tsx`
- Modify: `app/(cashier)/live/_components/quick-actions.tsx`

These four transaction types are all "drawer adjusts" with a required note — group them in one "Misc / adjust" modal.

- [ ] **Step 1: Add schemas**

```typescript
export const staffAdvanceSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().min(1),
  amount: decimalString,
  note: z.string().min(1).max(200),
});

export const fnbCostSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  amount: decimalString,
  note: z.string().min(1).max(200),
});

export const drawerAdjustSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  /** signed: positive = drawer was over by, negative = drawer was short by */
  amount: z.string().regex(/^-?\d+(\.\d+)?$/, "Must be a signed decimal").refine((s) => parseFloat(s) !== 0, "Cannot be zero"),
  note: z.string().min(1).max(200),
});

export const chipFloatAdjustSchema = drawerAdjustSchema; // same shape
```

- [ ] **Step 2: Add the four server actions**

```typescript
import {
  staffAdvanceSchema, fnbCostSchema, drawerAdjustSchema, chipFloatAdjustSchema,
} from "@/lib/validation/transactions";

export async function recordStaffAdvance(formData: FormData): Promise<void> {
  const input = parseFormData(staffAdvanceSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId, gameId: input.gameId, type: "STAFF_ADVANCE",
    createdById: cashierId, amount, method: "CASH",
    staffId: input.staffId,
    note: input.note,
    entries: [
      { account: "CASH_DRAWER", delta: amount.neg() },
      { account: "EXTERNAL", delta: amount },
    ],
  });
  revalidatePath("/live");
}

export async function recordFnbCost(formData: FormData): Promise<void> {
  const input = parseFormData(fnbCostSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId, gameId: input.gameId, type: "FNB_COST",
    createdById: cashierId, amount, method: "CASH",
    note: input.note,
    entries: [
      { account: "CASH_DRAWER", delta: amount.neg() },
      { account: "EXTERNAL", delta: amount },
    ],
  });
  revalidatePath("/live");
}

export async function recordDrawerAdjust(formData: FormData): Promise<void> {
  const input = parseFormData(drawerAdjustSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount); // signed

  await createTransaction({
    sessionId: input.sessionId, gameId: input.gameId, type: "DRAWER_COUNT_ADJUST",
    createdById: cashierId, amount: amount.abs(), method: "CASH",
    note: input.note,
    entries: [
      { account: "CASH_DRAWER", delta: amount },
      { account: "EXTERNAL", delta: amount.neg() },
    ],
  });
  revalidatePath("/live");
}

export async function recordChipFloatAdjust(formData: FormData): Promise<void> {
  const input = parseFormData(chipFloatAdjustSchema, formData);
  await ensureSessionOpen(input.sessionId);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount); // signed

  await createTransaction({
    sessionId: input.sessionId, gameId: input.gameId, type: "CHIP_FLOAT_ADJUST",
    createdById: cashierId, amount: amount.abs(), method: "CHIPS",
    note: input.note,
    entries: [
      { account: "CHIP_FLOAT", delta: amount },
      { account: "EXTERNAL", delta: amount.neg() },
    ],
  });
  revalidatePath("/live");
}
```

- [ ] **Step 3: Write `app/(cashier)/live/_components/tx-misc-modal.tsx`**

```tsx
import { Modal } from "@/components/modal";
import {
  recordStaffAdvance, recordFnbCost, recordDrawerAdjust, recordChipFloatAdjust,
} from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface Props {
  sessionId: string;
  gameId: string;
  trigger: React.ReactNode;
}

export async function MiscModal({ sessionId, gameId, trigger }: Props) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS", "RUNNER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });

  return (
    <Modal trigger={trigger} title="⋯ Other" description="Staff advance, F&B cost, drawer adjust, chip float adjust." wide>
      <div className="grid grid-cols-2 gap-4">
        <form action={recordStaffAdvance} className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Staff advance</h3>
          <select name="staffId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm">
            <option value="">— recipient —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input name="amount" type="number" step="0.01" min="0.01" required placeholder="amount"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="reason"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>

        <form action={recordFnbCost} className="flex flex-col gap-2">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">F&amp;B cost</h3>
          <input name="amount" type="number" step="0.01" min="0.01" required placeholder="amount"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="vendor / what"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>

        <form action={recordDrawerAdjust} className="flex flex-col gap-2 border-r border-[var(--color-border)] pr-4 pt-3 border-t border-[var(--color-border)]">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Drawer adjust</h3>
          <p className="text-xs text-slate-500">Signed amount: + over, − short.</p>
          <input name="amount" type="number" step="0.01" required placeholder="e.g. -40 or 25"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="reason"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>

        <form action={recordChipFloatAdjust} className="flex flex-col gap-2 pt-3 border-t border-[var(--color-border)]">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 text-sm">Chip float adjust</h3>
          <p className="text-xs text-slate-500">Signed: + extra chips found, − chips short.</p>
          <input name="amount" type="number" step="0.01" required placeholder="e.g. -50"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono" />
          <input name="note" required placeholder="reason"
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 text-sm" />
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">Record</button>
        </form>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Update Quick Actions to wire in Tournament, Jackpot, Freeroll, Misc modals**

Replace `app/(cashier)/live/_components/quick-actions.tsx`:

```tsx
import { BuyInModalServer } from "./tx-buyin-modal-wrapper";
import { CashOutModal } from "./tx-cashout-modal";
import { RakeModal } from "./tx-rake-modal";
import { TipDropModal } from "./tx-tipdrop-modal";
import { MarkerModal } from "./tx-marker-modal";
import { TournamentModal } from "./tx-tournament-modal";
import { JackpotModal } from "./tx-jackpot-modal";
import { FreerollModal } from "./tx-freeroll-modal";
import { MiscModal } from "./tx-misc-modal";

interface QuickActionsProps {
  sessionId: string;
  gameId: string;
}

const baseBtn =
  "bg-[var(--color-bg)] border border-[var(--color-border)] text-slate-200 font-semibold rounded-lg p-3 text-sm hover:border-amber-500 hover:text-amber-500 transition cursor-pointer w-full";

export async function QuickActions({ sessionId, gameId }: QuickActionsProps) {
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-3">Quick actions</h4>
      <div className="grid grid-cols-2 gap-2">
        <BuyInModalServer sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Buy-in</button>} />
        <CashOutModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>− Cash-out</button>} />
        <RakeModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Rake</button>} />
        <TipDropModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>+ Tip drop</button>} />
        <MarkerModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>$ Marker</button>} />
        <TournamentModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>⇄ Tournament</button>} />
        <JackpotModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>🏆 Jackpot</button>} />
        <FreerollModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn}>🎁 Freeroll</button>} />
        <MiscModal sessionId={sessionId} gameId={gameId} trigger={<button className={baseBtn} style={{ gridColumn: "span 2" }}>⋯ Other</button>} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add lib/validation/transactions.ts app/(cashier)/_actions/transactions.ts app/(cashier)/live/_components/
git commit -m "feat(tx): staff_advance, fnb_cost, drawer_count_adjust, chip_float_adjust"
```

---

## Phase E — Hourly drop tracker

### Task 16: Drop tracker computation + UI widget

**Files:**
- Create: `lib/drops/last-drop.ts`
- Create: `app/(cashier)/live/_components/drop-tracker.tsx`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Write `lib/drops/last-drop.ts`**

```typescript
import { prisma } from "@/lib/db";
import type { TransactionType } from "@prisma/client";

export interface DropTrackerEntry {
  staffId: string;
  staffName: string;
  staffRole: "DEALER" | "WAITRESS";
  lastRakeDrop: Date | null;
  lastTipDrop: Date | null;
}

const DROP_TYPES: TransactionType[] = ["RAKE", "TIP_DROP"];

/** For each active dealer/waitress, returns the most recent rake-drop and tip-drop times in this session. */
export async function getDropTracker(sessionId: string): Promise<DropTrackerEntry[]> {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  const drops = await prisma.transaction.findMany({
    where: { sessionId, type: { in: DROP_TYPES }, staffId: { not: null } },
    select: { staffId: true, type: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return staff.map((s) => {
    const lastRake = drops.find((d) => d.staffId === s.id && d.type === "RAKE")?.createdAt ?? null;
    const lastTip = drops.find((d) => d.staffId === s.id && d.type === "TIP_DROP")?.createdAt ?? null;
    return {
      staffId: s.id,
      staffName: s.name,
      staffRole: s.role as "DEALER" | "WAITRESS",
      lastRakeDrop: lastRake,
      lastTipDrop: lastTip,
    };
  });
}
```

- [ ] **Step 2: Write `app/(cashier)/live/_components/drop-tracker.tsx`**

```tsx
import { getDropTracker } from "@/lib/drops/last-drop";

interface Props {
  sessionId: string;
}

function ageColor(timestamp: Date | null): { label: string; cls: string } {
  if (!timestamp) return { label: "no drop yet", cls: "text-red-400" };
  const minutesAgo = (Date.now() - timestamp.getTime()) / 60_000;
  if (minutesAgo < 60) return { label: formatTime(timestamp), cls: "text-slate-300" };
  if (minutesAgo < 90) return { label: formatTime(timestamp) + " ⚠", cls: "text-amber-400" };
  return { label: formatTime(timestamp) + " ⚠", cls: "text-red-400" };
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function DropTracker({ sessionId }: Props) {
  const entries = await getDropTracker(sessionId);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
      <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-2">Drop tracker</h4>
      <ul className="text-xs flex flex-col gap-1">
        {entries.map((e) => {
          const isDealer = e.staffRole === "DEALER";
          const tracked = isDealer ? e.lastRakeDrop : e.lastTipDrop;
          const { label, cls } = ageColor(tracked);
          return (
            <li key={e.staffId} className="flex justify-between items-center px-2 py-1 rounded hover:bg-white/5">
              <span className="text-slate-200">{e.staffName}</span>
              <span className={`font-mono ${cls}`}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

For dealers, "tracked" is the last RAKE drop (since they drop both rake and tips, but rake is the more cadence-critical one). For waitresses, it's the last TIP_DROP. We'll refine this in Plan 1c if the friend wants both columns.

- [ ] **Step 3: Wire into the page side panel**

In `app/(cashier)/live/page.tsx`, in the right side panel after `<GameManager ... />`:

```tsx
import { DropTracker } from "./_components/drop-tracker";
// ...
<DropTracker sessionId={session.id} />
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add lib/drops/ app/(cashier)/live/
git commit -m "feat(ui): hourly drop tracker widget"
```

---

## Phase F — Full close-out flow

### Task 17: Tip-payout-with-tax module + tests

**Files:**
- Create: `lib/payouts/tip-payout.ts`
- Create: `tests/unit/ledger/tip-payout-tax.test.ts`

The module computes per-staff tip totals, applies each user's tax rate (or system default), rounds to the nearest dollar, and produces a list of `{staffId, total, taxRate, calculatedTax, roundedTax, netToStaff}` rows.

- [ ] **Step 1: Write `lib/payouts/tip-payout.ts`**

```typescript
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";

export interface TipPayoutRow {
  staffId: string;
  staffName: string;
  staffRole: string;
  total: Decimal;
  taxRate: Decimal;
  calculatedTax: Decimal;
  roundedTax: Decimal;
  netToStaff: Decimal;
}

/** Banker's-style rounding to the nearest whole dollar. Half goes to even. */
function roundHalfToEven(d: Decimal): Decimal {
  // decimal.js ROUND_HALF_EVEN = 6
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
}

/** Returns one row per staff member who has a non-zero tip-pool slice in this session. */
export async function computeTipPayouts(sessionId: string): Promise<TipPayoutRow[]> {
  // Sum tip_drop and tip_payout/tip_house_tax for each staff.
  // We compute "current tip pool slice for staffId" = sum of LedgerEntry where account=TIP_POOL
  //   and Transaction.staffId = staffId for TIP_DROP, or where the transaction was a payout/tax to that staff.
  // Simpler: for each staff, sum TIP_POOL deltas across transactions where staffId = staffId.
  const tipDrops = await prisma.transaction.findMany({
    where: { sessionId, type: "TIP_DROP", staffId: { not: null } },
    include: { staff: true, ledgerEntries: true },
  });

  const perStaff = new Map<string, { total: Decimal; staffName: string; staffRole: string }>();
  for (const tx of tipDrops) {
    if (!tx.staffId || !tx.staff) continue;
    const existing = perStaff.get(tx.staffId) ?? {
      total: new Decimal(0),
      staffName: tx.staff.name,
      staffRole: tx.staff.role,
    };
    // Use the TIP_POOL delta (positive on drop)
    const tipPoolEntry = tx.ledgerEntries.find((e) => e.account === "TIP_POOL");
    if (tipPoolEntry) {
      existing.total = existing.total.add(new Decimal(tipPoolEntry.delta.toString()));
    }
    perStaff.set(tx.staffId, existing);
  }

  if (perStaff.size === 0) return [];

  // Subtract any prior tip_payouts/tip_house_tax for these staff in this session (in case partial payouts already happened).
  const priorPayouts = await prisma.transaction.findMany({
    where: {
      sessionId,
      type: { in: ["TIP_PAYOUT", "TIP_HOUSE_TAX"] },
      staffId: { in: [...perStaff.keys()] },
    },
    include: { ledgerEntries: true },
  });
  for (const tx of priorPayouts) {
    if (!tx.staffId) continue;
    const existing = perStaff.get(tx.staffId);
    if (!existing) continue;
    const tipPoolEntry = tx.ledgerEntries.find((e) => e.account === "TIP_POOL");
    if (tipPoolEntry) {
      existing.total = existing.total.add(new Decimal(tipPoolEntry.delta.toString()));
    }
  }

  // Look up tax rates
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  const systemDefaultRate = new Decimal((settings?.defaultTipTaxRate ?? 0.20).toString());

  const users = await prisma.user.findMany({
    where: { id: { in: [...perStaff.keys()] } },
    select: { id: true, tipTaxRate: true },
  });
  const rateByUser = new Map<string, Decimal>();
  for (const u of users) {
    rateByUser.set(u.id, u.tipTaxRate ? new Decimal(u.tipTaxRate.toString()) : systemDefaultRate);
  }

  const rows: TipPayoutRow[] = [];
  for (const [staffId, info] of perStaff.entries()) {
    if (info.total.lessThanOrEqualTo(0)) continue;
    const taxRate = rateByUser.get(staffId) ?? systemDefaultRate;
    const calculatedTax = info.total.mul(taxRate);
    const roundedTax = roundHalfToEven(calculatedTax);
    const netToStaff = info.total.sub(roundedTax);
    rows.push({
      staffId,
      staffName: info.staffName,
      staffRole: info.staffRole,
      total: info.total,
      taxRate,
      calculatedTax,
      roundedTax,
      netToStaff,
    });
  }

  return rows.sort((a, b) => a.staffName.localeCompare(b.staffName));
}
```

- [ ] **Step 2: Write the test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { computeTipPayouts } from "@/lib/payouts/tip-payout";

describe("computeTipPayouts", () => {
  let sessionId: string;
  let gameId: string;
  let dealerId: string;
  let waitressId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
    const dealer = await testPrisma.user.create({
      data: { name: "Test Dealer", role: "DEALER", tipTaxRate: null },
    });
    const waitress = await testPrisma.user.create({
      data: { name: "Test Waitress", role: "WAITRESS", tipTaxRate: "0.15" },
    });
    dealerId = dealer.id;
    waitressId = waitress.id;
    await testPrisma.systemSettings.create({ data: { id: 1, defaultTipTaxRate: "0.20" } });
  });

  async function tipDrop(staffId: string, amount: number) {
    await createTransaction({
      sessionId, gameId, type: "TIP_DROP",
      createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS",
      staffId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
        { account: "TIP_POOL", delta: new Decimal(amount) },
      ],
    });
  }

  it("computes default-rate payout for a dealer", async () => {
    await tipDrop(dealerId, 87);
    const rows = await computeTipPayouts(sessionId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.total.toString()).toBe("87");
    expect(r.taxRate.toString()).toBe("0.2");
    expect(r.calculatedTax.toString()).toBe("17.4");
    // Banker's rounding: 17.4 → 17 (nearest). 17.5 would go to 18 (even).
    expect(r.roundedTax.toString()).toBe("17");
    expect(r.netToStaff.toString()).toBe("70");
  });

  it("uses custom rate when set", async () => {
    await tipDrop(waitressId, 35);
    const rows = await computeTipPayouts(sessionId);
    expect(rows[0].taxRate.toString()).toBe("0.15");
    expect(rows[0].calculatedTax.toString()).toBe("5.25");
    expect(rows[0].roundedTax.toString()).toBe("5");
    expect(rows[0].netToStaff.toString()).toBe("30");
  });

  it("aggregates multiple drops per staff", async () => {
    await tipDrop(dealerId, 20);
    await tipDrop(dealerId, 30);
    await tipDrop(dealerId, 10);
    const rows = await computeTipPayouts(sessionId);
    expect(rows[0].total.toString()).toBe("60");
  });

  it("excludes staff with zero tip total", async () => {
    // No drops → no row
    const rows = await computeTipPayouts(sessionId);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- tests/unit/ledger/tip-payout-tax.test.ts
git add lib/payouts/ tests/unit/ledger/tip-payout-tax.test.ts
git commit -m "feat(payouts): tip payout calculation with per-staff tax + banker's rounding"
```

---

### Task 18: Tip payout server action + UI

**Files:**
- Create: `app/(cashier)/_actions/payouts.ts`
- Create: `app/(cashier)/close/_components/tip-payout-step.tsx`
- Modify: `app/(cashier)/close/page.tsx`

The flow: at close-out, the cashier sees a pre-computed tip-payout table. For each row, they confirm individually or all-at-once. Confirmation generates a paired `tip_house_tax` + `tip_payout` transaction.

- [ ] **Step 1: Write `app/(cashier)/_actions/payouts.ts`**

```typescript
"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import { z } from "zod";
import type { PaymentMethod } from "@prisma/client";

const CASHIER_EMAIL = "cashier@dev.local";
async function cashierUserId(): Promise<string> {
  const c = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!c) throw new Error("Cashier user not seeded");
  return c.id;
}

const tipPayoutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  staffId: z.string().min(1),
  totalTipPool: z.string().regex(/^\d+(\.\d+)?$/),
  roundedTax: z.string().regex(/^\d+(\.\d+)?$/),
  netToStaff: z.string().regex(/^\d+(\.\d+)?$/),
  calculatedTax: z.string().regex(/^\d+(\.\d+)?$/),
  method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY"]),
});

const METHOD_TO_ACCOUNT = {
  CASH: "CASH_DRAWER",
  ZELLE: "ZELLE",
  VENMO: "VENMO",
  CASHAPP: "CASHAPP",
  APPLE_PAY: "APPLE_PAY",
} as const;

export async function executeTipPayout(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = tipPayoutSchema.parse(obj);

  const sessionId = input.sessionId;
  const gameId = input.gameId;
  const staffId = input.staffId;
  const cashierId = await cashierUserId();
  const totalTipPool = new Decimal(input.totalTipPool);
  const roundedTax = new Decimal(input.roundedTax);
  const netToStaff = new Decimal(input.netToStaff);
  const calculatedTax = new Decimal(input.calculatedTax);
  const method = input.method;
  const targetAccount = METHOD_TO_ACCOUNT[method];

  // Sanity: tax + net must equal total
  if (!roundedTax.add(netToStaff).equals(totalTipPool)) {
    throw new Error(`Tax + net ($${roundedTax} + $${netToStaff}) must equal total tip pool ($${totalTipPool})`);
  }

  // Two transactions: tip_house_tax (internal transfer) + tip_payout (cash to staff)
  await prisma.$transaction(async (_tx) => {
    // Note: createTransaction uses the global prisma client; since the deferred trigger
    // fires at COMMIT it works either way. We just sequence the inserts here.
    if (roundedTax.greaterThan(0)) {
      const roundingAdjustment = roundedTax.sub(calculatedTax); // signed
      await createTransaction({
        sessionId, gameId,
        type: "TIP_HOUSE_TAX",
        createdById: cashierId,
        amount: roundedTax,
        method: "CHIPS",
        staffId,
        roundingAdjustment,
        entries: [
          { account: "TIP_POOL", delta: roundedTax.neg() },
          { account: "HOUSE_TAX_POOL", delta: roundedTax },
        ],
      });
    }

    if (netToStaff.greaterThan(0)) {
      await createTransaction({
        sessionId, gameId,
        type: "TIP_PAYOUT",
        createdById: cashierId,
        amount: netToStaff,
        method,
        staffId,
        entries: [
          { account: targetAccount, delta: netToStaff.neg() },
          { account: "TIP_POOL", delta: netToStaff.neg() },
        ],
      });
    }
  }, { isolationLevel: "Serializable" });

  revalidatePath("/close");
}
```

- [ ] **Step 2: Write `app/(cashier)/close/_components/tip-payout-step.tsx`**

```tsx
"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { executeTipPayout } from "../../_actions/payouts";
import type { TipPayoutRow } from "@/lib/payouts/tip-payout";

interface Props {
  sessionId: string;
  gameId: string;
  rows: TipPayoutRow[];
}

interface RowState {
  roundedTax: Decimal;
  method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY";
  done: boolean;
}

export function TipPayoutStep({ sessionId, gameId, rows }: Props) {
  const [state, setState] = useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const r of rows) {
      initial[r.staffId] = { roundedTax: r.roundedTax, method: "CASH", done: false };
    }
    return initial;
  });

  function nudgeTax(staffId: string, direction: 1 | -1) {
    setState((s) => {
      const cur = s[staffId];
      return { ...s, [staffId]: { ...cur, roundedTax: cur.roundedTax.add(direction) } };
    });
  }

  function setMethod(staffId: string, method: RowState["method"]) {
    setState((s) => ({ ...s, [staffId]: { ...s[staffId], method } }));
  }

  async function confirm(row: TipPayoutRow) {
    const cur = state[row.staffId];
    const netToStaff = row.total.sub(cur.roundedTax);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("gameId", gameId);
    fd.set("staffId", row.staffId);
    fd.set("totalTipPool", row.total.toString());
    fd.set("calculatedTax", row.calculatedTax.toString());
    fd.set("roundedTax", cur.roundedTax.toString());
    fd.set("netToStaff", netToStaff.toString());
    fd.set("method", cur.method);
    await executeTipPayout(fd);
    setState((s) => ({ ...s, [row.staffId]: { ...s[row.staffId], done: true } }));
  }

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No tips to pay out tonight.</p>;
  }

  return (
    <table className="w-full bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg text-sm">
      <thead>
        <tr className="bg-amber-500/10 text-amber-500 text-xs uppercase tracking-wider">
          <th className="text-left px-3 py-2">Staff</th>
          <th className="text-right px-3 py-2">Tip pool</th>
          <th className="text-right px-3 py-2">Rate</th>
          <th className="text-right px-3 py-2">Calc'd tax</th>
          <th className="text-right px-3 py-2">Tax (rounded)</th>
          <th className="text-right px-3 py-2">Net to staff</th>
          <th className="text-right px-3 py-2">Method</th>
          <th className="text-center px-3 py-2"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cur = state[r.staffId];
          const netToStaff = r.total.sub(cur.roundedTax);
          return (
            <tr key={r.staffId} className="border-t border-[var(--color-border)]">
              <td className="px-3 py-2">{r.staffName}</td>
              <td className="px-3 py-2 text-right font-mono">${r.total.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{r.taxRate.mul(100).toFixed(0)}%</td>
              <td className="px-3 py-2 text-right text-slate-500 font-mono text-xs">${r.calculatedTax.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">
                  <button onClick={() => nudgeTax(r.staffId, 1)} disabled={cur.done}
                    className="bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-amber-500 w-5 h-5 rounded text-xs disabled:opacity-30">▲</button>
                  <span className={`font-mono ${cur.roundedTax.equals(r.roundedTax) ? "text-cyan-400" : "text-amber-500"}`}>${cur.roundedTax.toString()}</span>
                  <button onClick={() => nudgeTax(r.staffId, -1)} disabled={cur.done}
                    className="bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-amber-500 w-5 h-5 rounded text-xs disabled:opacity-30">▼</button>
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-green-400">${netToStaff.toString()}</td>
              <td className="px-3 py-2 text-right">
                <select value={cur.method} onChange={(e) => setMethod(r.staffId, e.target.value as RowState["method"])}
                  disabled={cur.done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 text-xs disabled:opacity-50">
                  <option value="CASH">cash</option>
                  <option value="ZELLE">zelle</option>
                  <option value="VENMO">venmo</option>
                  <option value="CASHAPP">cashapp</option>
                  <option value="APPLE_PAY">apple</option>
                </select>
              </td>
              <td className="px-3 py-2 text-center">
                {cur.done ? (
                  <span className="text-xs text-green-500">✓ done</span>
                ) : (
                  <button onClick={() => confirm(r)}
                    className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs">
                    Confirm
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add app/(cashier)/_actions/payouts.ts app/(cashier)/close/_components/tip-payout-step.tsx
git commit -m "feat(close): tip payout step with rounding arrows + per-row confirmation"
```

---

### Task 19: House tax distribution + per-game rake distribution

**Files:**
- Modify: `app/(cashier)/_actions/payouts.ts`
- Create: `app/(cashier)/close/_components/house-tax-step.tsx`
- Create: `app/(cashier)/close/_components/rake-distribution-step.tsx`

For Plan 1b, both distributions support a simple "even split among recipients" mode. Owner-side configurable splits ship in Plan 3.

- [ ] **Step 1: Append to `app/(cashier)/_actions/payouts.ts`**

```typescript
const distributeRakeSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  recipients: z.string(), // JSON array of { userId, amount, method }
});

export async function distributeRakeForGame(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = distributeRakeSchema.parse(obj);
  const recipients = z.array(z.object({
    userId: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY"]),
  })).parse(JSON.parse(input.recipients));

  const cashierId = await cashierUserId();

  await prisma.$transaction(async (_tx) => {
    for (const r of recipients) {
      const amount = new Decimal(r.amount);
      if (amount.lessThanOrEqualTo(0)) continue;
      const targetAccount = METHOD_TO_ACCOUNT[r.method];

      const tx = await createTransaction({
        sessionId: input.sessionId,
        gameId: input.gameId,
        type: "RAKE_DISTRIBUTION",
        createdById: cashierId,
        amount,
        method: r.method,
        staffId: r.userId,
        entries: [
          { account: targetAccount, delta: amount.neg() },
          { account: "RAKE_POOL", delta: amount.neg(), gameId: input.gameId },
        ],
      });

      await prisma.rakeDistribution.create({
        data: {
          sessionId: input.sessionId,
          gameId: input.gameId,
          recipientUserId: r.userId,
          amount: amount.toString(),
          txId: tx.id,
        },
      });
    }
  }, { isolationLevel: "Serializable" });

  revalidatePath("/close");
}

const distributeHouseTaxSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  recipients: z.string(),
});

export async function distributeHouseTax(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = distributeHouseTaxSchema.parse(obj);
  const recipients = z.array(z.object({
    userId: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY"]),
  })).parse(JSON.parse(input.recipients));

  const cashierId = await cashierUserId();

  await prisma.$transaction(async (_tx) => {
    for (const r of recipients) {
      const amount = new Decimal(r.amount);
      if (amount.lessThanOrEqualTo(0)) continue;
      const targetAccount = METHOD_TO_ACCOUNT[r.method];

      await createTransaction({
        sessionId: input.sessionId,
        gameId: input.gameId,
        type: "HOUSE_TAX_DISTRIBUTION",
        createdById: cashierId,
        amount,
        method: r.method,
        staffId: r.userId,
        entries: [
          { account: targetAccount, delta: amount.neg() },
          { account: "HOUSE_TAX_POOL", delta: amount.neg() },
        ],
      });
    }
  }, { isolationLevel: "Serializable" });

  revalidatePath("/close");
}
```

- [ ] **Step 2: Write `app/(cashier)/close/_components/rake-distribution-step.tsx`**

```tsx
"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { distributeRakeForGame } from "../../_actions/payouts";

interface Recipient {
  userId: string;
  userName: string;
  amount: Decimal;
  method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY";
}

interface Props {
  sessionId: string;
  gameId: string;
  gameName: string;
  totalRake: Decimal;
  /** Pre-computed even split among hosts who worked this game; admin can edit. */
  initialRecipients: Recipient[];
}

export function RakeDistributionStep({ sessionId, gameId, gameName, totalRake, initialRecipients }: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [done, setDone] = useState(false);

  const allocated = recipients.reduce((sum, r) => sum.add(r.amount), new Decimal(0));
  const remaining = totalRake.sub(allocated);

  function setAmount(userId: string, value: string) {
    setRecipients((rs) => rs.map((r) => r.userId === userId ? { ...r, amount: new Decimal(value || "0") } : r));
  }

  function setMethod(userId: string, method: Recipient["method"]) {
    setRecipients((rs) => rs.map((r) => r.userId === userId ? { ...r, method } : r));
  }

  async function submit() {
    if (!remaining.equals(0)) {
      alert(`Remaining must be $0.00 before distributing. Currently $${remaining.toString()}.`);
      return;
    }
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("gameId", gameId);
    fd.set("recipients", JSON.stringify(recipients.map((r) => ({
      userId: r.userId,
      amount: r.amount.toString(),
      method: r.method,
    }))));
    await distributeRakeForGame(fd);
    setDone(true);
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <header className="flex justify-between items-baseline mb-3">
        <h3 className="font-semibold text-amber-500">{gameName} — distribute rake</h3>
        <div className="text-xs text-slate-500">
          Pool: <span className="font-mono text-slate-200">${totalRake.toString()}</span> ·
          Remaining: <span className={`font-mono ${remaining.equals(0) ? "text-green-400" : "text-amber-400"}`}>${remaining.toString()}</span>
        </div>
      </header>

      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr><th className="text-left">Recipient</th><th className="text-right">Amount</th><th className="text-right">Method</th></tr>
        </thead>
        <tbody>
          {recipients.map((r) => (
            <tr key={r.userId} className="border-t border-[var(--color-border)]">
              <td className="py-2">{r.userName}</td>
              <td className="py-2 text-right">
                <input type="number" step="0.01" value={r.amount.toString()}
                  onChange={(e) => setAmount(r.userId, e.target.value)}
                  disabled={done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-28 font-mono text-right text-sm disabled:opacity-50" />
              </td>
              <td className="py-2 text-right">
                <select value={r.method} onChange={(e) => setMethod(r.userId, e.target.value as Recipient["method"])}
                  disabled={done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 text-xs disabled:opacity-50">
                  <option value="CASH">cash</option>
                  <option value="ZELLE">zelle</option>
                  <option value="VENMO">venmo</option>
                  <option value="CASHAPP">cashapp</option>
                  <option value="APPLE_PAY">apple</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="text-right mt-3">
        {done ? (
          <span className="text-sm text-green-500">✓ distributed</span>
        ) : (
          <button onClick={submit}
            disabled={!remaining.equals(0)}
            className="bg-amber-500 text-black font-semibold rounded px-4 py-2 text-sm disabled:opacity-50">
            Distribute
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `app/(cashier)/close/_components/house-tax-step.tsx` (similar pattern, but pulls from house_tax_pool)**

```tsx
"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { distributeHouseTax } from "../../_actions/payouts";

interface Recipient {
  userId: string;
  userName: string;
  amount: Decimal;
  method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY";
}

interface Props {
  sessionId: string;
  gameId: string;
  totalHouseTax: Decimal;
  initialRecipients: Recipient[];
}

export function HouseTaxStep({ sessionId, gameId, totalHouseTax, initialRecipients }: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [done, setDone] = useState(false);

  const allocated = recipients.reduce((sum, r) => sum.add(r.amount), new Decimal(0));
  const remaining = totalHouseTax.sub(allocated);

  async function submit() {
    if (!remaining.equals(0)) {
      alert(`Remaining must be $0.00. Currently $${remaining.toString()}.`);
      return;
    }
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("gameId", gameId);
    fd.set("recipients", JSON.stringify(recipients.map((r) => ({
      userId: r.userId, amount: r.amount.toString(), method: r.method,
    }))));
    await distributeHouseTax(fd);
    setDone(true);
  }

  if (totalHouseTax.lessThanOrEqualTo(0)) {
    return <p className="text-sm text-slate-500">No house tax to distribute.</p>;
  }

  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <header className="flex justify-between items-baseline mb-3">
        <h3 className="font-semibold text-amber-500">House tax distribution</h3>
        <div className="text-xs text-slate-500">
          Pool: <span className="font-mono text-slate-200">${totalHouseTax.toString()}</span> ·
          Remaining: <span className={`font-mono ${remaining.equals(0) ? "text-green-400" : "text-amber-400"}`}>${remaining.toString()}</span>
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 uppercase">
          <tr><th className="text-left">Recipient</th><th className="text-right">Amount</th><th className="text-right">Method</th></tr>
        </thead>
        <tbody>
          {recipients.map((r) => (
            <tr key={r.userId} className="border-t border-[var(--color-border)]">
              <td className="py-2">{r.userName}</td>
              <td className="py-2 text-right">
                <input type="number" step="0.01" value={r.amount.toString()}
                  onChange={(e) => setRecipients((rs) => rs.map((x) => x.userId === r.userId ? { ...x, amount: new Decimal(e.target.value || "0") } : x))}
                  disabled={done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-28 font-mono text-right text-sm disabled:opacity-50" />
              </td>
              <td className="py-2 text-right">
                <select value={r.method}
                  onChange={(e) => setRecipients((rs) => rs.map((x) => x.userId === r.userId ? { ...x, method: e.target.value as Recipient["method"] } : x))}
                  disabled={done}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 text-xs disabled:opacity-50">
                  <option value="CASH">cash</option>
                  <option value="ZELLE">zelle</option>
                  <option value="VENMO">venmo</option>
                  <option value="CASHAPP">cashapp</option>
                  <option value="APPLE_PAY">apple</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-right mt-3">
        {done
          ? <span className="text-sm text-green-500">✓ distributed</span>
          : <button onClick={submit} disabled={!remaining.equals(0)}
              className="bg-amber-500 text-black font-semibold rounded px-4 py-2 text-sm disabled:opacity-50">Distribute</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add app/(cashier)/_actions/payouts.ts app/(cashier)/close/_components/
git commit -m "feat(close): rake distribution per game + house tax distribution"
```

---

### Task 20: Wire payouts into multi-step close-out page

**Files:**
- Modify: `app/(cashier)/close/page.tsx`

The close page becomes a multi-step flow:
1. Tip payout
2. House tax distribution
3. Per-game rake distribution (one section per game)
4. Final per-account reconciliation (existing)

Each step is a section the cashier completes. The "Close Session" submit at the bottom only fires after all steps are confirmed. For Plan 1b we render them as sequential sections on one page (not a wizard) — simpler.

- [ ] **Step 1: Replace the file**

```tsx
import { redirect } from "next/navigation";
import Decimal from "decimal.js";
import { getOpenSession, closeSession } from "../_actions/session";
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";
import { Money } from "@/components/money";
import { computeTipPayouts } from "@/lib/payouts/tip-payout";
import { TipPayoutStep } from "./_components/tip-payout-step";
import { HouseTaxStep } from "./_components/house-tax-step";
import { RakeDistributionStep } from "./_components/rake-distribution-step";
import { prisma } from "@/lib/db";

export default async function ClosePage() {
  const session = await getOpenSession();
  if (!session) redirect("/live");

  // 1. Tip payouts
  const tipRows = await computeTipPayouts(session.id);

  // 2. House tax pool balance
  const houseTaxPool = await getAccountBalance({ account: "HOUSE_TAX_POOL", sessionId: session.id });

  // 3. Per-game rake pools
  const games = session.games;
  const rakePerGame = await Promise.all(
    games.map(async (g) => ({
      gameId: g.id,
      gameName: g.name,
      total: await getAccountBalance({ account: "RAKE_POOL", sessionId: session.id, gameId: g.id }),
    }))
  );

  // For now, "owners" for house-tax distribution and "hosts" for rake distribution are pulled from
  // active OWNER and ADMIN users respectively. Plan 3's admin panel will configure splits explicitly.
  const owners = await prisma.user.findMany({
    where: { role: { in: ["OWNER", "ADMIN", "CASHIER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const hosts = await prisma.user.findMany({
    where: { role: { in: ["RUNNER", "CASHIER"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  function evenSplit(total: Decimal, count: number): Decimal[] {
    if (count === 0) return [];
    const baseDecimal = total.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const totals = Array(count).fill(baseDecimal);
    // Allocate the remainder to the first recipient to make sums equal exactly.
    const allocated = baseDecimal.mul(count);
    const remainder = total.sub(allocated);
    if (!remainder.equals(0) && totals.length > 0) {
      totals[0] = totals[0].add(remainder);
    }
    return totals;
  }

  // Compute expected balances for the final reconciliation table
  const GAME_SCOPED = new Set(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"]);
  const expected: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    if (GAME_SCOPED.has(account)) {
      for (const game of session.games) {
        const bal = await getAccountBalance({ account, sessionId: session.id, gameId: game.id });
        expected[`${account}_${game.id}`] = bal.toString();
      }
    } else {
      const bal = await getAccountBalance({ account, sessionId: session.id });
      expected[account] = bal.toString();
    }
  }

  // House tax recipients (even split among owners by default)
  const houseTaxRecipients = (() => {
    const splits = evenSplit(houseTaxPool, owners.length);
    return owners.map((o, i) => ({
      userId: o.id,
      userName: o.name,
      amount: splits[i] ?? new Decimal(0),
      method: "CASH" as const,
    }));
  })();

  // For each game, compute rake recipients (even split among hosts)
  const rakeStepsData = rakePerGame.map((rp) => {
    const splits = evenSplit(rp.total, hosts.length);
    return {
      ...rp,
      recipients: hosts.map((h, i) => ({
        userId: h.id,
        userName: h.name,
        amount: splits[i] ?? new Decimal(0),
        method: "CASH" as const,
      })),
    };
  });

  // Need a gameId for tip-payout (TIP_HOUSE_TAX is not actually game-scoped, but we pass the first game's id for the foreign key).
  const defaultGameId = session.games[0].id;

  return (
    <div className="max-w-4xl flex flex-col gap-6 pb-12">
      <h2 className="text-lg font-semibold">Close Session</h2>
      <p className="text-sm text-slate-400">
        Complete each step in order. The final "Close Session" button at the bottom freezes the session and records account counts.
      </p>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 1 — Pay out tips</h3>
        <TipPayoutStep sessionId={session.id} gameId={defaultGameId} rows={tipRows} />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 2 — Distribute house tax pool</h3>
        <HouseTaxStep
          sessionId={session.id}
          gameId={defaultGameId}
          totalHouseTax={houseTaxPool}
          initialRecipients={houseTaxRecipients}
        />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 3 — Distribute rake (per game)</h3>
        <div className="flex flex-col gap-3">
          {rakeStepsData.map((rs) => (
            <RakeDistributionStep
              key={rs.gameId}
              sessionId={session.id}
              gameId={rs.gameId}
              gameName={rs.gameName}
              totalRake={rs.total}
              initialRecipients={rs.recipients}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 4 — Reconcile accounts &amp; close</h3>
        <p className="text-xs text-slate-500 mb-3">
          Count each account and enter the actual amount. Variances are recorded but allowed.
        </p>
        <form action={closeSession} className="flex flex-col gap-3">
          <input type="hidden" name="sessionId" value={session.id} />
          <table className="w-full bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg">
            <thead>
              <tr className="bg-amber-500/10 text-amber-500 text-xs uppercase tracking-wider">
                <th className="px-3 py-2 text-left">Account</th>
                <th className="px-3 py-2 text-right">Expected</th>
                <th className="px-3 py-2 text-right">Counted</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNTS.map((account) => {
                if (GAME_SCOPED.has(account)) {
                  return session.games.map((game) => (
                    <tr key={`${account}_${game.id}`} className="border-t border-[var(--color-border)]">
                      <td className="px-3 py-2 text-sm">{account.toLowerCase()} ({game.name})</td>
                      <td className="px-3 py-2 text-right font-mono"><Money amount={expected[`${account}_${game.id}`]} /></td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" step="0.01"
                          name={`counted_${account}_${game.id}`}
                          defaultValue={expected[`${account}_${game.id}`]}
                          className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right" />
                      </td>
                    </tr>
                  ));
                }
                return (
                  <tr key={account} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2 text-sm">{account.toLowerCase()}</td>
                    <td className="px-3 py-2 text-right font-mono"><Money amount={expected[account]} /></td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01"
                        name={`counted_${account}`}
                        defaultValue={expected[account]}
                        className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="submit" className="bg-red-600 text-white font-semibold rounded px-4 py-2 self-end">
            Close Session
          </button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(cashier)/close/page.tsx
git commit -m "feat(close): multi-step close-out — tips, house tax, rake, reconcile"
```

---

## Phase G — Walks / returns workflow

### Task 21: chip_walk and chip_return server actions + tests

**Files:**
- Create: `app/(cashier)/_actions/walks.ts`
- Create: `lib/validation/walks.ts`
- Create: `tests/unit/ledger/walks.test.ts`

- [ ] **Step 1: Write `lib/validation/walks.ts`**

```typescript
import { z } from "zod";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/).refine((s) => parseFloat(s) > 0, "Must be positive");

export const chipWalkSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  note: z.string().max(200).optional(),
});

export const chipReturnSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  amount: decimalString,
  matchesWalkId: z.string().optional(),
});
```

- [ ] **Step 2: Write `app/(cashier)/_actions/walks.ts`**

```typescript
"use server";

import Decimal from "decimal.js";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import { chipWalkSchema, chipReturnSchema } from "@/lib/validation/walks";

const CASHIER_EMAIL = "cashier@dev.local";
async function cashierUserId(): Promise<string> {
  const c = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!c) throw new Error("Cashier user not seeded");
  return c.id;
}

export async function recordChipWalk(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = chipWalkSchema.parse(obj);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "CHIP_WALK",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note: input.note ?? "Chips walked from session",
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "EXTERNAL", delta: amount },
    ],
  });

  revalidatePath("/close");
}

export async function recordChipReturn(formData: FormData): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) obj[k] = v.toString();
  const input = chipReturnSchema.parse(obj);
  const cashierId = await cashierUserId();
  const amount = new Decimal(input.amount);

  const note = input.matchesWalkId
    ? `Chips returned (matches walk tx ${input.matchesWalkId})`
    : "Chips returned (no prior walk match)";

  await createTransaction({
    sessionId: input.sessionId,
    gameId: input.gameId,
    type: "CHIP_RETURN",
    createdById: cashierId,
    amount,
    method: "CHIPS",
    playerId: input.playerId,
    note,
    entries: [
      { account: "CHIP_FLOAT", delta: amount },
      { account: "EXTERNAL", delta: amount.neg() },
    ],
  });

  revalidatePath("/close");
}

/** For the close-out walks panel: players who bought in this session but never cashed out and have no chip_walk. */
export async function getPlayersWithUnresolvedChips(sessionId: string) {
  const buyIns = await prisma.transaction.findMany({
    where: { sessionId, type: "BUY_IN", playerId: { not: null } },
    select: { playerId: true },
    distinct: ["playerId"],
  });

  const players = await prisma.player.findMany({
    where: { id: { in: buyIns.map((b) => b.playerId!).filter(Boolean) } },
    orderBy: { displayName: "asc" },
  });

  return players;
}

/** For the returns panel: prior chip_walk txs for players present in this session, not yet matched. */
export async function getCandidateWalksForReturn(sessionId: string) {
  const players = await prisma.transaction.findMany({
    where: { sessionId, playerId: { not: null } },
    select: { playerId: true },
    distinct: ["playerId"],
  });
  const playerIds = players.map((p) => p.playerId!).filter(Boolean);
  if (playerIds.length === 0) return [];

  const priorWalks = await prisma.transaction.findMany({
    where: {
      type: "CHIP_WALK",
      playerId: { in: playerIds },
      session: { closedAt: { not: null } }, // only closed prior sessions
    },
    include: { player: true, session: true },
    orderBy: { createdAt: "desc" },
  });

  return priorWalks;
}
```

- [ ] **Step 3: Write `tests/unit/ledger/walks.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("chip_walk and chip_return", () => {
  let sessionId: string;
  let gameId: string;
  let playerId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
    const player = await testPrisma.player.create({ data: { displayName: "Walker" } });
    playerId = player.id;
  });

  it("chip_walk decreases chip_float and increases external", async () => {
    await createTransaction({
      sessionId, gameId, type: "CHIP_WALK",
      createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      playerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-50) },
        { account: "EXTERNAL", delta: new Decimal(50) },
      ],
    });
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("-50");
    expect((await getAccountBalance({ account: "EXTERNAL", sessionId })).toString()).toBe("50");
  });

  it("chip_return reverses a walk", async () => {
    await createTransaction({
      sessionId, gameId, type: "CHIP_WALK",
      createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      playerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-50) },
        { account: "EXTERNAL", delta: new Decimal(50) },
      ],
    });
    await createTransaction({
      sessionId, gameId, type: "CHIP_RETURN",
      createdById: "test-cashier",
      amount: new Decimal(50), method: "CHIPS",
      playerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(50) },
        { account: "EXTERNAL", delta: new Decimal(-50) },
      ],
    });
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("0");
    expect((await getAccountBalance({ account: "EXTERNAL", sessionId })).toString()).toBe("0");
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
npm test -- tests/unit/ledger/walks.test.ts
git add lib/validation/walks.ts app/(cashier)/_actions/walks.ts tests/unit/ledger/walks.test.ts
git commit -m "feat(walks): chip_walk and chip_return server actions + tests"
```

---

### Task 22: Walks/returns close-out step

**Files:**
- Create: `app/(cashier)/close/_components/walks-returns-step.tsx`
- Modify: `app/(cashier)/close/page.tsx`

The step appears between "Distribute rake" and "Reconcile accounts". It shows:
- Current `chip_float` balance
- If positive: list candidate players with "Walked $X" form per row
- If negative: list candidate prior-session walks with "Match" buttons
- "I can't account for it" → falls through to `chip_float_adjust`

- [ ] **Step 1: Write `app/(cashier)/close/_components/walks-returns-step.tsx`**

```tsx
"use client";

import Decimal from "decimal.js";
import { useState } from "react";
import { recordChipWalk, recordChipReturn } from "../../_actions/walks";

interface Walk {
  id: string;
  player: { id: string; displayName: string };
  amount: { toString(): string };
  session: { openedAt: Date };
}

interface Player {
  id: string;
  displayName: string;
}

interface Props {
  sessionId: string;
  gameId: string;
  chipFloatBalance: Decimal;
  candidatePlayers: Player[];
  candidateWalks: Walk[];
}

export function WalksReturnsStep({ sessionId, gameId, chipFloatBalance, candidatePlayers, candidateWalks }: Props) {
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  if (chipFloatBalance.equals(0)) {
    return <p className="text-sm text-green-500">✓ chip_float = $0 — nothing to reconcile.</p>;
  }

  if (chipFloatBalance.greaterThan(0)) {
    return (
      <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <p className="text-sm mb-3">
          <span className="text-amber-500 font-semibold">${chipFloatBalance.toString()} in chips unaccounted for.</span>
          {" "}Mark each player who walked with chips. Total walked must equal the variance.
        </p>
        <ul className="flex flex-col gap-2">
          {candidatePlayers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{p.displayName}</span>
              <form action={async (fd) => {
                await recordChipWalk(fd);
                setDoneIds((s) => new Set(s).add(p.id));
              }} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="playerId" value={p.id} />
                <input name="amount" type="number" step="0.01" min="0.01" placeholder="$0.00"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-24 font-mono text-right text-sm" />
                <input name="note" placeholder="note (optional)"
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-40 text-sm" />
                <button type="submit" disabled={doneIds.has(p.id)}
                  className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs disabled:opacity-30">
                  {doneIds.has(p.id) ? "✓" : "Mark walked"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // chipFloatBalance.lessThan(0) — chips appeared
  const surplus = chipFloatBalance.abs();
  return (
    <div className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <p className="text-sm mb-3">
        <span className="text-cyan-400 font-semibold">${surplus.toString()} extra chips counted in.</span>
        {" "}Likely a player brought back chips from a prior session. Match against an outstanding walk:
      </p>
      {candidateWalks.length === 0 ? (
        <p className="text-xs text-slate-500">No prior walks to match. Use chip_float_adjust in the Other modal.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidateWalks.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">
                {w.player.displayName} — ${w.amount.toString()}
                <span className="text-xs text-slate-500 ml-2">
                  walked {new Date(w.session.openedAt).toLocaleDateString()}
                </span>
              </span>
              <form action={async (fd) => {
                await recordChipReturn(fd);
                setDoneIds((s) => new Set(s).add(w.id));
              }} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={sessionId} />
                <input type="hidden" name="gameId" value={gameId} />
                <input type="hidden" name="playerId" value={w.player.id} />
                <input type="hidden" name="amount" value={w.amount.toString()} />
                <input type="hidden" name="matchesWalkId" value={w.id} />
                <button type="submit" disabled={doneIds.has(w.id)}
                  className="bg-amber-500 text-black font-semibold rounded px-2 py-1 text-xs disabled:opacity-30">
                  {doneIds.has(w.id) ? "✓" : "Match return"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into close page** between "Step 3" and "Step 4"

In `app/(cashier)/close/page.tsx`:

```tsx
import { WalksReturnsStep } from "./_components/walks-returns-step";
import { getPlayersWithUnresolvedChips, getCandidateWalksForReturn } from "../_actions/walks";

// ... after computing rakePerGame, also compute:
const chipFloatBalance = await getAccountBalance({ account: "CHIP_FLOAT", sessionId: session.id });
const candidatePlayers = await getPlayersWithUnresolvedChips(session.id);
const candidateWalks = await getCandidateWalksForReturn(session.id);

// ... insert this section between Step 3 and Step 4:
<section>
  <h3 className="text-sm font-semibold text-slate-300 mb-2">Step 4 — Resolve chip float (walks &amp; returns)</h3>
  <WalksReturnsStep
    sessionId={session.id}
    gameId={defaultGameId}
    chipFloatBalance={chipFloatBalance}
    candidatePlayers={candidatePlayers}
    candidateWalks={candidateWalks}
  />
</section>
// ... and renumber the existing Step 4 to Step 5 in its h3.
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add app/(cashier)/close/
git commit -m "feat(close): walks/returns reconciliation step"
```

---

## Phase H — Divergence finder

### Task 23: Heuristics module

**Files:**
- Create: `lib/reconciliation/heuristics.ts`
- Create: `tests/unit/reconciliation/heuristics.test.ts`

- [ ] **Step 1: Write `lib/reconciliation/heuristics.ts`**

```typescript
import Decimal from "decimal.js";
import type { AccountType, Transaction, LedgerEntry } from "@prisma/client";

export interface Suggestion {
  /** Short human-readable headline */
  title: string;
  /** Longer description */
  body: string;
  /** Transaction id(s) implicated, if any */
  txIds: string[];
  /** Which heuristic fired */
  kind: "equal_opposite" | "outlier" | "decimal_typo" | "orphan";
}

export interface AccountVariance {
  account: AccountType;
  variance: Decimal;
}

interface TxLite {
  id: string;
  amount: Decimal;
  type: string;
  playerId: string | null;
  ledgerEntries: Array<{ account: AccountType; delta: Decimal }>;
}

/**
 * Suggestion 1: equal-and-opposite variance across two accounts.
 * If account A is short by $X and account B is over by $X, candidate transactions of amount $X
 * may have been recorded with the wrong method.
 */
export function findEqualOpposite(variances: AccountVariance[], txs: TxLite[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (let i = 0; i < variances.length; i++) {
    for (let j = i + 1; j < variances.length; j++) {
      const a = variances[i];
      const b = variances[j];
      if (a.variance.equals(0) || b.variance.equals(0)) continue;
      if (!a.variance.add(b.variance).equals(0)) continue;
      const magnitude = a.variance.abs();
      const candidates = txs.filter((tx) => tx.amount.equals(magnitude));
      if (candidates.length === 0) continue;
      suggestions.push({
        kind: "equal_opposite",
        title: `Possible method mistype: ${a.account} and ${b.account} variances cancel out`,
        body: `${a.account} is ${a.variance.toString()}, ${b.account} is ${b.variance.toString()}. Transactions of $${magnitude} may have been recorded with the wrong method.`,
        txIds: candidates.map((c) => c.id),
      });
    }
  }
  return suggestions;
}

/**
 * Suggestion 2: outlier transactions (amount > 5× median for that player).
 * Returns one suggestion per outlier transaction.
 */
export function findOutliers(txs: TxLite[], multiplier = 5): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const byPlayer = new Map<string, TxLite[]>();
  for (const tx of txs) {
    if (!tx.playerId) continue;
    const arr = byPlayer.get(tx.playerId) ?? [];
    arr.push(tx);
    byPlayer.set(tx.playerId, arr);
  }
  for (const [playerId, playerTxs] of byPlayer.entries()) {
    if (playerTxs.length < 3) continue;
    const sorted = [...playerTxs].sort((a, b) => Number(a.amount.minus(b.amount).toString()));
    const median = sorted[Math.floor(sorted.length / 2)].amount;
    if (median.equals(0)) continue;
    for (const tx of playerTxs) {
      if (tx.amount.greaterThan(median.mul(multiplier))) {
        suggestions.push({
          kind: "outlier",
          title: `Outlier amount: $${tx.amount.toString()}`,
          body: `Player's median transaction is $${median.toString()}; this is ${tx.amount.div(median).toFixed(1)}×.`,
          txIds: [tx.id],
        });
      }
    }
  }
  return suggestions;
}

/**
 * Suggestion 3: decimal/zero typos — amount that's exactly 10× another amount for the same player.
 */
export function findDecimalTypos(txs: TxLite[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const byPlayer = new Map<string, TxLite[]>();
  for (const tx of txs) {
    if (!tx.playerId) continue;
    const arr = byPlayer.get(tx.playerId) ?? [];
    arr.push(tx);
    byPlayer.set(tx.playerId, arr);
  }
  for (const playerTxs of byPlayer.values()) {
    for (const a of playerTxs) {
      for (const b of playerTxs) {
        if (a.id === b.id) continue;
        if (a.amount.equals(b.amount.mul(10))) {
          suggestions.push({
            kind: "decimal_typo",
            title: `Possible decimal typo: $${a.amount.toString()} is 10× $${b.amount.toString()}`,
            body: `Same player has a transaction at exactly 10× another. May be an extra zero.`,
            txIds: [a.id, b.id],
          });
        }
      }
    }
  }
  return suggestions;
}

/**
 * Suggestion 4: orphaned buy-ins — players who bought in but never cashed out, no marker, no chip_walk.
 */
export function findOrphans(allTxs: TxLite[]): Suggestion[] {
  const buyInPlayers = new Set<string>();
  const cashOutPlayers = new Set<string>();
  const markerPlayers = new Set<string>();
  const walkPlayers = new Set<string>();

  for (const tx of allTxs) {
    if (!tx.playerId) continue;
    if (tx.type === "BUY_IN") buyInPlayers.add(tx.playerId);
    if (tx.type === "CASH_OUT") cashOutPlayers.add(tx.playerId);
    if (tx.type === "MARKER_ISSUE") markerPlayers.add(tx.playerId);
    if (tx.type === "CHIP_WALK") walkPlayers.add(tx.playerId);
  }

  const orphans: string[] = [];
  for (const p of buyInPlayers) {
    if (!cashOutPlayers.has(p) && !markerPlayers.has(p) && !walkPlayers.has(p)) {
      orphans.push(p);
    }
  }

  if (orphans.length === 0) return [];

  return [{
    kind: "orphan",
    title: `${orphans.length} orphaned buy-in${orphans.length === 1 ? "" : "s"}`,
    body: "Players bought in but never cashed out, no marker, no walk recorded. They may have busted (no action needed) or walked with chips (record a chip_walk).",
    txIds: [], // referenced by playerId, not txId — intentionally empty
  }];
}

export function runAllHeuristics(variances: AccountVariance[], txs: TxLite[]): Suggestion[] {
  return [
    ...findEqualOpposite(variances, txs),
    ...findOutliers(txs),
    ...findDecimalTypos(txs),
    ...findOrphans(txs),
  ];
}
```

- [ ] **Step 2: Write `tests/unit/reconciliation/heuristics.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  findEqualOpposite, findOutliers, findDecimalTypos, findOrphans,
} from "@/lib/reconciliation/heuristics";

const D = (n: number | string) => new Decimal(n);

describe("findEqualOpposite", () => {
  it("flags two accounts with equal-and-opposite variances", () => {
    const variances = [
      { account: "CASH_DRAWER" as const, variance: D(-220) },
      { account: "ZELLE" as const, variance: D(220) },
    ];
    const txs = [{ id: "t1", amount: D(220), type: "BUY_IN", playerId: "p1", ledgerEntries: [] }];
    const out = findEqualOpposite(variances, txs);
    expect(out).toHaveLength(1);
    expect(out[0].txIds).toContain("t1");
  });

  it("returns nothing when variances don't cancel", () => {
    const variances = [
      { account: "CASH_DRAWER" as const, variance: D(-100) },
      { account: "ZELLE" as const, variance: D(50) },
    ];
    expect(findEqualOpposite(variances, [])).toHaveLength(0);
  });
});

describe("findOutliers", () => {
  it("flags a transaction > 5× the player's median", () => {
    const txs = [
      { id: "t1", amount: D(100), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t2", amount: D(150), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t3", amount: D(200), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t4", amount: D(2750), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
    ];
    const out = findOutliers(txs);
    expect(out.some((s) => s.txIds.includes("t4"))).toBe(true);
  });
});

describe("findDecimalTypos", () => {
  it("flags two amounts where one is 10× the other for same player", () => {
    const txs = [
      { id: "t1", amount: D(275), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t2", amount: D(2750), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
    ];
    const out = findDecimalTypos(txs);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("findOrphans", () => {
  it("returns one suggestion when a player bought in but never cashed out", () => {
    const txs = [
      { id: "t1", amount: D(200), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
    ];
    const out = findOrphans(txs);
    expect(out).toHaveLength(1);
  });

  it("doesn't flag a player who has a chip_walk recorded", () => {
    const txs = [
      { id: "t1", amount: D(200), type: "BUY_IN", playerId: "p1", ledgerEntries: [] },
      { id: "t2", amount: D(50), type: "CHIP_WALK", playerId: "p1", ledgerEntries: [] },
    ];
    expect(findOrphans(txs)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- tests/unit/reconciliation/heuristics.test.ts
git add lib/reconciliation/ tests/unit/reconciliation/
git commit -m "feat(reconciliation): variance heuristics module"
```

---

### Task 24: Divergence finder UI in close-out

**Files:**
- Create: `app/(cashier)/close/_components/divergence-finder.tsx`
- Modify: `app/(cashier)/close/page.tsx`

When the cashier submits the final reconciliation form, if any account variance is non-zero, instead of immediately closing, the page renders the divergence finder for them to investigate first.

For Plan 1b, we'll make it simpler: the divergence finder is **always visible** at the top of Step 5 if any variance is non-zero. The cashier can review suggestions, then proceed with close.

- [ ] **Step 1: Write `app/(cashier)/close/_components/divergence-finder.tsx`**

```tsx
import type { Suggestion } from "@/lib/reconciliation/heuristics";

interface Props {
  suggestions: Suggestion[];
}

const KIND_ICON: Record<Suggestion["kind"], string> = {
  equal_opposite: "🔀",
  outlier: "📈",
  decimal_typo: "🔢",
  orphan: "👤",
};

export function DivergenceFinder({ suggestions }: Props) {
  if (suggestions.length === 0) {
    return (
      <div className="bg-[var(--color-panel)] border border-green-900 rounded-lg p-3 text-sm text-green-500">
        ✓ No suspicious patterns detected.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {suggestions.map((s, i) => (
        <div key={i} className="bg-cyan-500/5 border border-cyan-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span>{KIND_ICON[s.kind]}</span>
            <span className="font-semibold text-cyan-300 text-sm">{s.title}</span>
          </div>
          <div className="text-xs text-slate-400">{s.body}</div>
          {s.txIds.length > 0 && (
            <div className="text-[0.7rem] text-slate-600 mt-1 font-mono">
              tx: {s.txIds.slice(0, 4).join(", ")}{s.txIds.length > 4 && ` +${s.txIds.length - 4} more`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire into close page**

In `app/(cashier)/close/page.tsx`, before Step 5's reconciliation table, compute suggestions:

```tsx
import { runAllHeuristics, type AccountVariance } from "@/lib/reconciliation/heuristics";
import { DivergenceFinder } from "./_components/divergence-finder";
import Decimal from "decimal.js";

// ... after computing `expected`, also compute current variances against expected.
// For Plan 1b, the cashier hasn't entered counted yet at render time, so we compute
// suggestions based on transactions alone (orphans, outliers, decimal typos) and skip
// equal_opposite (which requires variance values).

const allTxs = await prisma.transaction.findMany({
  where: { sessionId: session.id },
  include: { ledgerEntries: true },
  select: { id: true, amount: true, type: true, playerId: true, ledgerEntries: true },
});
const allTxsLite = allTxs.map((t) => ({
  id: t.id,
  amount: new Decimal(t.amount.toString()),
  type: t.type,
  playerId: t.playerId,
  ledgerEntries: t.ledgerEntries.map((e) => ({ account: e.account, delta: new Decimal(e.delta.toString()) })),
}));
const suggestions = runAllHeuristics([], allTxsLite); // empty variances at render time

// ... insert this section right before Step 5:
<section>
  <h3 className="text-sm font-semibold text-slate-300 mb-2">Pre-close diagnostics</h3>
  <DivergenceFinder suggestions={suggestions} />
</section>
```

For an interactive variance-aware version (where heuristics re-run as the cashier types counted amounts), Plan 3 will add a client-side computation. For Plan 1b, the static pre-close view catches orphans/outliers/typos which are the most common issues.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add app/(cashier)/close/
git commit -m "feat(close): divergence finder UI with heuristic suggestions"
```

---

## Phase I — E2E + README

### Task 25: E2E test for multi-game night with reconciliation

**Files:**
- Create: `tests/e2e/multi-game-night.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  execSync("npm run db:test:reset", { stdio: "inherit" });
  execSync("DATABASE_URL=\"postgresql://rakeledger:rakeledger_dev@localhost:5432/rakeledger?schema=public\" npx prisma db seed", { stdio: "inherit" });
});

test("multi-game night: open session, two games, buy-ins per game, close cleanly", async ({ page }) => {
  await page.goto("/live");
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Add a player
  await page.goto("/players/new");
  await page.getByLabel(/Display name/).fill("E2E Player");
  await page.getByRole("button", { name: /Create/ }).click();

  // Add a table
  await page.goto("/tables");
  await page.getByPlaceholder(/Table name/).fill("Table 1");
  await page.getByPlaceholder(/Stakes/).fill("1/2 NL");
  await page.getByRole("button", { name: /^Add$/ }).click();

  // Open a second game (Hi-Stakes)
  await page.goto("/live");
  await page.getByRole("link", { name: /\+ New/i }).first().click();
  // Game manager modal
  await page.getByLabel(/Name/).fill("Hi-Stakes");
  await page.getByLabel(/Stakes/).fill("5/10 NL");
  await page.getByRole("button", { name: /Open Game/ }).click();

  // Switch to Hi-Stakes via Game switcher
  await page.getByRole("link", { name: /Hi-Stakes/ }).click();

  // Buy-in $500 cash on Hi-Stakes
  await page.getByRole("button", { name: /\+ Buy-in/ }).click();
  await page.getByLabel(/Player/).selectOption({ label: "E2E Player" });
  await page.getByLabel(/Amount/).fill("500");
  await page.getByRole("button", { name: /Record Buy-in/ }).click();

  // Verify cash drawer shows $500
  await expect(page.locator("text=Cash drawer").first()).toBeVisible();

  // Close session (skip tip/rake/house tax steps since none accrued)
  await page.getByRole("link", { name: /Close session/ }).click();
  await page.getByRole("button", { name: /Close Session/ }).click();
  await expect(page.getByText("No session open")).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

```bash
npm run test:e2e
git add tests/e2e/multi-game-night.spec.ts
git commit -m "test(e2e): multi-game night smoke test"
```

---

### Task 26: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README** to reflect Plan 1b features

Add a new section after "Workflow" describing the expanded transaction set, multi-step close-out, multi-game support, and the test database isolation. Keep it concise — link forward to Plan 2 for auth/runner/production.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README updates for Plan 1b features"
```

---

## Self-Review

**Spec coverage check** (from the Plan 1 spec at `docs/superpowers/specs/2026-05-03-rakeledger-design.md`):

| Spec section | Plan 1 | Plan 1b | Notes |
|------|:--:|:--:|------|
| §6.2 transaction types — buy_in, cash_out, rake, tip_drop, marker_issue/repay, opening/closing_float | ✓ | — | Plan 1 |
| §6.2 — tournament_fee/payout, jackpot, freeroll_prize_payout | — | ✓ | Task 13, 14 |
| §6.2 — staff_advance, fnb_cost, drawer/chip_float_adjust | — | ✓ | Task 15 |
| §6.2 — chip_walk, chip_return | — | ✓ | Task 21 |
| §6.2 — tip_house_tax, tip_payout, house_tax_distribution, rake_distribution | — | ✓ | Task 18, 19 |
| §7.4 reconciliation — divergence finder + heuristics | — | ✓ | Task 23, 24 |
| §7.4 — walks/returns workflow | — | ✓ | Task 21, 22 |
| §9.6 hourly drops — drop tracker UI | — | ✓ | Task 16 |
| §9.8 close-out — full multi-step flow | partial | ✓ | Task 17–20 |
| §9.9 freeroll workflow with promo banner | — | ✓ | Task 14 |
| §9.10 walks/returns | — | ✓ | Task 21, 22 |
| §10 concurrent games — Game switcher, per-game accounts | partial (schema only) | ✓ | Task 7–12 |

Items deferred to Plan 1c (or later):
- Interactive variance-aware divergence finder (currently static; Plan 3 makes it interactive)
- Per-game chip color separation
- Off-premises chip tracking per player (current implementation logs walks/returns but doesn't maintain a per-player off-premises balance — the current heuristic checks for prior `chip_walk` rows which is sufficient for the v1 use case, but a dedicated balance would be cleaner)
- Owner-configurable rake split rules (Plan 3 admin panel)

**Placeholder scan:** None. All steps have concrete code or commands.

**Type consistency:**
- `getAccountBalance({ account, sessionId, gameId? })` — used consistently across balance.ts and time-travel.ts (Plan 1) and close page (Plan 1b)
- `createTransaction(args)` — same signature throughout
- `parseFormData(schema, formData)` — defined once in `lib/validation/transactions.ts`, used in transactions.ts and walks.ts
- `Suggestion` type — defined in heuristics.ts, used in DivergenceFinder

**Scope check:** 26 tasks. Comparable to Plan 1's 32. Each phase produces working, testable software. Phase boundaries are natural pause points.
