# RakeLedger

Web app that replaces the spreadsheet workflow at a small private poker room.
Append-only multi-account ledger, cashier-driven transaction recording, end-of-night reconciliation.

**Plan 1 status:** cashier-only foundation. No auth in this plan — runs on a local machine, used by the cashier directly. Auth + runner mobile + owner dashboards come in subsequent plans.

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

# 3. Apply migrations and seed default users
npx prisma migrate dev
npx prisma db seed

# 4. Start dev server
npm run dev
```

Visit http://localhost:3000.

### Tests

```bash
# Unit + integration (Vitest, hits the DB)
npm test

# E2E (Playwright, full night smoke test)
npm run test:e2e
```

## Project structure

- `prisma/schema.prisma` — full data model
- `prisma/triggers.sql` — append-only and balanced-entry DB triggers
- `lib/ledger/` — core append-only ledger module (heart of the system)
- `app/(cashier)/` — cashier UI routes
- `tests/unit/ledger/` — ledger module tests

## Default seeded users (Plan 1)

- "Cashier" — implicit user; all transactions recorded by this user
- "Dealer Jake", "Dealer Anna" — sample dealers (no logins in Plan 1)
- "Waitress Lila" — sample waitress

## Workflow

1. Open a session (with optional starting cash float)
2. Add players via /players, staff via /staff, tables via /tables
3. Record transactions from the live session view: buy-ins, cash-outs, rake, tip drops, markers
4. Close the session via /close — count each account, record variances, freeze
