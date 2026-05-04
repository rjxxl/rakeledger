# Plan 1 — Cashier Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a no-auth, cashier-centric web app that replaces the friend's Google Sheet workflow for the most common nightly operations. The cashier can open a session, manage players/staff/tables, record buy-ins/cash-outs/rake/tip-drops/markers, and close the session with per-account reconciliation. Full operational depth (freerolls, walks/returns, divergence finder, etc.) ships in Plan 1b; auth + runner mobile in Plan 2; owner dashboards + admin panel in Plan 3.

**Architecture:** Next.js 16 App Router + TypeScript + Tailwind v4. Postgres + Prisma. The append-only multi-account ledger lives in `lib/ledger/`. Double-entry validation uses a type-aware sign convention; append-only is enforced by Postgres triggers. Routes split via App Router groups: `(cashier)/` for the cage UI; `api/` only for server actions called from client-side forms (most mutations go through Server Actions directly). All money values use `decimal.js` / `Prisma.Decimal` — never JS floats. The full schema (including entities used in later plans) is created up-front so Plan 1b doesn't require migrations.

**Tech Stack:** Next.js 16, TypeScript, Tailwind CSS v4, Prisma 6, Postgres 16 (Docker locally), Zod, decimal.js, Vitest, Playwright

---

## File Structure

Created during this plan:

```
poker-room-accounting/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── docker-compose.yml                  # Postgres for local dev
├── .env.example, .env
├── prisma/
│   ├── schema.prisma                   # full data model
│   ├── migrations/                     # Prisma-generated
│   ├── triggers.sql                    # append-only + balanced-entry triggers
│   └── seed.ts                         # default cashier + sample dealers/waitresses
├── lib/
│   ├── db.ts                           # Prisma client singleton
│   ├── ledger/
│   │   ├── accounts.ts                 # account list + natural-sign map
│   │   ├── balance.ts                  # SUM(delta) queries
│   │   ├── validate.ts                 # double-entry balance check
│   │   ├── transaction.ts              # createTransaction + reverseTransaction
│   │   └── time-travel.ts              # balance-at-T queries
│   └── format.ts                       # money formatting helpers
├── app/
│   ├── layout.tsx                      # root layout, theme, fonts
│   ├── page.tsx                        # redirect to /live
│   ├── globals.css
│   └── (cashier)/
│       ├── layout.tsx                  # sidebar + main area
│       ├── live/
│       │   ├── page.tsx                # live session dashboard
│       │   └── _components/
│       │       ├── account-strip.tsx
│       │       ├── transaction-stream.tsx
│       │       ├── quick-actions.tsx
│       │       └── tx-modal.tsx        # generic modal wrapper
│       ├── close/
│       │   └── page.tsx                # close-out reconciliation flow
│       ├── players/
│       │   ├── page.tsx                # list
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx           # edit
│       ├── staff/
│       │   ├── page.tsx                # list
│       │   ├── new/page.tsx
│       │   └── [id]/page.tsx
│       ├── tables/
│       │   └── page.tsx                # list + inline create
│       └── _actions/                   # Server Actions
│           ├── session.ts              # openSession, closeSession
│           ├── transactions.ts         # createBuyIn, createCashOut, etc.
│           ├── players.ts
│           ├── staff.ts
│           └── tables.ts
├── components/                         # shared UI primitives
│   ├── nav-sidebar.tsx
│   ├── theme.tsx                       # dark theme constants
│   ├── money.tsx                       # <Money amount={...} />
│   └── form-fields.tsx                 # styled inputs, selects, etc.
└── tests/
    ├── unit/
    │   └── ledger/
    │       ├── balance.test.ts
    │       ├── validate.test.ts
    │       ├── transaction.test.ts
    │       └── time-travel.test.ts
    └── e2e/
        └── full-night.spec.ts          # Playwright happy path
```

---

## Task 1: Initialize Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`

- [ ] **Step 1: Run create-next-app**

```bash
cd /c/Users/rjxxl/projects/poker-room-accounting
npx create-next-app@latest . --typescript --tailwind --app --no-eslint --src-dir=false --import-alias="@/*" --turbopack --use-npm
```

When prompted to overwrite existing files (the `.superpowers/` brainstorm dir and `docs/`), choose to keep them.

- [ ] **Step 2: Verify the dev server starts**

```bash
npm run dev
```

Expected: server boots on http://localhost:3000 showing the default Next.js page. Stop with Ctrl+C.

- [ ] **Step 3: Initialize git and make first commit**

```bash
git init
git add .
git commit -m "chore: initialize Next.js 15 + TypeScript + Tailwind project"
```

---

## Task 2: Set up Postgres locally with Docker Compose

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.env`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: poker
      POSTGRES_PASSWORD: poker_dev
      POSTGRES_DB: poker_room_accounting
    ports:
      - "5432:5432"
    volumes:
      - poker_pg_data:/var/lib/postgresql/data

volumes:
  poker_pg_data:
```

- [ ] **Step 2: Write `.env.example`**

```
DATABASE_URL="postgresql://poker:poker_dev@localhost:5432/poker_room_accounting?schema=public"
```

- [ ] **Step 3: Copy to `.env` (gitignored) and start Postgres**

```bash
cp .env.example .env
docker compose up -d
```

Verify it's running:

```bash
docker compose ps
```

Expected: `postgres` service shows `running`.

- [ ] **Step 4: Add `.env` to `.gitignore` and commit**

Append `.env` to `.gitignore` (it should already be there from create-next-app, verify with `grep "^\.env$" .gitignore`).

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "chore: add docker-compose for local Postgres"
```

---

## Task 3: Install Prisma + supporting libs

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install @prisma/client decimal.js zod
npm install -D prisma vitest @vitest/coverage-v8 @types/node tsx playwright @playwright/test
```

- [ ] **Step 2: Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

This creates `prisma/schema.prisma` with default content and adds `DATABASE_URL` to `.env`. We already have `DATABASE_URL` set, so Prisma should pick it up. If `prisma init` overwrote `.env`, restore the URL from `.env.example`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json prisma/
git commit -m "chore: install Prisma, decimal.js, Zod, Vitest, Playwright"
```

---

## Task 4: Write the Prisma schema (full data model)

**Files:**
- Modify: `prisma/schema.prisma`

The schema below includes ALL entities from the spec, including ones we won't use until Plan 1b/2/3 (Role, UserCapabilityGrant, etc.). Including them now means no migrations later.

- [ ] **Step 1: Replace `prisma/schema.prisma` with the full schema**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserRole {
  OWNER
  ADMIN
  CASHIER
  RUNNER
  DEALER     // staff record only — no login in v1
  WAITRESS   // staff record only — no login in v1
}

enum UserStatus {
  PENDING
  ACTIVE
  DISABLED
}

enum AccountType {
  CASH_DRAWER
  ZELLE
  VENMO
  CASHAPP
  APPLE_PAY
  CHIP_FLOAT
  MARKER_OUTSTANDING
  TIP_POOL
  HOUSE_TAX_POOL
  RAKE_POOL
  PROMO_POOL
  TOURNAMENT_POOL
  EXTERNAL
}

enum PaymentMethod {
  CASH
  ZELLE
  VENMO
  CASHAPP
  APPLE_PAY
  OTHER
  CHIPS    // for in-cage flows like rake/tip drops where chips are the medium
}

enum TransactionType {
  BUY_IN
  CASH_OUT
  RAKE
  TOURNAMENT_FEE
  TOURNAMENT_PAYOUT
  TIP_DROP
  TIP_HOUSE_TAX
  TIP_PAYOUT
  MARKER_ISSUE
  MARKER_REPAY
  MARKER_WRITE_OFF
  FREEROLL_PRIZE_PAYOUT
  JACKPOT_PAYOUT
  STAFF_ADVANCE
  FNB_COST
  CHIP_WALK
  CHIP_RETURN
  DRAWER_COUNT_ADJUST
  CHIP_FLOAT_ADJUST
  RAKE_DISTRIBUTION
  HOUSE_TAX_DISTRIBUTION
  OPENING_FLOAT
  CLOSING_FLOAT
}

enum SessionStatus {
  OPEN
  CLOSED
}

enum GameStatus {
  OPEN
  CLOSED
}

enum MarkerStatus {
  OPEN
  REPAID
  WRITTEN_OFF
}

enum PickupStatus {
  PENDING
  SETTLED
  CANCELLED
}

model Role {
  id            String    @id @default(cuid())
  name          String    @unique
  isSystem      Boolean   @default(false)
  description   String?
  capabilities  String[]  // capability key list
  markerLimit   Decimal?  @db.Decimal(12, 2)
  users         User[]
}

model User {
  id            String    @id @default(cuid())
  name          String
  email         String?   @unique
  googleSub     String?   @unique
  role          UserRole
  status        UserStatus @default(ACTIVE)
  pinHash       String?
  tipTaxRate    Decimal?  @db.Decimal(5, 4)  // null = use system default; e.g. 0.2000 = 20%
  notes         String?
  customRoleId  String?
  customRole    Role?     @relation(fields: [customRoleId], references: [id])
  createdAt     DateTime  @default(now())

  capabilityGrants UserCapabilityGrant[]
  openedSessions   Session[] @relation("SessionOpenedBy")
  closedSessions   Session[] @relation("SessionClosedBy")
  txCreated        Transaction[] @relation("TxCreatedBy")
  txStaff          Transaction[] @relation("TxStaff")
  outgoingHandoffs CashierHandoff[] @relation("HandoffOutgoing")
  incomingHandoffs CashierHandoff[] @relation("HandoffIncoming")
  rakeReceived     RakeDistribution[]
  accountClosesBy  SessionAccountClose[]
}

model UserCapabilityGrant {
  id            String    @id @default(cuid())
  user          User      @relation(fields: [userId], references: [id])
  userId        String
  capabilityKey String
  mode          String    // "grant" | "revoke"
  grantedById   String
  grantedAt     DateTime  @default(now())
  reason        String?

  @@index([userId])
}

model Player {
  id            String    @id @default(cuid())
  displayName   String
  phone         String?
  notes         String?
  createdAt     DateTime  @default(now())

  transactions  Transaction[]
  markers       Marker[]
}

model Table {
  id            String    @id @default(cuid())
  name          String    @unique
  gameId        String?
  game          Game?     @relation(fields: [gameId], references: [id])
  stakes        String?
  active        Boolean   @default(true)

  transactions  Transaction[]
}

model Session {
  id            String    @id @default(cuid())
  status        SessionStatus @default(OPEN)
  openedAt      DateTime  @default(now())
  closedAt      DateTime?
  openedById    String
  openedBy      User      @relation("SessionOpenedBy", fields: [openedById], references: [id])
  closedById    String?
  closedBy      User?     @relation("SessionClosedBy", fields: [closedById], references: [id])
  openingCash   Decimal   @default(0) @db.Decimal(12, 2)
  closingCash   Decimal?  @db.Decimal(12, 2)
  notes         String?

  games         Game[]
  transactions  Transaction[]
  accountCloses SessionAccountClose[]
  rakeDistributions RakeDistribution[]
  cashierHandoffs CashierHandoff[]
  markersIssued Marker[]
}

model Game {
  id              String    @id @default(cuid())
  session         Session   @relation(fields: [sessionId], references: [id])
  sessionId       String
  name            String
  gameType        String?
  stakes          String?
  rakeSplitConfig Json
  status          GameStatus @default(OPEN)
  openedAt        DateTime  @default(now())
  closedAt        DateTime?

  tables          Table[]
  transactions    Transaction[]
  ledgerEntries   LedgerEntry[]
  rakeDistributions RakeDistribution[]
}

model Transaction {
  id              String    @id @default(cuid())
  session         Session   @relation(fields: [sessionId], references: [id])
  sessionId       String
  game            Game?     @relation(fields: [gameId], references: [id])
  gameId          String?
  type            TransactionType
  createdAt       DateTime  @default(now())
  createdBy       User      @relation("TxCreatedBy", fields: [createdById], references: [id])
  createdById     String
  player          Player?   @relation(fields: [playerId], references: [id])
  playerId        String?
  staff           User?     @relation("TxStaff", fields: [staffId], references: [id])
  staffId         String?
  table           Table?    @relation(fields: [tableId], references: [id])
  tableId         String?
  amount          Decimal   @db.Decimal(12, 2)
  method          PaymentMethod
  note            String?
  reverses        Transaction? @relation("Reversal", fields: [reversesId], references: [id])
  reversesId      String?
  reversedBy      Transaction[] @relation("Reversal")
  pickupStatus    PickupStatus?
  pickupConfirmedAt DateTime?
  pickupConfirmedById String?
  pickupEscalatedAt DateTime?
  roundingAdjustment Decimal? @db.Decimal(12, 4)  // for tip_house_tax

  ledgerEntries   LedgerEntry[]
  marker          Marker?  @relation("MarkerIssueTx")

  @@index([sessionId, createdAt])
  @@index([playerId])
  @@index([staffId])
}

model LedgerEntry {
  id              String    @id @default(cuid())
  transaction     Transaction @relation(fields: [transactionId], references: [id])
  transactionId   String
  account         AccountType
  game            Game?     @relation(fields: [gameId], references: [id])
  gameId          String?
  delta           Decimal   @db.Decimal(12, 2)
  createdAt       DateTime  @default(now())

  @@index([account, transactionId])
  @@index([gameId, account])
}

model Marker {
  id              String    @id @default(cuid())
  player          Player    @relation(fields: [playerId], references: [id])
  playerId        String
  issuedInSession Session   @relation(fields: [sessionId], references: [id])
  sessionId       String
  issuedTx        Transaction @relation("MarkerIssueTx", fields: [issuedTxId], references: [id])
  issuedTxId      String    @unique
  amount          Decimal   @db.Decimal(12, 2)
  repaidAmount    Decimal   @default(0) @db.Decimal(12, 2)
  status          MarkerStatus @default(OPEN)
  collateral      String?
  createdAt       DateTime  @default(now())

  @@index([playerId, status])
}

model SessionAccountClose {
  id              String    @id @default(cuid())
  session         Session   @relation(fields: [sessionId], references: [id])
  sessionId       String
  account         AccountType
  gameId          String?
  expected        Decimal   @db.Decimal(12, 2)
  counted         Decimal   @db.Decimal(12, 2)
  variance        Decimal   @db.Decimal(12, 2)
  countedBy       User      @relation(fields: [countedById], references: [id])
  countedById     String
  countedAt       DateTime  @default(now())
  note            String?

  @@unique([sessionId, account, gameId])
}

model RakeDistribution {
  id              String    @id @default(cuid())
  session         Session   @relation(fields: [sessionId], references: [id])
  sessionId       String
  game            Game      @relation(fields: [gameId], references: [id])
  gameId          String
  recipient       User      @relation(fields: [recipientUserId], references: [id])
  recipientUserId String
  amount          Decimal   @db.Decimal(12, 2)
  txId            String    @unique
}

model CashierHandoff {
  id              String    @id @default(cuid())
  session         Session   @relation(fields: [sessionId], references: [id])
  sessionId       String
  outgoing        User      @relation("HandoffOutgoing", fields: [outgoingUserId], references: [id])
  outgoingUserId  String
  incoming        User      @relation("HandoffIncoming", fields: [incomingUserId], references: [id])
  incomingUserId  String
  handedOffAt     DateTime  @default(now())
  accountCounts   Json
  notes           String?
}

model SystemSettings {
  id                       Int      @id @default(1)
  defaultTipTaxRate        Decimal  @default(0.20) @db.Decimal(5, 4)
  pickupTimeoutSeconds     Int      @default(300)
  rakeSplitDefaults        Json     @default("{}")
  houseTaxSplitDefaults    Json     @default("{}")
}
```

- [ ] **Step 2: Run prisma format and generate**

```bash
npx prisma format
npx prisma migrate dev --name init
```

Expected: migration created at `prisma/migrations/YYYYMMDDHHMMSS_init/migration.sql`. Prisma client generated.

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: define full Prisma schema with all entities"
```

---

## Task 5: Add database triggers (append-only + balanced entries + closed-session lock)

**Files:**
- Create: `prisma/triggers.sql`
- Create migration: `prisma/migrations/YYYYMMDDHHMMSS_triggers/migration.sql`

- [ ] **Step 1: Write `prisma/triggers.sql`**

```sql
-- Append-only on Transaction and LedgerEntry: block UPDATE and DELETE
CREATE OR REPLACE FUNCTION block_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only; UPDATE/DELETE blocked', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_tx_update BEFORE UPDATE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION block_modification();
CREATE TRIGGER block_tx_delete BEFORE DELETE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION block_modification();
CREATE TRIGGER block_le_update BEFORE UPDATE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION block_modification();
CREATE TRIGGER block_le_delete BEFORE DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION block_modification();

-- Closed session is frozen: no new transactions for closed sessions
CREATE OR REPLACE FUNCTION check_session_open() RETURNS trigger AS $$
DECLARE
  s_status text;
BEGIN
  SELECT status INTO s_status FROM "Session" WHERE id = NEW."sessionId";
  IF s_status = 'CLOSED' THEN
    RAISE EXCEPTION 'Cannot insert Transaction into closed session %', NEW."sessionId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tx_session_must_be_open BEFORE INSERT ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION check_session_open();

-- Balanced double-entry check: deferred until COMMIT so we can insert tx + entries together
CREATE OR REPLACE FUNCTION check_tx_balanced() RETURNS trigger AS $$
DECLARE
  total_signed numeric(14,2);
  entry_count int;
BEGIN
  SELECT COUNT(*),
         COALESCE(SUM(
           le.delta * CASE le.account
             WHEN 'CHIP_FLOAT' THEN -1
             WHEN 'TIP_POOL' THEN -1
             WHEN 'TOURNAMENT_POOL' THEN -1
             WHEN 'RAKE_POOL' THEN -1
             WHEN 'HOUSE_TAX_POOL' THEN -1
             ELSE 1  -- assets, expense (PROMO_POOL), and EXTERNAL all use +1
           END
         ), 0)
  INTO entry_count, total_signed
  FROM "LedgerEntry" le
  WHERE le."transactionId" = NEW.id;

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'Transaction % has only % ledger entries; minimum is 2', NEW.id, entry_count
      USING ERRCODE = 'check_violation';
  END IF;
  IF total_signed <> 0 THEN
    RAISE EXCEPTION 'Transaction % unbalanced: signed sum = %', NEW.id, total_signed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Use a deferred constraint trigger so the check runs at COMMIT, not after each INSERT
CREATE CONSTRAINT TRIGGER tx_must_be_balanced
  AFTER INSERT ON "Transaction"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_tx_balanced();
```

- [ ] **Step 2: Apply triggers via a manual migration**

```bash
npx prisma migrate dev --create-only --name triggers
```

This creates an empty migration directory. Copy `triggers.sql` content into the new migration's `migration.sql` file:

```bash
# find the new migration directory (the most recent one)
TRIG_DIR=$(ls -td prisma/migrations/*_triggers | head -1)
cat prisma/triggers.sql > "$TRIG_DIR/migration.sql"
```

- [ ] **Step 3: Apply the migration**

```bash
npx prisma migrate dev
```

Expected: migration applied; no errors.

- [ ] **Step 4: Manually verify trigger by attempting an UPDATE**

```bash
docker compose exec postgres psql -U poker -d poker_room_accounting -c 'UPDATE "Transaction" SET amount = 100 WHERE id = '"'"'nonexistent'"'"';'
```

Expected: error `Table Transaction is append-only; UPDATE/DELETE blocked` (even though the row doesn't exist, the trigger fires; if it instead reports 0 rows updated without firing, then the trigger isn't installed correctly — recheck the migration).

- [ ] **Step 5: Commit**

```bash
git add prisma/triggers.sql prisma/migrations/
git commit -m "feat: add append-only and balanced-entry DB triggers"
```

---

## Task 6: Create the Prisma client singleton

**Files:**
- Create: `lib/db.ts`

- [ ] **Step 1: Write `lib/db.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/db.ts
git commit -m "feat: add Prisma client singleton"
```

---

## Task 7: Seed initial data

**Files:**
- Create: `prisma/seed.ts`
- Modify: `package.json` (add prisma seed config)

- [ ] **Step 1: Write `prisma/seed.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Single seeded cashier — used as the implicit user for all transactions in Plan 1
  const cashier = await prisma.user.upsert({
    where: { email: "cashier@dev.local" },
    update: {},
    create: {
      name: "Cashier",
      email: "cashier@dev.local",
      role: "CASHIER",
      status: "ACTIVE",
    },
  });

  // Sample dealers and waitresses (no logins)
  await prisma.user.upsert({
    where: { email: "jake@dev.local" },
    update: {},
    create: { name: "Dealer Jake", email: "jake@dev.local", role: "DEALER", status: "ACTIVE" },
  });
  await prisma.user.upsert({
    where: { email: "anna@dev.local" },
    update: {},
    create: { name: "Dealer Anna", email: "anna@dev.local", role: "DEALER", status: "ACTIVE" },
  });
  await prisma.user.upsert({
    where: { email: "lila@dev.local" },
    update: {},
    create: { name: "Waitress Lila", email: "lila@dev.local", role: "WAITRESS", status: "ACTIVE" },
  });

  // System settings singleton
  await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  console.log(`Seed complete. Cashier id: ${cashier.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Add seed config to `package.json`**

Add this top-level key to `package.json`:

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 3: Run the seed**

```bash
npx prisma db seed
```

Expected: prints "Seed complete. Cashier id: <cuid>".

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts package.json
git commit -m "feat: seed default cashier + sample dealers/waitresses"
```

---

## Task 8: Configure Vitest

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Add test script to `package.json`**

In the `"scripts"` section, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test"
```

- [ ] **Step 3: Verify Vitest runs (with no tests yet)**

```bash
npm test
```

Expected: "No test files found" — that's fine, just confirms it works.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts package.json
git commit -m "chore: configure Vitest"
```

---

## Task 9: Define account types and natural-sign convention

**Files:**
- Create: `lib/ledger/accounts.ts`
- Create: `tests/unit/ledger/accounts.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/ledger/accounts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { naturalSign, ACCOUNTS, GAME_SCOPED_ACCOUNTS } from "@/lib/ledger/accounts";

describe("account natural sign", () => {
  it("assigns +1 to assets", () => {
    expect(naturalSign("CASH_DRAWER")).toBe(1);
    expect(naturalSign("ZELLE")).toBe(1);
    expect(naturalSign("MARKER_OUTSTANDING")).toBe(1);
  });

  it("assigns -1 to liabilities", () => {
    expect(naturalSign("CHIP_FLOAT")).toBe(-1);
    expect(naturalSign("TIP_POOL")).toBe(-1);
    expect(naturalSign("TOURNAMENT_POOL")).toBe(-1);
  });

  it("assigns -1 to revenue accounts", () => {
    expect(naturalSign("RAKE_POOL")).toBe(-1);
    expect(naturalSign("HOUSE_TAX_POOL")).toBe(-1);
  });

  it("assigns +1 to expense accounts", () => {
    expect(naturalSign("PROMO_POOL")).toBe(1);
  });

  it("assigns +1 to external", () => {
    expect(naturalSign("EXTERNAL")).toBe(1);
  });

  it("includes all 13 accounts in ACCOUNTS list", () => {
    expect(ACCOUNTS.length).toBe(13);
  });

  it("marks game-scoped accounts correctly", () => {
    expect(GAME_SCOPED_ACCOUNTS).toEqual(
      expect.arrayContaining(["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"])
    );
    expect(GAME_SCOPED_ACCOUNTS).not.toContain("CASH_DRAWER");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/unit/ledger/accounts.test.ts
```

Expected: FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Write `lib/ledger/accounts.ts`**

```typescript
import type { AccountType } from "@prisma/client";

export const ACCOUNTS: AccountType[] = [
  "CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY",
  "CHIP_FLOAT", "MARKER_OUTSTANDING",
  "TIP_POOL", "HOUSE_TAX_POOL",
  "RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL",
  "EXTERNAL",
];

export const GAME_SCOPED_ACCOUNTS: AccountType[] = [
  "RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL",
];

const ASSETS: AccountType[] = ["CASH_DRAWER", "ZELLE", "VENMO", "CASHAPP", "APPLE_PAY", "MARKER_OUTSTANDING"];
const LIABILITIES: AccountType[] = ["CHIP_FLOAT", "TIP_POOL", "TOURNAMENT_POOL"];
const REVENUES: AccountType[] = ["RAKE_POOL", "HOUSE_TAX_POOL"];
const EXPENSES: AccountType[] = ["PROMO_POOL"];
const EXTERNALS: AccountType[] = ["EXTERNAL"];

export function naturalSign(account: AccountType): 1 | -1 {
  if (LIABILITIES.includes(account) || REVENUES.includes(account)) return -1;
  if (ASSETS.includes(account) || EXPENSES.includes(account) || EXTERNALS.includes(account)) return 1;
  throw new Error(`Unknown account: ${account}`);
}

export function isGameScoped(account: AccountType): boolean {
  return GAME_SCOPED_ACCOUNTS.includes(account);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/unit/ledger/accounts.test.ts
```

Expected: all 7 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/accounts.ts tests/unit/ledger/accounts.test.ts
git commit -m "feat(ledger): account types and natural-sign convention"
```

---

## Task 10: Implement double-entry validation

**Files:**
- Create: `lib/ledger/validate.ts`
- Create: `tests/unit/ledger/validate.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/ledger/validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { validateBalanced, BalanceError } from "@/lib/ledger/validate";

const D = (n: string | number) => new Decimal(n);

describe("validateBalanced", () => {
  it("accepts a valid 2-leg buy_in (cash + chip_float)", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(200) },
        { account: "CHIP_FLOAT", delta: D(200) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid 2-leg cash_out (both decrease)", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(-150) },
        { account: "CHIP_FLOAT", delta: D(-150) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid 2-leg rake (chip_float ↓, rake_pool ↑)", () => {
    expect(() =>
      validateBalanced([
        { account: "CHIP_FLOAT", delta: D(-50) },
        { account: "RAKE_POOL", delta: D(50) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid 2-leg tip_payout (both decrease — settle liability with asset)", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(-70) },
        { account: "TIP_POOL", delta: D(-70) },
      ])
    ).not.toThrow();
  });

  it("accepts a valid freeroll_prize_payout (chip_float ↑, promo_pool ↑)", () => {
    expect(() =>
      validateBalanced([
        { account: "CHIP_FLOAT", delta: D(225) },
        { account: "PROMO_POOL", delta: D(225) },
      ])
    ).not.toThrow();
  });

  it("rejects an unbalanced transaction", () => {
    expect(() =>
      validateBalanced([
        { account: "CASH_DRAWER", delta: D(200) },
        { account: "CHIP_FLOAT", delta: D(100) },
      ])
    ).toThrow(BalanceError);
  });

  it("rejects a single-entry transaction", () => {
    expect(() =>
      validateBalanced([{ account: "CASH_DRAWER", delta: D(100) }])
    ).toThrow(/at least 2 entries/);
  });

  it("accepts a 3-leg balanced transaction", () => {
    expect(() =>
      validateBalanced([
        { account: "TIP_POOL", delta: D(-87) },     // settle full tip pool slice
        { account: "CASH_DRAWER", delta: D(-70) },  // pay $70 cash
        { account: "HOUSE_TAX_POOL", delta: D(17) }, // $17 to house
      ])
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/unit/ledger/validate.test.ts
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write `lib/ledger/validate.ts`**

```typescript
import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";
import { naturalSign } from "./accounts";

export class BalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceError";
  }
}

export interface LedgerEntryInput {
  account: AccountType;
  delta: Decimal;
  gameId?: string | null;
}

/**
 * Validates that a set of ledger entries forms a balanced double-entry transaction.
 * Sum of (delta * naturalSign(account)) must equal 0.
 * Throws BalanceError if invalid.
 */
export function validateBalanced(entries: LedgerEntryInput[]): void {
  if (entries.length < 2) {
    throw new BalanceError(`A transaction requires at least 2 entries; got ${entries.length}`);
  }

  let signedSum = new Decimal(0);
  for (const entry of entries) {
    const adjusted = entry.delta.mul(naturalSign(entry.account));
    signedSum = signedSum.add(adjusted);
  }

  if (!signedSum.equals(0)) {
    const lines = entries.map((e) => `  ${e.account}: ${e.delta.toString()}`).join("\n");
    throw new BalanceError(`Transaction unbalanced (signed sum = ${signedSum.toString()}):\n${lines}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/unit/ledger/validate.test.ts
```

Expected: all 8 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/validate.ts tests/unit/ledger/validate.test.ts
git commit -m "feat(ledger): double-entry balance validation"
```

---

## Task 11: Implement balance computation

**Files:**
- Create: `lib/ledger/balance.ts`
- Create: `tests/unit/ledger/balance.test.ts`

This task includes integration tests that hit the database. Tests must be written so each test sets up its own session/data and cleans up.

- [ ] **Step 1: Add a test setup helper**

Create `tests/unit/test-db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient();

export async function resetDatabase() {
  // Order matters: child tables first
  await testPrisma.ledgerEntry.deleteMany();
  await testPrisma.transaction.deleteMany();
  await testPrisma.marker.deleteMany();
  await testPrisma.sessionAccountClose.deleteMany();
  await testPrisma.rakeDistribution.deleteMany();
  await testPrisma.cashierHandoff.deleteMany();
  await testPrisma.game.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.table.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.userCapabilityGrant.deleteMany();
  await testPrisma.user.deleteMany();
  // Reseed minimal users
  await testPrisma.user.create({
    data: { id: "test-cashier", name: "Test Cashier", email: "test-cashier@dev", role: "CASHIER" },
  });
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/ledger/balance.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("getAccountBalance", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({
      data: { openedById: "test-cashier" },
    });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("returns 0 for an account with no entries", async () => {
    const balance = await getAccountBalance({ account: "CASH_DRAWER", sessionId });
    expect(balance.toString()).toBe("0");
  });

  it("sums positive deltas for an asset account", async () => {
    const tx = await testPrisma.transaction.create({
      data: {
        sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
        amount: new Decimal(200), method: "CASH",
        ledgerEntries: { create: [
          { account: "CASH_DRAWER", delta: new Decimal(200) },
          { account: "CHIP_FLOAT", delta: new Decimal(200) },
        ]},
      },
    });
    const balance = await getAccountBalance({ account: "CASH_DRAWER", sessionId });
    expect(balance.toString()).toBe("200");
  });

  it("filters by gameId for game-scoped accounts", async () => {
    const game2 = await testPrisma.game.create({
      data: { sessionId, name: "Hi-Stakes", rakeSplitConfig: {} },
    });
    // Rake on default game
    await testPrisma.transaction.create({
      data: {
        sessionId, gameId, type: "RAKE", createdById: "test-cashier",
        amount: new Decimal(50), method: "CHIPS",
        ledgerEntries: { create: [
          { account: "CHIP_FLOAT", delta: new Decimal(-50) },
          { account: "RAKE_POOL", delta: new Decimal(50), gameId },
        ]},
      },
    });
    // Rake on hi-stakes
    await testPrisma.transaction.create({
      data: {
        sessionId, gameId: game2.id, type: "RAKE", createdById: "test-cashier",
        amount: new Decimal(80), method: "CHIPS",
        ledgerEntries: { create: [
          { account: "CHIP_FLOAT", delta: new Decimal(-80) },
          { account: "RAKE_POOL", delta: new Decimal(80), gameId: game2.id },
        ]},
      },
    });

    const defaultRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId });
    expect(defaultRake.toString()).toBe("50");
    const hiRake = await getAccountBalance({ account: "RAKE_POOL", sessionId, gameId: game2.id });
    expect(hiRake.toString()).toBe("80");
    // Chip float is shared across games — sums across both
    const chipFloat = await getAccountBalance({ account: "CHIP_FLOAT", sessionId });
    expect(chipFloat.toString()).toBe("-130");
  });
});
```

- [ ] **Step 3: Run test, verify failure**

```bash
npm test -- tests/unit/ledger/balance.test.ts
```

Expected: FAIL with "Cannot find module @/lib/ledger/balance".

- [ ] **Step 4: Write `lib/ledger/balance.ts`**

```typescript
import Decimal from "decimal.js";
import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isGameScoped } from "./accounts";

interface BalanceArgs {
  account: AccountType;
  sessionId: string;
  gameId?: string;
  asOf?: Date;
}

/**
 * Returns the running balance of an account in a session, optionally scoped to a game,
 * optionally as of a specific timestamp (for time-travel queries).
 */
export async function getAccountBalance(args: BalanceArgs): Promise<Decimal> {
  const { account, sessionId, gameId, asOf } = args;

  const entries = await prisma.ledgerEntry.findMany({
    where: {
      account,
      transaction: {
        sessionId,
        ...(asOf ? { createdAt: { lte: asOf } } : {}),
      },
      ...(isGameScoped(account) && gameId ? { gameId } : {}),
    },
    select: { delta: true },
  });

  return entries.reduce((sum, e) => sum.add(new Decimal(e.delta.toString())), new Decimal(0));
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
npm test -- tests/unit/ledger/balance.test.ts
```

Expected: all 3 assertions pass.

- [ ] **Step 6: Commit**

```bash
git add lib/ledger/balance.ts tests/unit/ledger/balance.test.ts tests/unit/test-db.ts
git commit -m "feat(ledger): account balance computation with game scoping"
```

---

## Task 12: Implement createTransaction (transactional insert with validation)

**Files:**
- Create: `lib/ledger/transaction.ts`
- Create: `tests/unit/ledger/transaction.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/ledger/transaction.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction, TxValidationError } from "@/lib/ledger/transaction";

describe("createTransaction", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("creates a balanced buy_in with 2 ledger entries", async () => {
    const tx = await createTransaction({
      sessionId,
      gameId,
      type: "BUY_IN",
      createdById: "test-cashier",
      amount: new Decimal(200),
      method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    expect(tx.id).toBeTruthy();
    const stored = await testPrisma.transaction.findUnique({
      where: { id: tx.id },
      include: { ledgerEntries: true },
    });
    expect(stored?.ledgerEntries.length).toBe(2);
  });

  it("rejects unbalanced entries before hitting DB", async () => {
    await expect(
      createTransaction({
        sessionId, gameId, type: "BUY_IN",
        createdById: "test-cashier",
        amount: new Decimal(200), method: "CASH",
        entries: [
          { account: "CASH_DRAWER", delta: new Decimal(200) },
          { account: "CHIP_FLOAT", delta: new Decimal(100) },
        ],
      })
    ).rejects.toThrow(TxValidationError);
  });

  it("blocks insertion into a closed session", async () => {
    await testPrisma.session.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt: new Date(), closedById: "test-cashier" },
    });
    await expect(
      createTransaction({
        sessionId, gameId, type: "BUY_IN",
        createdById: "test-cashier",
        amount: new Decimal(50), method: "CASH",
        entries: [
          { account: "CASH_DRAWER", delta: new Decimal(50) },
          { account: "CHIP_FLOAT", delta: new Decimal(50) },
        ],
      })
    ).rejects.toThrow(/closed session/i);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- tests/unit/ledger/transaction.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write `lib/ledger/transaction.ts`**

```typescript
import Decimal from "decimal.js";
import type { TransactionType, PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateBalanced, BalanceError, type LedgerEntryInput } from "./validate";

export class TxValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxValidationError";
  }
}

export interface CreateTransactionArgs {
  sessionId: string;
  gameId?: string | null;
  type: TransactionType;
  createdById: string;
  amount: Decimal;
  method: PaymentMethod;
  playerId?: string | null;
  staffId?: string | null;
  tableId?: string | null;
  note?: string | null;
  reversesId?: string | null;
  roundingAdjustment?: Decimal | null;
  entries: LedgerEntryInput[];
}

/**
 * Creates a Transaction with its LedgerEntries in a single DB transaction.
 * Validates double-entry balance before insert. The DB trigger validates again at COMMIT.
 */
export async function createTransaction(args: CreateTransactionArgs) {
  try {
    validateBalanced(args.entries);
  } catch (e) {
    if (e instanceof BalanceError) {
      throw new TxValidationError(e.message);
    }
    throw e;
  }

  return await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({
      data: {
        sessionId: args.sessionId,
        gameId: args.gameId ?? null,
        type: args.type,
        createdById: args.createdById,
        amount: args.amount.toString(),
        method: args.method,
        playerId: args.playerId ?? null,
        staffId: args.staffId ?? null,
        tableId: args.tableId ?? null,
        note: args.note ?? null,
        reversesId: args.reversesId ?? null,
        roundingAdjustment: args.roundingAdjustment?.toString() ?? null,
        ledgerEntries: {
          create: args.entries.map((e) => ({
            account: e.account,
            delta: e.delta.toString(),
            gameId: e.gameId ?? null,
          })),
        },
      },
      include: { ledgerEntries: true },
    });

    return created;
  });
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- tests/unit/ledger/transaction.test.ts
```

Expected: 3 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/transaction.ts tests/unit/ledger/transaction.test.ts
git commit -m "feat(ledger): createTransaction with validation"
```

---

## Task 13: Implement reversal transactions

**Files:**
- Modify: `lib/ledger/transaction.ts`
- Modify: `tests/unit/ledger/transaction.test.ts`

- [ ] **Step 1: Add the failing test for reversals**

Append to `tests/unit/ledger/transaction.test.ts`:

```typescript
describe("reverseTransaction", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("creates a reversal that exactly negates the original entries", async () => {
    const original = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier",
      amount: new Decimal(200), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });

    const { reverseTransaction } = await import("@/lib/ledger/transaction");
    const reversal = await reverseTransaction({
      transactionId: original.id,
      reversedById: "test-cashier",
      reason: "test reversal",
    });

    expect(reversal.reversesId).toBe(original.id);
    const reversalEntries = await testPrisma.ledgerEntry.findMany({
      where: { transactionId: reversal.id },
    });
    expect(reversalEntries.length).toBe(2);
    expect(reversalEntries.find((e) => e.account === "CASH_DRAWER")?.delta.toString()).toBe("-200");
    expect(reversalEntries.find((e) => e.account === "CHIP_FLOAT")?.delta.toString()).toBe("-200");
  });

  it("net balance after reversal returns to zero", async () => {
    const { getAccountBalance } = await import("@/lib/ledger/balance");
    const { reverseTransaction } = await import("@/lib/ledger/transaction");

    const original = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier",
      amount: new Decimal(500), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(500) },
        { account: "CHIP_FLOAT", delta: new Decimal(500) },
      ],
    });
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("500");

    await reverseTransaction({
      transactionId: original.id,
      reversedById: "test-cashier",
      reason: "test",
    });

    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("0");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- tests/unit/ledger/transaction.test.ts
```

Expected: FAIL — `reverseTransaction` not found.

- [ ] **Step 3: Add `reverseTransaction` to `lib/ledger/transaction.ts`**

Append to `lib/ledger/transaction.ts`:

```typescript
export interface ReverseTransactionArgs {
  transactionId: string;
  reversedById: string;
  reason: string;
}

export async function reverseTransaction(args: ReverseTransactionArgs) {
  const original = await prisma.transaction.findUnique({
    where: { id: args.transactionId },
    include: { ledgerEntries: true },
  });
  if (!original) {
    throw new TxValidationError(`Transaction ${args.transactionId} not found`);
  }
  if (original.reversesId) {
    throw new TxValidationError(`Transaction ${args.transactionId} is already a reversal; can't reverse a reversal`);
  }

  const negatedEntries: LedgerEntryInput[] = original.ledgerEntries.map((e) => ({
    account: e.account,
    delta: new Decimal(e.delta.toString()).neg(),
    gameId: e.gameId,
  }));

  return await createTransaction({
    sessionId: original.sessionId,
    gameId: original.gameId,
    type: original.type,
    createdById: args.reversedById,
    amount: new Decimal(original.amount.toString()).neg(),
    method: original.method,
    playerId: original.playerId,
    staffId: original.staffId,
    tableId: original.tableId,
    note: `REVERSAL of ${original.id}: ${args.reason}`,
    reversesId: original.id,
    entries: negatedEntries,
  });
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- tests/unit/ledger/transaction.test.ts
```

Expected: all assertions pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/transaction.ts tests/unit/ledger/transaction.test.ts
git commit -m "feat(ledger): reverseTransaction"
```

---

## Task 14: Implement time-travel balance queries

**Files:**
- Create: `lib/ledger/time-travel.ts`
- Create: `tests/unit/ledger/time-travel.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/ledger/time-travel.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getBalanceAt } from "@/lib/ledger/time-travel";

describe("getBalanceAt", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({ data: { openedById: "test-cashier" } });
    sessionId = session.id;
    const game = await testPrisma.game.create({
      data: { sessionId, name: "Default", rakeSplitConfig: {} },
    });
    gameId = game.id;
  });

  it("returns the balance at a specific point in time", async () => {
    // Three sequential buy-ins at controlled times
    const tx1 = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier", amount: new Decimal(100), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(100) },
        { account: "CHIP_FLOAT", delta: new Decimal(100) },
      ],
    });
    const tx2 = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier", amount: new Decimal(200), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(200) },
        { account: "CHIP_FLOAT", delta: new Decimal(200) },
      ],
    });
    const tx3 = await createTransaction({
      sessionId, gameId, type: "BUY_IN",
      createdById: "test-cashier", amount: new Decimal(300), method: "CASH",
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(300) },
        { account: "CHIP_FLOAT", delta: new Decimal(300) },
      ],
    });

    // Balance at the moment of tx2 (inclusive) should be 100 + 200 = 300
    const balance = await getBalanceAt({ account: "CASH_DRAWER", sessionId, asOf: tx2.createdAt });
    expect(balance.toString()).toBe("300");

    // Balance after tx3 = 600
    const balanceAfter = await getBalanceAt({ account: "CASH_DRAWER", sessionId, asOf: tx3.createdAt });
    expect(balanceAfter.toString()).toBe("600");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
npm test -- tests/unit/ledger/time-travel.test.ts
```

Expected: FAIL — `getBalanceAt` not found.

- [ ] **Step 3: Write `lib/ledger/time-travel.ts`**

```typescript
import { getAccountBalance } from "./balance";
import type { AccountType } from "@prisma/client";

interface TimeTravelArgs {
  account: AccountType;
  sessionId: string;
  gameId?: string;
  asOf: Date;
}

export async function getBalanceAt(args: TimeTravelArgs) {
  return getAccountBalance(args);
}
```

(`getAccountBalance` already supports `asOf`; this is just a named alias for clarity at call sites.)

- [ ] **Step 4: Run test, verify pass**

```bash
npm test -- tests/unit/ledger/time-travel.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ledger/time-travel.ts tests/unit/ledger/time-travel.test.ts
git commit -m "feat(ledger): time-travel balance query"
```

---

## Task 15: Money formatting helpers

**Files:**
- Create: `lib/format.ts`
- Create: `components/money.tsx`

- [ ] **Step 1: Write `lib/format.ts`**

```typescript
import Decimal from "decimal.js";

export function formatMoney(amount: Decimal | string | number): string {
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  const sign = d.isNegative() ? "-" : "";
  const abs = d.abs();
  return `${sign}$${abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function formatMoneySigned(amount: Decimal | string | number): string {
  const d = amount instanceof Decimal ? amount : new Decimal(amount);
  if (d.isPositive() && !d.isZero()) return `+${formatMoney(d)}`;
  return formatMoney(d);
}
```

- [ ] **Step 2: Write `components/money.tsx`**

```tsx
import { formatMoney, formatMoneySigned } from "@/lib/format";

interface MoneyProps {
  amount: string | number | { toString(): string };
  signed?: boolean;
  className?: string;
}

export function Money({ amount, signed = false, className }: MoneyProps) {
  const value = typeof amount === "string" || typeof amount === "number" ? amount : amount.toString();
  return (
    <span className={`font-mono tabular-nums ${className ?? ""}`}>
      {signed ? formatMoneySigned(value) : formatMoney(value)}
    </span>
  );
}
```

- [ ] **Step 3: Add a quick test**

Create `tests/unit/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { formatMoney, formatMoneySigned } from "@/lib/format";

describe("formatMoney", () => {
  it("formats with two decimals and thousands separators", () => {
    expect(formatMoney(new Decimal(1234.5))).toBe("$1,234.50");
  });
  it("preserves negative sign", () => {
    expect(formatMoney(new Decimal(-200))).toBe("-$200.00");
  });
  it("formats zero", () => {
    expect(formatMoney(new Decimal(0))).toBe("$0.00");
  });
});

describe("formatMoneySigned", () => {
  it("adds + for positive", () => {
    expect(formatMoneySigned(new Decimal(50))).toBe("+$50.00");
  });
  it("preserves negative", () => {
    expect(formatMoneySigned(new Decimal(-50))).toBe("-$50.00");
  });
  it("does not add + for zero", () => {
    expect(formatMoneySigned(new Decimal(0))).toBe("$0.00");
  });
});
```

- [ ] **Step 4: Run test**

```bash
npm test -- tests/unit/format.test.ts
```

Expected: 6 assertions pass.

- [ ] **Step 5: Commit**

```bash
git add lib/format.ts components/money.tsx tests/unit/format.test.ts
git commit -m "feat: money formatting helpers and Money component"
```

---

## Task 16: Cashier layout — root + sidebar nav

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Create: `app/(cashier)/layout.tsx`
- Create: `components/nav-sidebar.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Set the dark theme in `app/globals.css`**

Replace `app/globals.css` content with:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0a0a0a;
  --color-panel: #0f0f0f;
  --color-border: #1f1f1f;
  --color-amber: #f59e0b;
  --color-text: #e2e8f0;
  --color-muted: #94a3b8;
  --color-dim: #64748b;
}

html, body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-feature-settings: "tnum";
}

* { box-sizing: border-box; }
```

- [ ] **Step 2: Update `app/layout.tsx`**

```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CageRoom",
  description: "Poker room accounting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Make the root path redirect to `/live`**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/live");
}
```

- [ ] **Step 4: Write `components/nav-sidebar.tsx`**

```tsx
import Link from "next/link";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const items: NavItem[] = [
  { href: "/live", label: "Live Session", icon: "🌙" },
  { href: "/players", label: "Players", icon: "🃏" },
  { href: "/staff", label: "Staff", icon: "👥" },
  { href: "/tables", label: "Tables", icon: "🪑" },
];

export function NavSidebar({ activePath }: { activePath: string }) {
  return (
    <aside className="w-[220px] bg-[var(--color-panel)] border-r border-[var(--color-border)] p-4 flex flex-col">
      <div className="text-amber-500 font-bold text-base mb-5 pb-3 border-b border-[var(--color-border)]">
        ♠ CageRoom
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const active = activePath === item.href || activePath.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-2 py-2 rounded text-sm ${
                active ? "bg-amber-500/10 text-amber-500" : "text-slate-300 hover:bg-white/5"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Write `app/(cashier)/layout.tsx`**

```tsx
import { headers } from "next/headers";
import { NavSidebar } from "@/components/nav-sidebar";

export default async function CashierLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const activePath = h.get("x-pathname") ?? "/live";
  return (
    <div className="grid grid-cols-[220px_1fr] min-h-screen">
      <NavSidebar activePath={activePath} />
      <main className="p-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Add a middleware to set `x-pathname`**

Create `middleware.ts` at the project root:

```typescript
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("x-pathname", req.nextUrl.pathname);
  return res;
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
```

- [ ] **Step 7: Verify dev server runs**

```bash
npm run dev
```

Expected: visit http://localhost:3000 → redirects to /live → renders the sidebar (without content yet, that's the next task).

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add app/ components/ middleware.ts
git commit -m "feat(ui): cashier layout with sidebar nav"
```

---

## Task 17: Live session page — placeholder when no session is open

**Files:**
- Create: `app/(cashier)/live/page.tsx`
- Create: `app/(cashier)/_actions/session.ts`

- [ ] **Step 1: Write `app/(cashier)/_actions/session.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import Decimal from "decimal.js";
import { createTransaction } from "@/lib/ledger/transaction";

const CASHIER_EMAIL = "cashier@dev.local";

async function getCashierUserId(): Promise<string> {
  const cashier = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!cashier) throw new Error("Cashier user not seeded — run `npx prisma db seed`");
  return cashier.id;
}

export async function openSession(formData: FormData) {
  const openingCashRaw = formData.get("openingCash")?.toString() ?? "0";
  const openingCash = new Decimal(openingCashRaw || "0");
  const cashierId = await getCashierUserId();

  const session = await prisma.session.create({
    data: {
      openedById: cashierId,
      openingCash: openingCash.toString(),
    },
  });

  // Auto-create a default Game so all transactions have a gameId
  const game = await prisma.game.create({
    data: {
      sessionId: session.id,
      name: "Main Game",
      rakeSplitConfig: { type: "even" },
    },
  });

  // If openingCash > 0, record an OPENING_FLOAT transaction
  if (openingCash.greaterThan(0)) {
    await createTransaction({
      sessionId: session.id,
      gameId: game.id,
      type: "OPENING_FLOAT",
      createdById: cashierId,
      amount: openingCash,
      method: "CASH",
      note: "Session opening float",
      entries: [
        { account: "CASH_DRAWER", delta: openingCash },
        { account: "EXTERNAL", delta: openingCash.neg() },
      ],
    });
  }

  revalidatePath("/live");
  return session;
}

export async function getOpenSession() {
  return await prisma.session.findFirst({
    where: { status: "OPEN" },
    include: { games: true, openedBy: true },
    orderBy: { openedAt: "desc" },
  });
}
```

- [ ] **Step 2: Write `app/(cashier)/live/page.tsx`**

```tsx
import { getOpenSession, openSession } from "../_actions/session";
import { Money } from "@/components/money";

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
          <button
            type="submit"
            className="bg-amber-500 text-black font-semibold rounded px-4 py-2 hover:bg-amber-400"
          >
            Open Session
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Tonight's Session</h2>
        <div className="text-sm text-slate-500">
          opened {new Date(session.openedAt).toLocaleTimeString()} by {session.openedBy.name}
          {" · "}
          opening cash <Money amount={session.openingCash.toString()} />
        </div>
      </header>
      <div className="text-slate-400 text-sm">
        Account strip and transaction stream coming in the next tasks.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Visit http://localhost:3000/live. Expected: "No session open" form. Submit with opening cash $0 — page should refresh showing "Tonight's Session" with opening cash $0.00.

Verify in DB:

```bash
docker compose exec postgres psql -U poker -d poker_room_accounting -c 'SELECT id, status, "openingCash" FROM "Session";'
```

Expected: one row with status=OPEN.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/
git commit -m "feat(session): open session with optional opening float"
```

---

## Task 18: Account strip on the live session page

**Files:**
- Create: `app/(cashier)/live/_components/account-strip.tsx`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Write `app/(cashier)/live/_components/account-strip.tsx`**

```tsx
import { Money } from "@/components/money";
import { getAccountBalance } from "@/lib/ledger/balance";
import type { AccountType } from "@prisma/client";

interface AccountStripProps {
  sessionId: string;
}

interface Tile {
  account: AccountType;
  label: string;
}

const tiles: Tile[] = [
  { account: "CASH_DRAWER", label: "Cash drawer" },
  { account: "ZELLE", label: "Zelle" },
  { account: "VENMO", label: "Venmo" },
  { account: "CASHAPP", label: "CashApp" },
  { account: "APPLE_PAY", label: "Apple Pay" },
  { account: "CHIP_FLOAT", label: "Chip float" },
  { account: "RAKE_POOL", label: "Rake pool" },
  { account: "TIP_POOL", label: "Tip pool" },
];

export async function AccountStrip({ sessionId }: AccountStripProps) {
  const balances = await Promise.all(
    tiles.map(async (t) => ({
      ...t,
      balance: await getAccountBalance({ account: t.account, sessionId }),
    }))
  );

  return (
    <div className="grid grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
      {balances.map((tile) => (
        <div
          key={tile.account}
          className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-md p-3"
        >
          <div className="text-[0.65rem] uppercase tracking-wider text-slate-500">{tile.label}</div>
          <div className="font-mono tabular-nums text-base font-semibold mt-1">
            <Money amount={tile.balance.toString()} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Use it in `app/(cashier)/live/page.tsx`**

In the open-session branch, after the header, add:

```tsx
import { AccountStrip } from "./_components/account-strip";

// ... inside the open-session JSX, replace the placeholder div with:
<AccountStrip sessionId={session.id} />
```

Full file should look like:

```tsx
import { getOpenSession, openSession } from "../_actions/session";
import { Money } from "@/components/money";
import { AccountStrip } from "./_components/account-strip";

export default async function LiveSessionPage() {
  const session = await getOpenSession();

  if (!session) {
    /* ... unchanged ... */
  }

  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Tonight's Session</h2>
        <div className="text-sm text-slate-500">
          opened {new Date(session.openedAt).toLocaleTimeString()} by {session.openedBy.name}
          {" · "}
          opening cash <Money amount={session.openingCash.toString()} />
        </div>
      </header>
      <AccountStrip sessionId={session.id} />
      <div className="text-slate-400 text-sm">Quick actions and transaction stream coming next.</div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npm run dev
```

Visit /live. Should see 8 account tiles, all showing $0.00 (or $X for cash_drawer if you opened with a float).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/live/
git commit -m "feat(ui): live session account strip"
```

---

## Task 19: Buy-in form + server action

**Files:**
- Create: `app/(cashier)/live/_components/quick-actions.tsx`
- Create: `app/(cashier)/live/_components/tx-buyin-form.tsx`
- Create: `app/(cashier)/_actions/transactions.ts`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Add the failing E2E test concept**

We'll come back to E2E tests at the end. For now, write a unit test in `tests/unit/ledger/buy-in.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";
import { getAccountBalance } from "@/lib/ledger/balance";

describe("buy_in transaction shape", () => {
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
    const player = await testPrisma.player.create({ data: { displayName: "Test Player" } });
    playerId = player.id;
  });

  it("cash buy-in increases cash_drawer and chip_float by amount", async () => {
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(500), method: "CASH", playerId,
      entries: [
        { account: "CASH_DRAWER", delta: new Decimal(500) },
        { account: "CHIP_FLOAT", delta: new Decimal(500) },
      ],
    });
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("500");
    expect((await getAccountBalance({ account: "CHIP_FLOAT", sessionId })).toString()).toBe("500");
  });

  it("zelle buy-in increases zelle and chip_float", async () => {
    await createTransaction({
      sessionId, gameId, type: "BUY_IN", createdById: "test-cashier",
      amount: new Decimal(300), method: "ZELLE", playerId,
      entries: [
        { account: "ZELLE", delta: new Decimal(300) },
        { account: "CHIP_FLOAT", delta: new Decimal(300) },
      ],
    });
    expect((await getAccountBalance({ account: "ZELLE", sessionId })).toString()).toBe("300");
    expect((await getAccountBalance({ account: "CASH_DRAWER", sessionId })).toString()).toBe("0");
  });
});
```

- [ ] **Step 2: Run, verify pass**

```bash
npm test -- tests/unit/ledger/buy-in.test.ts
```

Expected: 2 assertions pass (since `createTransaction` already exists and works).

- [ ] **Step 3: Write `app/(cashier)/_actions/transactions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import type { PaymentMethod } from "@prisma/client";

const CASHIER_EMAIL = "cashier@dev.local";

async function cashierUserId(): Promise<string> {
  const c = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!c) throw new Error("Cashier user not seeded");
  return c.id;
}

const METHOD_TO_ACCOUNT: Record<PaymentMethod, "CASH_DRAWER" | "ZELLE" | "VENMO" | "CASHAPP" | "APPLE_PAY"> = {
  CASH: "CASH_DRAWER",
  ZELLE: "ZELLE",
  VENMO: "VENMO",
  CASHAPP: "CASHAPP",
  APPLE_PAY: "APPLE_PAY",
  OTHER: "CASH_DRAWER",   // OTHER currently treated as cash; will be revisited
  CHIPS: "CASH_DRAWER",   // not used for buy_in/cash_out (CHIPS is for in-cage flows)
};

export async function recordBuyIn(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const playerId = formData.get("playerId")?.toString();
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");
  const method = (formData.get("method")?.toString() as PaymentMethod) ?? "CASH";
  const tableId = formData.get("tableId")?.toString() || null;

  if (!sessionId || !gameId || !playerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Missing or invalid buy_in input");
  }

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId,
    gameId,
    type: "BUY_IN",
    createdById: cashierId,
    amount,
    method,
    playerId,
    tableId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  revalidatePath("/live");
}
```

- [ ] **Step 4: Write `app/(cashier)/live/_components/tx-buyin-form.tsx`**

```tsx
import { recordBuyIn } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface BuyInFormProps {
  sessionId: string;
  gameId: string;
}

export async function BuyInForm({ sessionId, gameId }: BuyInFormProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const tables = await prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <form action={recordBuyIn} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">+ Buy-in</h3>
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
        <input type="number" name="amount" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
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
  );
}
```

- [ ] **Step 5: Wire it into the live page**

Replace the placeholder div in `app/(cashier)/live/page.tsx`:

```tsx
import { BuyInForm } from "./_components/tx-buyin-form";

// ... in the open-session branch:
<div className="grid grid-cols-[1fr_320px] gap-4">
  <div className="text-slate-400 text-sm">Transaction stream coming next.</div>
  <BuyInForm sessionId={session.id} gameId={session.games[0].id} />
</div>
```

- [ ] **Step 6: Verify in browser**

```bash
npm run dev
```

You'll need at least one player to test. Manually create one for now via the seed:

```bash
docker compose exec postgres psql -U poker -d poker_room_accounting -c 'INSERT INTO "Player" (id, "displayName") VALUES (gen_random_uuid()::text, '"'"'Test Player A'"'"');'
```

(We'll add player CRUD in a later task.) Then visit /live, fill in the buy-in form, submit. The cash_drawer tile should update from $0 to your buy-in amount.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add app/(cashier)/ tests/unit/ledger/buy-in.test.ts
git commit -m "feat(tx): buy_in form and server action"
```

---

## Task 20: Cash-out form (denomination grid) + server action

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-cashout-form.tsx`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Add `recordCashOut` to `app/(cashier)/_actions/transactions.ts`**

```typescript
export async function recordCashOut(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const playerId = formData.get("playerId")?.toString();
  const method = (formData.get("method")?.toString() as PaymentMethod) ?? "CASH";
  const tableId = formData.get("tableId")?.toString() || null;

  // Denomination grid sums: $100 × n100 + $25 × n25 + $5 × n5 + $1 × n1
  const n100 = parseInt(formData.get("n100")?.toString() ?? "0", 10) || 0;
  const n25 = parseInt(formData.get("n25")?.toString() ?? "0", 10) || 0;
  const n5 = parseInt(formData.get("n5")?.toString() ?? "0", 10) || 0;
  const n1 = parseInt(formData.get("n1")?.toString() ?? "0", 10) || 0;

  const amount = new Decimal(n100 * 100 + n25 * 25 + n5 * 5 + n1);
  if (!sessionId || !gameId || !playerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Cash-out requires a positive total");
  }

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId, gameId, type: "CASH_OUT",
    createdById: cashierId, amount, method, playerId, tableId,
    entries: [
      { account: targetAccount, delta: amount.neg() },
      { account: "CHIP_FLOAT", delta: amount.neg() },
    ],
  });

  revalidatePath("/live");
}
```

- [ ] **Step 2: Write `app/(cashier)/live/_components/tx-cashout-form.tsx`**

```tsx
import { recordCashOut } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface CashOutFormProps {
  sessionId: string;
  gameId: string;
}

export async function CashOutForm({ sessionId, gameId }: CashOutFormProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });

  return (
    <form action={recordCashOut} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">− Cash-out</h3>
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
            <input
              type="number"
              name={d.name}
              defaultValue="0"
              min="0"
              className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1.5 font-mono text-center"
            />
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
  );
}
```

- [ ] **Step 3: Wire into the page**

Update the side panel in `app/(cashier)/live/page.tsx` to show both forms:

```tsx
import { CashOutForm } from "./_components/tx-cashout-form";

// ... replace the side panel:
<div className="flex flex-col gap-4">
  <BuyInForm sessionId={session.id} gameId={session.games[0].id} />
  <CashOutForm sessionId={session.id} gameId={session.games[0].id} />
</div>
```

- [ ] **Step 4: Verify in browser**

Restart the dev server, do a buy-in, then a cash-out for the same player. Cash drawer balance should rise then fall by the cash-out amount.

- [ ] **Step 5: Commit**

```bash
git add app/(cashier)/
git commit -m "feat(tx): cash_out form with denomination grid"
```

---

## Task 21: Transaction stream component

**Files:**
- Create: `app/(cashier)/live/_components/transaction-stream.tsx`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Write `app/(cashier)/live/_components/transaction-stream.tsx`**

```tsx
import { Money } from "@/components/money";
import { prisma } from "@/lib/db";

interface TransactionStreamProps {
  sessionId: string;
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
        No transactions yet. Use the forms on the right to record one.
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
          const sign = tx.type === "CASH_OUT" || tx.type === "CLOSING_FLOAT" ? -1 : 1;
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
                <Money amount={(sign * Number(tx.amount.toString())).toString()} signed />
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

- [ ] **Step 2: Wire into the page**

Replace the placeholder text in `app/(cashier)/live/page.tsx`:

```tsx
import { TransactionStream } from "./_components/transaction-stream";

// ... replace the "Transaction stream coming next." div:
<TransactionStream sessionId={session.id} />
```

- [ ] **Step 3: Verify**

The stream should now show the buy-ins and cash-outs from prior tasks.

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/live/
git commit -m "feat(ui): transaction stream"
```

---

## Task 22: Players CRUD (list + create + edit)

**Files:**
- Create: `app/(cashier)/_actions/players.ts`
- Create: `app/(cashier)/players/page.tsx`
- Create: `app/(cashier)/players/new/page.tsx`
- Create: `app/(cashier)/players/[id]/page.tsx`

- [ ] **Step 1: Write `app/(cashier)/_actions/players.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function createPlayer(formData: FormData) {
  const displayName = formData.get("displayName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!displayName) throw new Error("Player name is required");
  await prisma.player.create({ data: { displayName, phone, notes } });
  revalidatePath("/players");
  redirect("/players");
}

export async function updatePlayer(formData: FormData) {
  const id = formData.get("id")?.toString();
  const displayName = formData.get("displayName")?.toString().trim();
  const phone = formData.get("phone")?.toString().trim() || null;
  const notes = formData.get("notes")?.toString().trim() || null;
  if (!id || !displayName) throw new Error("Invalid player update");
  await prisma.player.update({ where: { id }, data: { displayName, phone, notes } });
  revalidatePath("/players");
  redirect("/players");
}
```

- [ ] **Step 2: Write `app/(cashier)/players/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function PlayersPage() {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Players</h2>
        <Link href="/players/new" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">
          + New Player
        </Link>
      </header>
      {players.length === 0 ? (
        <p className="text-slate-500">No players yet. Add one to get started.</p>
      ) : (
        <ul className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {players.map((p) => (
            <li key={p.id}>
              <Link href={`/players/${p.id}`} className="block px-4 py-3 hover:bg-white/5">
                <div className="font-medium">{p.displayName}</div>
                {p.phone && <div className="text-xs text-slate-500">{p.phone}</div>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `app/(cashier)/players/new/page.tsx`**

```tsx
import { createPlayer } from "../../_actions/players";

export default function NewPlayerPage() {
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">New Player</h2>
      <form action={createPlayer} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Display name</span>
          <input name="displayName" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Phone (optional)</span>
          <input name="phone" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Notes</span>
          <textarea name="notes" rows={3} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">
          Create
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Write `app/(cashier)/players/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { updatePlayer } from "../../_actions/players";

export default async function EditPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await prisma.player.findUnique({ where: { id } });
  if (!player) notFound();
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">Edit {player.displayName}</h2>
      <form action={updatePlayer} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <input type="hidden" name="id" value={player.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Display name</span>
          <input name="displayName" required defaultValue={player.displayName} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Phone</span>
          <input name="phone" defaultValue={player.phone ?? ""} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Notes</span>
          <textarea name="notes" rows={3} defaultValue={player.notes ?? ""} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">
          Save
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Restart dev server. Navigate to /players → "+ New Player" → create a player. Should redirect back to the list. Click the player to edit; save changes.

- [ ] **Step 6: Commit**

```bash
git add app/(cashier)/players/ app/(cashier)/_actions/players.ts
git commit -m "feat(players): list, create, edit"
```

---

## Task 23: Staff CRUD (dealers, waitresses)

**Files:**
- Create: `app/(cashier)/_actions/staff.ts`
- Create: `app/(cashier)/staff/page.tsx`
- Create: `app/(cashier)/staff/new/page.tsx`
- Create: `app/(cashier)/staff/[id]/page.tsx`

The Staff section manages User records that are not the cashier — dealers and waitresses. They don't log in (no auth in Plan 1) but they appear in dropdowns when recording transactions that pay them.

- [ ] **Step 1: Write `app/(cashier)/_actions/staff.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

export async function createStaff(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const role = formData.get("role")?.toString() as UserRole;
  const tipTaxRateStr = formData.get("tipTaxRate")?.toString().trim();
  const useDefaultTax = formData.get("useDefaultTax") === "on";

  if (!name) throw new Error("Name required");
  if (!["DEALER", "WAITRESS", "RUNNER"].includes(role)) {
    throw new Error("Role must be DEALER, WAITRESS, or RUNNER");
  }
  const tipTaxRate = useDefaultTax || !tipTaxRateStr
    ? null
    : (parseFloat(tipTaxRateStr) / 100).toString();

  await prisma.user.create({
    data: {
      name,
      role,
      status: "ACTIVE",
      tipTaxRate,
    },
  });
  revalidatePath("/staff");
  redirect("/staff");
}

export async function updateStaff(formData: FormData) {
  const id = formData.get("id")?.toString();
  const name = formData.get("name")?.toString().trim();
  const role = formData.get("role")?.toString() as UserRole;
  const tipTaxRateStr = formData.get("tipTaxRate")?.toString().trim();
  const useDefaultTax = formData.get("useDefaultTax") === "on";

  if (!id || !name) throw new Error("Invalid staff update");
  const tipTaxRate = useDefaultTax || !tipTaxRateStr
    ? null
    : (parseFloat(tipTaxRateStr) / 100).toString();

  await prisma.user.update({
    where: { id },
    data: { name, role, tipTaxRate },
  });
  revalidatePath("/staff");
  redirect("/staff");
}
```

- [ ] **Step 2: Write `app/(cashier)/staff/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function StaffPage() {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS", "RUNNER"] } },
    orderBy: { name: "asc" },
  });
  return (
    <div>
      <header className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Staff</h2>
        <Link href="/staff/new" className="bg-amber-500 text-black font-semibold rounded px-3 py-1.5 text-sm">
          + New Staff
        </Link>
      </header>
      {staff.length === 0 ? (
        <p className="text-slate-500">No staff yet. Add dealers, waitresses, or runners.</p>
      ) : (
        <ul className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {staff.map((s) => (
            <li key={s.id}>
              <Link href={`/staff/${s.id}`} className="block px-4 py-3 hover:bg-white/5">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-slate-500">
                  {s.role.toLowerCase()}
                  {s.tipTaxRate && ` · tax ${(Number(s.tipTaxRate) * 100).toFixed(0)}%`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `app/(cashier)/staff/new/page.tsx`**

```tsx
import { createStaff } from "../../_actions/staff";

export default function NewStaffPage() {
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">New Staff</h2>
      <form action={createStaff} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Name</span>
          <input name="name" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Role</span>
          <select name="role" required defaultValue="DEALER" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="DEALER">Dealer</option>
            <option value="WAITRESS">Waitress</option>
            <option value="RUNNER">Runner</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="useDefaultTax" defaultChecked />
          <span className="text-slate-400">Use system default tip tax rate (20%)</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Custom tip tax rate (%)</span>
          <input name="tipTaxRate" type="number" min="0" max="100" step="1" placeholder="e.g. 15" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">
          Create
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Write `app/(cashier)/staff/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { updateStaff } from "../../_actions/staff";

export default async function EditStaffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await prisma.user.findUnique({ where: { id } });
  if (!s) notFound();
  const useDefault = s.tipTaxRate === null;
  const customPct = s.tipTaxRate ? (Number(s.tipTaxRate) * 100).toFixed(0) : "";
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-semibold mb-4">Edit {s.name}</h2>
      <form action={updateStaff} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <input type="hidden" name="id" value={s.id} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Name</span>
          <input name="name" defaultValue={s.name} required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Role</span>
          <select name="role" required defaultValue={s.role} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="DEALER">Dealer</option>
            <option value="WAITRESS">Waitress</option>
            <option value="RUNNER">Runner</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="useDefaultTax" defaultChecked={useDefault} />
          <span className="text-slate-400">Use system default tip tax rate</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Custom tip tax rate (%)</span>
          <input name="tipTaxRate" type="number" min="0" max="100" step="1" defaultValue={customPct} className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">
          Save
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Visit /staff, add Dealer Bo with custom 15% rate, save, edit, save again.

- [ ] **Step 6: Commit**

```bash
git add app/(cashier)/staff/ app/(cashier)/_actions/staff.ts
git commit -m "feat(staff): list, create, edit dealers/waitresses/runners"
```

---

## Task 24: Tables CRUD

**Files:**
- Create: `app/(cashier)/_actions/tables.ts`
- Create: `app/(cashier)/tables/page.tsx`

- [ ] **Step 1: Write `app/(cashier)/_actions/tables.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createTable(formData: FormData) {
  const name = formData.get("name")?.toString().trim();
  const stakes = formData.get("stakes")?.toString().trim() || null;
  if (!name) throw new Error("Table name required");
  await prisma.table.create({ data: { name, stakes } });
  revalidatePath("/tables");
}

export async function toggleTableActive(formData: FormData) {
  const id = formData.get("id")?.toString();
  if (!id) throw new Error("Invalid table");
  const t = await prisma.table.findUnique({ where: { id } });
  if (!t) throw new Error("Table not found");
  await prisma.table.update({ where: { id }, data: { active: !t.active } });
  revalidatePath("/tables");
}
```

- [ ] **Step 2: Write `app/(cashier)/tables/page.tsx`**

```tsx
import { prisma } from "@/lib/db";
import { createTable, toggleTableActive } from "../_actions/tables";

export default async function TablesPage() {
  const tables = await prisma.table.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Tables</h2>
      <form action={createTable} className="flex gap-2 mb-6 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-3">
        <input name="name" required placeholder="Table name (e.g., Table 1)" className="flex-1 bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        <input name="stakes" placeholder="Stakes (e.g., 1/2 NL)" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 w-40" />
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Add</button>
      </form>
      {tables.length === 0 ? (
        <p className="text-slate-500">No tables yet.</p>
      ) : (
        <ul className="bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
          {tables.map((t) => (
            <li key={t.id} className="flex justify-between items-center px-4 py-3">
              <div>
                <span className="font-medium">{t.name}</span>
                {t.stakes && <span className="text-slate-500 text-sm ml-2">{t.stakes}</span>}
                {!t.active && <span className="text-xs text-red-400 ml-2">inactive</span>}
              </div>
              <form action={toggleTableActive}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="text-xs text-slate-400 hover:text-white">
                  {t.active ? "deactivate" : "activate"}
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

- [ ] **Step 3: Verify**

Visit /tables, add Table 1 with stakes "1/2 NL", deactivate, reactivate.

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/tables/ app/(cashier)/_actions/tables.ts
git commit -m "feat(tables): list, create, toggle active"
```

---

## Task 25: Rake transaction form

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-rake-form.tsx`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Add `recordRake` to transactions action**

Append to `app/(cashier)/_actions/transactions.ts`:

```typescript
export async function recordRake(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const staffId = formData.get("staffId")?.toString() || null;
  const tableId = formData.get("tableId")?.toString() || null;
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");

  if (!sessionId || !gameId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Rake requires a positive amount");
  }
  const cashierId = await cashierUserId();

  await createTransaction({
    sessionId, gameId, type: "RAKE",
    createdById: cashierId, amount, method: "CHIPS",
    staffId, tableId,
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "RAKE_POOL", delta: amount, gameId },
    ],
  });

  revalidatePath("/live");
}
```

- [ ] **Step 2: Write the form**

`app/(cashier)/live/_components/tx-rake-form.tsx`:

```tsx
import { recordRake } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface RakeFormProps {
  sessionId: string;
  gameId: string;
}

export async function RakeForm({ sessionId, gameId }: RakeFormProps) {
  const dealers = await prisma.user.findMany({
    where: { role: "DEALER", status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
  const tables = await prisma.table.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <form action={recordRake} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">+ Rake drop</h3>
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
        <input name="amount" type="number" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Rake</button>
    </form>
  );
}
```

- [ ] **Step 3: Add to live page**

In `app/(cashier)/live/page.tsx`, in the side panel:

```tsx
import { RakeForm } from "./_components/tx-rake-form";

// ... add to side panel:
<RakeForm sessionId={session.id} gameId={session.games[0].id} />
```

- [ ] **Step 4: Verify**

Restart server. After a buy-in (chip_float = +500), record a rake of $50. Chip float should drop to $450, rake_pool should rise to $50.

- [ ] **Step 5: Commit**

```bash
git add app/(cashier)/
git commit -m "feat(tx): rake transaction form"
```

---

## Task 26: Tip drop form

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-tipdrop-form.tsx`
- Modify: `app/(cashier)/live/page.tsx`

- [ ] **Step 1: Add `recordTipDrop` to transactions action**

```typescript
export async function recordTipDrop(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const staffId = formData.get("staffId")?.toString();
  const tableId = formData.get("tableId")?.toString() || null;
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");

  if (!sessionId || !gameId || !staffId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Tip drop requires a recipient and a positive amount");
  }
  const cashierId = await cashierUserId();

  await createTransaction({
    sessionId, gameId, type: "TIP_DROP",
    createdById: cashierId, amount, method: "CHIPS",
    staffId, tableId,
    entries: [
      { account: "CHIP_FLOAT", delta: amount.neg() },
      { account: "TIP_POOL", delta: amount },
    ],
  });

  revalidatePath("/live");
}
```

- [ ] **Step 2: Write the form**

`app/(cashier)/live/_components/tx-tipdrop-form.tsx`:

```tsx
import { recordTipDrop } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface TipDropFormProps {
  sessionId: string;
  gameId: string;
}

export async function TipDropForm({ sessionId, gameId }: TipDropFormProps) {
  const staff = await prisma.user.findMany({
    where: { role: { in: ["DEALER", "WAITRESS"] }, status: "ACTIVE" },
    orderBy: { name: "asc" },
  });

  return (
    <form action={recordTipDrop} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="gameId" value={gameId} />
      <h3 className="font-semibold text-amber-500 mb-1">+ Tip drop</h3>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Recipient</span>
        <select name="staffId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
          <option value="">— select —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.toLowerCase()})</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-slate-400">Amount (chips)</span>
        <input name="amount" type="number" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
      </label>
      <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Tip Drop</button>
    </form>
  );
}
```

- [ ] **Step 3: Wire into live page + Commit**

```tsx
import { TipDropForm } from "./_components/tx-tipdrop-form";
// ... in side panel:
<TipDropForm sessionId={session.id} gameId={session.games[0].id} />
```

```bash
git add app/(cashier)/
git commit -m "feat(tx): tip drop form"
```

---

## Task 27: Marker issue + repay forms

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`
- Create: `app/(cashier)/live/_components/tx-marker-form.tsx`

- [ ] **Step 1: Add `issueMarker` and `repayMarker` to transactions action**

```typescript
export async function issueMarker(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const playerId = formData.get("playerId")?.toString();
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");
  const collateral = formData.get("collateral")?.toString() || null;

  if (!sessionId || !gameId || !playerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Marker issue requires player and positive amount");
  }
  const cashierId = await cashierUserId();

  // The transaction must exist before the Marker can reference it.
  // createTransaction returns the created tx; we then create the Marker with that tx id.
  const tx = await createTransaction({
    sessionId, gameId, type: "MARKER_ISSUE",
    createdById: cashierId, amount, method: "CHIPS",
    playerId,
    note: collateral ? `Collateral: ${collateral}` : null,
    entries: [
      { account: "MARKER_OUTSTANDING", delta: amount },
      { account: "CHIP_FLOAT", delta: amount },
    ],
  });

  await prisma.marker.create({
    data: {
      playerId, sessionId,
      issuedTxId: tx.id,
      amount: amount.toString(),
      status: "OPEN",
      collateral,
    },
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}

export async function repayMarker(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  const gameId = formData.get("gameId")?.toString();
  const markerId = formData.get("markerId")?.toString();
  const amount = new Decimal(formData.get("amount")?.toString() ?? "0");
  const method = (formData.get("method")?.toString() as PaymentMethod) ?? "CASH";

  if (!sessionId || !gameId || !markerId || amount.lessThanOrEqualTo(0)) {
    throw new Error("Marker repay requires marker and positive amount");
  }
  const marker = await prisma.marker.findUnique({ where: { id: markerId } });
  if (!marker) throw new Error("Marker not found");
  if (marker.status !== "OPEN") throw new Error("Marker is not open");

  const cashierId = await cashierUserId();
  const targetAccount = METHOD_TO_ACCOUNT[method];

  await createTransaction({
    sessionId, gameId, type: "MARKER_REPAY",
    createdById: cashierId, amount, method,
    playerId: marker.playerId,
    entries: [
      { account: targetAccount, delta: amount },
      { account: "MARKER_OUTSTANDING", delta: amount.neg() },
    ],
  });

  const newRepaid = new Decimal(marker.repaidAmount.toString()).add(amount);
  const newStatus = newRepaid.greaterThanOrEqualTo(marker.amount.toString()) ? "REPAID" : "OPEN";
  await prisma.marker.update({
    where: { id: markerId },
    data: { repaidAmount: newRepaid.toString(), status: newStatus },
  });

  revalidatePath("/live");
  revalidatePath("/markers");
}
```

- [ ] **Step 2: Write the marker form**

`app/(cashier)/live/_components/tx-marker-form.tsx`:

```tsx
import { issueMarker, repayMarker } from "../../_actions/transactions";
import { prisma } from "@/lib/db";

interface MarkerFormProps {
  sessionId: string;
  gameId: string;
}

export async function MarkerForm({ sessionId, gameId }: MarkerFormProps) {
  const players = await prisma.player.findMany({ orderBy: { displayName: "asc" } });
  const openMarkers = await prisma.marker.findMany({
    where: { status: "OPEN" },
    include: { player: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="flex flex-col gap-3">
      <form action={issueMarker} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gameId" value={gameId} />
        <h3 className="font-semibold text-amber-500 mb-1">$ Issue marker</h3>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Player</span>
          <select name="playerId" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
            <option value="">— select —</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Amount</span>
          <input name="amount" type="number" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Collateral note (optional)</span>
          <input name="collateral" placeholder="e.g. gold watch" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2" />
        </label>
        <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Issue Marker</button>
      </form>

      {openMarkers.length > 0 && (
        <form action={repayMarker} className="flex flex-col gap-3 bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg p-4">
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="gameId" value={gameId} />
          <h3 className="font-semibold text-amber-500 mb-1">$ Repay marker</h3>
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
            <span className="text-slate-400">Payment amount</span>
            <input name="amount" type="number" step="0.01" min="0.01" required className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2 font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Method</span>
            <select name="method" defaultValue="CASH" className="bg-black/40 border border-[var(--color-border)] rounded px-3 py-2">
              <option value="CASH">Cash</option>
              <option value="ZELLE">Zelle</option>
              <option value="VENMO">Venmo</option>
              <option value="CASHAPP">CashApp</option>
              <option value="APPLE_PAY">Apple Pay</option>
            </select>
          </label>
          <button type="submit" className="bg-amber-500 text-black font-semibold rounded px-4 py-2">Record Repayment</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into live page + verify + Commit**

```tsx
import { MarkerForm } from "./_components/tx-marker-form";
// ... add to side panel:
<MarkerForm sessionId={session.id} gameId={session.games[0].id} />
```

Issue a marker, then partially repay it, then fully repay it. Verify marker.status flips to REPAID when repaidAmount equals amount.

```bash
git add app/(cashier)/
git commit -m "feat(tx): marker issue and repay forms"
```

---

## Task 28: Session close — basic per-account reconciliation

**Files:**
- Modify: `app/(cashier)/_actions/session.ts`
- Create: `app/(cashier)/close/page.tsx`
- Modify: `app/(cashier)/live/page.tsx` (add "Close session" button)

- [ ] **Step 1: Add `closeSession` action**

Append to `app/(cashier)/_actions/session.ts`:

```typescript
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";

export async function closeSession(formData: FormData) {
  const sessionId = formData.get("sessionId")?.toString();
  if (!sessionId) throw new Error("sessionId required");

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { games: true },
  });
  if (!session) throw new Error("Session not found");
  if (session.status !== "OPEN") throw new Error("Session already closed");

  const cashierId = await getCashierUserId();

  // For each account that's not game-scoped, record one SessionAccountClose.
  // For game-scoped accounts, record one per game.
  for (const account of ACCOUNTS) {
    const isGameScoped = ["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"].includes(account);
    if (isGameScoped) {
      for (const game of session.games) {
        const expected = await getAccountBalance({ account, sessionId, gameId: game.id });
        const counted = new Decimal(formData.get(`counted_${account}_${game.id}`)?.toString() ?? "0");
        const variance = counted.sub(expected);
        await prisma.sessionAccountClose.create({
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
      await prisma.sessionAccountClose.create({
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

  // Freeze the session
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: cashierId,
      closingCash: (formData.get("counted_CASH_DRAWER")?.toString() ?? "0"),
    },
  });

  // Close any open games
  await prisma.game.updateMany({
    where: { sessionId, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  revalidatePath("/live");
  revalidatePath("/close");
}
```

- [ ] **Step 2: Write the close page**

`app/(cashier)/close/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getOpenSession, closeSession } from "../_actions/session";
import { getAccountBalance } from "@/lib/ledger/balance";
import { ACCOUNTS } from "@/lib/ledger/accounts";
import { Money } from "@/components/money";

export default async function ClosePage() {
  const session = await getOpenSession();
  if (!session) redirect("/live");

  // Compute expected balances for the form
  const expected: Record<string, string> = {};
  for (const account of ACCOUNTS) {
    const isGameScoped = ["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"].includes(account);
    if (isGameScoped) {
      for (const game of session.games) {
        const bal = await getAccountBalance({ account, sessionId: session.id, gameId: game.id });
        expected[`${account}_${game.id}`] = bal.toString();
      }
    } else {
      const bal = await getAccountBalance({ account, sessionId: session.id });
      expected[account] = bal.toString();
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Close Session</h2>
      <p className="text-sm text-slate-400 mb-4">
        Count each account and enter the actual amount. Variances are recorded but allowed —
        they appear in tonight's <code>SessionAccountClose</code> rows for review.
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
              const isGameScoped = ["RAKE_POOL", "PROMO_POOL", "TOURNAMENT_POOL"].includes(account);
              if (isGameScoped) {
                return session.games.map((game) => (
                  <tr key={`${account}_${game.id}`} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2 text-sm">{account.toLowerCase()} ({game.name})</td>
                    <td className="px-3 py-2 text-right font-mono"><Money amount={expected[`${account}_${game.id}`]} /></td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        name={`counted_${account}_${game.id}`}
                        defaultValue={expected[`${account}_${game.id}`]}
                        className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right"
                      />
                    </td>
                  </tr>
                ));
              }
              return (
                <tr key={account} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 text-sm">{account.toLowerCase()}</td>
                  <td className="px-3 py-2 text-right font-mono"><Money amount={expected[account]} /></td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      name={`counted_${account}`}
                      defaultValue={expected[account]}
                      className="bg-black/40 border border-[var(--color-border)] rounded px-2 py-1 w-32 font-mono text-right"
                    />
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
    </div>
  );
}
```

- [ ] **Step 3: Add a "Close session…" link/button to the live page header**

In `app/(cashier)/live/page.tsx`, in the header, add:

```tsx
import Link from "next/link";

// ... in the open-session header:
<Link href="/close" className="text-red-400 border border-red-900 rounded px-3 py-1.5 text-sm hover:bg-red-950/40">
  Close session…
</Link>
```

- [ ] **Step 4: Verify**

Open a session → record some transactions → click "Close session…" → review expected/counted form → submit. Visit /live, should see "No session open" form.

Verify in DB:

```bash
docker compose exec postgres psql -U poker -d poker_room_accounting -c 'SELECT account, expected, counted, variance FROM "SessionAccountClose" ORDER BY account;'
```

Expected: one row per account, variance = 0 (since defaults pre-fill expected).

- [ ] **Step 5: Commit**

```bash
git add app/(cashier)/
git commit -m "feat(session): close-out flow with per-account reconciliation"
```

---

## Task 29: Verify trigger blocks transactions on closed session

**Files:**
- Create: `tests/unit/ledger/closed-session.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { testPrisma, resetDatabase } from "../test-db";
import { createTransaction } from "@/lib/ledger/transaction";

describe("closed session is frozen", () => {
  let sessionId: string;
  let gameId: string;

  beforeEach(async () => {
    await resetDatabase();
    const session = await testPrisma.session.create({
      data: {
        openedById: "test-cashier",
        status: "CLOSED",
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

  it("rejects insertion of a transaction into a closed session", async () => {
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
    ).rejects.toThrow(/closed session/i);
  });
});
```

- [ ] **Step 2: Run, verify pass**

```bash
npm test -- tests/unit/ledger/closed-session.test.ts
```

Expected: pass (the trigger from Task 5 enforces this).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/ledger/closed-session.test.ts
git commit -m "test: closed session blocks new transactions"
```

---

## Task 30: E2E test — full night smoke test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/full-night.spec.ts`

- [ ] **Step 1: Write `playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Install Playwright browsers**

```bash
npx playwright install chromium
```

- [ ] **Step 3: Write the test**

`tests/e2e/full-night.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

test.beforeEach(async () => {
  // Reset and reseed before each test
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", { stdio: "inherit" });
  execSync("npx prisma db seed", { stdio: "inherit" });
});

test("full night: open session, add player, buy-in, cash-out, close", async ({ page }) => {
  // Open session
  await page.goto("/live");
  await expect(page.getByText("No session open")).toBeVisible();
  await page.getByLabel(/Opening cash float/).fill("0");
  await page.getByRole("button", { name: /Open Session/ }).click();
  await expect(page.getByText(/Tonight's Session/)).toBeVisible();

  // Create a player
  await page.goto("/players/new");
  await page.getByLabel(/Display name/).fill("Test Player");
  await page.getByRole("button", { name: /Create/ }).click();
  await expect(page.getByText("Test Player")).toBeVisible();

  // Create a table
  await page.goto("/tables");
  await page.getByPlaceholder(/Table name/).fill("Table 1");
  await page.getByPlaceholder(/Stakes/).fill("1/2 NL");
  await page.getByRole("button", { name: /^Add$/ }).click();

  // Buy-in $500 cash
  await page.goto("/live");
  const buyInForm = page.locator("form").filter({ hasText: "+ Buy-in" });
  await buyInForm.getByLabel(/Player/).selectOption({ label: "Test Player" });
  await buyInForm.getByLabel(/Amount/).fill("500");
  await buyInForm.getByRole("button", { name: /Record Buy-in/ }).click();

  // Cash drawer should now show $500
  await expect(page.getByText("$500.00").first()).toBeVisible();

  // Cash-out $500 (5 × $100)
  const cashOutForm = page.locator("form").filter({ hasText: "− Cash-out" });
  await cashOutForm.getByLabel(/Player/).selectOption({ label: "Test Player" });
  await cashOutForm.locator("input[name=n100]").fill("5");
  await cashOutForm.getByRole("button", { name: /Record Cash-out/ }).click();

  // Cash drawer back to $0
  await page.waitForTimeout(500);
  await expect(page.locator("text=Cash drawer").locator("xpath=./following-sibling::*")).toContainText("$0.00");

  // Close session
  await page.getByRole("link", { name: /Close session/ }).click();
  await page.getByRole("button", { name: /Close Session/ }).click();
  await expect(page.getByText("No session open")).toBeVisible();
});
```

- [ ] **Step 4: Run the E2E test**

```bash
npm run test:e2e
```

Expected: test passes.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test(e2e): full-night smoke test (open, buy-in, cash-out, close)"
```

---

## Task 31: Closed-session error handling in UI

**Files:**
- Modify: `app/(cashier)/_actions/transactions.ts`

When all forms exist, hitting submit on a closed session would currently throw a 500. Catch this in the actions and show a friendly error.

- [ ] **Step 1: Add a helper at the top of `app/(cashier)/_actions/transactions.ts`**

Replace the imports and add a helper:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { createTransaction } from "@/lib/ledger/transaction";
import type { PaymentMethod } from "@prisma/client";

const CASHIER_EMAIL = "cashier@dev.local";

async function cashierUserId(): Promise<string> {
  const c = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
  if (!c) throw new Error("Cashier user not seeded");
  return c.id;
}

async function ensureSessionOpen(sessionId: string): Promise<void> {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error("Session not found");
  if (s.status === "CLOSED") {
    throw new Error("Cannot record transactions on a closed session.");
  }
}
```

- [ ] **Step 2: Call `ensureSessionOpen` at the top of every record* function**

Add `await ensureSessionOpen(sessionId);` after the input validation in each of:
- `recordBuyIn`
- `recordCashOut`
- `recordRake`
- `recordTipDrop`
- `issueMarker`
- `repayMarker`

- [ ] **Step 3: Verify**

Manually test: close a session, then try to navigate to /live and use any form. The action throws a friendly error in the Server Components error UI rather than a generic 500.

- [ ] **Step 4: Commit**

```bash
git add app/(cashier)/_actions/transactions.ts
git commit -m "feat: friendly error when recording on a closed session"
```

---

## Task 32: README with setup instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the auto-generated README with usage docs**

```markdown
# Poker Room Accounting

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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup and usage"
```

---

## Self-Review

After writing the full plan, scan against the spec:

**Spec coverage check:**

| Spec section | Implemented in Plan 1? | Notes |
|--------------|:---------------------:|-------|
| §6.1 entities | ✓ all | Full schema in Task 4 |
| §6.2 transaction types | partial | Plan 1 covers: buy_in, cash_out, rake, tip_drop, marker_issue, marker_repay, opening_float. Plan 1b covers the rest. |
| §6.3 sign convention | ✓ | Task 9 + Task 10 |
| §7.1 invariants | ✓ | Triggers in Task 5 |
| §7.2 balance computation | ✓ | Task 11 |
| §7.3 corrections (reversals) | ✓ | Task 13 (logic only — no UI to invoke reversals from the cashier dashboard yet, that's Plan 1b) |
| §7.4 reconciliation | partial | Per-account close-out in Task 28; divergence finder + heuristics + walks/returns are Plan 1b |
| §8 RBAC + auth | — | Out of scope for Plan 1 |
| §9.1 session open | ✓ | Task 17 |
| §9.2 direct buy-in | ✓ | Task 19 |
| §9.3 runner pickup | — | Plan 2 |
| §9.4 cash-out denomination | ✓ | Task 20 |
| §9.5 marker issue/repay | ✓ | Task 27 |
| §9.6 hourly drops | ✓ for rake/tip drop forms | Drop tracker UI is Plan 1b |
| §9.7 cashier handoff | — | Plan 2 (needs auth) |
| §9.8 close-out | partial | Per-account close in Task 28; tip payout, rake distribution, walks/returns in Plan 1b |
| §9.9 freeroll | — | Plan 1b |
| §9.10 walks/returns | — | Plan 1b |
| §10 concurrent games | partial | Schema supports; UI uses singleton "Main Game" (Plan 1b adds Game switcher and per-game UX) |
| §11 UI structure | partial | Sidebar + live view + entity CRUD; mobile layout deferred to Plan 2 |
| §12 dashboards | — | Plan 3 |
| §13 tech stack | ✓ | Tasks 1-3 + 8 |

**Placeholder scan:** No "TBD", "TODO", or "implement later". Every step has runnable code or commands.

**Type consistency check:** `createTransaction`, `getAccountBalance`, `getBalanceAt`, `recordBuyIn`, `recordCashOut`, `recordRake`, `recordTipDrop`, `issueMarker`, `repayMarker`, `openSession`, `closeSession`, `createPlayer`, `updatePlayer`, `createStaff`, `updateStaff`, `createTable`, `toggleTableActive` — all referenced consistently across tasks.

**Scope check:** Plan 1 is large (32 tasks) but each task is self-contained with TDD steps and produces a small, committable change. The plan's deliverable — a cashier-only tool that handles the core nightly workflows — is a real working product. Plans 1b/2/3 are clearly scoped for follow-up.
