CREATE OR REPLACE FUNCTION public.corp_admin_signin_policy_decide(
  _policy_id uuid, _decision text, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_corp uuid;
  v_state text;
  v_version integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT (has_any_role(v_uid, ARRAY['admin','super_admin']::app_role[]) = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorised');
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;

  SELECT corporate_id, state, version INTO v_corp, v_state, v_version
    FROM identity_auth_policies WHERE id = _policy_id;
  IF v_corp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'policy_not_found');
  END IF;
  IF v_state <> 'DRAFT' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'policy_not_awaiting_approval');
  END IF;

  IF _decision = 'rejected' THEN
    UPDATE identity_auth_policies
       SET state = 'RETIRED', updated_at = now(),
           note = coalesce(note,'') || ' Declined by platform staff.'
                  || coalesce(' ' || nullif(trim(_note),''), '')
     WHERE id = _policy_id;
  ELSE
    UPDATE identity_auth_policies
       SET state = 'RETIRED', updated_at = now(),
           note = coalesce(note,'') || ' Superseded by version ' || v_version || '.'
     WHERE corporate_id = v_corp AND state = 'ACTIVE';

    UPDATE identity_auth_policies
       SET state = 'ACTIVE', approved_by = v_uid, approved_at = now(), updated_at = now(),
           note = coalesce(note,'') || coalesce(' ' || nullif(trim(_note),''), '')
     WHERE id = _policy_id;
  END IF;

  INSERT INTO corporate_admin_actions (admin_user_id, corporate_id, action, payload, result)
  VALUES (v_uid, v_corp, 'corp.signin_policy_decide',
          jsonb_build_object('policy_id', _policy_id, 'decision', _decision, 'version', v_version),
          'applied');

  RETURN jsonb_build_object('ok', true, 'policy_id', _policy_id, 'decision', _decision,
                            'state', CASE WHEN _decision = 'approved' THEN 'ACTIVE' ELSE 'RETIRED' END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corp_admin_signin_policy_decide(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.corp_admin_signin_policy_decide(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.corp_admin_org_settings_update(
  _corporate_id uuid,
  _credit_limit_cents bigint DEFAULT NULL,
  _payment_terms_days integer DEFAULT NULL,
  _status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF NOT (has_any_role(v_uid, ARRAY['admin','super_admin']::app_role[]) = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorised');
  END IF;
  IF _credit_limit_cents IS NOT NULL AND _credit_limit_cents < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credit_limit');
  END IF;
  IF _payment_terms_days IS NOT NULL AND (_payment_terms_days < 0 OR _payment_terms_days > 180) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_payment_terms');
  END IF;
  IF _status IS NOT NULL AND _status NOT IN ('active','suspended','closed','pending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  UPDATE corporate_accounts
     SET credit_limit_cents  = coalesce(_credit_limit_cents, credit_limit_cents),
         payment_terms_days  = coalesce(_payment_terms_days, payment_terms_days),
         status              = coalesce(_status, status),
         updated_at          = now()
   WHERE id = _corporate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'organisation_not_found');
  END IF;

  INSERT INTO corporate_admin_actions (admin_user_id, corporate_id, action, payload, result)
  VALUES (v_uid, _corporate_id, 'corp.admin_org_settings_update',
          jsonb_build_object('credit_limit_cents', _credit_limit_cents,
                             'payment_terms_days', _payment_terms_days,
                             'status', _status), 'applied');

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corp_admin_org_settings_update(uuid, bigint, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.corp_admin_org_settings_update(uuid, bigint, integer, text) TO authenticated;