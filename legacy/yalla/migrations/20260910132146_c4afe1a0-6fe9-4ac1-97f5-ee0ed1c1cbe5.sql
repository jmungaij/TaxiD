-- =====================================================================
-- OPERATOR PAYMENT POLICY
--   client pays 100%          -> 85% HELD in operator wallet (not withdrawable)
--   trip fulfilled            -> 85% released to available; 15% posted to paybill
--   operator withdraws        -> 5% fee to paybill, remainder to their M-Pesa
-- =====================================================================

-- 1. Policy constants -------------------------------------------------
ALTER TABLE public.provider_settlement_settings
  ADD COLUMN IF NOT EXISTS withdrawal_fee_bps integer NOT NULL DEFAULT 500;
ALTER TABLE public.provider_settlement_settings
  DROP CONSTRAINT IF EXISTS provider_settlement_settings_withdrawal_fee_bps_check;
ALTER TABLE public.provider_settlement_settings
  ADD CONSTRAINT provider_settlement_settings_withdrawal_fee_bps_check
  CHECK (withdrawal_fee_bps BETWEEN 0 AND 10000);
UPDATE public.provider_settlement_settings
   SET withdrawal_fee_bps = 500, commission_bps = 1500, platform_paybill = '4148095'
 WHERE id;

-- 2. Earning lifecycle: ACCRUED -> HELD -> CREDITED -------------------
ALTER TABLE public.provider_earnings
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS credited_at timestamptz;

ALTER TABLE public.provider_earnings DROP CONSTRAINT IF EXISTS provider_earnings_state_check;
ALTER TABLE public.provider_earnings
  ADD CONSTRAINT provider_earnings_state_check
  CHECK (state IN ('ACCRUED','HELD','CREDITED','PAYABLE','RESERVED','PAID','CANCELLED'));

-- 3. Operator wallet ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_wallets (
  provider_user_id uuid PRIMARY KEY,
  currency text NOT NULL DEFAULT 'KES',
  available_cents bigint NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  held_cents bigint NOT NULL DEFAULT 0 CHECK (held_cents >= 0),
  reserved_cents bigint NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  lifetime_earned_cents bigint NOT NULL DEFAULT 0,
  lifetime_withdrawn_cents bigint NOT NULL DEFAULT 0,
  lifetime_fees_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_wallets TO authenticated;
GRANT ALL ON public.provider_wallets TO service_role;
ALTER TABLE public.provider_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator reads own wallet" ON public.provider_wallets;
CREATE POLICY "operator reads own wallet"
  ON public.provider_wallets FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid()
         OR public.capacity_can_approve(auth.uid())
         OR public.has_staff_permission('staff.finance.settlement.manage'));

DROP POLICY IF EXISTS "service role manages provider wallets" ON public.provider_wallets;
CREATE POLICY "service role manages provider wallets"
  ON public.provider_wallets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS provider_wallets_touch ON public.provider_wallets;
CREATE TRIGGER provider_wallets_touch BEFORE UPDATE ON public.provider_wallets
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_touch();

CREATE TABLE IF NOT EXISTS public.provider_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN
    ('HOLD','RELEASE','WITHDRAWAL_RESERVED','WITHDRAWAL_FEE','WITHDRAWAL_PAID','WITHDRAWAL_RETURNED')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  available_delta bigint NOT NULL DEFAULT 0,
  held_delta bigint NOT NULL DEFAULT 0,
  reserved_delta bigint NOT NULL DEFAULT 0,
  available_after bigint NOT NULL,
  held_after bigint NOT NULL,
  reserved_after bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  reference text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_user_id, entry_type, reference)
);

CREATE INDEX IF NOT EXISTS provider_wallet_ledger_owner_idx
  ON public.provider_wallet_ledger (provider_user_id, created_at DESC);

GRANT SELECT ON public.provider_wallet_ledger TO authenticated;
GRANT ALL ON public.provider_wallet_ledger TO service_role;
ALTER TABLE public.provider_wallet_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator reads own wallet ledger" ON public.provider_wallet_ledger;
CREATE POLICY "operator reads own wallet ledger"
  ON public.provider_wallet_ledger FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid()
         OR public.capacity_can_approve(auth.uid())
         OR public.has_staff_permission('staff.finance.settlement.manage'));

DROP POLICY IF EXISTS "service role manages provider wallet ledger" ON public.provider_wallet_ledger;
CREATE POLICY "service role manages provider wallet ledger"
  ON public.provider_wallet_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._provider_wallet_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'provider_wallet_ledger is append-only';
END $$;

DROP TRIGGER IF EXISTS provider_wallet_ledger_append_only ON public.provider_wallet_ledger;
CREATE TRIGGER provider_wallet_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.provider_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public._provider_wallet_ledger_append_only();

-- 4. Money posted to the Yalla paybill (commission + withdrawal fees) --
CREATE TABLE IF NOT EXISTS public.provider_platform_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  posting_type text NOT NULL CHECK (posting_type IN ('COMMISSION','WITHDRAWAL_FEE')),
  provider_user_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'KES',
  paybill text NOT NULL,
  rate_bps integer NOT NULL,
  source_kind text NOT NULL,
  source_id uuid,
  reference text NOT NULL UNIQUE,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_platform_postings_type_idx
  ON public.provider_platform_postings (posting_type, created_at DESC);

GRANT SELECT ON public.provider_platform_postings TO authenticated;
GRANT ALL ON public.provider_platform_postings TO service_role;
ALTER TABLE public.provider_platform_postings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform postings visible to owner and finance" ON public.provider_platform_postings;
CREATE POLICY "platform postings visible to owner and finance"
  ON public.provider_platform_postings FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid()
         OR public.capacity_can_approve(auth.uid())
         OR public.has_staff_permission('staff.finance.settlement.manage'));

DROP POLICY IF EXISTS "service role manages platform postings" ON public.provider_platform_postings;
CREATE POLICY "service role manages platform postings"
  ON public.provider_platform_postings FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._provider_platform_postings_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'provider_platform_postings is append-only';
END $$;

DROP TRIGGER IF EXISTS provider_platform_postings_append_only ON public.provider_platform_postings;
CREATE TRIGGER provider_platform_postings_append_only
  BEFORE UPDATE OR DELETE ON public.provider_platform_postings
  FOR EACH ROW EXECUTE FUNCTION public._provider_platform_postings_append_only();

-- 5. Withdrawal shape on the existing payout request ------------------
ALTER TABLE public.provider_payout_requests
  ADD COLUMN IF NOT EXISTS gross_cents bigint,
  ADD COLUMN IF NOT EXISTS fee_bps integer,
  ADD COLUMN IF NOT EXISTS fee_cents bigint;

-- 6. Idempotent wallet posting ----------------------------------------
CREATE OR REPLACE FUNCTION public._provider_wallet_post(
  _uid uuid, _type text, _amount bigint,
  _avail bigint, _held bigint, _reserved bigint,
  _reference text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_w public.provider_wallets;
BEGIN
  INSERT INTO public.provider_wallets (provider_user_id) VALUES (_uid)
  ON CONFLICT (provider_user_id) DO NOTHING;

  PERFORM 1 FROM public.provider_wallets WHERE provider_user_id = _uid FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.provider_wallet_ledger
              WHERE provider_user_id = _uid AND entry_type = _type AND reference = _reference) THEN
    RETURN false;
  END IF;

  UPDATE public.provider_wallets
     SET available_cents = available_cents + _avail,
         held_cents = held_cents + _held,
         reserved_cents = reserved_cents + _reserved,
         lifetime_earned_cents = lifetime_earned_cents
           + CASE WHEN _type = 'RELEASE' THEN _amount ELSE 0 END,
         lifetime_withdrawn_cents = lifetime_withdrawn_cents
           + CASE WHEN _type = 'WITHDRAWAL_PAID' THEN _amount ELSE 0 END,
         lifetime_fees_cents = lifetime_fees_cents
           + CASE WHEN _type = 'WITHDRAWAL_FEE' THEN _amount ELSE 0 END
   WHERE provider_user_id = _uid
  RETURNING * INTO v_w;

  INSERT INTO public.provider_wallet_ledger
    (provider_user_id, entry_type, amount_cents, available_delta, held_delta, reserved_delta,
     available_after, held_after, reserved_after, currency, reference, detail)
  VALUES (_uid, _type, _amount, _avail, _held, _reserved,
          v_w.available_cents, v_w.held_cents, v_w.reserved_cents, v_w.currency, _reference,
          coalesce(_detail, '{}'::jsonb));

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public._provider_wallet_post(uuid, text, bigint, bigint, bigint, bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._provider_wallet_post(uuid, text, bigint, bigint, bigint, bigint, text, jsonb)
  TO service_role;

-- 7. Settlement engine: hold on payment, release on fulfilment --------
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

  -- (a) One earning row per real, priced booking that is at least confirmed.
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

  -- Legacy rows made "payable" under the previous rule re-enter the flow.
  UPDATE public.provider_earnings SET state = 'ACCRUED' WHERE state = 'PAYABLE';

  -- (b) Client has paid 100% -> the operator's 85% is HELD in their wallet.
  FOR r IN
    SELECT e.id, e.provider_user_id, e.net_cents, e.booking_reference
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
                         'reason', 'client paid in full; awaiting fulfilment'));
    UPDATE public.provider_earnings
       SET state = 'HELD',
           customer_paid_at = coalesce(customer_paid_at, now()),
           held_at = coalesce(held_at, now())
     WHERE id = r.id;
    v_held := v_held + 1;
  END LOOP;

  -- (c) Trip fulfilled -> release the 85%, post the 15% to the Yalla paybill.
  FOR r IN
    SELECT e.id, e.provider_user_id, e.net_cents, e.commission_cents, e.commission_bps,
           e.currency, e.booking_reference, e.booking_id
      FROM public.provider_earnings e
      JOIN public.provider_bookings b ON b.id = e.booking_id
     WHERE e.state = 'HELD' AND b.status = 'DELIVERED'
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'RELEASE', r.net_cents, r.net_cents, -r.net_cents, 0,
      'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'trip fulfilled; funds available for withdrawal'));

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

CREATE OR REPLACE FUNCTION public.provider_earnings_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_user <> 'service_role'
     AND NOT (public.capacity_can_approve(auth.uid())
              OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  RETURN public.provider_settlement_run();
END $$;

REVOKE ALL ON FUNCTION public.provider_earnings_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_earnings_sync() TO authenticated, service_role;

-- Run the engine whenever a booking or its invoice moves.
CREATE OR REPLACE FUNCTION public._provider_settlement_tick()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.provider_settlement_run();
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS provider_bookings_settlement_tick ON public.provider_bookings;
CREATE TRIGGER provider_bookings_settlement_tick
  AFTER INSERT OR UPDATE OF status, invoice_id ON public.provider_bookings
  FOR EACH ROW WHEN (NEW.is_test = false) EXECUTE FUNCTION public._provider_settlement_tick();

DROP TRIGGER IF EXISTS tax_invoices_provider_settlement_tick ON public.tax_invoices;
CREATE TRIGGER tax_invoices_provider_settlement_tick
  AFTER UPDATE OF status, paid_cents ON public.tax_invoices
  FOR EACH ROW WHEN (NEW.status = 'paid' AND NEW.paid_cents >= NEW.total_cents)
  EXECUTE FUNCTION public._provider_settlement_tick();

-- 8. Operator-initiated withdrawal with the 5% fee --------------------
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
                       'fee_bps', v_set.withdrawal_fee_bps));

  INSERT INTO public.provider_payout_events
    (request_id, event_type, state_to, note, detail, actor_user_id)
  VALUES (v_id, 'WITHDRAWAL_REQUESTED',
          CASE WHEN v_set.requires_finance_approval THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,
          'Operator requested a withdrawal from their wallet',
          jsonb_build_object('gross_cents', v_amount, 'fee_cents', v_fee, 'net_cents', v_net,
                             'fee_bps', v_set.withdrawal_fee_bps,
                             'paybill', v_set.platform_paybill), v_uid);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref,
    'gross_cents', v_amount, 'fee_cents', v_fee, 'net_cents', v_net,
    'fee_bps', v_set.withdrawal_fee_bps, 'msisdn', v_acct.msisdn);
END $$;

REVOKE ALL ON FUNCTION public.provider_withdrawal_request(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_withdrawal_request(jsonb) TO authenticated, service_role;

-- 9. Wallet finalisation when the M-Pesa payout settles or fails ------
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

    IF coalesce(NEW.fee_cents, 0) > 0 THEN
      PERFORM public._provider_wallet_post(
        NEW.provider_user_id, 'WITHDRAWAL_FEE', NEW.fee_cents, 0, 0, 0,
        'withdrawal:' || NEW.id::text,
        jsonb_build_object('reference', NEW.request_reference,
                           'fee_bps', NEW.fee_bps, 'paybill', v_set.platform_paybill));

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
    PERFORM public._provider_wallet_post(
      NEW.provider_user_id, 'WITHDRAWAL_RETURNED', NEW.gross_cents, NEW.gross_cents, 0, -NEW.gross_cents,
      'withdrawal:' || NEW.id::text,
      jsonb_build_object('reference', NEW.request_reference,
                         'reason', coalesce(NEW.failure_reason, NEW.decision_note,
                                            'withdrawal not completed')));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_withdrawal_finalise ON public.provider_payout_requests;
CREATE TRIGGER provider_withdrawal_finalise
  AFTER UPDATE OF state ON public.provider_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public._provider_withdrawal_finalise();

-- 10. Under the wallet policy, payouts are operator-initiated ---------
CREATE OR REPLACE FUNCTION public.provider_payout_prepare()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run jsonb;
BEGIN
  IF current_user <> 'service_role'
     AND NOT (public.capacity_can_approve(auth.uid())
              OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  v_run := public.provider_settlement_run();

  RETURN jsonb_build_object('ok', true, 'created', 0, 'requests', '[]'::jsonb,
    'held', v_run->'held', 'credited', v_run->'credited',
    'note', 'Wallet balances updated. Operators request their own withdrawals.');
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_prepare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_prepare() TO authenticated, service_role;

-- 11. Read models ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_settlement_self()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
  v_w public.provider_wallets;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;
  SELECT * INTO v_w FROM public.provider_wallets WHERE provider_user_id = v_uid;

  RETURN jsonb_build_object(
    'commission_bps', v_set.commission_bps,
    'withdrawal_fee_bps', v_set.withdrawal_fee_bps,
    'platform_paybill', v_set.platform_paybill,
    'min_payout_cents', v_set.min_payout_cents,
    'requires_finance_approval', v_set.requires_finance_approval,
    'account', (SELECT jsonb_build_object('id', a.id, 'msisdn', a.msisdn,
                  'account_name', a.account_name, 'verification_state', a.verification_state,
                  'verification_note', a.verification_note, 'verified_at', a.verified_at)
                  FROM public.provider_payout_accounts a
                 WHERE a.provider_user_id = v_uid AND a.is_default LIMIT 1),
    'wallet', jsonb_build_object(
      'currency', coalesce(v_w.currency, v_set.currency),
      'available_cents', coalesce(v_w.available_cents, 0),
      'held_cents', coalesce(v_w.held_cents, 0),
      'reserved_cents', coalesce(v_w.reserved_cents, 0),
      'lifetime_earned_cents', coalesce(v_w.lifetime_earned_cents, 0),
      'lifetime_withdrawn_cents', coalesce(v_w.lifetime_withdrawn_cents, 0),
      'lifetime_fees_cents', coalesce(v_w.lifetime_fees_cents, 0)),
    'totals', jsonb_build_object(
      'accrued_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings
                         WHERE provider_user_id = v_uid AND state='ACCRUED'),
      'held_cents', coalesce(v_w.held_cents, 0),
      'payable_cents', coalesce(v_w.available_cents, 0),
      'reserved_cents', coalesce(v_w.reserved_cents, 0),
      'paid_cents', coalesce(v_w.lifetime_withdrawn_cents, 0),
      'commission_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_platform_postings
                            WHERE provider_user_id = v_uid AND posting_type='COMMISSION')),
    'earnings', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'booking_reference', e.booking_reference, 'gross_cents', e.gross_cents,
        'commission_cents', e.commission_cents, 'net_cents', e.net_cents, 'currency', e.currency,
        'state', e.state, 'customer_paid_at', e.customer_paid_at, 'credited_at', e.credited_at,
        'paid_at', e.paid_at, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
        FROM public.provider_earnings e WHERE e.provider_user_id = v_uid),
    'wallet_ledger', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'entry_type', l.entry_type, 'amount_cents', l.amount_cents,
        'available_after', l.available_after, 'held_after', l.held_after,
        'currency', l.currency, 'detail', l.detail, 'created_at', l.created_at)
        ORDER BY l.created_at DESC), '[]'::jsonb)
        FROM public.provider_wallet_ledger l WHERE l.provider_user_id = v_uid),
    'payouts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'reference', q.request_reference, 'amount_cents', q.amount_cents,
        'gross_cents', q.gross_cents, 'fee_cents', q.fee_cents, 'fee_bps', q.fee_bps,
        'currency', q.currency, 'state', q.state, 'msisdn', q.msisdn,
        'earnings_count', q.earnings_count, 'provider_transaction_id', q.provider_transaction_id,
        'paid_at', q.paid_at, 'failure_reason', q.failure_reason, 'created_at', q.created_at)
        ORDER BY q.created_at DESC), '[]'::jsonb)
        FROM public.provider_payout_requests q WHERE q.provider_user_id = v_uid));
END $$;

REVOKE ALL ON FUNCTION public.provider_settlement_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_settlement_self() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_settlement_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.capacity_can_approve(v_uid)
          OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  RETURN jsonb_build_object(
    'settings', jsonb_build_object('commission_bps', v_set.commission_bps,
      'withdrawal_fee_bps', v_set.withdrawal_fee_bps,
      'platform_paybill', v_set.platform_paybill, 'min_payout_cents', v_set.min_payout_cents,
      'requires_finance_approval', v_set.requires_finance_approval,
      'auto_prepare', v_set.auto_prepare),
    'summary', jsonb_build_object(
      'commission_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_platform_postings
                            WHERE posting_type='COMMISSION'),
      'withdrawal_fee_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_platform_postings
                                WHERE posting_type='WITHDRAWAL_FEE'),
      'accrued_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings WHERE state='ACCRUED'),
      'held_cents', (SELECT coalesce(sum(held_cents),0) FROM public.provider_wallets),
      'payable_cents', (SELECT coalesce(sum(available_cents),0) FROM public.provider_wallets),
      'reserved_cents', (SELECT coalesce(sum(reserved_cents),0) FROM public.provider_wallets),
      'paid_cents', (SELECT coalesce(sum(lifetime_withdrawn_cents),0) FROM public.provider_wallets),
      'awaiting_approval', (SELECT count(*) FROM public.provider_payout_requests WHERE state='PENDING_APPROVAL'),
      'accounts_in_review', (SELECT count(*) FROM public.provider_payout_accounts WHERE verification_state='IN_REVIEW')),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'provider_user_id', a.provider_user_id, 'msisdn', a.msisdn,
        'account_name', a.account_name, 'verification_state', a.verification_state,
        'verification_note', a.verification_note, 'verified_at', a.verified_at,
        'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
        FROM public.provider_payout_accounts a),
    'wallets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'provider_user_id', w.provider_user_id, 'currency', w.currency,
        'available_cents', w.available_cents, 'held_cents', w.held_cents,
        'reserved_cents', w.reserved_cents,
        'lifetime_earned_cents', w.lifetime_earned_cents,
        'lifetime_withdrawn_cents', w.lifetime_withdrawn_cents,
        'lifetime_fees_cents', w.lifetime_fees_cents)
        ORDER BY w.available_cents DESC), '[]'::jsonb)
        FROM public.provider_wallets w),
    'payouts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'reference', q.request_reference, 'provider_user_id', q.provider_user_id,
        'msisdn', q.msisdn, 'amount_cents', q.amount_cents, 'gross_cents', q.gross_cents,
        'fee_cents', q.fee_cents, 'fee_bps', q.fee_bps, 'currency', q.currency,
        'state', q.state, 'earnings_count', q.earnings_count,
        'provider_transaction_id', q.provider_transaction_id, 'paid_at', q.paid_at,
        'failure_reason', q.failure_reason, 'approved_at', q.approved_at,
        'created_at', q.created_at) ORDER BY q.created_at DESC), '[]'::jsonb)
        FROM public.provider_payout_requests q),
    'postings', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'posting_type', p.posting_type, 'provider_user_id', p.provider_user_id,
        'amount_cents', p.amount_cents, 'currency', p.currency, 'paybill', p.paybill,
        'rate_bps', p.rate_bps, 'reference', p.reference, 'created_at', p.created_at)
        ORDER BY p.created_at DESC), '[]'::jsonb)
        FROM public.provider_platform_postings p),
    'earnings', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'provider_user_id', e.provider_user_id, 'booking_reference', e.booking_reference,
        'gross_cents', e.gross_cents, 'commission_cents', e.commission_cents,
        'net_cents', e.net_cents, 'state', e.state, 'currency', e.currency,
        'customer_paid_at', e.customer_paid_at, 'credited_at', e.credited_at,
        'created_at', e.created_at)
        ORDER BY e.created_at DESC), '[]'::jsonb)
        FROM public.provider_earnings e));
END $$;

REVOKE ALL ON FUNCTION public.provider_settlement_console() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_settlement_console() TO authenticated, service_role;