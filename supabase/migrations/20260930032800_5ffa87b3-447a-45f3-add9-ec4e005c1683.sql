CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

DO $sec$
DECLARE
  r record; v_args text; v_call text; v_ret text; v_body text; i int;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.pronargs, p.proretset,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS res,
           p.prorettype = 'void'::regtype AS is_void,
           p.provolatile
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef AND p.prokind = 'f'
      AND p.prorettype <> 'trigger'::regtype
      AND p.prorettype <> 'event_trigger'::regtype
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'))
  LOOP
    IF EXISTS (SELECT 1 FROM pg_proc q WHERE q.pronamespace='private'::regnamespace AND q.proname=r.proname
               AND pg_get_function_identity_arguments(q.oid)=pg_get_function_identity_arguments(r.oid)) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA private', r.proname, pg_get_function_identity_arguments(r.oid));
    v_call := '';
    FOR i IN 1..r.pronargs LOOP
      v_call := v_call || CASE WHEN i>1 THEN ', ' ELSE '' END || '$' || i;
    END LOOP;
    IF r.is_void THEN
      v_body := format('SELECT private.%I(%s)', r.proname, v_call);
    ELSIF r.proretset OR r.res ILIKE 'TABLE(%' THEN
      v_body := format('SELECT * FROM private.%I(%s)', r.proname, v_call);
    ELSE
      v_body := format('SELECT private.%I(%s)', r.proname, v_call);
    END IF;
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path = public AS %L',
      r.proname, r.args, r.res,
      CASE r.provolatile WHEN 'i' THEN 'STABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END,
      v_body);
    -- mirror access on the wrapper
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, pg_get_function_identity_arguments(r.oid));
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, pg_get_function_identity_arguments(r.oid));
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.proname, pg_get_function_identity_arguments(r.oid));
    END IF;
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, pg_get_function_identity_arguments(r.oid));
    END IF;
  END LOOP;
END $sec$;