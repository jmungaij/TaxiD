-- Guard: keep EXECUTE grants on role-check helper functions in sync automatically.

CREATE OR REPLACE FUNCTION public.sync_role_function_grants()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('has_role', 'has_any_role')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, anon, service_role', r.sig);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_role_function_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_role_function_grants() TO service_role;

-- Diagnostics: report any overload still missing the required grants.
CREATE OR REPLACE FUNCTION public.audit_role_function_grants()
RETURNS TABLE(function_signature text, missing_roles text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.oid::regprocedure::text,
         ARRAY(
           SELECT g FROM unnest(ARRAY['authenticated','anon','service_role']) AS g
           WHERE NOT has_function_privilege(g, p.oid, 'EXECUTE')
         )
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname IN ('has_role','has_any_role')
    AND EXISTS (
      SELECT 1 FROM unnest(ARRAY['authenticated','anon','service_role']) AS g
      WHERE NOT has_function_privilege(g, p.oid, 'EXECUTE')
    );
$$;

GRANT EXECUTE ON FUNCTION public.audit_role_function_grants() TO authenticated, service_role;

-- Event trigger: any new/replaced has_role / has_any_role overload gets grants immediately.
CREATE OR REPLACE FUNCTION public.tg_sync_role_function_grants()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.command_tag IN ('CREATE FUNCTION','ALTER FUNCTION')
       AND obj.object_identity LIKE 'public.has_role(%'
       OR (obj.command_tag IN ('CREATE FUNCTION','ALTER FUNCTION')
           AND obj.object_identity LIKE 'public.has_any_role(%')
    THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, anon, service_role', obj.object_identity);
    END IF;
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS role_function_grant_guard;
CREATE EVENT TRIGGER role_function_grant_guard
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION','ALTER FUNCTION')
  EXECUTE FUNCTION public.tg_sync_role_function_grants();

-- Backfill any existing overloads now.
SELECT public.sync_role_function_grants();