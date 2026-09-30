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
  IF _status IS NOT NULL AND upper(_status) NOT IN ('ACTIVE','SUSPENDED','CLOSED','PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  UPDATE corporate_accounts
     SET credit_limit_cents  = coalesce(_credit_limit_cents, credit_limit_cents),
         payment_terms_days  = coalesce(_payment_terms_days, payment_terms_days),
         status              = coalesce(upper(_status)::corporate_status, status),
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