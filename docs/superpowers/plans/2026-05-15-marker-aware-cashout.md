# Marker-Aware Cash-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cash-out modal shows an itemized receipt of the true payout after deducting a player's outstanding markers, with a 3-way scope selector, and persists the cash-out as a `CASH_OUT` plus per-marker `MARKER_REPAY` transactions atomically.

**Architecture:** A pure allocator function (`lib/payouts/marker-allocation.ts`) computes payout + FIFO repayments from a chip value and a list of open markers. It is shared by the client (live receipt display) and the server (authoritative recompute on submit). The server action re-fetches markers club-scoped and never trusts client-sent marker amounts. The "difference" cash-out decomposes into one full-chip-value `CASH_OUT` + N `MARKER_REPAY` txs on the same payment method, all inside one `prisma.$transaction`.

**Tech Stack:** Next.js 16 (server actions, client components), React 19, Prisma 6 + Postgres, decimal.js, Zod, Vitest.

> **Next.js note:** This repo runs a non-standard Next.js. Before editing any `.tsx`/server-action file, skim the relevant guide under `node_modules/next/dist/docs/` and heed deprecation notices (per `AGENTS.md`).

---

## File Structure

| File | Responsibility | Action |
| ---- | -------------- | ------ |
| `lib/payouts/marker-allocation.ts` | Pure FIFO allocator: `(chipValue, markers[]) → { payout, repayments, stillOpen }`. No DB, no I/O. | Create |
| `tests/unit/payouts/marker-allocation.test.ts` | Unit tests for the allocator (all math/edge cases). | Create |
| `lib/validation/transactions.ts` | Add `markerScope` to `cashOutSchema`. | Modify |
| `app/(cashier)/_actions/transactions.ts` | Add `getOpenMarkersForPlayer`; make `recordCashOut` marker-aware via shared allocator. | Modify |
| `tests/unit/ledger/cashout-markers.test.ts` | Integration tests: marker-aware `recordCashOut` ledger shape, marker status, atomicity, club scoping. | Create |
| `app/(cashier)/live/_components/tx-cashout-modal-client.tsx` | Scope selector, fetch markers on player select, itemized receipt, dynamic submit label. | Modify |

---

## Task 1: Pure marker allocator

**Files:**
- Create: `lib/payouts/marker-allocation.ts`
- Test: `tests/unit/payouts/marker-allocation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/payouts/marker-allocation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  allocateMarkerRepayments,
  type AllocatableMarker,
} from "@/lib/payouts/marker-allocation";

const m = (id: string, remaining: number): AllocatableMarker => ({
  id,
  remaining: new Decimal(remaining),
});

describe("allocateMarkerRepayments", () => {
  it("X > M: full payout of difference, all markers fully repaid", () => {
    const r = allocateMarkerRepayments(new Decimal(500), [m("a", 100), m("b", 50)]);
    expect(r.payout.toString()).toBe("350");
    expect(r.repayments).toEqual([
      { markerId: "a", amount: new Decimal(100) },
      { markerId: "b", amount: new Decimal(50) },
    ]);
    expect(r.stillOpen).toEqual([]);
  });

  it("X = M exactly: zero payout, all repaid, nothing still open", () => {
    const r = allocateMarkerRepayments(new Decimal(150), [m("a", 100), m("b", 50)]);
    expect(r.payout.toString()).toBe("0");
    expect(r.repayments).toEqual([
      { markerId: "a", amount: new Decimal(100) },
      { markerId: "b", amount: new Decimal(50) },
    ]);
    expect(r.stillOpen).toEqual([]);
  });

  it("X < M single marker: zero payout, partial repayment, remainder still open", () => {
    const r = allocateMarkerRepayments(new Decimal(60), [m("a", 100)]);
    expect(r.payout.toString()).toBe("0");
    expect(r.repayments).toEqual([{ markerId: "a", amount: new Decimal(60) }]);
    expect(r.stillOpen).toEqual([{ markerId: "a", remaining: new Decimal(40) }]);
  });

  it("X < M multi marker: FIFO oldest fully repaid, next partial, rest untouched", () => {
    const r = allocateMarkerRepayments(new Decimal(120), [
      m("a", 100),
      m("b", 50),
      m("c", 30),
    ]);
    expect(r.payout.toString()).toBe("0");
    expect(r.repayments).toEqual([
      { markerId: "a", amount: new Decimal(100) },
      { markerId: "b", amount: new Decimal(20) },
    ]);
    expect(r.stillOpen).toEqual([
      { markerId: "b", remaining: new Decimal(30) },
      { markerId: "c", remaining: new Decimal(30) },
    ]);
  });

  it("no markers: payout is the full chip value, no repayments", () => {
    const r = allocateMarkerRepayments(new Decimal(500), []);
    expect(r.payout.toString()).toBe("500");
    expect(r.repayments).toEqual([]);
    expect(r.stillOpen).toEqual([]);
  });

  it("skips zero-remaining markers without emitting empty repayments", () => {
    const r = allocateMarkerRepayments(new Decimal(500), [m("a", 0), m("b", 100)]);
    expect(r.repayments).toEqual([{ markerId: "b", amount: new Decimal(100) }]);
    expect(r.stillOpen).toEqual([]);
    expect(r.payout.toString()).toBe("400");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payouts/marker-allocation.test.ts`
Expected: FAIL — `Cannot find module '@/lib/payouts/marker-allocation'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/payouts/marker-allocation.ts`:

```ts
import Decimal from "decimal.js";

/** A marker eligible for repayment, reduced to its outstanding balance. */
export interface AllocatableMarker {
  id: string;
  /** amount − repaidAmount; always ≥ 0. */
  remaining: Decimal;
}

export interface MarkerRepayment {
  markerId: string;
  /** Amount to repay against this marker; always > 0. */
  amount: Decimal;
}

export interface MarkerAllocationResult {
  /** chipValue − Σ repayments, floored at 0. */
  payout: Decimal;
  /** One entry per marker that receives a non-zero repayment, in input order. */
  repayments: MarkerRepayment[];
  /** Markers with a positive balance left after allocation, in input order. */
  stillOpen: { markerId: string; remaining: Decimal }[];
}

/**
 * Allocates a player's surrendered chip value against their open markers,
 * oldest-first (FIFO). The caller is responsible for passing `markers`
 * already ordered oldest-first and scoped to the desired set (all open vs.
 * current session only). Pass `[]` to model the "no deduction" case.
 *
 * Pure: no I/O, no Decimal global mutation. Used by both the cash-out modal
 * (display) and the server action (authoritative recompute).
 */
export function allocateMarkerRepayments(
  chipValue: Decimal,
  markers: AllocatableMarker[]
): MarkerAllocationResult {
  let cashLeft = chipValue;
  const repayments: MarkerRepayment[] = [];
  const stillOpen: { markerId: string; remaining: Decimal }[] = [];

  for (const marker of markers) {
    const apply = Decimal.min(cashLeft, marker.remaining);
    if (apply.greaterThan(0)) {
      repayments.push({ markerId: marker.id, amount: apply });
      cashLeft = cashLeft.sub(apply);
    }
    const leftover = marker.remaining.sub(apply);
    if (leftover.greaterThan(0)) {
      stillOpen.push({ markerId: marker.id, remaining: leftover });
    }
  }

  return { payout: cashLeft, repayments, stillOpen };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payouts/marker-allocation.test.ts`
Expected: PASS — 6/6.

- [ ] **Step 5: Commit**

```bash
git add lib/payouts/marker-allocation.ts tests/unit/payouts/marker-allocation.test.ts
git commit -m "feat: add pure FIFO marker repayment allocator"
```

---

## Task 2: Add `markerScope` to the cash-out schema

**Files:**
- Modify: `lib/validation/transactions.ts:22-29`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/payouts/cashout-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cashOutSchema } from "@/lib/validation/transactions";

describe("cashOutSchema markerScope", () => {
  const base = { sessionId: "s", gameId: "g", playerId: "p", method: "CASH", amount: "100" };

  it("defaults markerScope to NONE when absent (back-compat)", () => {
    const parsed = cashOutSchema.parse(base);
    expect(parsed.markerScope).toBe("NONE");
  });

  it("accepts ALL and TONIGHT", () => {
    expect(cashOutSchema.parse({ ...base, markerScope: "ALL" }).markerScope).toBe("ALL");
    expect(cashOutSchema.parse({ ...base, markerScope: "TONIGHT" }).markerScope).toBe("TONIGHT");
  });

  it("rejects an unknown scope", () => {
    expect(() => cashOutSchema.parse({ ...base, markerScope: "SOME" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/payouts/cashout-schema.test.ts`
Expected: FAIL — `markerScope` is `undefined` (not `"NONE"`).

- [ ] **Step 3: Write minimal implementation**

In `lib/validation/transactions.ts`, replace the `cashOutSchema` block (currently lines 22-29):

```ts
export const cashOutSchema = z.object({
  sessionId: z.string().min(1),
  gameId: z.string().min(1),
  playerId: z.string().min(1),
  method: methodEnum,
  tableId: optionalId,
  amount: decimalString,
  // Marker deduction scope. Default NONE keeps every existing caller/test
  // (and the no-deduction UI option) on today's single-CASH_OUT behavior.
  markerScope: z.enum(["ALL", "TONIGHT", "NONE"]).default("NONE"),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/payouts/cashout-schema.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add lib/validation/transactions.ts tests/unit/payouts/cashout-schema.test.ts
git commit -m "feat: add markerScope (ALL/TONIGHT/NONE) to cashOutSchema"
```

---

## Task 3: `getOpenMarkersForPlayer` server action

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts` (add export + import)
- Test: `tests/unit/ledger/cashout-markers.test.ts` (create; first `describe` block)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger/cashout-markers.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  issueMarker,
  getOpenMarkersForPlayer,
} from "@/app/(cashier)/_actions/transactions";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.append(k, v);
  return f;
}

async function seed() {
  // resetDatabase creates club "test-club" + user "test-cashier" (OWNER).
  process.env.TEST_USER_EMAIL = "test-cashier@dev";
  const session = await testPrisma.session.create({
    data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0" },
  });
  const game = await testPrisma.game.create({
    data: { sessionId: session.id, name: "Default", rakeSplitConfig: {} },
  });
  const player = await testPrisma.player.create({
    data: { displayName: "P", clubId: "test-club" },
  });
  return { sessionId: session.id, gameId: game.id, playerId: player.id };
}

describe("getOpenMarkersForPlayer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns OPEN markers oldest-first with serializable fields and isCurrentSession flag", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "50" }));

    const markers = await getOpenMarkersForPlayer(playerId, sessionId);
    expect(markers).toHaveLength(2);
    expect(markers[0].amount).toBe("100");
    expect(markers[0].remaining).toBe("100");
    expect(markers[0].isCurrentSession).toBe(true);
    expect(typeof markers[0].issuedAt).toBe("string");
    // Oldest first.
    expect(new Date(markers[0].issuedAt).getTime())
      .toBeLessThanOrEqual(new Date(markers[1].issuedAt).getTime());
  });

  it("excludes markers from other clubs", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));

    await testPrisma.club.create({ data: { id: "other-club", name: "Other", slug: "other" } });
    const otherPlayer = await testPrisma.player.create({
      data: { displayName: "OP", clubId: "other-club" },
    });
    await testPrisma.marker.create({
      data: {
        playerId: otherPlayer.id,
        sessionId,
        issuedTxId: (await testPrisma.transaction.create({
          data: {
            sessionId, type: "MARKER_ISSUE", createdById: "test-cashier",
            amount: "999", method: "CHIPS", playerId: otherPlayer.id,
            ledgerEntries: { create: [
              { account: "MARKER_OUTSTANDING", delta: "999" },
              { account: "CHIP_FLOAT", delta: "999" },
            ] },
          },
        })).id,
        amount: "999", status: "OPEN", clubId: "other-club",
      },
    });

    const markers = await getOpenMarkersForPlayer(playerId, sessionId);
    expect(markers).toHaveLength(1);
    expect(markers[0].amount).toBe("100");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger/cashout-markers.test.ts -t "getOpenMarkersForPlayer"`
Expected: FAIL — `getOpenMarkersForPlayer` is not exported.

> If the run errors with `Can't reach database server at localhost:5432`, start local Postgres first (this repo's DB-backed tests require it), then re-run.

- [ ] **Step 3: Write minimal implementation**

In `app/(cashier)/_actions/transactions.ts`, add to the existing import from `@/lib/active-user` (currently there is no such import — add this line near the top imports, after the `getCashierUserId` import on line 15):

```ts
import { getActiveClubId } from "@/lib/active-user";
```

Then add this exported function (place it directly after `repayMarker`, i.e. after line 217):

```ts
export interface OpenMarkerDTO {
  id: string;
  amount: string;
  repaidAmount: string;
  remaining: string;
  sessionId: string;
  issuedAt: string;
  isCurrentSession: boolean;
}

/**
 * Returns the player's OPEN markers, club-scoped, oldest-first. All Decimal
 * fields are stringified so the result is safe to return to a client
 * component. `isCurrentSession` lets the modal filter "tonight only" with no
 * second round-trip.
 */
export async function getOpenMarkersForPlayer(
  playerId: string,
  currentSessionId: string
): Promise<OpenMarkerDTO[]> {
  const clubId = await getActiveClubId();
  const markers = await prisma.marker.findMany({
    where: { playerId, status: "OPEN", clubId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amount: true,
      repaidAmount: true,
      sessionId: true,
      createdAt: true,
    },
  });
  return markers.map((mk) => {
    const remaining = new Decimal(mk.amount.toString()).sub(mk.repaidAmount.toString());
    return {
      id: mk.id,
      amount: mk.amount.toString(),
      repaidAmount: mk.repaidAmount.toString(),
      remaining: remaining.toString(),
      sessionId: mk.sessionId,
      issuedAt: mk.createdAt.toISOString(),
      isCurrentSession: mk.sessionId === currentSessionId,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ledger/cashout-markers.test.ts -t "getOpenMarkersForPlayer"`
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add app/\(cashier\)/_actions/transactions.ts tests/unit/ledger/cashout-markers.test.ts
git commit -m "feat: add getOpenMarkersForPlayer club-scoped server action"
```

---

## Task 4: Make `recordCashOut` marker-aware

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts:61-85` (the `recordCashOut` function) + add internal helper
- Test: `tests/unit/ledger/cashout-markers.test.ts` (add a second `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/ledger/cashout-markers.test.ts` (add the import and a new `describe`; keep the existing file content above it):

```ts
import { recordCashOut } from "@/app/(cashier)/_actions/transactions";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("recordCashOut marker-aware", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("NONE scope (default): single CASH_OUT, markers untouched", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));
    await recordCashOut(fd({ sessionId, gameId, playerId, method: "CASH", amount: "500" }));

    const txs = await testPrisma.transaction.findMany({ where: { sessionId } });
    expect(txs.filter((t) => t.type === "CASH_OUT")).toHaveLength(1);
    expect(txs.filter((t) => t.type === "MARKER_REPAY")).toHaveLength(0);
    const marker = await testPrisma.marker.findFirst({ where: { playerId } });
    expect(marker?.status).toBe("OPEN");
    // CASH_DRAWER: +500 (issue chip side doesn't touch drawer) -500 (cashout) = -500
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("-500");
  });

  it("ALL scope, X > M: full CASH_OUT + MARKER_REPAY, marker REPAID, net = -(X-M)", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" }));
    await recordCashOut(
      fd({ sessionId, gameId, playerId, method: "CASH", amount: "500", markerScope: "ALL" })
    );

    const txs = await testPrisma.transaction.findMany({ where: { sessionId } });
    expect(txs.filter((t) => t.type === "CASH_OUT")).toHaveLength(1);
    expect(txs.filter((t) => t.type === "MARKER_REPAY")).toHaveLength(1);
    const marker = await testPrisma.marker.findFirst({ where: { playerId } });
    expect(marker?.status).toBe("REPAID");
    expect(marker?.repaidAmount.toString()).toBe("100");
    // CASH_DRAWER: -500 (cashout) +100 (repay) = -400 = -(500-100)
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("-400");
  });

  it("ALL scope, X < M multi marker: payout 0, FIFO partial, oldest REPAID, net 0", async () => {
    const { sessionId, gameId, playerId } = await seed();
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "100" })); // oldest
    await issueMarker(fd({ sessionId, gameId, playerId, amount: "50" }));
    await recordCashOut(
      fd({ sessionId, gameId, playerId, method: "CASH", amount: "120", markerScope: "ALL" })
    );

    const markers = await testPrisma.marker.findMany({
      where: { playerId }, orderBy: { createdAt: "asc" },
    });
    expect(markers[0].status).toBe("REPAID");
    expect(markers[0].repaidAmount.toString()).toBe("100");
    expect(markers[1].status).toBe("OPEN");
    expect(markers[1].repaidAmount.toString()).toBe("20");
    // CASH_DRAWER: -120 (cashout) +100 +20 (repays) = 0  (zero net payout)
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("0");
  });

  it("TONIGHT scope ignores prior-session markers", async () => {
    const { sessionId, gameId, playerId } = await seed();
    // Marker from a *different* (prior) session.
    const oldSession = await testPrisma.session.create({
      data: { clubId: "test-club", openedById: "test-cashier", openingCash: "0" },
    });
    const oldGame = await testPrisma.game.create({
      data: { sessionId: oldSession.id, name: "Old", rakeSplitConfig: {} },
    });
    await issueMarker(fd({ sessionId: oldSession.id, gameId: oldGame.id, playerId, amount: "100" }));

    await recordCashOut(
      fd({ sessionId, gameId, playerId, method: "CASH", amount: "500", markerScope: "TONIGHT" })
    );

    const txs = await testPrisma.transaction.findMany({ where: { sessionId } });
    expect(txs.filter((t) => t.type === "MARKER_REPAY")).toHaveLength(0);
    const oldMarker = await testPrisma.marker.findFirst({ where: { sessionId: oldSession.id } });
    expect(oldMarker?.status).toBe("OPEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ledger/cashout-markers.test.ts -t "recordCashOut marker-aware"`
Expected: FAIL — the `ALL`/`TONIGHT` tests fail (no `MARKER_REPAY` produced, balances wrong). The `NONE` test may already pass.

- [ ] **Step 3: Write minimal implementation**

In `app/(cashier)/_actions/transactions.ts`:

(a) Add these imports. `Prisma` joins the existing `@prisma/client` import (currently `import type { PaymentMethod } from "@prisma/client";` on line 7 — replace that line):

```ts
import type { PaymentMethod, Prisma } from "@prisma/client";
import { allocateMarkerRepayments } from "@/lib/payouts/marker-allocation";
```

(b) Add this internal helper (place it just above `recordCashOut`, before line 61). It repays one marker on a supplied transaction client, mirroring `repayMarker`'s status/overpayment logic:

```ts
/**
 * Repays a single marker inside an existing DB transaction. Mirrors the
 * status/overpayment logic of `repayMarker`. Used by the marker-aware
 * cash-out path so the CASH_OUT and all MARKER_REPAYs commit atomically.
 */
async function repayMarkerInTx(
  txc: Prisma.TransactionClient,
  args: {
    marker: { id: string; amount: string; repaidAmount: string; playerId: string };
    amount: Decimal;
    method: PaymentMethod;
    sessionId: string;
    gameId: string;
    cashierId: string;
  }
): Promise<void> {
  const remaining = new Decimal(args.marker.amount).sub(args.marker.repaidAmount);
  if (args.amount.greaterThan(remaining)) {
    throw new Error(
      `Repayment ${args.amount.toString()} exceeds remaining marker balance ${remaining.toString()}`
    );
  }
  const targetAccount = METHOD_TO_ACCOUNT[args.method];
  await createTransaction(
    {
      sessionId: args.sessionId,
      gameId: args.gameId,
      type: "MARKER_REPAY",
      createdById: args.cashierId,
      amount: args.amount,
      method: args.method,
      playerId: args.marker.playerId,
      entries: [
        { account: targetAccount, delta: args.amount },
        { account: "MARKER_OUTSTANDING", delta: args.amount.neg() },
      ],
    },
    txc
  );
  const newRepaid = new Decimal(args.marker.repaidAmount).add(args.amount);
  const newStatus = newRepaid.greaterThanOrEqualTo(args.marker.amount) ? "REPAID" : "OPEN";
  await txc.marker.update({
    where: { id: args.marker.id },
    data: { repaidAmount: newRepaid.toString(), status: newStatus },
  });
}
```

(c) Replace the entire `recordCashOut` function (currently lines 61-85) with:

```ts
export async function recordCashOut(formData: FormData): Promise<void> {
  const input = parseFormData(cashOutSchema, formData);
  await ensureSessionOpen(input.sessionId);

  const cashierId = await getCashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[input.method as PaymentMethod];
  const amount = new Decimal(input.amount);
  const method = input.method as PaymentMethod;

  // No marker deduction → unchanged single-CASH_OUT behavior.
  if (input.markerScope === "NONE") {
    await createTransaction({
      sessionId: input.sessionId,
      gameId: input.gameId,
      type: "CASH_OUT",
      createdById: cashierId,
      amount,
      method,
      playerId: input.playerId,
      tableId: input.tableId ?? null,
      entries: [
        { account: targetAccount, delta: amount.neg() },
        { account: "CHIP_FLOAT", delta: amount.neg() },
      ],
    });
    revalidatePath("/live");
    return;
  }

  // Marker-aware path. Re-fetch markers server-side (never trust the client)
  // club-scoped, oldest-first, filtered to the requested scope.
  const clubId = await getActiveClubId();
  const allOpen = await prisma.marker.findMany({
    where: { playerId: input.playerId, status: "OPEN", clubId },
    orderBy: { createdAt: "asc" },
    select: { id: true, amount: true, repaidAmount: true, sessionId: true, playerId: true },
  });
  const inScope =
    input.markerScope === "TONIGHT"
      ? allOpen.filter((mk) => mk.sessionId === input.sessionId)
      : allOpen;

  const allocation = allocateMarkerRepayments(
    amount,
    inScope.map((mk) => ({
      id: mk.id,
      remaining: new Decimal(mk.amount.toString()).sub(mk.repaidAmount.toString()),
    }))
  );
  const markerById = new Map(inScope.map((mk) => [mk.id, mk]));

  await prisma.$transaction(async (txc) => {
    // Full chip value leaves the cage; the repays below claw the debt back
    // into the same payment account, netting to the true payout.
    await createTransaction(
      {
        sessionId: input.sessionId,
        gameId: input.gameId,
        type: "CASH_OUT",
        createdById: cashierId,
        amount,
        method,
        playerId: input.playerId,
        tableId: input.tableId ?? null,
        entries: [
          { account: targetAccount, delta: amount.neg() },
          { account: "CHIP_FLOAT", delta: amount.neg() },
        ],
      },
      txc
    );

    for (const repayment of allocation.repayments) {
      const mk = markerById.get(repayment.markerId)!;
      await repayMarkerInTx(txc, {
        marker: {
          id: mk.id,
          amount: mk.amount.toString(),
          repaidAmount: mk.repaidAmount.toString(),
          playerId: mk.playerId,
        },
        amount: repayment.amount,
        method,
        sessionId: input.sessionId,
        gameId: input.gameId,
        cashierId,
      });
    }
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ledger/cashout-markers.test.ts`
Expected: PASS — all `getOpenMarkersForPlayer` and `recordCashOut marker-aware` cases (6 total).

Then run the existing cash-out / ledger suite to confirm no regression (default `NONE` keeps old behavior):

Run: `npx vitest run tests/unit/ledger`
Expected: PASS — no regressions.

- [ ] **Step 5: Commit**

```bash
git add app/\(cashier\)/_actions/transactions.ts tests/unit/ledger/cashout-markers.test.ts
git commit -m "feat: marker-aware recordCashOut (CASH_OUT + FIFO MARKER_REPAY, atomic)"
```

---

## Task 5: Cash-out modal — scope selector, live receipt, dynamic submit

**Files:**
- Modify: `app/(cashier)/live/_components/tx-cashout-modal-client.tsx` (full rewrite of `CashOutForm`)

There is no client-component test harness in this repo (tests are Vitest unit + Playwright e2e), and the receipt math is already covered by the Task 1 allocator unit tests (the modal imports the same pure function). This task is verified by typecheck + production build + manual smoke.

- [ ] **Step 1: Rewrite the modal client**

Replace the entire contents of `app/(cashier)/live/_components/tx-cashout-modal-client.tsx` with:

```tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Decimal from "decimal.js";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { useDenominationMode } from "@/components/use-denomination-mode";
import {
  recordCashOut,
  getOpenMarkersForPlayer,
  type OpenMarkerDTO,
} from "../../_actions/transactions";
import { allocateMarkerRepayments } from "@/lib/payouts/marker-allocation";

interface CashOutModalClientProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
}

const DENOMS = [
  { name: "n100", label: "$100", unit: 100 },
  { name: "n25", label: "$25", unit: 25 },
  { name: "n5", label: "$5", unit: 5 },
  { name: "n1", label: "$1", unit: 1 },
] as const;

type Scope = "ALL" | "TONIGHT" | "NONE";

function markerLabel(mk: OpenMarkerDTO): string {
  if (mk.isCurrentSession) return "Marker (tonight)";
  const d = new Date(mk.issuedAt);
  return `Marker (${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
}

function CashOutForm({ close, sessionId, gameId, players }: FormProps) {
  const toast = useToast();
  const [denominationMode] = useDenominationMode();
  const [counts, setCounts] = useState<Record<string, number>>({ n100: 0, n25: 0, n5: 0, n1: 0 });
  const [singleAmount, setSingleAmount] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [scope, setScope] = useState<Scope>("ALL");
  const [markers, setMarkers] = useState<OpenMarkerDTO[]>([]);

  const denomTotal = DENOMS.reduce((sum, d) => sum + (counts[d.name] || 0) * d.unit, 0);
  const chipValueNum = denominationMode ? denomTotal : parseFloat(singleAmount) || 0;

  const { onSubmit, pending, error } = useFormAction(recordCashOut, {
    onSuccess: (fd) => {
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Cash-out $${fd.get("amount")} recorded for ${playerName}`);
      close();
    },
  });

  // Re-fetch markers only when the selected player changes.
  useEffect(() => {
    if (!playerId) {
      setMarkers([]);
      return;
    }
    let cancelled = false;
    getOpenMarkersForPlayer(playerId, sessionId).then((m) => {
      if (!cancelled) setMarkers(m);
    });
    return () => {
      cancelled = true;
    };
  }, [playerId, sessionId]);

  if (players.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-400">
          No players have been added yet. Cash-outs are recorded against a player.
        </p>
        <Link
          href="/players/new"
          onClick={close}
          className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 text-center"
        >
          Add a player
        </Link>
      </div>
    );
  }

  const inScopeMarkers =
    scope === "NONE"
      ? []
      : scope === "TONIGHT"
        ? markers.filter((m) => m.isCurrentSession)
        : markers;

  const allocation = allocateMarkerRepayments(
    new Decimal(chipValueNum),
    inScopeMarkers.map((m) => ({ id: m.id, remaining: new Decimal(m.remaining) }))
  );
  const markerById = new Map(markers.map((m) => [m.id, m]));
  const repaidById = new Map(allocation.repayments.map((r) => [r.markerId, r.amount]));
  const stillOpenById = new Map(allocation.stillOpen.map((s) => [s.markerId, s.remaining]));
  const payoutStr = allocation.payout.toFixed(2);
  const hasDeduction = scope !== "NONE" && inScopeMarkers.length > 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="markerScope" value={scope} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select
          name="playerId"
          required
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2"
        >
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>

      {denominationMode ? (
        <>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Chip count</div>
          <div className="grid grid-cols-4 gap-2">
            {DENOMS.map((d) => (
              <label key={d.name} className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">{d.label}</span>
                <input
                  type="number"
                  min="0"
                  value={counts[d.name]}
                  onChange={(e) => setCounts((prev) => ({ ...prev, [d.name]: parseInt(e.target.value, 10) || 0 }))}
                  className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5 font-mono text-center"
                />
              </label>
            ))}
          </div>
          <input type="hidden" name="amount" value={denomTotal.toFixed(2)} />
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Total amount</span>
          <input
            type="number"
            name="amount"
            step="0.01"
            min="0.01"
            required
            value={singleAmount}
            onChange={(e) => setSingleAmount(e.target.value)}
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Payout method</span>
        <select name="method" required defaultValue="CASH"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="CASH">Cash</option>
          <option value="ZELLE">Zelle</option>
          <option value="VENMO">Venmo</option>
          <option value="CASHAPP">CashApp</option>
          <option value="APPLE_PAY">Apple Pay</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Marker deduction</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2"
        >
          <option value="ALL">All open markers</option>
          <option value="TONIGHT">Tonight&apos;s markers only</option>
          <option value="NONE">None</option>
        </select>
      </label>

      <div className="bg-amber-500/10 border border-amber-500/40 rounded p-3 text-sm font-mono">
        <div className="flex justify-between">
          <span className="text-slate-300">Chips turned in</span>
          <span className="text-amber-300">${chipValueNum.toFixed(2)}</span>
        </div>
        {hasDeduction &&
          inScopeMarkers.map((m) => {
            const applied = repaidById.get(m.id);
            const leftover = stillOpenById.get(m.id);
            return (
              <div key={m.id} className="mt-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">─ {markerLabel(markerById.get(m.id) ?? m)}</span>
                  <span className="text-red-400">
                    −${(applied ?? new Decimal(0)).toFixed(2)}
                  </span>
                </div>
                {leftover && (
                  <div className="text-[10px] text-slate-500 pl-3">
                    ${leftover.toFixed(2)} still open
                  </div>
                )}
              </div>
            );
          })}
        <div className="border-t border-amber-500/30 mt-2 pt-2 flex justify-between">
          <span className="text-amber-400 uppercase tracking-wide text-xs">Payout to player</span>
          <span className="text-2xl font-semibold text-amber-300">${payoutStr}</span>
        </div>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={pending || chipValueNum <= 0}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50"
      >
        {allocation.payout.greaterThan(0) ? `Pay out $${payoutStr}` : "Record (no payout)"}
      </button>
    </form>
  );
}

export function CashOutModalClient({ trigger, ...rest }: CashOutModalClientProps) {
  return (
    <Modal trigger={trigger} title="− Cash-out" description="Record chips returned to the cage." wide>
      {(close) => <CashOutForm close={close} {...rest} />}
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds (no type/lint failures in the cashier route).

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev`, open the Live page, open the Cash-out modal. Verify:
1. Select a player with no markers → receipt shows only "Chips turned in" and "Payout to player" equal to the entered amount; button reads `Pay out $X`.
2. Issue a marker for a player (Marker modal), reopen Cash-out, select that player → "All open markers" (default) shows an itemized `─ Marker (...) −$Y` line; payout = X − Y.
3. Enter an amount less than the marker total → payout shows `$0.00`, partial marker shows `... still open`, button reads `Record (no payout)`.
4. Switch the selector to `None` → deduction lines disappear, payout = full chip value.
5. Submit option 2 above → toast fires; in the DB/activity the marker is `REPAID` and a `MARKER_REPAY` exists alongside the `CASH_OUT`.

- [ ] **Step 5: Commit**

```bash
git add app/\(cashier\)/live/_components/tx-cashout-modal-client.tsx
git commit -m "feat: marker-aware cash-out modal with scope selector and itemized receipt"
```

---

## Final Verification

- [ ] Run the full unit suite: `npm test` — Expected: PASS (DB-backed tests require local Postgres running).
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm run build` succeeds.
- [ ] Dispatch a final code reviewer over the whole diff, then use `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- 3-way scope selector (ALL default / TONIGHT / NONE) → Task 2 (schema) + Task 5 (UI select, ALL default).
- Live itemized receipt, recomputes on player/amount/scope change → Task 5 (shared allocator, `useEffect` re-fetch only on player change).
- FIFO oldest-first, X≥M full repay, X<M payout $0 + partial → Task 1 allocator + Task 4 server, covered by tests.
- Same-payment-method repay, atomic CASH_OUT + N MARKER_REPAY → Task 4 (`method` reused, single `prisma.$transaction`).
- Only OPEN markers, club-scoped → Task 3/4 (`status: "OPEN", clubId`), tested by the cross-club case.
- "Tonight only" filter without extra round-trip → `isCurrentSession` flag (Task 3), client filter (Task 5), server filter (Task 4).
- Submit label reflects payout; collapses to single line with no markers → Task 5.
- NONE / no-marker back-compat (single CASH_OUT, existing tests green) → schema default `NONE` (Task 2), explicit branch (Task 4), regression run in Task 4 Step 4.

**Placeholder scan:** none — every code step has complete code; every command has an expected result.

**Type consistency:** `allocateMarkerRepayments`, `AllocatableMarker`, `MarkerRepayment`, `MarkerAllocationResult`, `OpenMarkerDTO`, `repayMarkerInTx`, `markerScope` (`"ALL"|"TONIGHT"|"NONE"`) are defined once and used consistently across Tasks 1, 3, 4, 5. `createTransaction(args, txClient)` matches its real signature (`lib/ledger/transaction.ts`). `getActiveClubId` returns `string | null`; Prisma `where: { clubId }` accepts `null`, consistent with `lib/drops/last-drop.ts` usage in this codebase.
