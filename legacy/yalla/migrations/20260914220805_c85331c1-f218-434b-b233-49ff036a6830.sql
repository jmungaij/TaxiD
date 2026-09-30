
-- 1. Provision a corporate account from an APPROVED registration draft (service_role only).
CREATE OR REPLACE FUNCTION public.corp_provision_from_draft(_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  v_corp uuid;
  v_name text;
  v_email text;
  v_domain text;
BEGIN
  SELECT * INTO d FROM corporate_registration_drafts WHERE id = _draft_id;
  IF d.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'draft_not_found');
  END IF;
  IF d.decision IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_approved');
  END IF;
  IF d.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_applicant_account');
  END IF;

  v_name := nullif(trim(coalesce(d.business_info->>'registered_name', d.business_info->>'trading_name', '')), '');
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_registered_name');
  END IF;
  v_email := nullif(trim(coalesce(d.personal_info->>'corporate_email', d.personal_info->>'personal_email', '')), '');

  -- Idempotent: reuse an existing organisation for this applicant, else by KRA PIN, else create.
  SELECT ce.corporate_id INTO v_corp
    FROM corporate_employees ce
   WHERE ce.user_id = d.user_id AND ce.status <> 'removed'
   LIMIT 1;

  IF v_corp IS NULL AND nullif(d.business_info->>'kra_pin','') IS NOT NULL THEN
    SELECT id INTO v_corp FROM corporate_accounts
     WHERE upper(kra_pin) = upper(d.business_info->>'kra_pin') LIMIT 1;
  END IF;

  IF v_corp IS NULL THEN
    INSERT INTO corporate_accounts (legal_name, trading_name, kra_pin, registration_number,
                                    billing_email, billing_phone, status, metadata)
    VALUES (v_name,
            nullif(d.business_info->>'trading_name',''),
            nullif(d.business_info->>'kra_pin',''),
            coalesce(nullif(d.business_info->>'registration_number',''),
                     nullif(d.business_info->>'certificate_of_incorporation_number','')),
            v_email,
            nullif(d.personal_info->>'corporate_phone',''),
            'ACTIVE',
            jsonb_build_object('provisioned_from_draft', d.id, 'provisioned_at', now()))
    RETURNING id INTO v_corp;
  END IF;

  INSERT INTO corporate_employees (corporate_id, user_id, email, full_name, phone, role, status, activated_at, metadata)
  VALUES (v_corp, d.user_id, v_email,
          nullif(trim(concat_ws(' ', d.personal_info->>'first_name', d.personal_info->>'last_name')), ''),
          nullif(d.personal_info->>'corporate_phone',''),
          'corporate_admin', 'active', now(),
          jsonb_build_object('provisioned_from_draft', d.id))
  ON CONFLICT DO NOTHING;

  UPDATE corporate_employees
     SET role = 'corporate_admin', status = 'active',
         activated_at = coalesce(activated_at, now()), updated_at = now()
   WHERE corporate_id = v_corp AND user_id = d.user_id;

  INSERT INTO user_roles (user_id, role) VALUES (d.user_id, 'corporate_admin')
  ON CONFLICT DO NOTHING;

  -- Seed a draft sign-in policy for the organisation's email domain (never active without approval).
  v_domain := lower(split_part(coalesce(v_email,''), '@', 2));
  IF v_domain <> '' AND NOT EXISTS (
        SELECT 1 FROM identity_auth_policies WHERE corporate_id = v_corp) THEN
    INSERT INTO identity_auth_policies (scope, corporate_id, label, version, email_domains,
      password_enabled, passwordless_enabled, google_enabled, sso_enabled,
      mfa_required, session_idle_minutes, session_absolute_hours, state, note)
    VALUES ('ORGANISATION', v_corp, v_name || ' sign-in policy', 1, ARRAY[v_domain],
      true, false, false, false, false, 30, 8, 'DRAFT',
      'Seeded on approval of registration ' || d.id::text || '. Awaiting business approval.');
  END IF;

  INSERT INTO corporate_admin_actions (admin_user_id, corporate_id, action, payload, result)
  VALUES (d.decided_by, v_corp, 'corp.provision_from_draft',
          jsonb_build_object('draft_id', d.id, 'user_id', d.user_id), 'applied');

  RETURN jsonb_build_object('ok', true, 'corporate_id', v_corp, 'user_id', d.user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.corp_provision_from_draft(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corp_provision_from_draft(uuid) TO service_role;

-- 2. Organisation administrators propose their own sign-in policy version (DRAFT only).
CREATE OR REPLACE FUNCTION public.corp_signin_policy_propose(
  _corporate_id uuid,
  _email_domains text[],
  _password boolean,
  _passwordless boolean,
  _google boolean,
  _mfa_required boolean,
  _idle_minutes integer,
  _absolute_hours integer,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_version integer;
  v_id uuid;
  v_domains text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT (is_corporate_manager_or_admin(v_uid, _corporate_id) = true
          OR has_any_role(v_uid, ARRAY['admin','super_admin']::app_role[]) = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorised');
  END IF;
  IF _password IS NOT TRUE AND _passwordless IS NOT TRUE AND _google IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'at_least_one_method_required');
  END IF;
  IF coalesce(_idle_minutes, 0) < 5 OR _idle_minutes > 480
     OR coalesce(_absolute_hours, 0) < 1 OR _absolute_hours > 24 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_limits_out_of_range');
  END IF;

  SELECT legal_name INTO v_name FROM corporate_accounts WHERE id = _corporate_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'organisation_not_found');
  END IF;

  SELECT array_agg(DISTINCT lower(trim(d))) INTO v_domains
    FROM unnest(coalesce(_email_domains, ARRAY[]::text[])) d
   WHERE trim(d) <> '';
  IF v_domains IS NULL OR array_length(v_domains, 1) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_domain_required');
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM identity_auth_policies WHERE corporate_id = _corporate_id;

  -- Retire any earlier proposal that is still awaiting approval.
  UPDATE identity_auth_policies
     SET state = 'RETIRED', updated_at = now(),
         note = coalesce(note, '') || ' Superseded by version ' || v_version || '.'
   WHERE corporate_id = _corporate_id AND state = 'DRAFT';

  INSERT INTO identity_auth_policies (scope, corporate_id, label, version, email_domains,
    password_enabled, passwordless_enabled, google_enabled, sso_enabled,
    mfa_required, session_idle_minutes, session_absolute_hours, state, note)
  VALUES ('ORGANISATION', _corporate_id, v_name || ' sign-in policy', v_version, v_domains,
    coalesce(_password, false), coalesce(_passwordless, false), coalesce(_google, false), false,
    coalesce(_mfa_required, false), _idle_minutes, _absolute_hours, 'DRAFT',
    coalesce(nullif(trim(_note), ''), 'Proposed by organisation administrator. Awaiting platform approval.'))
  RETURNING id INTO v_id;

  INSERT INTO corporate_admin_actions (admin_user_id, corporate_id, action, payload, result)
  VALUES (v_uid, _corporate_id, 'corp.signin_policy_propose',
          jsonb_build_object('policy_id', v_id, 'version', v_version, 'domains', v_domains), 'applied');

  RETURN jsonb_build_object('ok', true, 'policy_id', v_id, 'version', v_version, 'state', 'DRAFT');
END;
$$;
REVOKE ALL ON FUNCTION public.corp_signin_policy_propose(uuid, text[], boolean, boolean, boolean, boolean, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corp_signin_policy_propose(uuid, text[], boolean, boolean, boolean, boolean, integer, integer, text) TO authenticated;

-- 3. Organisation administrators maintain their own billing contact details.
CREATE OR REPLACE FUNCTION public.corp_org_settings_update(
  _corporate_id uuid,
  _billing_email text,
  _billing_phone text,
  _billing_address text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT (is_corporate_manager_or_admin(v_uid, _corporate_id) = true
          OR has_any_role(v_uid, ARRAY['admin','super_admin']::app_role[]) = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorised');
  END IF;
  IF _billing_email IS NOT NULL AND _billing_email <> '' AND position('@' in _billing_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_email');
  END IF;

  UPDATE corporate_accounts
     SET billing_email = coalesce(nullif(trim(_billing_email), ''), billing_email),
         billing_phone = coalesce(nullif(trim(_billing_phone), ''), billing_phone),
         billing_address = coalesce(nullif(trim(_billing_address), ''), billing_address),
         updated_at = now()
   WHERE id = _corporate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'organisation_not_found');
  END IF;

  INSERT INTO corporate_admin_actions (admin_user_id, corporate_id, action, payload, result)
  VALUES (v_uid, _corporate_id, 'corp.org_settings_update',
          jsonb_build_object('billing_email', _billing_email, 'billing_phone', _billing_phone), 'applied');

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.corp_org_settings_update(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corp_org_settings_update(uuid, text, text, text) TO authenticated;
