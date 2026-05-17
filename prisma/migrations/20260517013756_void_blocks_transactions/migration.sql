CREATE OR REPLACE FUNCTION check_session_open() RETURNS trigger AS $$
DECLARE
  s_status text;
BEGIN
  SELECT status INTO s_status FROM "Session" WHERE id = NEW."sessionId";
  IF s_status <> 'OPEN' THEN
    RAISE EXCEPTION 'Cannot insert Transaction into non-open session % (status %)', NEW."sessionId", s_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
