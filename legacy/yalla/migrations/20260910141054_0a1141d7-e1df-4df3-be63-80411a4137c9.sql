-- Operator withdrawals are funded by the operator's own wallet balance.
-- The collections paybill (4148095) is where customers pay Yalla in; it is NOT
-- an account operators draw against. Money leaving to an operator's M-Pesa
-- number must use a dedicated payouts (B2C) short code.

ALTER TABLE public.provider_settlement_settings
  ADD COLUMN IF NOT EXISTS payout_shortcode text;

CREATE OR REPLACE FUNCTION public._provider_settlement_settings_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payout_shortcode IS NOT NULL
     AND btrim(NEW.payout_shortcode) = btrim(coalesce(NEW.platform_paybill, '')) THEN
    RAISE EXCEPTION 'PAYOUT_SHORTCODE_MUST_DIFFER_FROM_COLLECTIONS_PAYBILL';
  END IF;
  IF NEW.payout_shortcode IS NOT NULL AND btrim(NEW.payout_shortcode) = '' THEN
    NEW.payout_shortcode := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_settlement_settings_guard ON public.provider_settlement_settings;
CREATE TRIGGER provider_settlement_settings_guard
  BEFORE INSERT OR UPDATE ON public.provider_settlement_settings
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_settings_guard();

-- Withdrawal request: unchanged money rules (own wallet available balance only),
-- but the recorded evidence now names the funding source explicitly.
CREATE OR REPLACE FUNCTION public.provider_withdrawal_request(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
  v_acct public.provider_payout_accounts;
  v_w public.provider_wallets;
  v_amount bigint := coalesce((p->>'amount_cents')::bigint, 0);
  v_fee bigint;
  v_net bigint;
  v_id uuid;
  v_ref text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  SELECT * INTO v_acct FROM public.provider_payout_accounts
   WHERE provider_user_id = v_uid AND verification_state = 'VERIFIED'
   ORDER BY is_default DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_MPESA_ACCOUNT_REQUIRED'; END IF;

  PERFORM public.provider_settlement_run();

  SELECT * INTO v_w FROM public.provider_wallets WHERE provider_user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_w.available_cents <= 0 THEN RAISE EXCEPTION 'NO_WITHDRAWABLE_BALANCE'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_REQUIRED'; END IF;
  IF v_amount > v_w.available_cents THEN RAISE EXCEPTION 'AMOUNT_EXCEEDS_AVAILABLE_BALANCE'; END IF;

  v_fee := round(v_amount::numeric * v_set.withdrawal_fee_bps / 10000);
  v_net := v_amount - v_fee;
  IF v_net < greatest(v_set.min_payout_cents, 1000) THEN
    RAISE EXCEPTION 'BELOW_MINIMUM_PAYOUT';
  END IF;

  IF EXISTS (SELECT 1 FROM public.provider_payout_requests
              WHERE provider_user_id = v_uid
                AND state IN ('PENDING_APPROVAL','APPROVED','PROCESSING')) THEN
    RAISE EXCEPTION 'WITHDRAWAL_ALREADY_IN_PROGRESS';
  END IF;

  v_ref := 'WDR-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));

  INSERT INTO public.provider_payout_requests
    (request_reference, provider_user_id, account_id, msisdn, amount_cents, currency,
     earnings_count, state, gross_cents, fee_bps, fee_cents)
  VALUES (v_ref, v_uid, v_acct.id, v_acct.msisdn, v_net, v_w.currency, 0,
          CASE WHEN v_set.requires_finance_approval THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,
          v_amount, v_set.withdrawal_fee_bps, v_fee)
  RETURNING id INTO v_id;

  PERFORM public._provider_wallet_post(
    v_uid, 'WITHDRAWAL_RESERVED', v_amount, -v_amount, 0, v_amount,
    'withdrawal:' || v_id::text,
    jsonb_build_object('reference', v_ref, 'fee_cents', v_fee, 'net_cents', v_net,
                       'fee_bps', v_set.withdrawal_fee_bps,
                       'funding_source', 'provider_wallet'));

  INSERT INTO public.provider_payout_events
    (request_id, event_type, state_to, note, detail, actor_user_id)
  VALUES (v_id, 'WITHDRAWAL_REQUESTED',
          CASE WHEN v_set.requires_finance_approval THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,
          'Operator requested a withdrawal from their own wallet balance',
          jsonb_build_object('gross_cents', v_amount, 'fee_cents', v_fee, 'net_cents', v_net,
                             'fee_bps', v_set.withdrawal_fee_bps,
                             'funding_source', 'provider_wallet',
                             'payout_shortcode', v_set.payout_shortcode,
                             'fee_posted_to_paybill', v_set.platform_paybill), v_uid);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref,
    'gross_cents', v_amount, 'fee_cents', v_fee, 'net_cents', v_net,
    'fee_bps', v_set.withdrawal_fee_bps, 'msisdn', v_acct.msisdn,
    'funding_source', 'provider_wallet');
END $$;

REVOKE ALL ON FUNCTION public.provider_withdrawal_request(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_withdrawal_request(jsonb) TO authenticated, service_role;
