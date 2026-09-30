DO $mig$
DECLARE
  keep text[] := ARRAY['_contract_may_activate','_contract_may_read','_driver_application_staff','_sales_stage_probability'];
  r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid=p.pronamespace
    JOIN pg_type t ON t.oid=p.prorettype
    WHERE ns.nspname='public' AND p.prosecdef
      AND t.typname NOT IN ('trigger','event_trigger')
      AND p.proname LIKE '\_%'
      AND NOT (p.proname = ANY (keep))
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies pol
        WHERE (coalesce(pol.qual,'')||' '||coalesce(pol.with_check,'')) LIKE '%'||p.proname||'(%'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated, anon, PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'private helpers closed: %', n;
END
$mig$;