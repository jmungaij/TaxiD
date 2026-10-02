DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('private.corporate_trip_settle(uuid)'::regprocedure) INTO src;
  src := replace(src, 'INSERT INTO corporate_cash_ledger(corporate_id, entry_type, amount_cents, balance_after_cents, reference, description, source_kind, source_id, created_by, metadata)
      VALUES (b.corporate_id, ''ride_charge'', -use_w, wal - use_w, b.booking_number, ''Business trip ''||b.booking_number, ''trip_booking'', b.id, auth.uid(),',
    'INSERT INTO corporate_cash_ledger(corporate_id, entry_type, amount_cents, balance_after_cents, reference, description, source_kind, source_id, created_by, occurred_at, created_at, metadata)
      VALUES (b.corporate_id, ''ride_charge'', -use_w, wal - use_w, b.booking_number, ''Business trip ''||b.booking_number, ''trip_booking'', b.id, auth.uid(), clock_timestamp(), clock_timestamp(),');
  IF position('clock_timestamp()' in src) = 0 THEN RAISE EXCEPTION 'patch not applied'; END IF;
  EXECUTE src;
END $$;