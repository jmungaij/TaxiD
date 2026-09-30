CREATE OR REPLACE FUNCTION public.corp_payment_decide(
  _corporate_id uuid,
  _amount_cents bigint,
  _requested_mode text DEFAULT 'CASH',
  _correlation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mode public.yalla_payment_mode;
  snap jsonb; pol record; decision public.payment_decision_type; reasons text[] := '{}';
  avail bigint := 0; gid uuid; fid uuid; acct record; acct_status text;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_corporate_member(auth.uid(), _corporate_id)
     AND NOT public.is_credit_observer(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  BEGIN mode := upper(_requested_mode)::public.yalla_payment_mode;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_payment_mode');
  END;

  SELECT * INTO acct FROM public.corporate_accounts WHERE id = _corporate_id;
  acct_status := upper(COALESCE(acct.status::text, ''));
  SELECT * INTO pol FROM public.corporate_payment_policies
    WHERE corporate_id = _corporate_id AND status = 'ACTIVE' LIMIT 1;

  IF mode = 'CASH' THEN
    decision := 'ALLOW_CASH_PAYMENT';
    reasons := ARRAY['CASH_IS_DEFAULT','PAYMENT_VERIFICATION_REQUIRED'];
  ELSE
    snap := public.corp_credit_snapshot(_corporate_id);
    avail := COALESCE((snap->>'available_credit_cents')::bigint, 0);
    gid := NULLIF(snap#>>'{guarantee,id}','')::uuid;
    fid := NULLIF(snap#>>'{facility,id}','')::uuid;

    IF acct.id IS NULL OR acct_status NOT IN ('ACTIVE','APPROVED') THEN
      decision := 'DENIED'; reasons := ARRAY['CORPORATE_ACCOUNT_NOT_ACTIVE'];
    ELSIF pol.id IS NULL OR pol.credit_rule IN ('CASH_ONLY','CREDIT_NOT_ALLOWED') THEN
      decision := 'CREDIT_UNAVAILABLE';
      reasons := ARRAY[CASE WHEN pol.id IS NULL THEN 'NO_ACTIVE_PAYMENT_POLICY' ELSE 'POLICY_FORBIDS_CREDIT' END];
    ELSIF gid IS NULL THEN
      decision := 'GUARANTEE_REQUIRED'; reasons := ARRAY['NO_ACTIVE_BANK_GUARANTEE'];
    ELSIF fid IS NULL THEN
      decision := 'CREDIT_UNAVAILABLE'; reasons := ARRAY['NO_ACTIVE_CREDIT_FACILITY'];
    ELSIF pol.max_transaction_cents IS NOT NULL AND _amount_cents > pol.max_transaction_cents THEN
      decision := 'POLICY_LIMIT_EXCEEDED'; reasons := ARRAY['POLICY_MAX_TRANSACTION_EXCEEDED'];
    ELSIF avail < _amount_cents THEN
      decision := 'CREDIT_LIMIT_EXCEEDED'; reasons := ARRAY['DENY_CREDIT_INSUFFICIENT_COVERAGE'];
    ELSIF pol.approval_threshold_cents IS NOT NULL AND _amount_cents > pol.approval_threshold_cents THEN
      decision := 'APPROVAL_REQUIRED'; reasons := ARRAY['ABOVE_APPROVAL_THRESHOLD'];
    ELSE
      decision := 'ALLOW_GUARANTEED_CREDIT';
      reasons := ARRAY['GUARANTEE_ACTIVE','FACILITY_ACTIVE','SUFFICIENT_AVAILABLE_CREDIT','POLICY_PERMITS_CREDIT'];
    END IF;
  END IF;

  INSERT INTO public.corporate_payment_decisions (
    corporate_id, requested_mode, decision, requested_amount_cents, available_credit_cents,
    guarantee_id, facility_id, policy_id, policy_version, reason_codes, detail, actor_id, correlation_id
  ) VALUES (
    _corporate_id, mode, decision, _amount_cents, CASE WHEN mode='CREDIT' THEN avail ELSE NULL END,
    gid, fid, pol.id, pol.version, reasons,
    jsonb_build_object('snapshot', snap, 'credit_rule', pol.credit_rule, 'account_status', acct_status),
    auth.uid(), _correlation_id
  );

  RETURN jsonb_build_object(
    'ok', true, 'decision', decision, 'requested_mode', mode,
    'requested_amount_cents', _amount_cents,
    'available_credit_cents', CASE WHEN mode='CREDIT' THEN avail ELSE NULL END,
    'reason_codes', reasons, 'correlation_id', _correlation_id,
    'policy_id', pol.id, 'policy_version', pol.version,
    'cash_fallback', CASE WHEN decision IN ('ALLOW_CASH_PAYMENT','ALLOW_GUARANTEED_CREDIT') THEN NULL
                          ELSE 'Corporate credit is unavailable. Pay using Yalla M-Pesa PayBill or bank transfer.' END
  );
END $$;
REVOKE ALL ON FUNCTION public.corp_payment_decide(uuid, bigint, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_payment_decide(uuid, bigint, text, uuid) TO authenticated, service_role;