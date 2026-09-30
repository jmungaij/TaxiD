DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proconfig IS NULL
       AND p.prokind = 'f'
       AND p.proname IN ('enqueue_email','read_email_batch','delete_email','move_to_dlq')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pgmq', r.sig);
  END LOOP;
END $$;