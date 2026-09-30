-- ============================================================
-- Role-helper grant governance: hardened guard, drift ledger,
-- version-pinned helpers, admin visibility.
-- ============================================================

-- 1. Append-only guard event ledger -------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_grant_guard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,               -- GRANT_APPLIED | OWNER_MISMATCH | DRIFT_DETECTED | DRIFT_CLEARED
  command_tag text,
  function_signature text,
  function_owner text,
  security_definer boolean,
  applied_grantees text[] NOT NULL DEFAULT '{}',
  missing_grantees text[] NOT NULL DEFAULT '{}',
  actor text NOT NULL DEFAULT current_user,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.role_grant_guard_events TO authenticated;
GRANT ALL ON public.role_grant_guard_events TO service_role;
ALTER TABLE public.role_grant_guard_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_grant_guard_events_admin_read ON public.role_grant_guard_events;
CREATE POLICY role_grant_guard_events_admin_read
  ON public.role_grant_guard_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.role_grant_guard_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'role_grant_guard_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS role_grant_guard_events_no_mutate ON public.role_grant_guard_events;
CREATE TRIGGER role_grant_guard_events_no_mutate
  BEFORE UPDATE OR DELETE ON public.role_grant_guard_events
  FOR EACH ROW EXECUTE FUNCTION public.role_grant_guard_events_append_only();

CREATE INDEX IF NOT EXISTS role_grant_guard_events_occurred_idx
  ON public.role_grant_guard_events (occurred_at DESC);

-- 2. Drift check snapshots ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_grant_drift_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',   -- manual | cron | ci
  gap_count integer NOT NULL DEFAULT 0,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  repaired boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  notification_channel text,
  notification_error text
);

GRANT SELECT ON public.role_grant_drift_checks TO authenticated;
GRANT ALL ON public.role_grant_drift_checks TO service_role;
ALTER TABLE public.role_grant_drift_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_grant_drift_checks_admin_read ON public.role_grant_drift_checks;
CREATE POLICY role_grant_drift_checks_admin_read
  ON public.role_grant_drift_checks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE INDEX IF NOT EXISTS role_grant_drift_checks_checked_idx
  ON public.role_grant_drift_checks (checked_at DESC);

-- 3. Canonical status view ----------------------------------------------------
CREATE OR REPLACE VIEW public.v_role_helper_grants
WITH (security_invoker = true) AS
SELECT
  p.oid::regprocedure::text AS function_signature,
  p.proname                 AS function_name,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef               AS security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_execute,
  ARRAY(
    SELECT g FROM unnest(ARRAY['authenticated','anon','service_role']) g
    WHERE NOT has_function_privilege(g, p.oid, 'EXECUTE')
  ) AS missing_grantees,
  (pg_get_userbyid(p.proowner) = 'postgres') AS owner_expected
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('has_role', 'has_any_role', 'has_role_v1', 'has_any_role_v1');

GRANT SELECT ON public.v_role_helper_grants TO authenticated, service_role;

-- 4. Hardened sync routine (grants + owner verification + logging) ------------
CREATE OR REPLACE FUNCTION public.sync_role_function_grants(_command_tag text DEFAULT 'MANUAL')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
  missing text[];
BEGIN
  FOR r IN
    SELECT p.oid AS oid,
           p.oid::regprocedure AS sig,
           pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef AS secdef
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname IN ('has_role', 'has_any_role', 'has_role_v1', 'has_any_role_v1')
  LOOP
    missing := ARRAY(
      SELECT g FROM unnest(ARRAY['authenticated','anon','service_role']) g
      WHERE NOT has_function_privilege(g, r.oid, 'EXECUTE')
    );

    -- deterministic privilege state: PUBLIC revoked, explicit grants only
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, anon, service_role', r.sig);
    n := n + 1;

    IF cardinality(missing) > 0 THEN
      INSERT INTO public.role_grant_guard_events
        (event_type, command_tag, function_signature, function_owner, security_definer,
         applied_grantees, missing_grantees, details)
      VALUES ('GRANT_APPLIED', _command_tag, r.sig::text, r.owner, r.secdef,
              ARRAY['authenticated','anon','service_role'], missing,
              jsonb_build_object('reason', 'missing execute privileges repaired'));
    END IF;

    IF r.owner <> 'postgres' OR r.secdef IS DISTINCT FROM true THEN
      INSERT INTO public.role_grant_guard_events
        (event_type, command_tag, function_signature, function_owner, security_definer, details)
      VALUES ('OWNER_MISMATCH', _command_tag, r.sig::text, r.owner, r.secdef,
              jsonb_build_object('expected_owner', 'postgres', 'expected_security_definer', true));
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_role_function_grants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_role_function_grants(text) TO service_role;

DROP FUNCTION IF EXISTS public.sync_role_function_grants();

-- 5. Hardened event trigger: CREATE / ALTER / RENAME / SECURITY DEFINER change
CREATE OR REPLACE FUNCTION public.tg_sync_role_function_grants()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj record;
  touched boolean := false;
  tag text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF obj.object_type = 'function'
       AND (obj.object_identity LIKE 'public.has_role(%'
            OR obj.object_identity LIKE 'public.has_any_role(%'
            OR obj.object_identity LIKE 'public.has_role_v1(%'
            OR obj.object_identity LIKE 'public.has_any_role_v1(%')
    THEN
      touched := true;
      tag := obj.command_tag;
    END IF;
  END LOOP;

  IF touched THEN
    PERFORM public.sync_role_function_grants(tag);
  END IF;
END;
$$;

DROP EVENT TRIGGER IF EXISTS role_function_grant_guard;
CREATE EVENT TRIGGER role_function_grant_guard
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION')
  EXECUTE FUNCTION public.tg_sync_role_function_grants();

-- 6. Version-pinned helpers (convention: RLS may pin to _v1) ------------------
CREATE OR REPLACE FUNCTION public.has_role_v1(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role_v1(_user_id uuid, _roles app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, _roles)
$$;

-- 7. Drift check with ledger + repair -----------------------------------------
CREATE OR REPLACE FUNCTION public.run_role_grant_drift_check(_source text DEFAULT 'manual', _repair boolean DEFAULT true)
RETURNS TABLE(check_id uuid, gap_count integer, gaps jsonb, repaired boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found jsonb;
  cnt integer;
  cid uuid;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'function_signature', function_signature,
           'missing_grantees', missing_grantees,
           'function_owner', function_owner,
           'security_definer', security_definer,
           'owner_expected', owner_expected)), '[]'::jsonb)
    INTO found
  FROM public.v_role_helper_grants
  WHERE cardinality(missing_grantees) > 0 OR NOT owner_expected OR NOT security_definer;

  cnt := jsonb_array_length(found);

  IF cnt > 0 AND _repair THEN
    PERFORM public.sync_role_function_grants('DRIFT_REPAIR');
  END IF;

  INSERT INTO public.role_grant_drift_checks (source, gap_count, gaps, repaired)
  VALUES (_source, cnt, found, cnt > 0 AND _repair)
  RETURNING id INTO cid;

  IF cnt > 0 THEN
    INSERT INTO public.role_grant_guard_events (event_type, command_tag, details, missing_grantees)
    VALUES ('DRIFT_DETECTED', _source, jsonb_build_object('check_id', cid, 'gaps', found), '{}');
  END IF;

  RETURN QUERY SELECT cid, cnt, found, (cnt > 0 AND _repair);
END;
$$;

REVOKE ALL ON FUNCTION public.run_role_grant_drift_check(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_role_grant_drift_check(text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_role_grant_drift_notified(_check_id uuid, _channel text, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.role_grant_drift_checks
     SET notified_at = now(), notification_channel = _channel, notification_error = _error
   WHERE id = _check_id;
$$;

REVOKE ALL ON FUNCTION public.mark_role_grant_drift_notified(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_role_grant_drift_notified(uuid, text, text) TO service_role;

-- 8. Admin-visible overview RPC ----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_role_grant_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'helpers', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.function_signature) FROM public.v_role_helper_grants v), '[]'::jsonb),
    'checks', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.checked_at DESC)
                        FROM (SELECT * FROM public.role_grant_drift_checks ORDER BY checked_at DESC LIMIT 50) c), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at DESC)
                        FROM (SELECT * FROM public.role_grant_guard_events ORDER BY occurred_at DESC LIMIT 100) e), '[]'::jsonb),
    'guard_enabled', (SELECT count(*) > 0 FROM pg_event_trigger WHERE evtname = 'role_function_grant_guard' AND evtenabled <> 'D')
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_role_grant_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_role_grant_overview() TO authenticated, service_role;

-- 9. Backfill + first drift check ---------------------------------------------
SELECT public.sync_role_function_grants('BOOTSTRAP');
SELECT * FROM public.run_role_grant_drift_check('bootstrap', true);