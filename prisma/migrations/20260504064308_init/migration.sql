-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'CASHIER', 'RUNNER', 'DEALER', 'WAITRESS');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH_DRAWER', 'ZELLE', 'VENMO', 'CASHAPP', 'APPLE_PAY', 'CHIP_FLOAT', 'MARKER_OUTSTANDING', 'TIP_POOL', 'HOUSE_TAX_POOL', 'RAKE_POOL', 'PROMO_POOL', 'TOURNAMENT_POOL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ZELLE', 'VENMO', 'CASHAPP', 'APPLE_PAY', 'OTHER', 'CHIPS');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY_IN', 'CASH_OUT', 'RAKE', 'TOURNAMENT_FEE', 'TOURNAMENT_PAYOUT', 'TIP_DROP', 'TIP_HOUSE_TAX', 'TIP_PAYOUT', 'MARKER_ISSUE', 'MARKER_REPAY', 'MARKER_WRITE_OFF', 'FREEROLL_PRIZE_PAYOUT', 'JACKPOT_PAYOUT', 'STAFF_ADVANCE', 'FNB_COST', 'CHIP_WALK', 'CHIP_RETURN', 'DRAWER_COUNT_ADJUST', 'CHIP_FLOAT_ADJUST', 'RAKE_DISTRIBUTION', 'HOUSE_TAX_DISTRIBUTION', 'OPENING_FLOAT', 'CLOSING_FLOAT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MarkerStatus" AS ENUM ('OPEN', 'REPAID', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "capabilities" TEXT[],
    "markerLimit" DECIMAL(12,2),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "googleSub" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinHash" TEXT,
    "tipTaxRate" DECIMAL(5,4),
    "notes" TEXT,
    "customRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCapabilityGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "UserCapabilityGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Table" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameId" TEXT,
    "stakes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openedById" TEXT NOT NULL,
    "closedById" TEXT,
    "openingCash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closingCash" DECIMAL(12,2),
    "notes" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameType" TEXT,
    "stakes" TEXT,
    "rakeSplitConfig" JSONB NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "gameId" TEXT,
    "type" "TransactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "playerId" TEXT,
    "staffId" TEXT,
    "tableId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "note" TEXT,
    "reversesId" TEXT,
    "pickupStatus" "PickupStatus",
    "pickupConfirmedAt" TIMESTAMP(3),
    "pickupConfirmedById" TEXT,
    "pickupEscalatedAt" TIMESTAMP(3),
    "roundingAdjustment" DECIMAL(12,4),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "account" "AccountType" NOT NULL,
    "gameId" TEXT,
    "delta" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marker" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "issuedTxId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "repaidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "MarkerStatus" NOT NULL DEFAULT 'OPEN',
    "collateral" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Marker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAccountClose" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "account" "AccountType" NOT NULL,
    "gameId" TEXT,
    "expected" DECIMAL(12,2) NOT NULL,
    "counted" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "countedById" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "SessionAccountClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RakeDistribution" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "txId" TEXT NOT NULL,

    CONSTRAINT "RakeDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierHandoff" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "outgoingUserId" TEXT NOT NULL,
    "incomingUserId" TEXT NOT NULL,
    "handedOffAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountCounts" JSONB NOT NULL,
    "notes" TEXT,

    CONSTRAINT "CashierHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "defaultTipTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.20,
    "pickupTimeoutSeconds" INTEGER NOT NULL DEFAULT 300,
    "rakeSplitDefaults" JSONB NOT NULL DEFAULT '{}',
    "houseTaxSplitDefaults" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE INDEX "UserCapabilityGrant_userId_idx" ON "UserCapabilityGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Table_name_key" ON "Table"("name");

-- CreateIndex
CREATE INDEX "Transaction_sessionId_createdAt_idx" ON "Transaction"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_playerId_idx" ON "Transaction"("playerId");

-- CreateIndex
CREATE INDEX "Transaction_staffId_idx" ON "Transaction"("staffId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_transactionId_idx" ON "LedgerEntry"("account", "transactionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_gameId_account_idx" ON "LedgerEntry"("gameId", "account");

-- CreateIndex
CREATE UNIQUE INDEX "Marker_issuedTxId_key" ON "Marker"("issuedTxId");

-- CreateIndex
CREATE INDEX "Marker_playerId_status_idx" ON "Marker"("playerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAccountClose_sessionId_account_gameId_key" ON "SessionAccountClose"("sessionId", "account", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "RakeDistribution_txId_key" ON "RakeDistribution"("txId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapabilityGrant" ADD CONSTRAINT "UserCapabilityGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Table" ADD CONSTRAINT "Table_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marker" ADD CONSTRAINT "Marker_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marker" ADD CONSTRAINT "Marker_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Marker" ADD CONSTRAINT "Marker_issuedTxId_fkey" FOREIGN KEY ("issuedTxId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAccountClose" ADD CONSTRAINT "SessionAccountClose_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAccountClose" ADD CONSTRAINT "SessionAccountClose_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RakeDistribution" ADD CONSTRAINT "RakeDistribution_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RakeDistribution" ADD CONSTRAINT "RakeDistribution_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RakeDistribution" ADD CONSTRAINT "RakeDistribution_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierHandoff" ADD CONSTRAINT "CashierHandoff_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierHandoff" ADD CONSTRAINT "CashierHandoff_outgoingUserId_fkey" FOREIGN KEY ("outgoingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashierHandoff" ADD CONSTRAINT "CashierHandoff_incomingUserId_fkey" FOREIGN KEY ("incomingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
