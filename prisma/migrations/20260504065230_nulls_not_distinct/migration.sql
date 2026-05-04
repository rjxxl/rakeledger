-- Replace SessionAccountClose unique index with NULLS NOT DISTINCT semantics.
-- Without this, Postgres treats each NULL gameId as distinct, so the same
-- (sessionId, account) for a non-game-scoped account (e.g. CASH_DRAWER) could
-- be inserted twice without a constraint violation. Postgres 15+ supports
-- NULLS NOT DISTINCT; we target Postgres 16.

DROP INDEX "SessionAccountClose_sessionId_account_gameId_key";
CREATE UNIQUE INDEX "SessionAccountClose_sessionId_account_gameId_key"
  ON "SessionAccountClose" ("sessionId", "account", "gameId")
  NULLS NOT DISTINCT;
