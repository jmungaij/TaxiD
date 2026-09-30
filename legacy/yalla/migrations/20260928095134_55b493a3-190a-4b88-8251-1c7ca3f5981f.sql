DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.charter_bookings_guard_financials()'::regprocedure) INTO d;
  d := regexp_replace(d, 'NEW\.total_amount\s*:= OLD\.total_amount;', 'NEW.amount := OLD.amount;');
  EXECUTE d;
END $$;