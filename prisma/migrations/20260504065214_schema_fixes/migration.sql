-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "Session_status_idx" ON "Session"("status");

-- CreateIndex
CREATE INDEX "Transaction_gameId_createdAt_idx" ON "Transaction"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_pickupConfirmedById_idx" ON "Transaction"("pickupConfirmedById");

-- CreateIndex
CREATE INDEX "UserCapabilityGrant_grantedById_idx" ON "UserCapabilityGrant"("grantedById");

-- AddForeignKey
ALTER TABLE "UserCapabilityGrant" ADD CONSTRAINT "UserCapabilityGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_pickupConfirmedById_fkey" FOREIGN KEY ("pickupConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RakeDistribution" ADD CONSTRAINT "RakeDistribution_txId_fkey" FOREIGN KEY ("txId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
