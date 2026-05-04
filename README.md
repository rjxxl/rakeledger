# RakeLedger

Web app that replaces the spreadsheet workflow at a small private poker room.
Append-only multi-account ledger, cashier-driven transaction recording, end-of-night reconciliation.

**Plan 1 + 1b status:** cashier-only foundation, fully featured. No auth in this plan — runs on a local machine, used by the cashier directly. Auth + runner mobile + owner dashboards come in subsequent plans.

## What's working

- 14 transaction types (buy-in, cash-out, rake, tip drop, marker issue/repay, freeroll prize, tournament fee/payout, jackpot, staff advance, F&B cost, drawer/chip-float adjusts, walks/returns)
- Concurrent games per session with a Game switcher and per-game Rake/Promo/Tournament pools
- Multi-step end-of-night close-out: tip payout (per-staff tax + rounding), house tax distribution, per-game rake distribution, walks/returns reconciliation, divergence finder, per-account counts
- Append-only ledger with double-entry validation enforced at both the application and database levels
- Modal-based Quick Actions UI (no overflow scrolling)
- Hourly drop tracker with cadence color coding
- Test isolation: tests run against a separate `rakeledger_test` database

## Local development

### Prerequisites

- Node.js 20+
- Docker (for Postgres)
- npm

### Setup

```bash
# 1. Start Postgres
docker compose up -d

# 2. Install dependencies
npm install

# 3. Apply migrations and seed default users (dev database)
npx prisma migrate dev
npx prisma db seed

# 4. Set up the test database
docker compose exec -T postgres psql -U rakeledger -d rakeledger \
  -c "CREATE DATABASE rakeledger_test OWNER rakeledger;"
cp .env.test.example .env.test
npx dotenv -e .env.test -- npx prisma migrate deploy

# 5. Start dev server
npm run dev
```

Visit http://localhost:3000.

### Tests

```bash
# Unit + integration (Vitest, runs against rakeledger_test)
npm test

# E2E (Playwright; uses the dev database — runs prisma reset + seed in beforeEach)
npm run test:e2e
```

## Project structure

- `prisma/schema.prisma` — full data model (14 entities)
- `prisma/triggers.sql` — append-only and balanced-entry DB triggers
- `lib/ledger/` — core append-only ledger (createTransaction, balance, time-travel, reversals)
- `lib/reconciliation/heuristics.ts` — variance detection (equal-and-opposite, outliers, decimal typos, orphans)
- `lib/payouts/tip-payout.ts` — tip payout calculation with per-staff tax + banker's rounding
- `lib/validation/` — Zod schemas for all Server Action inputs
- `lib/drops/last-drop.ts` — hourly drop tracker computation
- `app/(cashier)/` — cashier UI routes
  - `live/` — live session dashboard with Quick Actions and modal forms
  - `close/` — multi-step end-of-night close-out
  - `players/`, `staff/`, `tables/` — entity CRUD
  - `_actions/` — Server Actions (transactions, session, games, walks, payouts, players, staff, tables)
- `tests/unit/ledger/` — ledger module tests
- `tests/unit/reconciliation/` — heuristic tests
- `tests/e2e/` — Playwright smoke tests

## Default seeded users (Plan 1)

- "Cashier" (`cashier@dev.local`) — implicit user; all transactions recorded by this user
- "Dealer Jake", "Dealer Anna" — sample dealers
- "Waitress Lila" — sample waitress

## Workflow

1. Open a session (with optional starting cash float)
2. Add players via /players, staff via /staff, tables via /tables
3. (Optional) Open additional games via the GameManager in the side panel
4. Record transactions from the live session view via the Quick Actions modals
5. Close the session via /close — multi-step flow: pay out tips with tax → distribute house tax → distribute rake per game → resolve walks/returns → review diagnostics → count and reconcile accounts → freeze

## What's next

Plan 2 (auth + runner mobile + production deployment) and Plan 3 (owner dashboards + admin panel + CSV export) are still to come.
