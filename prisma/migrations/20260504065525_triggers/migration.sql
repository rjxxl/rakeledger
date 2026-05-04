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
