# Plan 1c — Cashier UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six cashier-side UX gaps surfaced during the 2026-05-06 Plan 1b playtest: in-product transaction correction, mid-session per-player and per-staff visibility, AccountStrip cleanup (hide-when-zero + add MARKER_OUTSTANDING), and write-confirmation toasts.

**Architecture:** All changes are cashier-side (`app/(cashier)/...`), no auth or schema work. Three new infrastructure pieces:
1. A Radix Toast provider mounted in the cashier layout, accessed via a `useToast` hook.
2. A `useFormAction` client hook that wraps existing Server Actions with `useTransition` + error capture + a configurable success callback (for toast firing + modal closing).
3. A `correctTransaction` helper in `lib/ledger/` that wraps the existing `reverseTransaction` + `createTransaction` pair to perform a single-shot correction (reversal + corrected re-entry).

Per-player and per-staff session views are rendered as Radix dialogs (the existing `Modal` component) hydrated lazily from a Server Action. Click a player name on the tx stream or a staff name on the drop tracker → modal opens → action fetches that subject's session activity → list renders inside.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Radix UI Dialog + Toast, Prisma 6, Postgres 16, decimal.js, Zod, Vitest, Playwright.

**Out of scope (Plan 3):** Cross-session player profile, historical staff performance dashboard, CSV export, owner dashboards.

**Worktree note:** No worktree was created for this plan — it's a continuation of Plan 1b in the existing `rakeledger` working directory. The implementer should branch off `main` (`git checkout -b plan-1c-cashier-polish`) before starting Task 1.

---

## File structure

**New files**

| Path | Responsibility |
|---|---|
| `components/toast/toast-provider.tsx` | Client-side `<ToastProvider>` wrapping Radix Toast root + viewport. Holds toast state. |
| `components/toast/use-toast.ts` | `useToast()` hook + React context. Exposes `{ show(message, kind?) }`. |
| `components/use-form-action.ts` | Generic client hook: wraps a Server Action with `useTransition`, error capture, and `onSuccess` callback. |
| `lib/ledger/correct.ts` | `correctTransaction()` helper: reverses original + creates corrected re-entry in one Prisma transaction. |
| `tests/unit/ledger/correct.test.ts` | Unit tests for `correctTransaction`. |
| `app/(cashier)/_actions/corrections.ts` | `correctTransaction` Server Action (form parsing + delegation to lib helper). |
| `app/(cashier)/_actions/activity.ts` | Server Actions: `getPlayerSessionActivity`, `getStaffSessionActivity`. |
| `tests/unit/activity.test.ts` | Unit tests for the two activity functions. |
| `app/(cashier)/live/_components/player-name-trigger.tsx` | Client component: clickable player name → opens session-activity modal. |
| `app/(cashier)/live/_components/staff-name-trigger.tsx` | Client component: clickable staff name → opens session-activity modal. |
| `app/(cashier)/live/_components/session-activity-panel.tsx` | Shared client component: takes activity rows + summary, renders inside a modal. |
| `app/(cashier)/live/_components/tx-correct-modal.tsx` | Client modal for correcting a transaction (method/amount/player/table/note). |

**Modified files**

| Path | Change |
|---|---|
| `app/(cashier)/layout.tsx` | Wrap `<main>` with `<ToastProvider>`. |
| `app/(cashier)/live/_components/account-strip.tsx` | Add MARKER_OUTSTANDING tile; hide-when-zero rule for non-essential tiles. |
| `app/(cashier)/live/_components/transaction-stream.tsx` | Wrap player names with `<PlayerNameTrigger>`, staff names with `<StaffNameTrigger>`; add "Correct" button per row (where eligible). |
| `app/(cashier)/live/_components/drop-tracker.tsx` | Wrap staff names with `<StaffNameTrigger>`. |
| `app/(cashier)/live/_components/tx-buyin-modal.tsx` | Use `useFormAction`; fire toast on success. |
| `app/(cashier)/live/_components/tx-cashout-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-rake-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-tipdrop-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-marker-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-tournament-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-jackpot-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-freeroll-modal.tsx` | Same. |
| `app/(cashier)/live/_components/tx-misc-modal.tsx` | Same. |
| `package.json` | Add `@radix-ui/react-toast`. |

---

## Task 1: Toast infrastructure + wire Quick Action modals

**Files:**
- Create: `components/toast/toast-provider.tsx`
- Create: `components/toast/use-toast.ts`
- Create: `components/use-form-action.ts`
- Modify: `app/(cashier)/layout.tsx`
- Modify: `app/(cashier)/live/_components/tx-buyin-modal.tsx`, `tx-cashout-modal.tsx`, `tx-rake-modal.tsx`, `tx-tipdrop-modal.tsx`, `tx-marker-modal.tsx`, `tx-tournament-modal.tsx`, `tx-jackpot-modal.tsx`, `tx-freeroll-modal.tsx`, `tx-misc-modal.tsx`
- Modify: `package.json`

- [ ] **Step 1: Install Radix Toast**

```bash
npm install @radix-ui/react-toast
```

Expected: package.json gains `"@radix-ui/react-toast": "^1.x"`.

- [ ] **Step 2: Create the toast context + hook**

Create `components/toast/use-toast.ts`:

```ts
"use client";

import { createContext, useContext } from "react";

export type ToastKind = "success" | "error" | "info";

export interface ToastShape {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
```

- [ ] **Step 3: Create the ToastProvider component**

Create `components/toast/toast-provider.tsx`:

```tsx
"use client";

import * as Toast from "@radix-ui/react-toast";
import { useCallback, useState, type ReactNode } from "react";
import { ToastContext, type ToastKind, type ToastShape } from "./use-toast";

let nextId = 1;

const KIND_CLASSES: Record<ToastKind, string> = {
  success: "border-emerald-700 bg-emerald-950/80 text-emerald-200",
  error: "border-red-700 bg-red-950/80 text-red-200",
  info: "border-slate-700 bg-slate-900/80 text-slate-200",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastShape[]>([]);

  const show = useCallback((message: string, kind: ToastKind = "success") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      <Toast.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            className={`border rounded-md px-4 py-3 shadow-lg text-sm font-medium ${KIND_CLASSES[t.kind]}`}
            onOpenChange={(open) => { if (!open) dismiss(t.id); }}
          >
            <Toast.Title>{t.message}</Toast.Title>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[360px] max-w-[90vw] outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 4: Wrap the cashier layout**

Edit `app/(cashier)/layout.tsx`:

```tsx
import { headers } from "next/headers";
import { NavSidebar } from "@/components/nav-sidebar";
import { ToastProvider } from "@/components/toast/toast-provider";

export default async function CashierLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const activePath = h.get("x-pathname") ?? "/live";
  return (
    <ToastProvider>
      <div className="grid grid-cols-[220px_1fr] min-h-screen">
        <NavSidebar activePath={activePath} />
        <main className="p-4">{children}</main>
      </div>
    </ToastProvider>
  );
}
```

- [ ] **Step 5: Create the useFormAction hook**

Create `components/use-form-action.ts`:

```ts
"use client";

import { useState, useTransition, type FormEvent } from "react";

export interface UseFormActionOpts {
  /** Called after the action resolves successfully. */
  onSuccess?: (formData: FormData) => void;
  /** Called when the action throws. Default: capture as string into `error`. */
  onError?: (err: unknown) => void;
}

/**
 * Wraps a Server Action that takes FormData with client-side error capture and a success hook.
 *
 * Usage:
 *   const { onSubmit, pending, error } = useFormAction(recordBuyIn, {
 *     onSuccess: (fd) => { toast.show(`Buy-in $${fd.get("amount")} recorded`); close(); }
 *   });
 *   <form onSubmit={onSubmit}>...</form>
 */
export function useFormAction<T>(
  action: (formData: FormData) => Promise<T>,
  opts: UseFormActionOpts = {}
) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        await action(fd);
        opts.onSuccess?.(fd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        opts.onError?.(err);
      }
    });
  };

  return { onSubmit, pending, error };
}
```

- [ ] **Step 6: Wire BuyIn modal as the reference pattern**

Edit `app/(cashier)/live/_components/tx-buyin-modal.tsx`. The form must be its own component (not an inline render prop) so the hooks inside it follow Rules of Hooks. Full file:

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { recordBuyIn } from "../../_actions/transactions";

interface BuyInModalProps {
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  getUnredeemedPromo: (playerId: string) => Promise<string>;
  trigger: React.ReactNode;
}

interface FormProps {
  close: () => void;
  sessionId: string;
  gameId: string;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  getUnredeemedPromo: (playerId: string) => Promise<string>;
}

function BuyInForm({ close, sessionId, gameId, players, tables, getUnredeemedPromo }: FormProps) {
  const toast = useToast();
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [unredeemed, setUnredeemed] = useState<string>("0");
  const [, startPromoTransition] = useTransition();

  useEffect(() => {
    if (!selectedPlayerId) { setUnredeemed("0"); return; }
    startPromoTransition(async () => {
      const amount = await getUnredeemedPromo(selectedPlayerId);
      setUnredeemed(amount);
    });
  }, [selectedPlayerId, getUnredeemedPromo]);

  const { onSubmit, pending, error } = useFormAction(recordBuyIn, {
    onSuccess: (fd) => {
      const playerName = players.find((p) => p.id === fd.get("playerId"))?.displayName ?? "player";
      toast.show(`Buy-in $${fd.get("amount")} recorded for ${playerName}`);
      close();
    },
  });

  const showBanner = parseFloat(unredeemed) > 0;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Player</span>
        <select name="playerId" required value={selectedPlayerId}
          onChange={(e) => setSelectedPlayerId(e.target.value)}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
        </select>
      </label>
      {showBanner && (
        <div className="bg-cyan-500/10 border border-cyan-700 text-cyan-300 text-xs rounded px-3 py-2">
          ⚡ This player won <strong>${unredeemed}</strong> in freeroll prizes this session.
          Only enter the <em>cash</em> they&apos;re handing you now.
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
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Record Buy-in
      </button>
    </form>
  );
}

export function BuyInModal({ trigger, ...rest }: BuyInModalProps) {
  return (
    <Modal trigger={trigger} title="+ Buy-in" description="Player exchanges money for chips.">
      {(close) => <BuyInForm close={close} {...rest} />}
    </Modal>
  );
}
```

**Why a sub-component:** the inner form uses `useToast()`, `useState()`, `useEffect()`, and `useFormAction()`. Calling these inside the inline render-prop callback `(close) => { ... }` would violate Rules of Hooks (hooks would run inside a nested function defined in another component). Extracting `BuyInForm` makes the hooks valid. Apply this pattern to every modal in Step 7.

Radix Dialog unmounts the form on close by default, which is correct — local state (`selectedPlayerId`, etc.) resets cleanly on next open.

- [ ] **Step 7: Apply the same pattern to the other 8 modals**

For each of: `tx-cashout-modal.tsx`, `tx-rake-modal.tsx`, `tx-tipdrop-modal.tsx`, `tx-marker-modal.tsx`, `tx-tournament-modal.tsx`, `tx-jackpot-modal.tsx`, `tx-freeroll-modal.tsx`, `tx-misc-modal.tsx`:

1. Extract a `XxxForm` sub-component that holds all hooks (`useToast`, `useFormAction`, any local state).
2. Convert `<form action={X}>` to `<form onSubmit={onSubmit}>` using `useFormAction`.
3. On success, fire a toast with a specific message (see message reference below) and call `close()`.
4. Display `error` below the submit button.
5. The wrapper `XxxModal` only renders `<Modal trigger={trigger} title="...">{(close) => <XxxForm close={close} {...rest} />}</Modal>`.

Reference messages (use these exact strings):
- CashOut: `` `Cash-out $${total} recorded for ${playerName}` `` (compute total client-side from n100/n25/n5/n1)
- Rake: `` `Rake $${amount} recorded${staffName ? ` for ${staffName}` : ""}` ``
- TipDrop: `` `Tip drop $${amount} recorded for ${staffName}` ``
- MarkerIssue: `` `Marker $${amount} issued to ${playerName}` ``
- MarkerRepay: `` `Marker repayment $${amount} from ${playerName}` ``
- Tournament fee: `` `Tournament fee $${amount} recorded for ${playerName}` ``
- Tournament payout: `` `Tournament payout $${amount} to ${playerName}` ``
- Jackpot: `` `Jackpot $${amount} paid to ${playerName}` ``
- Freeroll: `` `Freeroll prize $${amount} awarded to ${playerName}` ``
- Misc / Staff advance / FNB / Drawer adjust / Chip float adjust: `` `${humanType} $${amount} recorded` ``

- [ ] **Step 8: Manual smoke test**

Start the dev server, open a session, click each Quick Action, fill in valid values, submit. Expected: modal closes, a toast appears bottom-right with the correct message and dismisses after ~4s. Force an error (e.g., negative amount via dev tools) and verify the inline error renders.

- [ ] **Step 9: Commit**

```bash
git add components/toast/ components/use-form-action.ts app/\(cashier\)/layout.tsx app/\(cashier\)/live/_components/tx-*-modal.tsx package.json package-lock.json
git commit -m "feat(cashier): toast confirmation on Quick Action submission"
```

---

## Task 2: AccountStrip — hide-when-zero + MARKER_OUTSTANDING

**Files:**
- Modify: `app/(cashier)/live/_components/account-strip.tsx`
- Create: `lib/ledger/tile-filter.ts`
- Create: `tests/unit/tile-filter.test.ts`

The current strip always renders 7 shared tiles + 3 game tiles per active game. After the playtest the rule is:
- **Always show**, regardless of balance: `CASH_DRAWER`, `CHIP_FLOAT`, `TIP_POOL`, `RAKE_POOL`.
- **Show only when non-zero**: `ZELLE`, `VENMO`, `CASHAPP`, `APPLE_PAY`, `MARKER_OUTSTANDING`, `PROMO_POOL`, `TOURNAMENT_POOL`.

`MARKER_OUTSTANDING` is a new tile in the shared row.

- [ ] **Step 1: Write the tile-filter test (failing)**

Create `tests/unit/tile-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { filterTiles, type TileWithBalance } from "@/lib/ledger/tile-filter";

describe("filterTiles", () => {
  const tiles: TileWithBalance[] = [
    { account: "CASH_DRAWER", label: "Cash drawer", balance: new Decimal(0) },
    { account: "ZELLE", label: "Zelle", balance: new Decimal(0) },
    { account: "VENMO", label: "Venmo", balance: new Decimal(50) },
    { account: "CASHAPP", label: "CashApp", balance: new Decimal(0) },
    { account: "MARKER_OUTSTANDING", label: "Markers out", balance: new Decimal(200) },
    { account: "CHIP_FLOAT", label: "Chip float", balance: new Decimal(0) },
    { account: "TIP_POOL", label: "Tip pool", balance: new Decimal(0) },
    { account: "RAKE_POOL", label: "Rake", balance: new Decimal(0) },
    { account: "PROMO_POOL", label: "Promo", balance: new Decimal(0) },
  ];

  it("always shows CASH_DRAWER, CHIP_FLOAT, TIP_POOL, RAKE_POOL even at zero", () => {
    const out = filterTiles(tiles);
    const accounts = out.map((t) => t.account);
    expect(accounts).toContain("CASH_DRAWER");
    expect(accounts).toContain("CHIP_FLOAT");
    expect(accounts).toContain("TIP_POOL");
    expect(accounts).toContain("RAKE_POOL");
  });

  it("hides ZELLE / CASHAPP / PROMO_POOL when zero", () => {
    const out = filterTiles(tiles);
    const accounts = out.map((t) => t.account);
    expect(accounts).not.toContain("ZELLE");
    expect(accounts).not.toContain("CASHAPP");
    expect(accounts).not.toContain("PROMO_POOL");
  });

  it("shows VENMO and MARKER_OUTSTANDING when non-zero", () => {
    const out = filterTiles(tiles);
    const accounts = out.map((t) => t.account);
    expect(accounts).toContain("VENMO");
    expect(accounts).toContain("MARKER_OUTSTANDING");
  });

  it("preserves input order in output", () => {
    const out = filterTiles(tiles);
    expect(out.map((t) => t.account)).toEqual([
      "CASH_DRAWER", "VENMO", "MARKER_OUTSTANDING", "CHIP_FLOAT", "TIP_POOL", "RAKE_POOL",
    ]);
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm test -- tests/unit/tile-filter.test.ts
```

Expected: FAIL — module `@/lib/ledger/tile-filter` not found.

- [ ] **Step 3: Implement filterTiles**

Create `lib/ledger/tile-filter.ts`:

```ts
import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";

export interface TileWithBalance {
  account: AccountType;
  label: string;
  balance: Decimal;
  /** Optional: only present for game-scoped tiles. */
  gameId?: string;
}

/**
 * Accounts that ALWAYS render in the AccountStrip even when their balance is zero.
 * Everything else is hidden when its balance is exactly zero.
 *
 * Rationale: the cashier's primary surfaces (cash drawer, chips on the table, the tip kitty,
 * the rake kitty) should always be visible so the cashier can confirm "yes, books look right"
 * at a glance. Method-specific tiles (Zelle, Venmo, etc) only matter once they have activity.
 * MARKER_OUTSTANDING shows only when there are open markers — visibly cuing the cashier to chase.
 */
export const ALWAYS_SHOW: ReadonlySet<AccountType> = new Set([
  "CASH_DRAWER",
  "CHIP_FLOAT",
  "TIP_POOL",
  "RAKE_POOL",
]);

export function filterTiles(tiles: TileWithBalance[]): TileWithBalance[] {
  return tiles.filter((t) => ALWAYS_SHOW.has(t.account) || !t.balance.equals(0));
}
```

- [ ] **Step 4: Run the test, see it pass**

```bash
npm test -- tests/unit/tile-filter.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Update AccountStrip**

Edit `app/(cashier)/live/_components/account-strip.tsx`. Replace the file content with:

```tsx
import { Money } from "@/components/money";
import { getAccountBalance } from "@/lib/ledger/balance";
import { prisma } from "@/lib/db";
import { filterTiles, type TileWithBalance } from "@/lib/ledger/tile-filter";
import type { AccountType } from "@prisma/client";

interface AccountStripProps {
  sessionId: string;
  activeGameId: string | "all";
}

interface TileDef {
  account: AccountType;
  label: string;
}

const SHARED_TILES: TileDef[] = [
  { account: "CASH_DRAWER", label: "Cash drawer" },
  { account: "ZELLE", label: "Zelle" },
  { account: "VENMO", label: "Venmo" },
  { account: "CASHAPP", label: "CashApp" },
  { account: "APPLE_PAY", label: "Apple Pay" },
  { account: "MARKER_OUTSTANDING", label: "Markers out" },
  { account: "CHIP_FLOAT", label: "Chip float" },
  { account: "TIP_POOL", label: "Tip pool" },
];

const GAME_TILES: TileDef[] = [
  { account: "RAKE_POOL", label: "Rake" },
  { account: "PROMO_POOL", label: "Promo" },
  { account: "TOURNAMENT_POOL", label: "Tournament" },
];

export async function AccountStrip({ sessionId, activeGameId }: AccountStripProps) {
  const games = await prisma.game.findMany({ where: { sessionId }, orderBy: { openedAt: "asc" } });

  const sharedBalances: TileWithBalance[] = await Promise.all(
    SHARED_TILES.map(async (t) => ({
      account: t.account,
      label: t.label,
      balance: await getAccountBalance({ account: t.account, sessionId }),
    }))
  );

  const gameTilesToRender =
    activeGameId === "all"
      ? games.flatMap((g) =>
          GAME_TILES.map((t) => ({ account: t.account, label: `${t.label} · ${g.name}`, gameId: g.id }))
        )
      : GAME_TILES.map((t) => ({ account: t.account, label: t.label, gameId: activeGameId }));

  const gameBalances: TileWithBalance[] = await Promise.all(
    gameTilesToRender.map(async (t) => ({
      account: t.account,
      label: t.label,
      gameId: t.gameId,
      balance: await getAccountBalance({ account: t.account, sessionId, gameId: t.gameId }),
    }))
  );

  const visible = filterTiles([...sharedBalances, ...gameBalances]);

  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
      {visible.map((tile, i) => (
        <div
          key={`${tile.account}-${tile.gameId ?? "shared"}-${i}`}
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

- [ ] **Step 6: Manual smoke test**

Open a session with no transactions. Expected: only `Cash drawer`, `Chip float`, `Tip pool`, `Rake` render. Record a Zelle buy-in. Expected: `Zelle` tile appears. Issue a marker. Expected: `Markers out` tile appears with the correct dollar amount.

- [ ] **Step 7: Commit**

```bash
git add lib/ledger/tile-filter.ts tests/unit/tile-filter.test.ts app/\(cashier\)/live/_components/account-strip.tsx
git commit -m "feat(cashier): hide zero-balance tiles + add MARKER_OUTSTANDING tile"
```

---

## Task 3: Per-player session activity panel

**Files:**
- Create: `app/(cashier)/_actions/activity.ts`
- Create: `tests/unit/activity-player.test.ts`
- Create: `app/(cashier)/live/_components/session-activity-panel.tsx`
- Create: `app/(cashier)/live/_components/player-name-trigger.tsx`
- Modify: `app/(cashier)/live/_components/transaction-stream.tsx`

The panel is a client modal that, when opened, calls a Server Action to fetch every transaction the player has in the current session, plus running totals: total bought-in, total cashed-out, total markers issued, total marker repaid, total walks, total returns, and net cash position.

- [ ] **Step 1: Write the failing test for getPlayerSessionActivity**

Create `tests/unit/activity-player.test.ts`. Follows the existing pattern (see `tests/unit/ledger/buy-in.test.ts`): use `testPrisma` + `resetDatabase` from `./test-db`, and exercise the lower-level `createTransaction` rather than the Server Actions (which depend on `getCashierUserId()` looking up `cashier@dev.local`, not seeded by `resetDatabase`):

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "./test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getPlayerSessionActivity } from "@/app/(cashier)/_actions/activity";

describe("getPlayerSessionActivity", () => {
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
    const player = await testPrisma.player.create({ data: { displayName: "Alice" } });
    playerId = player.id;
  });

  it("returns rows + totals for a single player in a session", async () => {
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(300), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(300) },
        { account: "CHIP_FLOAT", delta: new Decimal(300) },
      ],
    });
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(200), method: "ZELLE", playerId,
      entries: [
        { account: "ZELLE", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    await createTransaction({
      sessionId, gameId, type: "CASH_OUT", createdById: "test-cashier",
      amount: new Decimal(100), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(-100) },
        { account: "CHIP_FLOAT", delta: new Decimal(-100) },
      ],
    });

    const activity = await getPlayerSessionActivity(sessionId, playerId);

    expect(activity.rows).toHaveLength(3);
    expect(activity.totals.buyIn).toBe("500");
    expect(activity.totals.cashOut).toBe("100");
    expect(activity.totals.netCash).toBe("400"); // 300+200 in − 100 out
    expect(activity.totals.markersIssued).toBe("0");
    expect(activity.totals.markersRepaid).toBe("0");
  });

  it("returns empty totals for a player with no activity", async () => {
    const ghost = await testPrisma.player.create({ data: { displayName: "Ghost" } });
    const activity = await getPlayerSessionActivity(sessionId, ghost.id);
    expect(activity.rows).toHaveLength(0);
    expect(activity.totals.buyIn).toBe("0");
    expect(activity.totals.netCash).toBe("0");
  });

  it("excludes transactions from other sessions", async () => {
    const session2 = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    const game2 = await testPrisma.game.create({
      data: { sessionId: session2.id, name: "Other", rakeSplitConfig: {} },
    });
    await createTransaction({
      sessionId: session2.id, gameId: game2.id, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(999), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(999) },
        { account: "CHIP_FLOAT", delta: new Decimal(999) },
      ],
    });

    const activity = await getPlayerSessionActivity(sessionId, playerId);
    expect(activity.rows).toHaveLength(0);
  });

  it("includes reversals in rows but excludes them from totals", async () => {
    const original = await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(100), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(100) },
        { account: "CHIP_FLOAT", delta: new Decimal(100) },
      ],
    });
    const { reverseTransaction } = await import("@/lib/ledger/transaction");
    await reverseTransaction({ transactionId: original.id, reversedById: "test-cashier", reason: "test" });

    const activity = await getPlayerSessionActivity(sessionId, playerId);
    expect(activity.rows).toHaveLength(2); // both shown
    expect(activity.totals.buyIn).toBe("100"); // reversal not counted
    expect(activity.totals.netCash).toBe("100"); // reversal not counted
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm test -- tests/unit/activity-player.test.ts
```

Expected: FAIL — module `@/app/(cashier)/_actions/activity` not found.

- [ ] **Step 3: Implement getPlayerSessionActivity**

Create `app/(cashier)/_actions/activity.ts`:

```ts
"use server";

import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import type { TransactionType } from "@prisma/client";

export interface ActivityRow {
  id: string;
  createdAt: string; // ISO; serialized for client transport
  type: TransactionType;
  amount: string;
  method: string;
  note: string | null;
  gameName: string | null;
  tableName: string | null;
  reversesId: string | null;
  staffName: string | null;
  playerName: string | null;
}

export interface PlayerTotals {
  buyIn: string;
  cashOut: string;
  markersIssued: string;
  markersRepaid: string;
  walks: string;
  returns: string;
  /** Net cash the player put in: buy-ins (any method) + tournament fees − cash-outs − tournament payouts − jackpot/freeroll cash payouts. Chip-only events (RAKE, TIP_DROP) do not affect this. */
  netCash: string;
}

export interface PlayerActivity {
  rows: ActivityRow[];
  totals: PlayerTotals;
}

export async function getPlayerSessionActivity(sessionId: string, playerId: string): Promise<PlayerActivity> {
  const txs = await prisma.transaction.findMany({
    where: { sessionId, playerId },
    include: { game: true, table: true, staff: true, player: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: ActivityRow[] = txs.map((t) => ({
    id: t.id,
    createdAt: t.createdAt.toISOString(),
    type: t.type,
    amount: t.amount.toString(),
    method: t.method,
    note: t.note,
    gameName: t.game?.name ?? null,
    tableName: t.table?.name ?? null,
    reversesId: t.reversesId,
    staffName: t.staff?.name ?? null,
    playerName: t.player?.displayName ?? null,
  }));

  // Sum amounts per category. We only count tx that are not reversals (reversesId IS NULL).
  // Reversals appear in the rows list for transparency but don't double-count in totals.
  let buyIn = new Decimal(0);
  let cashOut = new Decimal(0);
  let markersIssued = new Decimal(0);
  let markersRepaid = new Decimal(0);
  let walks = new Decimal(0);
  let returns = new Decimal(0);
  let netCash = new Decimal(0);

  for (const t of txs) {
    if (t.reversesId) continue; // skip reversals
    const amt = new Decimal(t.amount.toString());
    switch (t.type) {
      case "BUY_IN":           buyIn = buyIn.add(amt);           netCash = netCash.add(amt);          break;
      case "CASH_OUT":         cashOut = cashOut.add(amt);       netCash = netCash.sub(amt);          break;
      case "MARKER_ISSUE":     markersIssued = markersIssued.add(amt);                                break;
      case "MARKER_REPAY":     markersRepaid = markersRepaid.add(amt); netCash = netCash.add(amt);    break;
      case "CHIP_WALK":        walks = walks.add(amt);                                                break;
      case "CHIP_RETURN":      returns = returns.add(amt);                                            break;
      case "TOURNAMENT_FEE":   netCash = netCash.add(amt);                                            break;
      case "TOURNAMENT_PAYOUT": netCash = netCash.sub(amt);                                           break;
      // JACKPOT_PAYOUT and FREEROLL_PRIZE_PAYOUT: cash-out flavor reduces drawer; chips flavor doesn't touch cash.
      // We can't distinguish here without entries; skip. If precise, re-derive from ledger entries later.
    }
  }

  return {
    rows,
    totals: {
      buyIn: buyIn.toString(),
      cashOut: cashOut.toString(),
      markersIssued: markersIssued.toString(),
      markersRepaid: markersRepaid.toString(),
      walks: walks.toString(),
      returns: returns.toString(),
      netCash: netCash.toString(),
    },
  };
}
```

- [ ] **Step 4: Run the test, see it pass**

```bash
npm test -- tests/unit/activity-player.test.ts
```

Expected: PASS (3/3).

- [ ] **Step 5: Build the shared activity panel UI**

Create `app/(cashier)/live/_components/session-activity-panel.tsx`:

```tsx
"use client";

import { Money } from "@/components/money";
import type { ActivityRow } from "../../_actions/activity";

export interface SummaryItem {
  label: string;
  value: string; // numeric string
  emphasize?: boolean;
}

interface PanelProps {
  title: string;
  rows: ActivityRow[];
  summary: SummaryItem[];
}

export function SessionActivityPanel({ title, rows, summary }: PanelProps) {
  return (
    <div className="flex flex-col gap-4 max-h-[70vh]">
      <div>
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {summary.map((s) => (
            <div key={s.label} className="bg-black/30 border border-[var(--color-border)] rounded p-2">
              <div className="text-[0.65rem] uppercase tracking-wider text-slate-500">{s.label}</div>
              <div className={`font-mono tabular-nums text-sm mt-1 ${s.emphasize ? "text-amber-400 font-semibold" : ""}`}>
                <Money amount={s.value} signed={s.emphasize} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-auto border border-[var(--color-border)] rounded">
        {rows.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-sm">No activity in this session.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`px-3 py-2 text-xs grid grid-cols-[60px_1fr_70px_90px] gap-2 ${
                  r.reversesId ? "text-slate-500 italic" : ""
                }`}
              >
                <span className="font-mono text-slate-500">
                  {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span>
                  <span className="text-slate-200">{r.type.toLowerCase().replace(/_/g, " ")}</span>
                  {r.gameName && <span className="text-slate-500"> · {r.gameName}</span>}
                  {r.tableName && <span className="text-slate-500"> / {r.tableName}</span>}
                  {r.staffName && <span className="text-slate-500"> · {r.staffName}</span>}
                  {r.note && <div className="text-slate-500 mt-0.5">{r.note}</div>}
                </span>
                <span className="text-center text-slate-400 bg-[var(--color-bg)] rounded px-1.5 py-0.5 self-center">
                  {r.method.toLowerCase()}
                </span>
                <span className="font-mono text-right self-center">
                  <Money amount={r.amount} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build the player name trigger**

Create `app/(cashier)/live/_components/player-name-trigger.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { SessionActivityPanel, type SummaryItem } from "./session-activity-panel";
import { getPlayerSessionActivity, type PlayerActivity } from "../../_actions/activity";

interface Props {
  sessionId: string;
  playerId: string;
  playerName: string;
}

export function PlayerNameTrigger({ sessionId, playerId, playerName }: Props) {
  const [data, setData] = useState<PlayerActivity | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    if (data || pending) return;
    startTransition(async () => {
      const result = await getPlayerSessionActivity(sessionId, playerId);
      setData(result);
    });
  };

  const summary: SummaryItem[] = data
    ? [
        { label: "Buy-ins", value: data.totals.buyIn },
        { label: "Cash-outs", value: data.totals.cashOut },
        { label: "Markers", value: data.totals.markersIssued },
        { label: "Net cash", value: data.totals.netCash, emphasize: true },
      ]
    : [];

  return (
    <Modal
      trigger={
        <button onClick={load} className="text-slate-200 hover:text-amber-400 hover:underline cursor-pointer">
          {playerName}
        </button>
      }
      title={`${playerName} · session activity`}
      wide
    >
      {() =>
        pending && !data ? (
          <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
        ) : data ? (
          <SessionActivityPanel title={playerName} rows={data.rows} summary={summary} />
        ) : (
          <div className="p-6 text-center text-slate-500 text-sm">Click to load</div>
        )
      }
    </Modal>
  );
}
```

Note: the existing `Modal` component opens on click of the trigger (via the `display:contents` wrapper). The trigger's own `onClick={load}` fires before the modal opens, kicking off the data fetch. The `useTransition` keeps the UI responsive while the action runs.

- [ ] **Step 7: Wire into TransactionStream**

Edit `app/(cashier)/live/_components/transaction-stream.tsx`. Replace the player-name span with `<PlayerNameTrigger>` when `tx.playerId` is non-null:

```tsx
import { PlayerNameTrigger } from "./player-name-trigger";

// inside the .map((tx) => ...) block, replace:
//   <span className="text-slate-200">{tx.player?.displayName ?? tx.staff?.name ?? "—"}</span>
// with:
{tx.player ? (
  <PlayerNameTrigger sessionId={sessionId} playerId={tx.player.id} playerName={tx.player.displayName} />
) : (
  <span className="text-slate-200">{tx.staff?.name ?? "—"}</span>
)}
```

- [ ] **Step 8: Manual smoke test**

Open a session with multiple buy-ins / cash-outs for the same player. Click that player's name on the tx stream. Expected: a wide modal opens, summary tiles show buy-in / cash-out / markers / net cash, the tx list shows every row with timestamps and types. Closing and reopening reuses cached state.

- [ ] **Step 9: Commit**

```bash
git add app/\(cashier\)/_actions/activity.ts app/\(cashier\)/live/_components/session-activity-panel.tsx app/\(cashier\)/live/_components/player-name-trigger.tsx app/\(cashier\)/live/_components/transaction-stream.tsx tests/unit/activity-player.test.ts
git commit -m "feat(cashier): per-player session activity panel"
```

---

## Task 4: Per-staff session activity panel + summary

**Files:**
- Modify: `app/(cashier)/_actions/activity.ts` (add `getStaffSessionActivity`)
- Create: `tests/unit/activity-staff.test.ts`
- Create: `app/(cashier)/live/_components/staff-name-trigger.tsx`
- Modify: `app/(cashier)/live/_components/drop-tracker.tsx`
- Modify: `app/(cashier)/live/_components/transaction-stream.tsx`

Reuses the `SessionActivityPanel` from Task 3. The staff variant aggregates rake drops, tip drops, and (for cashiers) all transactions they created.

- [ ] **Step 1: Write the failing test for getStaffSessionActivity**

Create `tests/unit/activity-staff.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "./test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getStaffSessionActivity } from "@/app/(cashier)/_actions/activity";

describe("getStaffSessionActivity", () => {
  let sessionId: string;
  let gameId: string;
  let dealerId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
    const dealer = await testPrisma.user.create({
      data: { email: "d1@dev.local", name: "Dealer One", role: "DEALER", status: "ACTIVE" },
    });
    dealerId = dealer.id;
  });

  async function rake(amount: number) {
    return createTransaction({
      sessionId, gameId, type: "RAKE", createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS", staffId: dealerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
        { account: "RAKE_POOL", delta: new Decimal(amount), gameId },
      ],
    });
  }

  async function tip(amount: number) {
    return createTransaction({
      sessionId, gameId, type: "TIP_DROP", createdById: "test-cashier",
      amount: new Decimal(amount), method: "CHIPS", staffId: dealerId,
      entries: [
        { account: "CHIP_FLOAT", delta: new Decimal(-amount) },
        { account: "TIP_POOL", delta: new Decimal(amount) },
      ],
    });
  }

  it("aggregates rake drops + tip drops per dealer", async () => {
    await rake(25);
    await rake(30);
    await tip(10);
    await tip(12);

    const activity = await getStaffSessionActivity(sessionId, dealerId);
    expect(activity.rows).toHaveLength(4);
    expect(activity.totals.rakeDrops).toBe("55");
    expect(activity.totals.tipDrops).toBe("22");
    expect(activity.totals.dropCount).toBe(4);
    expect(activity.totals.lastDropAt).not.toBeNull();
  });

  it("returns empty totals for staff with no activity", async () => {
    const dealer2 = await testPrisma.user.create({
      data: { email: "d2@dev.local", name: "Dealer Two", role: "DEALER", status: "ACTIVE" },
    });
    const activity = await getStaffSessionActivity(sessionId, dealer2.id);
    expect(activity.rows).toHaveLength(0);
    expect(activity.totals.rakeDrops).toBe("0");
    expect(activity.totals.tipDrops).toBe("0");
    expect(activity.totals.dropCount).toBe(0);
    expect(activity.totals.lastDropAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm test -- tests/unit/activity-staff.test.ts
```

Expected: FAIL — `getStaffSessionActivity` not exported.

- [ ] **Step 3: Implement getStaffSessionActivity**

Append to `app/(cashier)/_actions/activity.ts`:

```ts
export interface StaffTotals {
  rakeDrops: string;
  tipDrops: string;
  dropCount: number;
  lastDropAt: string | null;
}

export interface StaffActivity {
  rows: ActivityRow[];
  totals: StaffTotals;
}

export async function getStaffSessionActivity(sessionId: string, staffId: string): Promise<StaffActivity> {
  const txs = await prisma.transaction.findMany({
    where: { sessionId, staffId },
    include: { game: true, table: true, staff: true, player: true },
    orderBy: { createdAt: "asc" },
  });

  const rows: ActivityRow[] = txs.map((t) => ({
    id: t.id,
    createdAt: t.createdAt.toISOString(),
    type: t.type,
    amount: t.amount.toString(),
    method: t.method,
    note: t.note,
    gameName: t.game?.name ?? null,
    tableName: t.table?.name ?? null,
    reversesId: t.reversesId,
    staffName: t.staff?.name ?? null,
    playerName: t.player?.displayName ?? null,
  }));

  let rakeDrops = new Decimal(0);
  let tipDrops = new Decimal(0);
  let dropCount = 0;
  let lastDropAt: Date | null = null;

  for (const t of txs) {
    if (t.reversesId) continue;
    if (t.type === "RAKE") {
      rakeDrops = rakeDrops.add(t.amount.toString());
      dropCount++;
      if (!lastDropAt || t.createdAt > lastDropAt) lastDropAt = t.createdAt;
    } else if (t.type === "TIP_DROP") {
      tipDrops = tipDrops.add(t.amount.toString());
      dropCount++;
      if (!lastDropAt || t.createdAt > lastDropAt) lastDropAt = t.createdAt;
    }
  }

  return {
    rows,
    totals: {
      rakeDrops: rakeDrops.toString(),
      tipDrops: tipDrops.toString(),
      dropCount,
      lastDropAt: lastDropAt ? lastDropAt.toISOString() : null,
    },
  };
}
```

- [ ] **Step 4: Run the test, see it pass**

```bash
npm test -- tests/unit/activity-staff.test.ts
```

Expected: PASS (2/2).

- [ ] **Step 5: Build the staff name trigger**

Create `app/(cashier)/live/_components/staff-name-trigger.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { SessionActivityPanel, type SummaryItem } from "./session-activity-panel";
import { getStaffSessionActivity, type StaffActivity } from "../../_actions/activity";

interface Props {
  sessionId: string;
  staffId: string;
  staffName: string;
}

export function StaffNameTrigger({ sessionId, staffId, staffName }: Props) {
  const [data, setData] = useState<StaffActivity | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    if (data || pending) return;
    startTransition(async () => {
      const result = await getStaffSessionActivity(sessionId, staffId);
      setData(result);
    });
  };

  const summary: SummaryItem[] = data
    ? [
        { label: "Rake drops", value: data.totals.rakeDrops },
        { label: "Tip drops", value: data.totals.tipDrops },
        { label: "Drop count", value: String(data.totals.dropCount) },
        {
          label: "Last drop",
          value: data.totals.lastDropAt
            ? new Date(data.totals.lastDropAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : "—",
        },
      ]
    : [];

  return (
    <Modal
      trigger={
        <button onClick={load} className="text-slate-200 hover:text-amber-400 hover:underline cursor-pointer">
          {staffName}
        </button>
      }
      title={`${staffName} · session activity`}
      wide
    >
      {() =>
        pending && !data ? (
          <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
        ) : data ? (
          <SessionActivityPanel title={staffName} rows={data.rows} summary={summary} />
        ) : (
          <div className="p-6 text-center text-slate-500 text-sm">Click to load</div>
        )
      }
    </Modal>
  );
}
```

Note on `summary`: the `Last drop` value is a time string, not a money string. The `SessionActivityPanel` component renders summary values via `<Money>`, which will mishandle non-numeric strings. Either (a) extend `SessionActivityPanel`'s `SummaryItem` to support a `raw: true` flag that renders the value as plain text, or (b) split summary into "money tiles" and "raw tiles". Choose (a) for simplicity.

If you choose (a), update `SessionActivityPanel`:

```tsx
export interface SummaryItem {
  label: string;
  value: string;
  emphasize?: boolean;
  /** When true, render value as plain text instead of through <Money>. */
  raw?: boolean;
}

// inside the summary map:
<div className={`font-mono tabular-nums text-sm mt-1 ${s.emphasize ? "text-amber-400 font-semibold" : ""}`}>
  {s.raw ? s.value : <Money amount={s.value} signed={s.emphasize} />}
</div>
```

Then mark `Last drop` and `Drop count` as `raw: true` in the staff trigger.

- [ ] **Step 6: Wire into DropTracker**

Edit `app/(cashier)/live/_components/drop-tracker.tsx`. Replace the staff name span with `<StaffNameTrigger>`:

```tsx
import { StaffNameTrigger } from "./staff-name-trigger";
// ... inside the <li>:
<StaffNameTrigger sessionId={sessionId} staffId={e.staffId} staffName={e.staffName} />
```

The `sessionId` prop already exists on `DropTracker` (the page passes it).

- [ ] **Step 7: Wire into TransactionStream for staff (RAKE/TIP_DROP rows)**

Edit `app/(cashier)/live/_components/transaction-stream.tsx`. In the row rendering, when `tx.staff` is non-null and there's no player, render `<StaffNameTrigger>` instead of the plain span:

```tsx
{tx.player ? (
  <PlayerNameTrigger sessionId={sessionId} playerId={tx.player.id} playerName={tx.player.displayName} />
) : tx.staff ? (
  <StaffNameTrigger sessionId={sessionId} staffId={tx.staff.id} staffName={tx.staff.name} />
) : (
  <span className="text-slate-200">—</span>
)}
```

- [ ] **Step 8: Manual smoke test**

Open a session, record a few rake drops and tip drops for one dealer. Click the dealer's name on the drop tracker. Expected: modal opens, summary tiles show rake total + tip total + drop count + last drop time, list shows each drop with the table name. Same name on a tx-stream RAKE row should also open the modal.

- [ ] **Step 9: Commit**

```bash
git add app/\(cashier\)/_actions/activity.ts app/\(cashier\)/live/_components/staff-name-trigger.tsx app/\(cashier\)/live/_components/drop-tracker.tsx app/\(cashier\)/live/_components/transaction-stream.tsx app/\(cashier\)/live/_components/session-activity-panel.tsx tests/unit/activity-staff.test.ts
git commit -m "feat(cashier): per-staff session activity panel"
```

---

## Task 5: Transaction correction UI

**Files:**
- Create: `lib/ledger/correct.ts`
- Create: `tests/unit/ledger/correct.test.ts`
- Create: `app/(cashier)/_actions/corrections.ts`
- Create: `app/(cashier)/live/_components/tx-correct-modal.tsx`
- Modify: `app/(cashier)/live/_components/transaction-stream.tsx`

The "correct" affordance lets the cashier change a recorded transaction's method, amount, player, table, or note in one click. Implementation: reverse the original (creates a negated tx with `reversesId`) and create a new tx with the same type but the user's new fields. Both writes happen inside one Prisma transaction so the audit trail is atomic.

**Supported types:** `BUY_IN`, `CASH_OUT`, `RAKE`, `TIP_DROP`, `TOURNAMENT_FEE`, `TOURNAMENT_PAYOUT`, `JACKPOT_PAYOUT`, `FREEROLL_PRIZE_PAYOUT`, `STAFF_ADVANCE`, `FNB_COST`, `DRAWER_COUNT_ADJUST`, `CHIP_FLOAT_ADJUST`.

**Excluded types:** `MARKER_ISSUE`, `MARKER_REPAY` (require coordinated update of the `Marker` row — for v1, the cashier can use `Reverse` and re-issue manually). `OPENING_FLOAT`, `RAKE_DISTRIBUTION`, `TIP_PAYOUT`, `TIP_HOUSE_TAX`, `HOUSE_TAX_DISTRIBUTION`, `CHIP_WALK`, `CHIP_RETURN` (close-out side effects or already-correctable via their own modal).

The `Correct` button is hidden for: excluded types, transactions that are themselves reversals (`reversesId !== null`), and transactions that have already been reversed (a later tx points back at this one's id).

- [ ] **Step 1: Write the failing test for correctTransaction**

Create `tests/unit/ledger/correct.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { correctTransaction, CorrectionError } from "@/lib/ledger/correct";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("correctTransaction", () => {
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
    const player = await testPrisma.player.create({ data: { displayName: "Yvonne" } });
    playerId = player.id;
  });

  async function makeBuyIn(amount: number, methodAccount: "CASH_DRAWER" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY", method: "CASH" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY") {
    return createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(amount), method, playerId,
      entries: [
        { account: methodAccount, delta: new Decimal(amount) },
        { account: "CHIP_FLOAT", delta: new Decimal(amount) },
      ],
    });
  }

  it("changes method from CASHAPP to APPLE_PAY (the Yvonne case)", async () => {
    const tx = await makeBuyIn(250, "CASHAPP", "CASHAPP");

    expect((await getAccountBalance({ account: "CASHAPP", sessionId })).toString()).toBe("250");
    expect((await getAccountBalance({ account: "APPLE_PAY", sessionId })).toString()).toBe("0");

    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "wrong method (cashapp → apple_pay)",
      overrides: { method: "APPLE_PAY" },
    });

    expect((await getAccountBalance({ account: "CASHAPP", sessionId })).toString()).toBe("0");
    expect((await getAccountBalance({ account: "APPLE_PAY", sessionId })).toString()).toBe("250");
    // CHIP_FLOAT unchanged: 250 (original) − 250 (reversal) + 250 (corrected) = 250
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("250");
  });

  it("changes amount from 200 to 300", async () => {
    const tx = await makeBuyIn(200, "CASH_DRAWER", "CASH");

    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "wrong amount",
      overrides: { amount: new Decimal(300) },
    });

    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("300");
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("300");
  });

  it("changes both method and amount in a single correction", async () => {
    const tx = await makeBuyIn(200, "CASHAPP", "CASHAPP");

    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "wrong method + amount",
      overrides: { method: "APPLE_PAY", amount: new Decimal(350) },
    });

    expect((await getAccountBalance({ account: "CASHAPP", sessionId })).toString()).toBe("0");
    expect((await getAccountBalance({ account: "APPLE_PAY", sessionId })).toString()).toBe("350");
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("350");
  });

  it("rejects correcting an already-reversed transaction", async () => {
    const tx = await makeBuyIn(100, "CASH_DRAWER", "CASH");
    await correctTransaction({
      originalId: tx.id,
      reversedById: "test-cashier",
      reason: "first correction",
      overrides: { amount: new Decimal(150) },
    });

    await expect(
      correctTransaction({
        originalId: tx.id,
        reversedById: "test-cashier",
        reason: "second attempt",
        overrides: { amount: new Decimal(200) },
      })
    ).rejects.toBeInstanceOf(CorrectionError);
  });

  it("rejects correcting a MARKER_ISSUE (excluded type)", async () => {
    const tx = await createTransaction({
      sessionId, gameId, type: "MARKER_ISSUE", createdById: "test-cashier",
      amount: new Decimal(200), method: "CHIPS", playerId,
      entries: [
        { account: "MARKER_OUTSTANDING", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });

    await expect(
      correctTransaction({
        originalId: tx.id,
        reversedById: "test-cashier",
        reason: "test",
        overrides: { amount: new Decimal(300) },
      })
    ).rejects.toBeInstanceOf(CorrectionError);
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm test -- tests/unit/ledger/correct.test.ts
```

Expected: FAIL — module `@/lib/ledger/correct` not found.

- [ ] **Step 3: Implement correctTransaction**

Create `lib/ledger/correct.ts`:

```ts
import Decimal from "decimal.js";
import type { TransactionType, PaymentMethod, AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createTransaction } from "./transaction";

export class CorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorrectionError";
  }
}

const SUPPORTED_TYPES: ReadonlySet<TransactionType> = new Set([
  "BUY_IN", "CASH_OUT", "RAKE", "TIP_DROP",
  "TOURNAMENT_FEE", "TOURNAMENT_PAYOUT",
  "JACKPOT_PAYOUT", "FREEROLL_PRIZE_PAYOUT",
  "STAFF_ADVANCE", "FNB_COST", "DRAWER_COUNT_ADJUST", "CHIP_FLOAT_ADJUST",
]);

const METHOD_TO_ACCOUNT: Record<PaymentMethod, AccountType> = {
  CASH: "CASH_DRAWER",
  ZELLE: "ZELLE",
  VENMO: "VENMO",
  CASHAPP: "CASHAPP",
  APPLE_PAY: "APPLE_PAY",
  OTHER: "CASH_DRAWER",
  CHIPS: "CASH_DRAWER", // never used (chip-only tx don't change method)
};

const METHOD_DERIVED_ACCOUNTS: ReadonlySet<AccountType> = new Set([
  "CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY",
]);

export interface CorrectionOverrides {
  method?: PaymentMethod;
  amount?: Decimal;
  playerId?: string | null;
  tableId?: string | null;
  staffId?: string | null;
  note?: string | null;
}

export interface CorrectTransactionArgs {
  originalId: string;
  reversedById: string;
  reason: string;
  overrides: CorrectionOverrides;
}

export async function correctTransaction(args: CorrectTransactionArgs) {
  const original = await prisma.transaction.findUnique({
    where: { id: args.originalId },
    include: { ledgerEntries: true },
  });
  if (!original) throw new CorrectionError(`Transaction ${args.originalId} not found`);
  if (original.reversesId) throw new CorrectionError("Cannot correct a reversal");
  if (!SUPPORTED_TYPES.has(original.type)) {
    throw new CorrectionError(`Type ${original.type} is not supported by the correction tool. Use the dedicated workflow.`);
  }

  // Has this tx already been reversed?
  const existingReversal = await prisma.transaction.findFirst({ where: { reversesId: args.originalId } });
  if (existingReversal) throw new CorrectionError("This transaction has already been corrected or reversed");

  const originalAmount = new Decimal(original.amount.toString());
  const newAmount = args.overrides.amount ?? originalAmount;
  if (newAmount.lessThanOrEqualTo(0)) throw new CorrectionError("Amount must be greater than zero");

  // Build the new ledger entries by transforming the originals.
  const scale = newAmount.div(originalAmount); // safe: originalAmount > 0 always
  const newMethod = args.overrides.method ?? (original.method as PaymentMethod);
  const targetMethodAccount = METHOD_TO_ACCOUNT[newMethod];

  const newEntries = original.ledgerEntries.map((e) => {
    let account = e.account as AccountType;
    if (
      args.overrides.method !== undefined &&
      METHOD_DERIVED_ACCOUNTS.has(account)
    ) {
      account = targetMethodAccount;
    }
    return {
      account,
      delta: new Decimal(e.delta.toString()).mul(scale),
      gameId: e.gameId,
    };
  });

  return await prisma.$transaction(async () => {
    // 1) Reversal: negated entries, reversesId pointing at original.
    const reversal = await createTransaction({
      sessionId: original.sessionId,
      gameId: original.gameId,
      type: original.type,
      createdById: args.reversedById,
      amount: originalAmount.neg(),
      method: original.method as PaymentMethod,
      playerId: original.playerId,
      staffId: original.staffId,
      tableId: original.tableId,
      reversesId: original.id,
      note: `REVERSAL of ${original.id}: ${args.reason}`,
      entries: original.ledgerEntries.map((e) => ({
        account: e.account as AccountType,
        delta: new Decimal(e.delta.toString()).neg(),
        gameId: e.gameId,
      })),
    });

    // 2) Corrected: same type, new fields, transformed entries.
    const corrected = await createTransaction({
      sessionId: original.sessionId,
      gameId: original.gameId,
      type: original.type,
      createdById: args.reversedById,
      amount: newAmount,
      method: newMethod,
      playerId: args.overrides.playerId !== undefined ? args.overrides.playerId : original.playerId,
      staffId: args.overrides.staffId !== undefined ? args.overrides.staffId : original.staffId,
      tableId: args.overrides.tableId !== undefined ? args.overrides.tableId : original.tableId,
      note: args.overrides.note !== undefined ? args.overrides.note : `Corrected from ${original.id}: ${args.reason}`,
      entries: newEntries,
    });

    return { reversal, corrected };
  });
}
```

- [ ] **Step 4: Run the test, see it pass**

```bash
npm test -- tests/unit/ledger/correct.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 5: Add the Server Action wrapper**

Create `app/(cashier)/_actions/corrections.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { z } from "zod";
import { correctTransaction } from "@/lib/ledger/correct";
import { parseFormData } from "@/lib/validation/transactions";
import { getCashierUserId } from "./_cashier";
import type { PaymentMethod } from "@prisma/client";

const correctionSchema = z.object({
  originalId: z.string().min(1),
  reason: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  method: z.enum(["CASH", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "OTHER"]).optional(),
  playerId: z.string().optional(),
  tableId: z.string().optional(),
  staffId: z.string().optional(),
  note: z.string().optional(),
});

export async function submitCorrection(formData: FormData): Promise<void> {
  const input = parseFormData(correctionSchema, formData);
  const cashierId = await getCashierUserId();

  await correctTransaction({
    originalId: input.originalId,
    reversedById: cashierId,
    reason: input.reason,
    overrides: {
      amount: input.amount ? new Decimal(input.amount) : undefined,
      method: input.method as PaymentMethod | undefined,
      playerId: input.playerId === "" ? null : input.playerId,
      tableId: input.tableId === "" ? null : input.tableId,
      staffId: input.staffId === "" ? null : input.staffId,
      note: input.note,
    },
  });

  revalidatePath("/live");
}
```

- [ ] **Step 6: Build the correction modal**

Create `app/(cashier)/live/_components/tx-correct-modal.tsx`:

```tsx
"use client";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast/use-toast";
import { useFormAction } from "@/components/use-form-action";
import { submitCorrection } from "../../_actions/corrections";

interface OriginalTx {
  id: string;
  type: string;
  amount: string;
  method: string;
  playerName: string | null;
  playerId: string | null;
  tableName: string | null;
  tableId: string | null;
  note: string | null;
}

interface Props {
  tx: OriginalTx;
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
  trigger: React.ReactNode;
}

const METHOD_OPTIONS: Array<[string, string]> = [
  ["CASH", "Cash"], ["ZELLE", "Zelle"], ["VENMO", "Venmo"],
  ["CASHAPP", "CashApp"], ["APPLE_PAY", "Apple Pay"], ["OTHER", "Other"],
];

// Types whose method field is structurally fixed (chip-only, cash-only, or has custom payout-shape logic).
// For these, hide the method dropdown — only amount/player/table/note are editable via correction.
const METHOD_LOCKED_TYPES = new Set([
  "RAKE", "TIP_DROP", "FREEROLL_PRIZE_PAYOUT", "CHIP_FLOAT_ADJUST",
  "JACKPOT_PAYOUT", // CHIPS vs CASH path is a custom dispatch, not a simple account swap
  "STAFF_ADVANCE", "FNB_COST", "DRAWER_COUNT_ADJUST", // CASH-only with EXTERNAL pairing
]);

function CorrectForm({ close, tx, players, tables }: { close: () => void; tx: OriginalTx; players: Props["players"]; tables: Props["tables"] }) {
  const toast = useToast();
  const { onSubmit, pending, error } = useFormAction(submitCorrection, {
    onSuccess: () => {
      toast.show("Correction recorded");
      close();
    },
  });

  const allowMethodEdit = !METHOD_LOCKED_TYPES.has(tx.type);
  const allowPlayerEdit = tx.playerId !== null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="originalId" value={tx.id} />
      <div className="text-xs text-slate-500 bg-black/30 rounded p-2">
        <div><span className="text-slate-400">Type:</span> {tx.type.toLowerCase()}</div>
        <div><span className="text-slate-400">Original amount:</span> ${tx.amount} · {tx.method.toLowerCase()}</div>
        {tx.playerName && <div><span className="text-slate-400">Player:</span> {tx.playerName}</div>}
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Reason (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. wrong method, miscount, wrong player"
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Amount (leave blank to keep ${tx.amount})</span>
        <input type="number" name="amount" step="0.01" min="0.01" placeholder={tx.amount}
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      {allowMethodEdit && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Method (leave blank to keep {tx.method.toLowerCase()})</span>
          <select name="method" defaultValue=""
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— keep {tx.method.toLowerCase()} —</option>
            {METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
      {allowPlayerEdit && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player (leave blank to keep {tx.playerName ?? "—"})</span>
          <select name="playerId" defaultValue=""
            className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— keep —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Table (leave blank to keep)</span>
        <select name="tableId" defaultValue=""
          className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— keep —</option>
          {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button type="submit" disabled={pending}
        className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400 disabled:opacity-50">
        Apply correction
      </button>
    </form>
  );
}

export function TxCorrectModal({ tx, players, tables, trigger }: Props) {
  return (
    <Modal trigger={trigger} title="Correct transaction" description={`Reverses tx ${tx.id.slice(0, 8)} and records the corrected version. The original row is preserved for audit.`}>
      {(close) => <CorrectForm close={close} tx={tx} players={players} tables={tables} />}
    </Modal>
  );
}
```

- [ ] **Step 7: Wire the Correct button into TransactionStream**

Edit `app/(cashier)/live/_components/transaction-stream.tsx`. Add a new column to the grid for the action button. The grid should change from `grid-cols-[60px_1fr_70px_90px_100px]` to `grid-cols-[60px_1fr_70px_90px_100px_70px]`. Also update the prop signature to accept `players` and `tables` (the page passes these in from `prisma.player.findMany` etc.).

Compute `correctable` per row:

```tsx
const CORRECTABLE: ReadonlySet<TransactionType> = new Set([
  "BUY_IN", "CASH_OUT", "RAKE", "TIP_DROP",
  "TOURNAMENT_FEE", "TOURNAMENT_PAYOUT",
  "JACKPOT_PAYOUT", "FREEROLL_PRIZE_PAYOUT",
  "STAFF_ADVANCE", "FNB_COST", "DRAWER_COUNT_ADJUST", "CHIP_FLOAT_ADJUST",
] as const) as ReadonlySet<TransactionType>;

// Inside the txs.findMany call, also include reversedBy: { include: { ... } } is not needed;
// instead, pre-compute which tx ids have been reversed:
const reversedIds = new Set(txs.filter((t) => t.reversesId).map((t) => t.reversesId));

// Per row:
const isReversal = tx.reversesId !== null;
const wasReversed = reversedIds.has(tx.id);
const canCorrect = CORRECTABLE.has(tx.type) && !isReversal && !wasReversed;
```

Render the column:

```tsx
<div className="self-center text-right">
  {canCorrect ? (
    <TxCorrectModal
      tx={{
        id: tx.id, type: tx.type, amount: tx.amount.toString(), method: tx.method,
        playerName: tx.player?.displayName ?? null, playerId: tx.player?.id ?? null,
        tableName: tx.table?.name ?? null, tableId: tx.table?.id ?? null,
        note: tx.note,
      }}
      players={players}
      tables={tables}
      trigger={
        <button className="text-xs text-slate-500 hover:text-amber-400 hover:underline cursor-pointer">
          correct
        </button>
      }
    />
  ) : isReversal ? (
    <span className="text-xs text-slate-600 italic">reversal</span>
  ) : wasReversed ? (
    <span className="text-xs text-slate-600 italic">corrected</span>
  ) : null}
</div>
```

The `players` and `tables` arrays are passed as props from the live page; pull them from existing queries (the BuyInModal already receives `players` and `tables` via its wrapper).

- [ ] **Step 8: Pass players + tables down from the live page**

Edit `app/(cashier)/live/page.tsx`. Add `prisma.player.findMany` and `prisma.table.findMany` calls and pass the results to `TransactionStream`:

```tsx
const players = await prisma.player.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true } });
const tables = await prisma.table.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

// ...
<TransactionStream sessionId={session.id} activeGameId={activeGameId} players={players} tables={tables} />
```

Update `TransactionStreamProps`:

```tsx
interface TransactionStreamProps {
  sessionId: string;
  activeGameId: string | "all";
  players: Array<{ id: string; displayName: string }>;
  tables: Array<{ id: string; name: string }>;
}
```

- [ ] **Step 9: Manual smoke test — the Yvonne case end to end**

1. Open a session.
2. Record a buy-in for any player: amount $250, method CASHAPP.
3. Verify the AccountStrip shows `CashApp $250` and `Chip float $250`.
4. Click `correct` on the buy-in row in the tx stream.
5. In the modal, leave amount blank, change method to APPLE_PAY, enter reason `wrong method`, submit.
6. Verify a toast appears (`Correction recorded`), and the modal closes.
7. Verify the AccountStrip now shows `Apple Pay $250` and `CashApp` is hidden (zero balance).
8. Verify the tx stream now has three rows for that buy-in: the original (greyed-out, no `correct` button, label `corrected`), the reversal (italicized, label `reversal`), and the new corrected one.

- [ ] **Step 10: Commit**

```bash
git add lib/ledger/correct.ts tests/unit/ledger/correct.test.ts app/\(cashier\)/_actions/corrections.ts app/\(cashier\)/live/_components/tx-correct-modal.tsx app/\(cashier\)/live/_components/transaction-stream.tsx app/\(cashier\)/live/page.tsx
git commit -m "feat(cashier): in-product transaction correction"
```

---

## Final verification

After all five tasks, run the full test suite and a quick E2E smoke:

```bash
npm test
npm run test:e2e
```

Expected: all unit tests pass, existing E2E suite still passes. No new E2E required for Plan 1c (manual QA covered the surfaces).

Then run a fresh playtest of the Yvonne flow (Step 9 above) end to end and confirm the correction lands cleanly.

---

## Self-review notes (for the controller)

- **Spec coverage:** all 6 followups items in `2026-05-06-plan-1c-scope.md` are mapped to tasks 1-5 (items 2 and 3 share Task 2; item 4 is Task 1; item 5 is Task 3; item 6 is Task 4; item 1 is Task 5).
- **Type consistency:** `ActivityRow`, `PlayerActivity`, `StaffActivity`, `SummaryItem`, `CorrectionOverrides`, `CorrectTransactionArgs` are all defined in single locations and consumed verbatim across tasks.
- **No placeholders:** every step has either runnable code, an exact command, or a specific manual-test instruction with expected outcome.
- **TDD discipline:** Tasks 2-5 each follow write-test → see-fail → implement → see-pass. Task 1 is UI-heavy and relies on manual smoke testing (toast + modal pattern is hard to unit-test meaningfully).
- **Test pattern:** All new tests follow the existing `tests/unit/ledger/buy-in.test.ts` pattern: `import { testPrisma, resetDatabase } from "../test-db"` (or `"./test-db"` for top-level tests), use `beforeEach(resetDatabase)`, and exercise `createTransaction` directly rather than the Server Actions (Server Actions depend on `getCashierUserId()` looking up `cashier@dev.local` by email, which is not seeded by `resetDatabase`; `resetDatabase` seeds `id: "test-cashier"` instead).
- **Rules of Hooks:** All modal forms in Tasks 1 and 5 are split into `XxxForm` sub-components so hooks (`useToast`, `useFormAction`, `useState`, `useEffect`) live inside a regular component, not inside the `Modal` render-prop callback.
