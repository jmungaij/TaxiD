CREATE OR REPLACE FUNCTION public.is_service_context()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT session_user::text IN ('postgres', 'supabase_admin', 'service_role')
      OR COALESCE(
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           ''
         ) = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.require_staff(_perm text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.is_service_context() THEN
    RETURN;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_staff_permission(_perm) THEN
    RAISE EXCEPTION 'forbidden: % is required for this operation', _perm
      USING ERRCODE = '42501';
  END IF;
END;
$$;

DO $sweep$
DECLARE
  r record;
  v_ident text;
BEGIN
  FOR r IN
    SELECT p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           t.typname AS rettype
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public'
  LOOP
    v_ident := format('public.%I(%s)', r.proname, r.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_ident);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_ident);
    IF r.rettype NOT IN ('trigger', 'event_trigger') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_ident);
    ELSE
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_ident);
    END IF;
  END LOOP;
END;
$sweep$;

DO $pub$
DECLARE
  r record;
  allowlist text[] := ARRAY[
    'rec_public_vacancies', 'rec_public_vacancy', 'rec_public_vacancy_detail',
    'rec_public_internship', 'rec_public_application_blueprint',
    'rec_public_slug_is_open', 'rec_public_document_check',
    'rec_public_apply', 'rec_public_internship_apply',
    'rec_public_draft_load', 'rec_public_draft_save',
    'rec_public_announcement_track', 'rec_log_public_api',
    'rec_comm_candidate_respond', 'rec_comm_verify_document',
    'rec_delivery_touch_public',
    'doc_verify_public',
    'track_package_public', 'redeem_trip_share_token',
    'city_pricing_public', 'surge_rules_public',
    'active_surge_multiplier', 'driver_leaderboard_public'
  ];
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(allowlist)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.args);
  END LOOP;
END;
$pub$;

DO $pol$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE n.nspname = 'public'
      AND t.typname = 'bool'
      AND EXISTS (
        SELECT 1 FROM pg_policies pol
        WHERE pol.schemaname = 'public'
          AND (
            coalesce(pol.qual, '') LIKE '%' || p.proname || '(%'
            OR coalesce(pol.with_check, '') LIKE '%' || p.proname || '(%'
          )
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', r.proname, r.args);
  END LOOP;
END;
$pol$;