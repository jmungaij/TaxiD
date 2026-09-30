-- Guard the two staff-facing definer RPCs that had no authorization check.

-- 1. Role-grant drift check + repair is a governance action: platform admins only.
CREATE OR REPLACE FUNCTION public.run_role_grant_drift_check(_source text DEFAULT 'manual'::text, _repair boolean DEFAULT true)
 RETURNS TABLE(check_id uuid, gap_count integer, gaps jsonb, repaired boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  found jsonb;
  cnt integer;
  cid uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'not_authorised: platform admin required' USING errcode = '42501';
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.run_role_grant_drift_check(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_role_grant_drift_check(text, boolean) TO authenticated, service_role;

-- 2. Publication gate status exposes internal vacancy readiness: recruitment
--    readers only. The body is preserved byte-for-byte; only the guard is added.
DO $do$
DECLARE
  src text;
  guard text := $g$BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not_authorised: recruitment access required' USING errcode = '42501';
  END IF;
$g$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO src
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname = 'rec_publication_gate_status';

  IF src IS NULL THEN RAISE EXCEPTION 'rec_publication_gate_status not found'; END IF;
  IF position('rec_can_read' in src) > 0 THEN RETURN; END IF;

  src := overlay(src placing guard from position(E'BEGIN\n' in src) for length(E'BEGIN\n'));
  EXECUTE src;
END $do$;