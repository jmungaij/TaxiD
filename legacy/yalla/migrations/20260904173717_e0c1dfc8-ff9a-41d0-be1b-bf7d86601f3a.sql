-- 1. earning transaction kind on the existing wallet transaction taxonomy
ALTER TYPE public.txn_kind ADD VALUE IF NOT EXISTS 'ride_earning';

-- 2. driver -> fleet owner attribution on the existing driver entity
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES public.carrier_profiles(id);

-- 3. ownership helper
CREATE OR REPLACE FUNCTION public._is_own_driver(_driver_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = _driver_id AND d.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public._is_own_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_own_driver(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._driver_finance_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'service_role'
      OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])
      OR public.has_staff_permission('staff.finance.charge.manage');
$$;
REVOKE ALL ON FUNCTION public._driver_finance_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._driver_finance_staff() TO authenticated, service_role;

-- 4. authoritative driver earning record
CREATE TABLE IF NOT EXISTS public.driver_trip_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_reference text NOT NULL UNIQUE,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.trip_bookings(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  driver_user_id uuid,
  carrier_id uuid REFERENCES public.carrier_profiles(id),
  service_line text NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  gross_cents bigint NOT NULL CHECK (gross_cents >= 0),
  commission_bps integer NOT NULL CHECK (commission_bps >= 0 AND commission_bps <= 10000),
  commission_cents bigint NOT NULL CHECK (commission_cents >= 0),
  deductions_cents bigint NOT NULL DEFAULT 0 CHECK (deductions_cents >= 0),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  state text NOT NULL DEFAULT 'EARNED'
    CHECK (state IN ('PENDING','ELIGIBLE','EARNED','AVAILABLE','WITHDRAWN','PAID','REVERSED','DISPUTED')),
  data_class text NOT NULL DEFAULT 'PRODUCTION' CHECK (data_class IN ('PRODUCTION','TEST')),
  journal_id uuid,
  wallet_transaction_id uuid,
  payout_id uuid,
  terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  accrued_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_trip_earnings_driver_idx ON public.driver_trip_earnings (driver_id, accrued_at DESC);
CREATE INDEX IF NOT EXISTS driver_trip_earnings_user_idx ON public.driver_trip_earnings (driver_user_id, accrued_at DESC);
CREATE INDEX IF NOT EXISTS driver_trip_earnings_state_idx ON public.driver_trip_earnings (state);

GRANT SELECT ON public.driver_trip_earnings TO authenticated;
GRANT ALL ON public.driver_trip_earnings TO service_role;

ALTER TABLE public.driver_trip_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers read their own earnings" ON public.driver_trip_earnings
  FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid() OR public._is_own_driver(driver_id));

CREATE POLICY "Finance and compliance staff read earnings" ON public.driver_trip_earnings
  FOR SELECT TO authenticated
  USING (public._driver_finance_staff() OR public.has_staff_permission('staff.logistics.read'));

-- financial immutability: amounts and lineage can never be rewritten
CREATE OR REPLACE FUNCTION public._driver_earning_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.booking_id <> OLD.booking_id
     OR NEW.driver_id <> OLD.driver_id
     OR NEW.gross_cents <> OLD.gross_cents
     OR NEW.commission_bps <> OLD.commission_bps
     OR NEW.commission_cents <> OLD.commission_cents
     OR NEW.net_cents <> OLD.net_cents
     OR NEW.earning_reference <> OLD.earning_reference THEN
    RAISE EXCEPTION 'DRIVER_EARNING_FINANCIALS_IMMUTABLE';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS driver_trip_earnings_immutable ON public.driver_trip_earnings;
CREATE TRIGGER driver_trip_earnings_immutable
  BEFORE UPDATE ON public.driver_trip_earnings
  FOR EACH ROW EXECUTE FUNCTION public._driver_earning_immutable();

DROP TRIGGER IF EXISTS driver_trip_earnings_no_delete ON public.driver_trip_earnings;
CREATE OR REPLACE FUNCTION public._driver_earning_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'DRIVER_EARNINGS_APPEND_ONLY';
END; $$;
CREATE TRIGGER driver_trip_earnings_no_delete
  BEFORE DELETE ON public.driver_trip_earnings
  FOR EACH ROW EXECUTE FUNCTION public._driver_earning_no_delete();

-- 5. driver may read the trips they performed (existing policy only matched user ids)
DROP POLICY IF EXISTS "Driver of record reads own trips" ON public.trip_bookings;
CREATE POLICY "Driver of record reads own trips" ON public.trip_bookings
  FOR SELECT TO authenticated
  USING (public._is_own_driver(driver_id));

-- 6. accrue an earning from a completed trip (idempotent, one per booking)
CREATE OR REPLACE FUNCTION public.driver_earning_accrue(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.trip_bookings;
  v_existing public.driver_trip_earnings;
  v_driver public.drivers;
  v_line text;
  v_bps int;
  v_gross bigint;
  v_comm bigint;
  v_net bigint;
  v_terms record;
  v_ref text;
  v_id uuid;
  v_journal uuid := gen_random_uuid();
  v_expense uuid;
  v_payable uuid;
  v_class text;
BEGIN
  IF NOT public._driver_finance_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_b FROM public.trip_bookings WHERE id = _booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','BOOKING_NOT_FOUND'); END IF;
  IF v_b.status::text <> 'completed' THEN
    RETURN jsonb_build_object('error', true, 'code','TRIP_NOT_COMPLETED', 'status', v_b.status);
  END IF;
  IF v_b.driver_id IS NULL THEN RETURN jsonb_build_object('error', true, 'code','NO_DRIVER_ATTRIBUTED'); END IF;

  SELECT * INTO v_existing FROM public.driver_trip_earnings WHERE booking_id = _booking_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'earning_id', v_existing.id,
                              'reference', v_existing.earning_reference, 'state', v_existing.state,
                              'net_cents', v_existing.net_cents);
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = v_b.driver_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','DRIVER_NOT_FOUND'); END IF;
  IF v_driver.status::text <> 'active' THEN
    RETURN jsonb_build_object('error', true, 'code','DRIVER_NOT_ACTIVE', 'driver_status', v_driver.status);
  END IF;

  v_line := CASE WHEN coalesce(v_b.intent::text,'') = 'corporate' THEN 'corporate' ELSE 'ride_hailing' END;
  SELECT * INTO v_terms FROM public.service_line_financial_terms WHERE service_line = v_line;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','COMMERCIAL_TERMS_NOT_CONFIGURED','service_line',v_line); END IF;

  v_gross := round(coalesce(v_b.total_fare,0) * 100)::bigint;
  IF v_gross <= 0 THEN RETURN jsonb_build_object('error', true, 'code','NO_FARE_ON_TRIP'); END IF;

  v_bps := coalesce(v_b.commission_bps, v_terms.commission_bps);
  v_comm := coalesce(v_b.commission_cents, round(v_gross * v_bps / 10000.0)::bigint);
  v_net := v_gross - v_comm;
  IF v_net < 0 THEN RETURN jsonb_build_object('error', true, 'code','NEGATIVE_ENTITLEMENT'); END IF;

  v_class := CASE WHEN coalesce(v_b.booking_number,'') ~* '^(TWIN|TEST|SIM)' THEN 'TEST' ELSE 'PRODUCTION' END;
  v_ref := 'DER-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(_booking_id::text), 1, 8));

  SELECT id INTO v_expense FROM public.ledger_accounts WHERE coa_code = '5110' LIMIT 1;
  IF v_expense IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('DRIVER_EARNINGS_COST','Driver Earnings Cost','EXPENSE','KES','5110') RETURNING id INTO v_expense;
  END IF;
  SELECT id INTO v_payable FROM public.ledger_accounts WHERE coa_code = '2110' LIMIT 1;
  IF v_payable IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('DRIVER_PAYABLE','Driver Payables','LIABILITY','KES','2110') RETURNING id INTO v_payable;
  END IF;

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (v_journal, 'DRIVER_EARNING', v_ref, 'Driver entitlement for trip ' || coalesce(v_b.booking_number, _booking_id::text), auth.uid());

  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (v_journal, v_expense, 'DEBIT',  v_net, 'KES', 'DR driver earnings cost ' || v_ref, auth.uid()),
    (v_journal, v_payable, 'CREDIT', v_net, 'KES', 'CR driver payable ' || v_ref, auth.uid());

  PERFORM public.posting_engine_post(v_journal);

  INSERT INTO public.driver_trip_earnings
    (earning_reference, booking_id, driver_id, driver_user_id, carrier_id, service_line, currency,
     gross_cents, commission_bps, commission_cents, net_cents, state, data_class, journal_id, terms_snapshot)
  VALUES
    (v_ref, _booking_id, v_driver.id, v_driver.user_id, v_driver.carrier_id, v_line, coalesce(v_b.currency,'KES'),
     v_gross, v_bps, v_comm, v_net, 'EARNED', v_class, v_journal,
     jsonb_build_object('service_line', v_line, 'commission_bps', v_bps,
                        'payment_cost_bps', v_terms.payment_cost_bps,
                        'principal_contract', v_terms.principal_contract,
                        'source', 'service_line_financial_terms',
                        'booking_number', v_b.booking_number,
                        'booking_payment_status', v_b.payment_status))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'earning_id', v_id, 'reference', v_ref, 'state','EARNED',
                            'gross_cents', v_gross, 'commission_bps', v_bps, 'commission_cents', v_comm,
                            'net_cents', v_net, 'data_class', v_class, 'journal_id', v_journal);
END; $$;
REVOKE ALL ON FUNCTION public.driver_earning_accrue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_earning_accrue(uuid) TO authenticated, service_role;

-- 7. release an earned entitlement into the existing driver wallet once the trip payment is confirmed
CREATE OR REPLACE FUNCTION public.driver_earning_release(_earning_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_e public.driver_trip_earnings;
  v_b public.trip_bookings;
  v_wallet uuid;
  v_txn uuid;
BEGIN
  IF NOT public._driver_finance_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_e FROM public.driver_trip_earnings WHERE id = _earning_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','EARNING_NOT_FOUND'); END IF;
  IF v_e.state = 'AVAILABLE' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'earning_id', v_e.id, 'state','AVAILABLE');
  END IF;
  IF v_e.state <> 'EARNED' THEN
    RETURN jsonb_build_object('error', true, 'code','INVALID_STATE','state', v_e.state);
  END IF;

  SELECT * INTO v_b FROM public.trip_bookings WHERE id = v_e.booking_id;
  IF lower(coalesce(v_b.payment_status,'')) NOT IN ('paid','succeeded','completed','captured','settled') THEN
    RETURN jsonb_build_object('error', true, 'code','TRIP_PAYMENT_NOT_CONFIRMED',
                              'payment_status', v_b.payment_status);
  END IF;

  SELECT id INTO v_wallet FROM public.wallets
   WHERE user_id = v_e.driver_user_id AND wallet_type = 'driver' LIMIT 1;
  IF v_wallet IS NULL THEN
    IF v_e.driver_user_id IS NULL THEN
      RETURN jsonb_build_object('error', true, 'code','DRIVER_HAS_NO_PLATFORM_ACCOUNT');
    END IF;
    INSERT INTO public.wallets (user_id, wallet_type, balance_cents, currency)
    VALUES (v_e.driver_user_id, 'driver', 0, v_e.currency) RETURNING id INTO v_wallet;
  END IF;

  INSERT INTO public.wallet_transactions
    (wallet_id, user_id, direction, amount_cents, kind, status, reference, metadata)
  VALUES
    (v_wallet, v_e.driver_user_id, 'credit', v_e.net_cents, 'ride_earning', 'completed', v_e.earning_reference,
     jsonb_build_object('booking_id', v_e.booking_id, 'earning_id', v_e.id, 'journal_id', v_e.journal_id,
                        'data_class', v_e.data_class))
  RETURNING id INTO v_txn;

  UPDATE public.wallets SET balance_cents = balance_cents + v_e.net_cents, updated_at = now()
   WHERE id = v_wallet;

  UPDATE public.driver_trip_earnings
     SET state = 'AVAILABLE', released_at = now(), wallet_transaction_id = v_txn
   WHERE id = v_e.id;

  RETURN jsonb_build_object('ok', true, 'earning_id', v_e.id, 'state','AVAILABLE',
                            'wallet_id', v_wallet, 'wallet_transaction_id', v_txn,
                            'credited_cents', v_e.net_cents);
END; $$;
REVOKE ALL ON FUNCTION public.driver_earning_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_earning_release(uuid) TO authenticated, service_role;

-- 8. driver-initiated withdrawal request against the existing payout engine
CREATE UNIQUE INDEX IF NOT EXISTS driver_payouts_idempotency_uidx
  ON public.driver_payouts ((metadata->>'idempotency_key'))
  WHERE metadata->>'idempotency_key' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.driver_withdrawal_request(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers;
  v_method public.driver_payout_methods;
  v_amount bigint := (p->>'amount_cents')::bigint;
  v_key text := coalesce(p->>'idempotency_key','');
  v_existing public.driver_payouts;
  v_balance bigint;
  v_inflight bigint;
  v_available bigint;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF v_key = '' THEN RETURN jsonb_build_object('error', true, 'code','IDEMPOTENCY_KEY_REQUIRED'); END IF;

  SELECT * INTO v_existing FROM public.driver_payouts WHERE metadata->>'idempotency_key' = v_key;
  IF FOUND THEN
    IF v_existing.driver_id <> v_uid THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'payout_id', v_existing.id,
                              'status', v_existing.status, 'amount_cents', v_existing.amount_cents);
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','NOT_A_REGISTERED_DRIVER'); END IF;
  IF v_driver.status::text <> 'active' THEN
    RETURN jsonb_build_object('error', true, 'code','DRIVER_NOT_ACTIVE','driver_status', v_driver.status);
  END IF;
  IF coalesce(v_driver.verification_status,'') NOT IN ('verified','approved') THEN
    RETURN jsonb_build_object('error', true, 'code','DRIVER_NOT_VERIFIED',
                              'verification_status', v_driver.verification_status);
  END IF;

  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN jsonb_build_object('error', true, 'code','INVALID_AMOUNT'); END IF;
  IF v_amount < 5000 THEN
    RETURN jsonb_build_object('error', true, 'code','BELOW_MINIMUM_WITHDRAWAL','minimum_cents', 5000);
  END IF;

  SELECT * INTO v_method FROM public.driver_payout_methods
   WHERE id = (p->>'method_id')::uuid AND driver_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','PAYOUT_DESTINATION_NOT_FOUND'); END IF;
  IF NOT v_method.verified THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_DESTINATION_NOT_VERIFIED');
  END IF;

  IF EXISTS (SELECT 1 FROM public.driver_payouts
              WHERE driver_id = v_uid AND status IN ('PENDING','QUEUED','PROCESSING')) THEN
    RETURN jsonb_build_object('error', true, 'code','WITHDRAWAL_ALREADY_IN_FLIGHT');
  END IF;

  SELECT coalesce(balance_cents,0) INTO v_balance FROM public.wallets
   WHERE user_id = v_uid AND wallet_type = 'driver' LIMIT 1;
  IF v_balance IS NULL THEN RETURN jsonb_build_object('error', true, 'code','DRIVER_WALLET_NOT_FUNDED'); END IF;

  SELECT coalesce(sum(amount_cents),0) INTO v_inflight FROM public.driver_payouts
   WHERE driver_id = v_uid AND status IN ('PENDING','QUEUED','PROCESSING');
  v_available := v_balance - v_inflight;

  IF v_amount > v_available THEN
    RETURN jsonb_build_object('error', true, 'code','INSUFFICIENT_AVAILABLE_BALANCE',
                              'available_cents', v_available, 'requested_cents', v_amount);
  END IF;

  INSERT INTO public.driver_payouts
    (driver_id, method_id, amount_cents, currency, status, reference, requested_by, metadata)
  VALUES
    (v_uid, v_method.id, v_amount, 'KES', 'PENDING',
     'DWD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key), 1, 6)),
     v_uid,
     jsonb_build_object('idempotency_key', v_key, 'source','driver_portal',
                        'destination_type', v_method.method_type,
                        'destination_masked', right(coalesce(v_method.msisdn,''), 4),
                        'available_cents_at_request', v_available,
                        'requested_at', now()))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'payout_id', v_id, 'status','PENDING',
                            'amount_cents', v_amount, 'available_cents', v_available);
END; $$;
REVOKE ALL ON FUNCTION public.driver_withdrawal_request(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_withdrawal_request(jsonb) TO authenticated, service_role;

-- 9. finance decision: approve (reserve through ledger + wallet, queue payout) or reject
CREATE OR REPLACE FUNCTION public.driver_withdrawal_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action text := upper(coalesce(p->>'action',''));
  v_payout public.driver_payouts;
  v_wallet uuid;
  v_balance bigint;
  v_journal uuid := gen_random_uuid();
  v_payable uuid;
  v_bank uuid;
  v_txn uuid;
  v_remaining bigint;
  v_row record;
BEGIN
  IF NOT public._driver_finance_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE = '42501'; END IF;
  IF v_action NOT IN ('APPROVE','REJECT') THEN
    RETURN jsonb_build_object('error', true, 'code','INVALID_ACTION');
  END IF;

  SELECT * INTO v_payout FROM public.driver_payouts WHERE id = (p->>'payout_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_FOUND'); END IF;
  IF v_payout.status::text <> 'PENDING' THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_PENDING','status', v_payout.status);
  END IF;

  IF v_action = 'REJECT' THEN
    UPDATE public.driver_payouts
       SET status = 'CANCELLED', approved_by = auth.uid(), approved_at = now(),
           metadata = metadata || jsonb_build_object('rejection_reason', p->>'reason',
                                                     'decided_by', auth.uid(), 'decided_at', now())
     WHERE id = v_payout.id;
    RETURN jsonb_build_object('ok', true, 'payout_id', v_payout.id, 'status','CANCELLED');
  END IF;

  SELECT id, balance_cents INTO v_wallet, v_balance FROM public.wallets
   WHERE user_id = v_payout.driver_id AND wallet_type = 'driver' LIMIT 1;
  IF v_wallet IS NULL THEN RETURN jsonb_build_object('error', true, 'code','DRIVER_WALLET_MISSING'); END IF;
  IF v_balance < v_payout.amount_cents THEN
    RETURN jsonb_build_object('error', true, 'code','INSUFFICIENT_BALANCE_AT_APPROVAL',
                              'balance_cents', v_balance, 'amount_cents', v_payout.amount_cents);
  END IF;

  SELECT id INTO v_payable FROM public.ledger_accounts WHERE coa_code = '2110' LIMIT 1;
  SELECT id INTO v_bank FROM public.ledger_accounts WHERE coa_code = '1110' LIMIT 1;
  IF v_bank IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('BANK_CLEARING','Bank/Payout Clearing','ASSET','KES','1110') RETURNING id INTO v_bank;
  END IF;

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (v_journal, 'DRIVER_PAYOUT', v_payout.id::text,
          'Driver withdrawal ' || coalesce(v_payout.reference, v_payout.id::text), auth.uid());
  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (v_journal, v_payable, 'DEBIT',  v_payout.amount_cents, 'KES', 'DR driver payable (withdrawal)', auth.uid()),
    (v_journal, v_bank,    'CREDIT', v_payout.amount_cents, 'KES', 'CR payout clearing', auth.uid());
  PERFORM public.posting_engine_post(v_journal);

  INSERT INTO public.wallet_transactions
    (wallet_id, user_id, direction, amount_cents, kind, status, reference, metadata)
  VALUES
    (v_wallet, v_payout.driver_id, 'debit', v_payout.amount_cents, 'payout', 'pending',
     coalesce(v_payout.reference, v_payout.id::text),
     jsonb_build_object('payout_id', v_payout.id, 'journal_id', v_journal))
  RETURNING id INTO v_txn;

  UPDATE public.wallets SET balance_cents = balance_cents - v_payout.amount_cents, updated_at = now()
   WHERE id = v_wallet;

  UPDATE public.driver_payouts
     SET status = 'QUEUED', approved_by = auth.uid(), approved_at = now(), journal_id = v_journal,
         metadata = metadata || jsonb_build_object('wallet_transaction_id', v_txn,
                                                   'approved_balance_cents', v_balance)
   WHERE id = v_payout.id;

  -- mark the oldest available earnings as withdrawn up to the approved amount
  v_remaining := v_payout.amount_cents;
  FOR v_row IN
    SELECT id, net_cents FROM public.driver_trip_earnings
     WHERE driver_user_id = v_payout.driver_id AND state = 'AVAILABLE'
     ORDER BY accrued_at
  LOOP
    EXIT WHEN v_remaining <= 0;
    UPDATE public.driver_trip_earnings
       SET state = 'WITHDRAWN', payout_id = v_payout.id WHERE id = v_row.id;
    v_remaining := v_remaining - v_row.net_cents;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'payout_id', v_payout.id, 'status','QUEUED',
                            'journal_id', v_journal, 'wallet_transaction_id', v_txn,
                            'note','Disbursement requires the live provider path; QUEUED is not PAID.');
END; $$;
REVOKE ALL ON FUNCTION public.driver_withdrawal_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_withdrawal_decide(jsonb) TO authenticated, service_role;

-- 10. driver-scoped read projection used by the portal (no client-side aggregation of money)
CREATE OR REPLACE FUNCTION public.driver_portal_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers;
  v_wallet record;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_driver FROM public.drivers WHERE user_id = v_uid LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('is_driver', false); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid AND wallet_type = 'driver' LIMIT 1;

  SELECT jsonb_build_object(
    'is_driver', true,
    'driver', jsonb_build_object(
      'id', v_driver.id, 'driver_code', v_driver.driver_code,
      'name', trim(coalesce(v_driver.first_name,'') || ' ' || coalesce(v_driver.last_name,'')),
      'status', v_driver.status, 'application_status', v_driver.application_status,
      'verification_status', v_driver.verification_status,
      'carrier_id', v_driver.carrier_id,
      'carrier_name', (SELECT legal_entity_name FROM public.carrier_profiles WHERE id = v_driver.carrier_id),
      'rating', v_driver.driver_rating, 'activation_date', v_driver.activation_date),
    'wallet', jsonb_build_object(
      'currency', coalesce(v_wallet.currency,'KES'),
      'balance_cents', coalesce(v_wallet.balance_cents, 0),
      'exists', v_wallet.id IS NOT NULL),
    'earnings', (
      SELECT jsonb_build_object(
        'today_cents',    coalesce(sum(net_cents) FILTER (WHERE accrued_at >= date_trunc('day', now())), 0),
        'week_cents',     coalesce(sum(net_cents) FILTER (WHERE accrued_at >= date_trunc('week', now())), 0),
        'month_cents',    coalesce(sum(net_cents) FILTER (WHERE accrued_at >= date_trunc('month', now())), 0),
        'lifetime_cents', coalesce(sum(net_cents), 0),
        'pending_cents',  coalesce(sum(net_cents) FILTER (WHERE state IN ('PENDING','ELIGIBLE','EARNED')), 0),
        'available_cents',coalesce(sum(net_cents) FILTER (WHERE state = 'AVAILABLE'), 0),
        'withdrawn_cents',coalesce(sum(net_cents) FILTER (WHERE state IN ('WITHDRAWN','PAID')), 0),
        'reversed_cents', coalesce(sum(net_cents) FILTER (WHERE state = 'REVERSED'), 0),
        'test_cents',     coalesce(sum(net_cents) FILTER (WHERE data_class = 'TEST'), 0),
        'count', count(*))
      FROM public.driver_trip_earnings WHERE driver_id = v_driver.id),
    'trips', (
      SELECT jsonb_build_object(
        'total', count(*),
        'completed', count(*) FILTER (WHERE status::text = 'completed'),
        'cancelled', count(*) FILTER (WHERE status::text = 'cancelled'))
      FROM public.trip_bookings WHERE driver_id = v_driver.id),
    'payouts', (
      SELECT jsonb_build_object(
        'in_flight_cents', coalesce(sum(amount_cents) FILTER (WHERE status IN ('PENDING','QUEUED','PROCESSING')), 0),
        'paid_cents', coalesce(sum(amount_cents) FILTER (WHERE status = 'SUCCESS'), 0),
        'count', count(*))
      FROM public.driver_payouts WHERE driver_id = v_uid),
    'documents', (
      SELECT jsonb_build_object(
        'total', count(*),
        'verified', count(*) FILTER (WHERE lower(coalesce(status,'')) IN ('verified','approved')),
        'expiring_soon', count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date <= (now() + interval '30 days')),
        'expired', count(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < now()))
      FROM public.driver_documents WHERE driver_id = v_uid),
    'generated_at', now()
  ) INTO v_res;

  RETURN v_res;
END; $$;
REVOKE ALL ON FUNCTION public.driver_portal_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_portal_summary() TO authenticated, service_role;