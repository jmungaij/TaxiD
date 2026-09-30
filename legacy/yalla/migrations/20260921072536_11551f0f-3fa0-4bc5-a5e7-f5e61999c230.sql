-- Realtime-published business tables: remove the anon table grant.
-- No anon policy exists on any of these, so anon already received zero rows;
-- revoking the grant refuses a signed-out subscription at the privilege layer.
-- Rollback: GRANT SELECT ON <table> TO anon for the listed tables.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
  END LOOP;
END $$;
