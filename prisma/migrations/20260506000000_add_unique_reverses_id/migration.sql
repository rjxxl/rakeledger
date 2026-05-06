-- Enforce at-most-one reversal per original transaction.
-- Without this, a TOCTOU race in correctTransaction could allow two concurrent
-- corrections to both pass the "no existing reversal" pre-flight check and both
-- insert reversal rows. Postgres treats NULL as distinct in unique indexes by
-- default, so this only constrains rows where reversesId IS NOT NULL.

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_reversesId_key" ON "Transaction"("reversesId");
