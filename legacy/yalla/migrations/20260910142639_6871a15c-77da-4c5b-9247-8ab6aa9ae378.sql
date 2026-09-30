-- =====================================================================
-- YALLA MOBILITY WALLET
--   client pays 100%   -> whole amount locked in the Yalla wallet (custody)
--   job fulfilled      -> operator 85% released to their wallet, Yalla 15% income
--   withdrawal PAID    -> 5% fee becomes Yalla income, cash leaves the float
--   withdrawal FAILED  -> full amount returns to the operator's balance, no fee
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.platform_wallet (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  currency text NOT NULL DEFAULT 'KES',
  float_cents bigint NOT NULL DEFAULT 0,
  custody_cents bigint NOT NULL DEFAULT 0 CHECK (custody_cents >= 0),
  liability_cents bigint NOT NULL DEFAULT 0 CHECK (liability_cents >= 0),
  income_cents bigint NOT NULL DEFAULT 0,
  lifetime_funded_cents bigint NOT NULL DEFAULT 0,
  lifetime_client_cents bigint NOT NULL DEFAULT 0,
  lifetime_released_cents bigint NOT NULL DEFAULT 0,
  lifetime_paid_out_cents bigint NOT NULL DEFAULT 0,
  funding_msisdn text NOT NULL DEFAULT '254710100090',
  paybill text NOT NULL DEFAULT '4148095',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_wallet (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.platform_wallet TO authenticated;
GRANT ALL ON public.platform_wallet TO service_role;
ALTER TABLE public.platform_wallet ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance reads the yalla wallet" ON public.platform_wallet;
CREATE POLICY "finance reads the yalla wallet"
  ON public.platform_wallet FOR SELECT TO authenticated
  USING (public.capacity_can_approve(auth.uid())
         OR public.has_staff_permission('staff.finance.settlement.manage'));

DROP POLICY IF EXISTS "service role manages the yalla wallet" ON public.platform_wallet;
CREATE POLICY "service role manages the yalla wallet"
  ON public.platform_wallet FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS platform_wallet_touch ON public.platform_wallet;
CREATE TRIGGER platform_wallet_touch BEFORE UPDATE ON public.platform_wallet
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_touch();

CREATE TABLE IF NOT EXISTS public.platform_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN
    ('FUNDING','CLIENT_PAYMENT','FULFILMENT_RELEASE','WITHDRAWAL_PAID','WITHDRAWAL_FEE_INCOME')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  float_delta bigint NOT NULL DEFAULT 0,
  custody_delta bigint NOT NULL DEFAULT 0,
  liability_delta bigint NOT NULL DEFAULT 0,
  income_delta bigint NOT NULL DEFAULT 0,
  float_after bigint NOT NULL,
  custody_after bigint NOT NULL,
  liability_after bigint NOT NULL,
  income_after bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  provider_user_id uuid,
  source_kind text NOT NULL,
  source_id uuid,
  reference text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_type, reference)
);

CREATE INDEX IF NOT EXISTS platform_wallet_ledger_recent_idx
  ON public.platform_wallet_ledger (created_at DESC);

GRANT SELECT ON public.platform_wallet_ledger TO authenticated;
GRANT ALL ON public.platform_wallet_ledger TO service_role;
ALTER TABLE public.platform_wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance reads the yalla wallet ledger" ON public.platform_wallet_ledger;
CREATE POLICY "finance reads the yalla wallet ledger"
  ON public.platform_wallet_ledger FOR SELECT TO authenticated
  USING (public.capacity_can_approve(auth.uid())
         OR public.has_staff_permission('staff.finance.settlement.manage'));

DROP POLICY IF EXISTS "service role manages the yalla wallet ledger" ON public.platform_wallet_ledger;
CREATE POLICY "service role manages the yalla wallet ledger"
  ON public.platform_wallet_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._platform_wallet_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'platform_wallet_ledger is append-only';
END $$;

DROP TRIGGER IF EXISTS platform_wallet_ledger_append_only ON public.platform_wallet_ledger;
CREATE TRIGGER platform_wallet_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.platform_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public._platform_wallet_ledger_append_only();

-- Idempotent posting into the Yalla wallet -----------------------------
CREATE OR REPLACE FUNCTION public._platform_wallet_post(
  _type text, _amount bigint,
  _float bigint, _custody bigint, _liability bigint, _income bigint,
  _reference text, _source_kind text, _source_id uuid DEFAULT NULL,
  _provider uuid DEFAULT NULL, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_w public.platform_wallet;
BEGIN
  INSERT INTO public.platform_wallet (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  PERFORM 1 FROM public.platform_wallet WHERE id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.platform_wallet_ledger
              WHERE entry_type = _type AND reference = _reference) THEN
    RETURN false;
  END IF;

  UPDATE public.platform_wallet
     SET float_cents = float_cents + _float,
         custody_cents = custody_cents + _custody,
         liability_cents = liability_cents + _liability,
         income_cents = income_cents + _income,
         lifetime_funded_cents = lifetime_funded_cents
           + CASE WHEN _type = 'FUNDING' THEN _amount ELSE 0 END,
         lifetime_client_cents = lifetime_client_cents
           + CASE WHEN _type = 'CLIENT_PAYMENT' THEN _amount ELSE 0 END,
         lifetime_released_cents = lifetime_released_cents
           + CASE WHEN _type = 'FULFILMENT_RELEASE' THEN _amount ELSE 0 END,
         lifetime_paid_out_cents = lifetime_paid_out_cents
           + CASE WHEN _type = 'WITHDRAWAL_PAID' THEN _amount ELSE 0 END
   WHERE id
  RETURNING * INTO v_w;

  INSERT INTO public.platform_wallet_ledger
    (entry_type, amount_cents, float_delta, custody_delta, liability_delta, income_delta,
     float_after, custody_after, liability_after, income_after, currency,
     provider_user_id, source_kind, source_id, reference, detail)
  VALUES (_type, _amount, _float, _custody, _liability, _income,
          v_w.float_cents, v_w.custody_cents, v_w.liability_cents, v_w.income_cents,
          v_w.currency, _provider, _source_kind, _source_id, _reference,
          coalesce(_detail, '{}'::jsonb));

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public._platform_wallet_post(text, bigint, bigint, bigint, bigint, bigint, text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._platform_wallet_post(text, bigint, bigint, bigint, bigint, bigint, text, text, uuid, uuid, jsonb)
  TO service_role;

-- Fund the Yalla wallet from a CONFIRMED M-Pesa collection -------------
CREATE OR REPLACE FUNCTION public.platform_wallet_fund_apply_mpesa(_checkout_request_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_txn public.mpesa_transactions;
  v_applied boolean;
  v_w public.platform_wallet;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.capacity_can_approve(v_uid)
          OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF _checkout_request_id IS NULL OR btrim(_checkout_request_id) = '' THEN
    RAISE EXCEPTION 'PAYMENT_REFERENCE_REQUIRED';
  END IF;

  SELECT * INTO v_txn FROM public.mpesa_transactions
   WHERE checkout_request_id = _checkout_request_id AND deleted_at IS NULL
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF v_txn.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;
  IF coalesce(v_txn.result_code, -1) <> 0 THEN RAISE EXCEPTION 'PAYMENT_NOT_CONFIRMED'; END IF;
  IF coalesce(v_txn.amount_cents, 0) <= 0 THEN RAISE EXCEPTION 'PAYMENT_CARRIES_NO_AMOUNT'; END IF;

  v_applied := public._platform_wallet_post(
    'FUNDING', v_txn.amount_cents, v_txn.amount_cents, 0, 0, 0,
    'mpesa:' || v_txn.id::text, 'mpesa_transaction', v_txn.id, NULL,
    jsonb_build_object('checkout_request_id', v_txn.checkout_request_id,
                       'receipt', v_txn.mpesa_receipt,
                       'phone_last4', right(coalesce(v_txn.phone, ''), 4)));

  SELECT * INTO v_w FROM public.platform_wallet WHERE id;

  RETURN jsonb_build_object('ok', true, 'applied', v_applied,
    'amount_cents', v_txn.amount_cents, 'receipt', v_txn.mpesa_receipt,
    'float_cents', v_w.float_cents, 'custody_cents', v_w.custody_cents,
    'liability_cents', v_w.liability_cents, 'income_cents', v_w.income_cents);
END $$;

REVOKE ALL ON FUNCTION public.platform_wallet_fund_apply_mpesa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_wallet_fund_apply_mpesa(text) TO authenticated, service_role;

-- Staff console for the Yalla wallet -----------------------------------
CREATE OR REPLACE FUNCTION public.platform_wallet_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_w public.platform_wallet;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.capacity_can_approve(v_uid)
          OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_w FROM public.platform_wallet WHERE id;

  RETURN jsonb_build_object(
    'wallet', to_jsonb(v_w),
    'ledger', coalesce((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at DESC)
        FROM (SELECT * FROM public.platform_wallet_ledger
               ORDER BY created_at DESC LIMIT 50) l), '[]'::jsonb),
    'pending_custody', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'earning_id', e.id, 'booking_reference', e.booking_reference,
        'provider_user_id', e.provider_user_id, 'gross_cents', e.gross_cents,
        'net_cents', e.net_cents, 'commission_cents', e.commission_cents,
        'held_at', e.held_at) ORDER BY e.held_at)
        FROM public.provider_earnings e WHERE e.state = 'HELD'), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.platform_wallet_console() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_wallet_console() TO authenticated, service_role;

-- Settlement engine now moves money through the Yalla wallet -----------
CREATE OR REPLACE FUNCTION public.provider_settlement_run()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_set public.provider_settlement_settings;
  r record;
  v_accrued integer := 0;
  v_held integer := 0;
  v_credited integer := 0;
BEGIN
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  WITH ins AS (
    INSERT INTO public.provider_earnings
      (provider_user_id, booking_id, booking_reference, gross_cents, commission_bps,
       commission_cents, net_cents, currency, state)
    SELECT b.provider_user_id, b.id, b.booking_reference, b.amount_cents, v_set.commission_bps,
           round(b.amount_cents::numeric * v_set.commission_bps / 10000),
           b.amount_cents - round(b.amount_cents::numeric * v_set.commission_bps / 10000),
           coalesce(b.currency,'KES'), 'ACCRUED'
      FROM public.provider_bookings b
     WHERE b.status IN ('CONFIRMED','DELIVERED')
       AND b.is_test = false
       AND b.amount_cents > 0
    ON CONFLICT (booking_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_accrued FROM ins;

  UPDATE public.provider_earnings SET state = 'ACCRUED' WHERE state = 'PAYABLE';

  -- (b) Client paid in full -> the WHOLE amount is locked in the Yalla wallet,
  --     and the operator's 85% shows as held (not withdrawable).
  FOR r IN
    SELECT e.id, e.provider_user_id, e.gross_cents, e.net_cents, e.booking_reference
      FROM public.provider_earnings e
     WHERE e.state = 'ACCRUED'
       AND EXISTS (
         SELECT 1 FROM public.provider_bookings b
           JOIN public.tax_invoices i ON i.id = b.invoice_id
          WHERE b.id = e.booking_id
            AND i.status = 'paid'
            AND i.paid_cents >= i.total_cents)
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'HOLD', r.net_cents, 0, r.net_cents, 0, 'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'client paid in full; held in the Yalla Mobility wallet until fulfilment'));

    PERFORM public._platform_wallet_post(
      'CLIENT_PAYMENT', r.gross_cents, r.gross_cents, r.gross_cents, 0, 0,
      'earning:' || r.id::text, 'provider_earning', r.id, r.provider_user_id,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'operator_share_cents', r.net_cents,
                         'reason', 'client funds in custody; only fulfilment releases them'));

    UPDATE public.provider_earnings
       SET state = 'HELD',
           customer_paid_at = coalesce(customer_paid_at, now()),
           held_at = coalesce(held_at, now())
     WHERE id = r.id;
    v_held := v_held + 1;
  END LOOP;

  -- (c) Fulfilled -> release 85% into the operator wallet, recognise Yalla's 15%.
  FOR r IN
    SELECT e.id, e.provider_user_id, e.gross_cents, e.net_cents, e.commission_cents,
           e.commission_bps, e.currency, e.booking_reference, e.booking_id
      FROM public.provider_earnings e
      JOIN public.provider_bookings b ON b.id = e.booking_id
     WHERE e.state = 'HELD' AND b.status = 'DELIVERED'
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'RELEASE', r.net_cents, r.net_cents, -r.net_cents, 0,
      'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'trip fulfilled; funds available for withdrawal'));

    PERFORM public._platform_wallet_post(
      'FULFILMENT_RELEASE', r.gross_cents, 0, -r.gross_cents, r.net_cents, r.commission_cents,
      'earning:' || r.id::text, 'provider_earning', r.id, r.provider_user_id,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'operator_share_cents', r.net_cents,
                         'commission_cents', r.commission_cents,
                         'commission_bps', r.commission_bps,
                         'paybill', v_set.platform_paybill));

    INSERT INTO public.provider_platform_postings
      (posting_type, provider_user_id, amount_cents, currency, paybill, rate_bps,
       source_kind, source_id, reference, detail)
    VALUES ('COMMISSION', r.provider_user_id, r.commission_cents, r.currency,
            v_set.platform_paybill, r.commission_bps, 'provider_earning', r.id,
            'commission:' || r.id::text,
            jsonb_build_object('booking_reference', r.booking_reference,
                              'booking_id', r.booking_id))
    ON CONFLICT (reference) DO NOTHING;

    UPDATE public.provider_earnings
       SET state = 'CREDITED',
           fulfilled_at = coalesce(fulfilled_at, now()),
           credited_at = coalesce(credited_at, now())
     WHERE id = r.id;
    v_credited := v_credited + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'accrued', v_accrued,
    'held', v_held, 'credited', v_credited, 'made_payable', v_credited);
END $$;

REVOKE ALL ON FUNCTION public.provider_settlement_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_settlement_run() TO service_role;

-- Withdrawal finalisation: fee only on success, full return on failure --
CREATE OR REPLACE FUNCTION public._provider_withdrawal_finalise()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_set public.provider_settlement_settings;
BEGIN
  IF NEW.gross_cents IS NULL OR NEW.state = OLD.state THEN RETURN NEW; END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  IF NEW.state = 'PAID' THEN
    PERFORM public._provider_wallet_post(
      NEW.provider_user_id, 'WITHDRAWAL_PAID', NEW.amount_cents, 0, 0, -NEW.gross_cents,
      'withdrawal:' || NEW.id::text,
      jsonb_build_object('reference', NEW.request_reference, 'msisdn', NEW.msisdn,
                         'provider_transaction_id', NEW.provider_transaction_id));

    PERFORM public._platform_wallet_post(
      'WITHDRAWAL_PAID', NEW.amount_cents, -NEW.amount_cents, 0, -NEW.gross_cents, 0,
      'withdrawal:' || NEW.id::text, 'provider_withdrawal', NEW.id, NEW.provider_user_id,
      jsonb_build_object('reference', NEW.request_reference,
                         'gross_cents', NEW.gross_cents,
                         'net_cents', NEW.amount_cents));

    IF coalesce(NEW.fee_cents, 0) > 0 THEN
      PERFORM public._provider_wallet_post(
        NEW.provider_user_id, 'WITHDRAWAL_FEE', NEW.fee_cents, 0, 0, 0,
        'withdrawal:' || NEW.id::text,
        jsonb_build_object('reference', NEW.request_reference,
                           'fee_bps', NEW.fee_bps, 'paybill', v_set.platform_paybill));

      PERFORM public._platform_wallet_post(
        'WITHDRAWAL_FEE_INCOME', NEW.fee_cents, 0, 0, 0, NEW.fee_cents,
        'withdrawal:' || NEW.id::text, 'provider_withdrawal', NEW.id, NEW.provider_user_id,
        jsonb_build_object('reference', NEW.request_reference,
                           'fee_bps', coalesce(NEW.fee_bps, v_set.withdrawal_fee_bps),
                           'paybill', v_set.platform_paybill,
                           'reason', 'withdrawal succeeded; 5% fee earned'));

      INSERT INTO public.provider_platform_postings
        (posting_type, provider_user_id, amount_cents, currency, paybill, rate_bps,
         source_kind, source_id, reference, detail)
      VALUES ('WITHDRAWAL_FEE', NEW.provider_user_id, NEW.fee_cents, NEW.currency,
              v_set.platform_paybill, coalesce(NEW.fee_bps, v_set.withdrawal_fee_bps),
              'provider_withdrawal', NEW.id, 'fee:' || NEW.id::text,
              jsonb_build_object('reference', NEW.request_reference,
                                 'gross_cents', NEW.gross_cents,
                                 'net_cents', NEW.amount_cents))
      ON CONFLICT (reference) DO NOTHING;
    END IF;

  ELSIF NEW.state IN ('FAILED','CANCELLED') THEN
    -- No fee is ever charged: the full reserved amount returns to the operator.
    PERFORM public._provider_wallet_post(
      NEW.provider_user_id, 'WITHDRAWAL_RETURNED', NEW.gross_cents, NEW.gross_cents, 0, -NEW.gross_cents,
      'withdrawal:' || NEW.id::text,
      jsonb_build_object('reference', NEW.request_reference,
                         'fee_charged_cents', 0,
                         'reason', coalesce(NEW.failure_reason, NEW.decision_note,
                                            'withdrawal not completed')));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_withdrawal_finalise ON public.provider_payout_requests;
CREATE TRIGGER provider_withdrawal_finalise
  AFTER UPDATE OF state ON public.provider_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public._provider_withdrawal_finalise();

-- A paid service can no longer be cancelled ---------------------------
CREATE OR REPLACE FUNCTION public.provider_booking_set_status(_booking_id uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.provider_bookings;
  v_to text := upper(coalesce(_status,''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO b FROM public.provider_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_BOOKING'; END IF;
  IF b.provider_user_id <> v_uid AND NOT public.capacity_can_approve(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_FOR_BOOKING';
  END IF;
  IF v_to NOT IN ('CONFIRMED','DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'UNKNOWN_BOOKING_STATUS'; END IF;
  IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'BOOKING_ALREADY_CANCELLED'; END IF;
  IF v_to = 'CONFIRMED' AND b.status <> 'REQUESTED' THEN RAISE EXCEPTION 'ONLY_A_REQUESTED_BOOKING_CAN_BE_CONFIRMED'; END IF;
  IF v_to = 'DELIVERED' AND b.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'ONLY_A_CONFIRMED_BOOKING_CAN_BE_DELIVERED'; END IF;
  IF v_to = 'CANCELLED' AND coalesce(btrim(_note),'') = '' THEN RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED'; END IF;

  IF v_to = 'CANCELLED' THEN
    IF EXISTS (SELECT 1 FROM public.tax_invoices i
                WHERE i.id = b.invoice_id
                  AND (i.status = 'paid' OR coalesce(i.paid_cents, 0) > 0)) THEN
      RAISE EXCEPTION 'PAID_SERVICE_CANNOT_BE_CANCELLED';
    END IF;
    IF EXISTS (SELECT 1 FROM public.provider_earnings e
                WHERE e.booking_id = b.id
                  AND e.state IN ('HELD','CREDITED','RESERVED','PAID')) THEN
      RAISE EXCEPTION 'PAID_SERVICE_CANNOT_BE_CANCELLED';
    END IF;
  END IF;

  UPDATE public.provider_bookings SET status = v_to WHERE id = _booking_id;
  INSERT INTO public.provider_booking_events (booking_id, action, status_from, status_to, note, actor_user_id)
  VALUES (_booking_id, v_to, b.status, v_to, NULLIF(btrim(coalesce(_note,'')),''), v_uid);

  RETURN jsonb_build_object('ok', true, 'status', v_to);
END $$;

REVOKE ALL ON FUNCTION public.provider_booking_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_booking_set_status(uuid, text, text) TO authenticated, service_role;