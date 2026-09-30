SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS public.security_claims ( claim_code text PRIMARY KEY, surface text NOT NULL, wording text, implementation text NOT NULL, owner text NOT NULL, audience text NOT NULL DEFAULT 'PUBLIC', requested_display boolean NOT NULL DEFAULT true, withheld_reason text, review_interval_days integer NOT NULL DEFAULT 90, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.security_claim_controls ( claim_code text NOT NULL REFERENCES public.security_claims(claim_code) ON DELETE CASCADE, control_ref text NOT NULL, control_kind text NOT NULL CHECK (control_kind IN ('DB_POLICY','DB_FUNCTION','DB_TABLE','CI_GATE','PLATFORM_SERVICE','EXTERNAL_AUDIT')), description text NOT NULL, PRIMARY KEY (claim_code, control_ref) );
CREATE TABLE IF NOT EXISTS public.security_claim_evidence ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_code text NOT NULL REFERENCES public.security_claims(claim_code) ON DELETE CASCADE, verdict text NOT NULL CHECK (verdict IN ('PASS','PARTIAL','FAIL','BLOCKED','NOT_TESTED','REQUIRES_EXTERNAL_ACTION')), environment text NOT NULL, observation text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}', executed_by uuid, executed_at timestamptz NOT NULL DEFAULT now(), digest text GENERATED ALWAYS AS (md5(claim_code || verdict || observation)) STORED );
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['security_claims','security_claim_controls','security_claim_evidence'] LOOP EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t); EXECUTE format('GRANT ALL ON public.%I TO service_role', t); EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('CREATE POLICY "Admins manage restored records" ON public.%I FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[]))', t); END LOOP; END $$;

CREATE VIEW public.v_security_claims AS
SELECT c.claim_code, c.surface, c.wording, c.implementation, c.owner, c.audience,
       c.requested_display, c.withheld_reason, c.review_interval_days,
       (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) AS controls,
       e.verdict AS latest_verdict,
       e.observation AS latest_observation,
       e.executed_at AS verified_at,
       e.environment,
       (e.executed_at + (c.review_interval_days || ' days')::interval) AS review_due,
       CASE
         WHEN c.wording IS NULL OR NOT c.requested_display THEN false
         WHEN (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) = 0 THEN false
         WHEN e.verdict IS DISTINCT FROM 'PASS' THEN false
         WHEN e.executed_at + (c.review_interval_days || ' days')::interval < now() THEN false
         ELSE true
       END AS safe_to_display,
       CASE
         WHEN c.wording IS NULL THEN 'NO_APPROVED_WORDING'
         WHEN NOT c.requested_display THEN 'WITHHELD_BY_OWNER'
         WHEN (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) = 0 THEN 'NO_CONTROL'
         WHEN e.verdict IS NULL THEN 'NO_EVIDENCE'
         WHEN e.verdict <> 'PASS' THEN 'EVIDENCE_' || e.verdict
         WHEN e.executed_at + (c.review_interval_days || ' days')::interval < now() THEN 'EVIDENCE_EXPIRED'
         ELSE 'DISPLAYABLE'
       END AS display_state
FROM public.security_claims c
LEFT JOIN LATERAL (
  SELECT * FROM public.security_claim_evidence x
  WHERE x.claim_code = c.claim_code ORDER BY x.executed_at DESC LIMIT 1
) e ON true;
ALTER VIEW public.v_security_claims SET (security_invoker = true);
REVOKE ALL ON public.v_security_claims FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.is_stabilization_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((feature_flags->>'stabilization_mode')::boolean, false)
  FROM public.platform_settings
  ORDER BY created_at ASC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.record_portal_transition(
  _kind text,
  _new_route text,
  _previous_route text DEFAULT NULL,
  _new_context text DEFAULT NULL,
  _previous_context text DEFAULT NULL,
  _remembered boolean DEFAULT false,
  _user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF _kind NOT IN ('login_redirect','portal_switch','deep_link') THEN
    RAISE EXCEPTION 'unsupported transition kind %', _kind;
  END IF;

  INSERT INTO public.portal_transition_audit
    (user_id, actor_email, kind, previous_route, new_route,
     previous_context, new_context, roles, remembered, user_agent)
  SELECT
    _uid,
    (SELECT email FROM auth.users WHERE id = _uid),
    _kind,
    left(coalesce(_previous_route, ''), 300),
    left(_new_route, 300),
    _previous_context,
    _new_context,
    coalesce(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = _uid), '{}'),
    coalesce(_remembered, false),
    left(coalesce(_user_agent, ''), 400)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.security_claims_public()
RETURNS TABLE (claim_code text, surface text, wording text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.claim_code, c.surface, c.wording
  FROM public.v_security_claims c
  WHERE c.safe_to_display
  ORDER BY c.claim_code
$$;

CREATE OR REPLACE FUNCTION public.identity_discover(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(_email, '')));
  v_domain text;
  v_hash text;
  v_bucket text;
  v_hits integer;
  v_policy public.identity_auth_policies;
  v_org public.corporate_accounts;
  v_outcome text := 'PLATFORM_POLICY';
  v_corr uuid := gen_random_uuid();
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_EMAIL');
  END IF;

  v_domain := split_part(v_email, '@', 2);
  v_hash := md5(v_email || 'yalla-identity-discovery');
  v_bucket := 'discover:' || v_hash;

  INSERT INTO public.identity_discovery_rate (bucket, window_start, hits)
  VALUES (v_bucket, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket) DO UPDATE
    SET hits = CASE WHEN public.identity_discovery_rate.window_start < date_trunc('hour', now())
                    THEN 1 ELSE public.identity_discovery_rate.hits + 1 END,
        window_start = CASE WHEN public.identity_discovery_rate.window_start < date_trunc('hour', now())
                    THEN date_trunc('hour', now()) ELSE public.identity_discovery_rate.window_start END
  RETURNING hits INTO v_hits;

  IF v_hits > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;

  SELECT p.* INTO v_policy
  FROM public.identity_auth_policies p
  WHERE p.state = 'ACTIVE' AND p.scope = 'ORGANISATION' AND v_domain = ANY (p.email_domains)
  LIMIT 1;

  IF v_policy.id IS NOT NULL THEN
    SELECT * INTO v_org FROM public.corporate_accounts WHERE id = v_policy.corporate_id;
    v_outcome := 'ORGANISATION_POLICY';
  ELSE
    SELECT p.* INTO v_policy
    FROM public.identity_auth_policies p
    WHERE p.state = 'ACTIVE' AND p.scope = 'PLATFORM'
    LIMIT 1;
  END IF;

  INSERT INTO public.identity_discovery_events (email_hash, email_domain, outcome, corporate_id, policy_id, correlation_id)
  VALUES (v_hash, v_domain, v_outcome, v_policy.corporate_id, v_policy.id, v_corr);

  IF v_policy.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_POLICY', 'correlation_id', v_corr);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'correlation_id', v_corr,
    'outcome', v_outcome,
    'domain', v_domain,
    'organisation', CASE WHEN v_org.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', coalesce(v_org.trading_name, v_org.legal_name)) END,
    'policy', jsonb_build_object('id', v_policy.id, 'label', v_policy.label, 'version', v_policy.version),
    'methods', jsonb_build_object(
      'password', v_policy.password_enabled,
      'passwordless', v_policy.passwordless_enabled,
      'google', v_policy.google_enabled,
      'sso', v_policy.sso_enabled,
      'sso_provider', v_policy.sso_provider
    ),
    'mfa_required', v_policy.mfa_required,
    'session', jsonb_build_object('idle_minutes', v_policy.session_idle_minutes,
                                  'absolute_hours', v_policy.session_absolute_hours)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.identity_risk_evaluate(_fingerprint_hash text DEFAULT NULL, _country text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.identity_risk_policies;
  v_score integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_signals jsonb := '{}'::jsonb;
  v_new_device boolean := false;
  v_new_country boolean := false;
  v_dormant boolean := false;
  v_failures integer := 0;
  v_travel boolean := false;
  v_privileged boolean := false;
  v_last_success timestamptz;
  v_decision text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_p FROM public.identity_risk_policies WHERE state = 'ACTIVE' LIMIT 1;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_RISK_POLICY');
  END IF;

  IF _fingerprint_hash IS NOT NULL THEN
    v_new_device := NOT EXISTS (
      SELECT 1 FROM public.device_fingerprints d
      WHERE d.user_id = v_uid AND d.fingerprint_hash = _fingerprint_hash)
      AND NOT EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.fingerprint_hash = _fingerprint_hash AND e.success);
  END IF;

  IF _country IS NOT NULL THEN
    v_new_country := NOT EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.success AND e.country = _country);
  END IF;

  SELECT max(e.occurred_at) INTO v_last_success
  FROM public.authentication_events e
  WHERE e.user_id = v_uid AND e.success;
  v_dormant := v_last_success IS NOT NULL
    AND v_last_success < now() - make_interval(days => v_p.dormant_days);

  SELECT count(*) INTO v_failures
  FROM public.authentication_events e
  WHERE e.user_id = v_uid AND NOT e.success
    AND e.occurred_at > now() - make_interval(mins => v_p.failure_window_minutes);

  IF _country IS NOT NULL THEN
    v_travel := EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.success
        AND e.country IS NOT NULL AND e.country <> _country
        AND e.occurred_at > now() - make_interval(hours => v_p.travel_window_hours));
  END IF;

  v_privileged := public.has_any_role(v_uid,
    ARRAY['admin','super_admin','finance_admin']::app_role[]);

  IF v_new_device THEN
    v_score := v_score + v_p.w_new_device;
    v_reasons := v_reasons || jsonb_build_array('A device we have not seen on this account before');
  END IF;
  IF v_new_country THEN
    v_score := v_score + v_p.w_new_country;
    v_reasons := v_reasons || jsonb_build_array('A country this account has not signed in from before');
  END IF;
  IF v_dormant THEN
    v_score := v_score + v_p.w_dormant;
    v_reasons := v_reasons || jsonb_build_array('A long gap since the last sign-in');
  END IF;
  IF v_failures >= v_p.failure_threshold THEN
    v_score := v_score + v_p.w_recent_failures;
    v_reasons := v_reasons || jsonb_build_array('Several failed sign-in attempts recently');
  END IF;
  IF v_travel THEN
    v_score := v_score + v_p.w_impossible_travel;
    v_reasons := v_reasons || jsonb_build_array('A sign-in from a different country within a short window');
  END IF;
  IF v_privileged THEN
    v_score := v_score + v_p.w_privileged_access;
    v_reasons := v_reasons || jsonb_build_array('This account holds privileged access');
  END IF;

  v_signals := jsonb_build_object(
    'new_device', v_new_device, 'new_country', v_new_country, 'dormant', v_dormant,
    'recent_failures', v_failures, 'impossible_travel', v_travel, 'privileged', v_privileged,
    'last_success_at', v_last_success);

  v_decision := CASE WHEN v_score >= v_p.step_up_threshold THEN 'STEP_UP_REQUIRED' ELSE 'ALLOW' END;

  INSERT INTO public.identity_risk_assessments
    (user_id, policy_id, policy_version, score, decision, reasons, signals, fingerprint_hash, country)
  VALUES (v_uid, v_p.id, v_p.version, v_score, v_decision, v_reasons, v_signals, _fingerprint_hash, _country)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'assessment_id', v_id, 'decision', v_decision, 'score', v_score,
    'threshold', v_p.step_up_threshold, 'reasons', v_reasons,
    'policy', jsonb_build_object('id', v_p.id, 'version', v_p.version, 'label', v_p.label,
                                 'business_approval', v_p.business_approval));
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_link_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified boolean := false;
  v_linked_id uuid;
  v_linked_status text;
  v_match_count int := 0;
  v_match_status text;
  v_match_org uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('reason', 'not_authenticated');
  END IF;

  SELECT lower(u.email), u.email_confirmed_at IS NOT NULL
    INTO v_email, v_verified
  FROM auth.users u WHERE u.id = v_uid;

  SELECT s.id, s.employment_status INTO v_linked_id, v_linked_status
  FROM public.staff_members s WHERE s.user_id = v_uid LIMIT 1;

  SELECT count(*) INTO v_match_count
  FROM public.staff_members s
  WHERE s.user_id IS NULL
    AND (lower(s.work_email) = v_email OR lower(s.personal_email) = v_email);

  IF v_match_count > 0 THEN
    SELECT s.employment_status, s.org_id INTO v_match_status, v_match_org
    FROM public.staff_members s
    WHERE s.user_id IS NULL
      AND (lower(s.work_email) = v_email OR lower(s.personal_email) = v_email)
    LIMIT 1;
  END IF;

  v_reason := CASE
    WHEN v_linked_id IS NOT NULL AND coalesce(v_linked_status, 'active') <> 'active' THEN 'record_inactive'
    WHEN v_linked_id IS NOT NULL THEN 'linked'
    WHEN NOT v_verified THEN 'email_unverified'
    WHEN v_match_count > 1 THEN 'ambiguous_email_match'
    WHEN v_match_count = 1 AND coalesce(v_match_status, 'active') <> 'active' THEN 'match_inactive'
    WHEN v_match_count = 1 THEN 'claimable'
    ELSE 'no_staff_record'
  END;

  RETURN jsonb_build_object(
    'reason', v_reason,
    'email', v_email,
    'email_verified', v_verified,
    'linked_staff_id', v_linked_id,
    'linked_status', v_linked_status,
    'unlinked_email_matches', v_match_count,
    'match_status', v_match_status,
    'match_org_id', v_match_org
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_claim_self()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified timestamptz;
  v_staff uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = v_uid LIMIT 1;
  IF v_staff IS NOT NULL THEN
    RETURN v_staff;
  END IF;

  SELECT lower(email), email_confirmed_at
    INTO v_email, v_verified
    FROM auth.users WHERE id = v_uid;

  IF v_email IS NULL OR v_verified IS NULL THEN
    RAISE EXCEPTION 'email_not_verified';
  END IF;

  SELECT id, employment_status INTO v_staff, v_status
    FROM public.staff_members
   WHERE user_id IS NULL
     AND employment_status IN ('active', 'onboarding')
     AND (lower(work_email) = v_email OR lower(personal_email) = v_email)
   ORDER BY created_at
   LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no_matching_staff_record';
  END IF;

  UPDATE public.staff_members
     SET user_id = v_uid, updated_at = now()
   WHERE id = v_staff AND user_id IS NULL;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, resource_type, resource_id, metadata)
  VALUES (v_uid, v_email, 'staff_profile_self_claim', 'staff_members', v_staff::text,
          jsonb_build_object('matched_email', v_email, 'employment_status', v_status));

  RETURN v_staff;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_self_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.staff_members
   WHERE user_id = auth.uid() AND employment_status = 'active'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.staff_available_actions(p_limit integer DEFAULT 8)
RETURNS TABLE (
  kind            text,
  title           text,
  reason          text,
  account_id      uuid,
  account_name    text,
  opportunity_id  uuid,
  reference_id    uuid,
  priority        text,
  value_score     numeric,
  suggested_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid := public.staff_self_id();
  v_lim   integer := least(greatest(coalesce(p_limit, 8), 1), 25);
BEGIN
  IF v_staff IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH overdue AS (
    SELECT 'overdue_follow_up'::text AS kind,
           na.title,
           'Committed action is past its due date'::text AS reason,
           na.account_id,
           a.name AS account_name,
           na.opportunity_id,
           na.work_item_id AS reference_id,
           na.priority,
           90::numeric + least(extract(epoch FROM (now() - na.due_at)) / 86400, 10) AS value_score,
           10 AS suggested_minutes
      FROM public.crm_next_actions na
      JOIN public.crm_accounts a ON a.id = na.account_id
     WHERE na.staff_id = v_staff
       AND na.status IN ('open', 'in_progress')
       AND na.due_at IS NOT NULL
       AND na.due_at < now()
  ),
  dormant AS (
    SELECT 'reengage_account'::text,
           ('Re-engage ' || a.name)::text,
           'No recorded interaction in the last 30 days'::text,
           a.id,
           a.name,
           NULL::uuid,
           a.id,
           CASE a.importance_tier WHEN 'strategic' THEN 'high' WHEN 'key' THEN 'high' ELSE 'medium' END,
           60::numeric + CASE a.importance_tier WHEN 'strategic' THEN 20 WHEN 'key' THEN 10 ELSE 0 END,
           15
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_interactions i
          WHERE i.account_id = a.id AND i.occurred_at > now() - interval '30 days'
       )
  ),
  stalled AS (
    SELECT 'opportunity_without_next_action'::text,
           ('Set the next action on ' || a.name)::text,
           'Active opportunity has no open next action'::text,
           a.id,
           a.name,
           ol.opportunity_id,
           ol.opportunity_id,
           'high'::text,
           75::numeric,
           10
      FROM public.crm_opportunity_links ol
      JOIN public.crm_accounts a ON a.id = ol.account_id
     WHERE ol.owner_staff_id = v_staff
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_next_actions na
          WHERE na.opportunity_id = ol.opportunity_id
            AND na.status IN ('open', 'in_progress')
       )
  ),
  quiet AS (
    SELECT 'prospect_new_account'::text,
           ('Open a conversation with ' || a.name)::text,
           'Account owned by you has no interaction on record'::text,
           a.id,
           a.name,
           NULL::uuid,
           a.id,
           'medium'::text,
           50::numeric,
           15
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
       AND a.lifecycle_stage IN ('prospect', 'lead', 'qualified')
       AND NOT EXISTS (SELECT 1 FROM public.crm_interactions i WHERE i.account_id = a.id)
  )
  SELECT * FROM (
    SELECT * FROM overdue
    UNION ALL SELECT * FROM stalled
    UNION ALL SELECT * FROM dormant
    UNION ALL SELECT * FROM quiet
  ) s
  ORDER BY s.value_score DESC, s.title
  LIMIT v_lim;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_operating_contexts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _roles text[];
  _contexts text[] := ARRAY[]::text[];
  _email text;
  _org_id uuid;
  _org_name text;
  _position text;
  _unit text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'contexts', '[]'::jsonb);
  END IF;

  SELECT array_agg(role::text) INTO _roles FROM public.user_roles WHERE user_id = _uid;
  _roles := COALESCE(_roles, ARRAY[]::text[]);

  SELECT email INTO _email FROM auth.users WHERE id = _uid;

  IF _roles && ARRAY['admin','super_admin','finance_admin','compliance_admin',
                     'operations_admin','operations_manager','pricing_manager','fleet_manager']::text[] THEN
    _contexts := array_append(_contexts, 'staff_operations');
  END IF;
  IF _roles && ARRAY['admin','super_admin']::text[] THEN
    _contexts := array_append(_contexts, 'super_admin');
  END IF;

  BEGIN
    SELECT s.entity_id, p.title, u.name
      INTO _org_id, _position, _unit
      FROM public.staff_members s
      LEFT JOIN public.org_positions p ON p.id = s.position_id
      LEFT JOIN public.org_units u ON u.id = s.unit_id
     WHERE s.user_id = _uid
     LIMIT 1;
  EXCEPTION WHEN others THEN
    _org_id := NULL;
  END;

  IF _org_id IS NOT NULL THEN
    BEGIN
      SELECT name INTO _org_name FROM public.org_entities WHERE id = _org_id;
    EXCEPTION WHEN others THEN _org_name := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', _uid,
    'identity', _email,
    'roles', to_jsonb(_roles),
    'contexts', to_jsonb(_contexts),
    'organisation_id', _org_id,
    'organisation', COALESCE(_org_name, 'Yalla Mobility'),
    'unit', _unit,
    'position', _position,
    'resolved_role', COALESCE(_position,
      CASE WHEN _roles && ARRAY['super_admin']::text[] THEN 'Super Administrator'
           WHEN _roles && ARRAY['admin']::text[] THEN 'Administrator'
           ELSE COALESCE(_roles[1], 'Staff') END)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.identity_discover(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_discover(text) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.identity_risk_evaluate(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_risk_evaluate(text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_stabilization_mode() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_stabilization_mode() TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_operating_contexts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_operating_contexts() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.security_claims_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_claims_public() TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.staff_available_actions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_available_actions(integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.staff_claim_self() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_claim_self() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.staff_link_diagnostics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_link_diagnostics() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.staff_self_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_self_id() TO authenticated, service_role;
