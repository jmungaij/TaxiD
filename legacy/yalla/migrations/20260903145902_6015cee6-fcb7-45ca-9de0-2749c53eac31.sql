-- 1. Authorisation guard on carrier compliance/eligibility readers -------------
CREATE OR REPLACE FUNCTION public._carrier_read_authorised(_carrier_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Internal system contexts: service_role callers and nested SECURITY DEFINER
  -- calls executing as the database owner.
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF public._carrier_is_member(_carrier_id) THEN
    RETURN true;
  END IF;
  RETURN public.has_staff_permission('staff.logistics.read')
      OR public.has_staff_permission('staff.logistics.manage')
      OR public.has_staff_permission('staff.logistics.compliance.manage')
      OR public.has_staff_permission('staff.partners.read');
END;
$$;

REVOKE ALL ON FUNCTION public._carrier_read_authorised(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._carrier_read_authorised(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._carrier_read_authorised(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._carrier_read_authorised(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.carrier_matchability(_carrier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compliance jsonb;
  v_blocking jsonb := '[]'::jsonb;
  v_missing_decl text[];
BEGIN
  IF NOT public._carrier_read_authorised(_carrier_id) THEN
    RAISE EXCEPTION 'not_authorised_for_carrier';
  END IF;

  v_compliance := public.carrier_compliance_state(_carrier_id);
  IF (v_compliance->>'state') <> 'PASS' THEN
    v_blocking := v_blocking || jsonb_build_object('code','CARRIER_COMPLIANCE_' || (v_compliance->>'state'));
  END IF;

  SELECT array_agg(code) INTO v_missing_decl
    FROM (VALUES ('FLEET_OWNER_AGREEMENT'),('PROHIBITED_GOODS_UNDERTAKING'),('INDEMNITY_ACCEPTANCE')) AS t(code)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.carrier_declarations d
      WHERE d.carrier_id = _carrier_id AND d.declaration_code = t.code AND d.state = 'ACCEPTED');

  IF v_missing_decl IS NOT NULL THEN
    v_blocking := v_blocking || jsonb_build_object('code','DECLARATIONS_NOT_ACCEPTED','missing', to_jsonb(v_missing_decl));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.carrier_settlement_destinations
                  WHERE carrier_id = _carrier_id AND verification_state = 'VERIFIED') THEN
    v_blocking := v_blocking || jsonb_build_object('code','SETTLEMENT_DESTINATION_NOT_VERIFIED');
  END IF;

  RETURN jsonb_build_object(
    'matchable', jsonb_array_length(v_blocking) = 0,
    'state', CASE WHEN jsonb_array_length(v_blocking) = 0 THEN 'MATCHABLE' ELSE 'NOT_MATCHABLE' END,
    'compliance', v_compliance, 'blocking', v_blocking, 'evaluated_at', now());
END; $function$;

CREATE OR REPLACE FUNCTION public.carrier_subject_eligibility(_carrier_id uuid, _level text, _vehicle_id uuid DEFAULT NULL::uuid, _driver_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int; v_blocking jsonb := '[]'::jsonb; r record;
BEGIN
  IF NOT public._carrier_read_authorised(_carrier_id) THEN
    RAISE EXCEPTION 'not_authorised_for_carrier';
  END IF;

  SELECT count(*) INTO v_total FROM public.carrier_compliance_items
   WHERE carrier_id = _carrier_id AND is_mandatory AND responsibility_level = _level
     AND COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_vehicle_id, '00000000-0000-0000-0000-000000000000')
     AND COALESCE(driver_user_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_driver_user_id, '00000000-0000-0000-0000-000000000000');

  IF v_total = 0 THEN
    RETURN jsonb_build_object('eligible', false, 'state', 'REQUIREMENTS_NOT_PROVISIONED',
      'blocking', jsonb_build_array(jsonb_build_object('code','REQUIREMENTS_NOT_PROVISIONED','level',_level)));
  END IF;

  FOR r IN
    SELECT * FROM public.carrier_compliance_items
     WHERE carrier_id = _carrier_id AND is_mandatory AND responsibility_level = _level
       AND COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_vehicle_id, '00000000-0000-0000-0000-000000000000')
       AND COALESCE(driver_user_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_driver_user_id, '00000000-0000-0000-0000-000000000000')
  LOOP
    IF r.state::text <> 'VERIFIED' THEN
      v_blocking := v_blocking || jsonb_build_object('code','EVIDENCE_' || r.state::text, 'requirement', r.requirement_code);
    ELSIF r.expires_on IS NOT NULL AND r.expires_on < current_date THEN
      v_blocking := v_blocking || jsonb_build_object('code','EVIDENCE_EXPIRED', 'requirement', r.requirement_code, 'expired_on', r.expires_on);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible', jsonb_array_length(v_blocking) = 0,
    'state', CASE WHEN jsonb_array_length(v_blocking) = 0 THEN 'ELIGIBLE' ELSE 'BLOCKED' END,
    'level', _level, 'mandatory_items', v_total, 'blocking', v_blocking, 'evaluated_at', now());
END; $function$;

-- 2. Withdraw anonymous EXECUTE from privileged carrier RPCs ------------------
REVOKE ALL ON FUNCTION public.carrier_matchability(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.carrier_matchability(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.carrier_matchability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carrier_matchability(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.carrier_subject_eligibility(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.carrier_subject_eligibility(uuid, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.carrier_subject_eligibility(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carrier_subject_eligibility(uuid, text, uuid, uuid) TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'carrier_pod_submit', 'carrier_pod_review', 'carrier_payable_release',
         'carrier_withdrawal_request', 'carrier_withdrawal_decide',
         'carrier_requirements_provision')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 3. Harden the public candidate declaration entrypoint -----------------------
CREATE OR REPLACE FUNCTION public.rec_public_requirement_responses(p_application_id uuid, p_responses jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_app public.rec_applications; r jsonb; v_id uuid; v_count int := 0; v_detail text;
BEGIN
  IF jsonb_typeof(coalesce(p_responses, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_responses_payload';
  END IF;
  IF jsonb_array_length(coalesce(p_responses, '[]'::jsonb)) > 40 THEN
    RAISE EXCEPTION 'too_many_responses';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.created_at < now() - interval '2 hours' THEN
    RAISE EXCEPTION 'response_window_closed';
  END IF;
  IF coalesce(lower(v_app.status::text), '') IN ('submitted', 'withdrawn', 'rejected', 'hired') THEN
    RAISE EXCEPTION 'response_window_closed';
  END IF;

  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(p_responses,'[]'::jsonb)) x LOOP
    IF coalesce(btrim(r->>'requirement_key'),'') = '' THEN CONTINUE; END IF;
    v_detail := left(nullif(btrim(coalesce(r->>'declared_detail','')),''), 2000);

    INSERT INTO public.rec_requirement_responses
      (application_id, rule_id, requirement_key, doc_key, declared, declared_detail)
    VALUES (p_application_id, nullif(r->>'rule_id','')::uuid, left(btrim(r->>'requirement_key'), 120),
            nullif(btrim(coalesce(r->>'doc_key','')),''),
            coalesce((r->>'declared')::boolean, false),
            v_detail)
    ON CONFLICT (application_id, requirement_key) DO UPDATE
      SET declared = excluded.declared,
          declared_detail = excluded.declared_detail,
          rule_id = coalesce(excluded.rule_id, public.rec_requirement_responses.rule_id),
          doc_key = coalesce(excluded.doc_key, public.rec_requirement_responses.doc_key)
      WHERE public.rec_requirement_responses.staff_status = 'pending'
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      INSERT INTO public.rec_requirement_response_events
        (response_id, application_id, requirement_key, action, new_status, declared, note)
      VALUES (v_id, p_application_id, left(btrim(r->>'requirement_key'), 120), 'CANDIDATE_DECLARED',
              'pending', coalesce((r->>'declared')::boolean, false), v_detail);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('application_id', p_application_id, 'recorded', v_count);
END; $function$;

REVOKE ALL ON FUNCTION public.rec_public_requirement_responses(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_requirement_responses(uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.rec_public_requirement_responses(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_public_requirement_responses(uuid, jsonb) TO service_role;