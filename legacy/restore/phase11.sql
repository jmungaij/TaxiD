ALTER TYPE public.journal_source ADD VALUE IF NOT EXISTS 'DRIVER_EARNING';
CREATE TABLE IF NOT EXISTS public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.journals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.ledger_accounts(id),
  direction text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  memo text, posted_by uuid, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.journal_lines TO authenticated;
GRANT ALL ON public.journal_lines TO service_role;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance staff read journal lines" ON public.journal_lines FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));
CREATE INDEX IF NOT EXISTS journal_lines_journal_idx ON public.journal_lines(journal_id);
ALTER TABLE public.ledger_accounts ADD COLUMN IF NOT EXISTS active boolean GENERATED ALWAYS AS (is_active) STORED;
INSERT INTO public.chart_of_accounts (code,name,account_type,normal_side) VALUES
 ('1110','Bank / Payout Clearing','ASSET','DEBIT'),
 ('2110','Driver Payables','LIABILITY','CREDIT'),
 ('5110','Driver Earnings Cost','EXPENSE','DEBIT') ON CONFLICT (code) DO NOTHING;
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

CREATE OR REPLACE FUNCTION public.driver_rides_self()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _driver public.drivers;
  _bps integer;
  _out jsonb;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _driver
    FROM public.drivers
   WHERE user_id = _caller
   ORDER BY created_at
   LIMIT 1;

  IF _driver.id IS NULL THEN
    RETURN jsonb_build_object(
      'is_driver', false,
      'currency', 'KES',
      'commission_bps', 1500,
      'available', '[]'::jsonb,
      'trips', '[]'::jsonb,
      'summary', jsonb_build_object(
        'available', 0, 'assigned', 0, 'in_progress', 0, 'completed', 0,
        'gross_cents', 0, 'commission_cents', 0, 'net_cents', 0, 'upcoming_net_cents', 0
      )
    );
  END IF;

  SELECT coalesce(commission_bps, 1500) INTO _bps FROM public.provider_settlement_settings LIMIT 1;
  _bps := coalesce(_bps, 1500);

  WITH mine AS (
    SELECT b.id,
           b.booking_number,
           b.pickup_address,
           b.dropoff_address,
           b.passenger_count,
           b.intent,
           b.status,
           b.payment_status,
           b.payment_method,
           coalesce(b.currency, 'KES') AS currency,
           b.scheduled_for,
           b.pickup_eta,
           b.started_at,
           b.completed_at,
           b.cancelled_at,
           round(coalesce(b.total_fare, 0) * 100)::bigint AS gross_cents,
           coalesce(
             b.commission_cents,
             round(coalesce(b.total_fare, 0) * 100 * _bps / 10000.0)::bigint
           ) AS commission_cents
      FROM public.trip_bookings b
     WHERE b.driver_id = _driver.id
  ),
  waiting AS (
    SELECT b.id,
           b.booking_number,
           b.pickup_address,
           b.dropoff_address,
           b.passenger_count,
           b.intent,
           b.status,
           coalesce(b.currency, 'KES') AS currency,
           b.scheduled_for,
           round(coalesce(b.total_fare, 0) * 100)::bigint AS gross_cents,
           round(coalesce(b.total_fare, 0) * 100 * (10000 - _bps) / 10000.0)::bigint AS net_cents
      FROM public.trip_bookings b
     WHERE b.driver_id IS NULL
       AND b.status IN ('pending', 'scheduled')
       AND b.cancelled_at IS NULL
     ORDER BY coalesce(b.scheduled_for, b.created_at)
     LIMIT 25
  )
  SELECT jsonb_build_object(
    'is_driver', true,
    'driver', jsonb_build_object(
      'id', _driver.id,
      'driver_code', _driver.driver_code,
      'status', _driver.status,
      'driver_type', _driver.driver_type,
      'rating', _driver.driver_rating
    ),
    'currency', coalesce((SELECT currency FROM mine LIMIT 1), 'KES'),
    'commission_bps', _bps,
    'available', coalesce((SELECT jsonb_agg(to_jsonb(w)) FROM waiting w), '[]'::jsonb),
    'trips', coalesce((
      SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('net_cents', m.gross_cents - m.commission_cents)
             ORDER BY coalesce(m.completed_at, m.started_at, m.scheduled_for) DESC NULLS LAST)
        FROM mine m
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'available', (SELECT count(*) FROM waiting),
      'assigned', (SELECT count(*) FROM mine WHERE status IN ('assigned', 'scheduled', 'pending')),
      'in_progress', (SELECT count(*) FROM mine WHERE status IN ('in_progress', 'started', 'arrived')),
      'completed', (SELECT count(*) FROM mine WHERE status = 'completed'),
      'gross_cents', (SELECT coalesce(sum(gross_cents), 0) FROM mine WHERE status = 'completed'),
      'commission_cents', (SELECT coalesce(sum(commission_cents), 0) FROM mine WHERE status = 'completed'),
      'net_cents', (SELECT coalesce(sum(gross_cents - commission_cents), 0) FROM mine WHERE status = 'completed'),
      'upcoming_net_cents', (SELECT coalesce(sum(gross_cents - commission_cents), 0) FROM mine
                              WHERE status IN ('assigned', 'scheduled', 'pending', 'in_progress', 'started', 'arrived'))
    )
  ) INTO _out;

  RETURN _out;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_set_availability(
  _online boolean,
  _available boolean DEFAULT true,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _accuracy_m numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_lat numeric;
  v_lng numeric;
  v_trip uuid;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver.id IS NULL THEN RAISE EXCEPTION 'No driver profile for this account'; END IF;
  IF v_driver.status <> 'active' AND _online THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'driver_not_active', 'status', v_driver.status);
  END IF;

  SELECT COALESCE(_lat, dl.lat), COALESCE(_lng, dl.lng)
    INTO v_lat, v_lng
    FROM public.driver_locations dl
   WHERE dl.driver_id = v_driver.id;

  v_lat := COALESCE(v_lat, _lat);
  v_lng := COALESCE(v_lng, _lng);

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'location_required');
  END IF;

  INSERT INTO public.driver_locations(driver_id, lat, lng, accuracy_m, is_online, is_available, updated_at)
  VALUES (v_driver.id, v_lat, v_lng, _accuracy_m, _online, _online AND _available, now())
  ON CONFLICT (driver_id) DO UPDATE
     SET lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         accuracy_m = COALESCE(EXCLUDED.accuracy_m, public.driver_locations.accuracy_m),
         is_online = EXCLUDED.is_online,
         is_available = EXCLUDED.is_available,
         updated_at = now();

  -- Feed the rider's live map while a trip is running.
  SELECT id INTO v_trip
    FROM public.trip_bookings
   WHERE driver_id = v_driver.id
     AND status IN ('driver_assigned', 'driver_arriving', 'in_progress')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_trip IS NOT NULL AND _lat IS NOT NULL AND _lng IS NOT NULL THEN
    INSERT INTO public.trip_tracking(trip_booking_id, lat, lng) VALUES (v_trip, _lat, _lng);
  END IF;

  RETURN jsonb_build_object('ok', true, 'is_online', _online, 'is_available', _online AND _available, 'active_trip_id', v_trip);
END $$;

CREATE OR REPLACE FUNCTION public.driver_duty_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_loc public.driver_locations%ROWTYPE;
  v_trip jsonb;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_loc FROM public.driver_locations WHERE driver_id = v_driver.id;

  SELECT to_jsonb(t) INTO v_trip FROM (
    SELECT id, booking_number, status, pickup_address, dropoff_address,
           pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, total_fare, pickup_eta, passenger_count
      FROM public.trip_bookings
     WHERE driver_id = v_driver.id
       AND status IN ('driver_assigned', 'driver_arriving', 'in_progress')
     ORDER BY created_at DESC
     LIMIT 1
  ) t;

  RETURN jsonb_build_object(
    'driver_id', v_driver.id,
    'driver_status', v_driver.status,
    'is_online', COALESCE(v_loc.is_online, false),
    'is_available', COALESCE(v_loc.is_available, false),
    'last_ping', v_loc.updated_at,
    'active_trip', v_trip
  );
END $$;

CREATE OR REPLACE FUNCTION public.driver_advance_trip(_booking_id uuid, _to_status text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_b public.trip_bookings%ROWTYPE;
  v_allowed text[];
BEGIN
  PERFORM set_config('app.trip_engine', 'on', true);

  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No driver profile for this account'; END IF;

  SELECT * INTO v_b FROM public.trip_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_b.id IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF v_b.driver_id IS DISTINCT FROM v_driver_id THEN RAISE EXCEPTION 'Trip not assigned to you'; END IF;

  v_allowed := CASE v_b.status
    WHEN 'driver_assigned' THEN ARRAY['driver_arriving', 'cancelled']
    WHEN 'driver_arriving' THEN ARRAY['in_progress', 'cancelled']
    WHEN 'in_progress' THEN ARRAY['completed']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (_to_status = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'from', v_b.status, 'to', _to_status);
  END IF;

  UPDATE public.trip_bookings
     SET status = _to_status,
         started_at = CASE WHEN _to_status = 'in_progress' THEN now() ELSE started_at END,
         completed_at = CASE WHEN _to_status = 'completed' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN _to_status = 'cancelled' THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN _to_status = 'cancelled' THEN 'driver' ELSE cancelled_by END,
         cancellation_reason = CASE WHEN _to_status = 'cancelled' THEN _reason ELSE cancellation_reason END,
         updated_at = now()
   WHERE id = _booking_id;

  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES (_booking_id, v_b.status, _to_status, auth.uid(), _reason);

  IF _to_status IN ('completed', 'cancelled') THEN
    UPDATE public.driver_locations
       SET is_available = true, updated_at = now()
     WHERE driver_id = v_driver_id AND is_online;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', _to_status);
END $$;

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

CREATE OR REPLACE FUNCTION public._driver_finance_staff()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR (
      auth.uid() IS NOT NULL AND (
        public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])
        OR public.has_staff_permission('staff.finance.charge.manage')
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.driver_payout_recipients()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (public._driver_finance_staff()
          OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', d.user_id,
           'driver_id', d.id,
           'driver_code', d.driver_code,
           'status', d.status,
           'clearance_state', c.state)), '[]'::jsonb)
    INTO v_rows
    FROM public.drivers d
    LEFT JOIN public.driver_finance_clearances c ON c.driver_id = d.id
   WHERE d.user_id IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'drivers', v_rows);
END $function$;

CREATE OR REPLACE FUNCTION public.driver_application_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first text := btrim(coalesce(p->>'first_name',''));
  v_last text := btrim(coalesce(p->>'last_name',''));
  v_id_no text := btrim(coalesce(p->>'national_id',''));
  v_email text := lower(btrim(coalesce(p->>'contact_email','')));
  v_phone text := btrim(coalesce(p->>'contact_phone',''));
  v_licence text := upper(btrim(coalesce(p->>'licence_number','')));
  v_own text := upper(coalesce(nullif(btrim(coalesce(p->>'vehicle_ownership','')),''),'NONE'));
  v_ref text;
  v_token text;
  v_app_id uuid;
  v_existing public.driver_applications;
  v_doc record;
BEGIN
  IF length(v_first) < 2 OR length(v_first) > 80 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_FIRST_NAME');
  END IF;
  IF length(v_last) < 2 OR length(v_last) > 80 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_LAST_NAME');
  END IF;
  IF v_id_no !~ '^[A-Za-z0-9/-]{5,20}$' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_NATIONAL_ID');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_EMAIL');
  END IF;
  IF v_phone !~ '^[0-9+ ()-]{9,20}$' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_PHONE');
  END IF;
  IF length(v_licence) < 4 OR length(v_licence) > 40 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_LICENCE_NUMBER');
  END IF;
  IF v_own NOT IN ('NONE','OWNER','FLEET_ASSIGNED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_VEHICLE_OWNERSHIP');
  END IF;
  IF length(coalesce(p->>'notes','')) > 4000 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOTES_TOO_LONG');
  END IF;

  SELECT * INTO v_existing FROM public.driver_applications
   WHERE national_id = v_id_no AND contact_email = v_email
     AND status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'application_id', v_existing.id,
      'application_reference', v_existing.application_reference,
      'claim_token', v_existing.claim_token,
      'status', v_existing.status);
  END IF;

  v_ref := 'DRV-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.driver_applications (
    application_reference, first_name, middle_name, last_name, gender, date_of_birth,
    national_id, kra_pin, contact_email, contact_phone, county, town, country,
    driver_type, licence_number, licence_classes, licence_expiry, psv_badge_number,
    years_experience, vehicle_ownership, vehicle_registration, vehicle_make_model,
    service_categories, preferred_city, notes, applicant_user_id, claim_token
  ) VALUES (
    v_ref, v_first, nullif(btrim(coalesce(p->>'middle_name','')),''), v_last,
    nullif(btrim(coalesce(p->>'gender','')),''), nullif(p->>'date_of_birth','')::date,
    v_id_no, nullif(btrim(coalesce(p->>'kra_pin','')),''), v_email, v_phone,
    nullif(btrim(coalesce(p->>'county','')),''), nullif(btrim(coalesce(p->>'town','')),''),
    coalesce(nullif(btrim(coalesce(p->>'country','')),''),'KE'),
    coalesce(nullif(btrim(coalesce(p->>'driver_type','')),''),'individual'),
    v_licence,
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'licence_classes','[]'::jsonb)) t(x)), '{}'),
    nullif(p->>'licence_expiry','')::date,
    nullif(btrim(coalesce(p->>'psv_badge_number','')),''),
    nullif(p->>'years_experience','')::int,
    v_own,
    nullif(btrim(coalesce(p->>'vehicle_registration','')),''),
    nullif(btrim(coalesce(p->>'vehicle_make_model','')),''),
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'service_categories','[]'::jsonb)) t(x)), '{}'),
    nullif(btrim(coalesce(p->>'preferred_city','')),''),
    nullif(btrim(coalesce(p->>'notes','')),''),
    auth.uid(), v_token
  ) RETURNING id INTO v_app_id;

  FOR v_doc IN
    SELECT * FROM (VALUES
      ('NATIONAL_ID','National ID (both sides)', true),
      ('DRIVING_LICENCE','Driving licence', true),
      ('PSV_BADGE','PSV badge', false),
      ('GOOD_CONDUCT','Certificate of good conduct', true),
      ('PASSPORT_PHOTO','Passport photograph', true),
      ('KRA_PIN','KRA PIN certificate', false),
      ('VEHICLE_LOGBOOK','Vehicle logbook', false),
      ('VEHICLE_INSURANCE','Vehicle insurance certificate', false)
    ) AS t(code, label, mandatory)
  LOOP
    INSERT INTO public.driver_application_documents (application_id, doc_code, doc_label, is_mandatory)
    VALUES (v_app_id, v_doc.code, v_doc.label,
      CASE WHEN v_doc.code IN ('VEHICLE_LOGBOOK','VEHICLE_INSURANCE') THEN (v_own = 'OWNER') ELSE v_doc.mandatory END);
  END LOOP;

  INSERT INTO public.driver_application_events (application_id, action, status_to, actor_user_id)
  VALUES (v_app_id, 'SUBMITTED', 'SUBMITTED', auth.uid());

  RETURN jsonb_build_object('ok', true, 'application_id', v_app_id,
    'application_reference', v_ref, 'claim_token', v_token, 'status', 'SUBMITTED');
END; $$;

CREATE OR REPLACE FUNCTION public.driver_application_status(_reference text, _token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.driver_applications; v_docs jsonb;
BEGIN
  IF coalesce(_reference,'') = '' OR coalesce(_token,'') = '' THEN
    RETURN jsonb_build_object('error', true, 'code', 'REFERENCE_AND_TOKEN_REQUIRED');
  END IF;
  SELECT * INTO r FROM public.driver_applications
   WHERE application_reference = _reference AND claim_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_code', d.doc_code, 'doc_label', d.doc_label,
    'is_mandatory', d.is_mandatory, 'state', d.state, 'review_notes', d.review_notes,
    'expires_on', d.expires_on) ORDER BY d.doc_code), '[]'::jsonb)
    INTO v_docs FROM public.driver_application_documents d WHERE d.application_id = r.id;

  RETURN jsonb_build_object('ok', true,
    'application_id', r.id,
    'application_reference', r.application_reference,
    'applicant_name', r.first_name || ' ' || r.last_name,
    'status', r.status,
    'review_notes', r.review_notes,
    'submitted_at', r.created_at,
    'decided_at', r.decided_at,
    'driver_id', r.driver_id,
    'documents', v_docs);
END; $$;

CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.staff_role_permissions srp ON srp.role = ur.role
      WHERE ur.user_id = auth.uid() AND srp.permission_key = _perm
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_baseline_permissions b
      JOIN public.staff_members sm ON sm.user_id = auth.uid() AND sm.employment_status IN ('active','onboarding')
      WHERE b.permission_key = _perm AND b.active
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_permission_grants g
      JOIN public.staff_members sm ON sm.user_id = g.user_id AND sm.employment_status IN ('active','onboarding')
      WHERE g.user_id = auth.uid() AND g.permission_key = _perm AND g.revoked_at IS NULL
        AND (_perm = g.permission_key OR (_perm = 'staff.crm.read' AND g.permission_key = 'staff.crm.manage'))
    )
    OR (_perm = 'staff.crm.read' AND EXISTS (
      SELECT 1 FROM public.staff_permission_grants g
      JOIN public.staff_members sm ON sm.user_id = g.user_id AND sm.employment_status IN ('active','onboarding')
      WHERE g.user_id = auth.uid() AND g.permission_key = 'staff.crm.manage' AND g.revoked_at IS NULL
    )),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public._driver_application_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_staff_permission('staff.logistics.compliance.manage')
      OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.driver_application_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'application_id')::uuid;
  v_action text := upper(coalesce(p->>'action',''));
  v_note text := nullif(btrim(coalesce(p->>'note','')),'');
  a public.driver_applications;
  v_to text;
  v_driver uuid;
  v_code text;
  v_base text;
  v_n int := 0;
  v_missing int;
BEGIN
  IF NOT public._driver_application_staff() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO a FROM public.driver_applications WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_APPLICATION'); END IF;

  IF v_action = 'APPROVE' AND a.status = 'APPROVED' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true, 'driver_id', a.driver_id);
  END IF;
  IF a.status IN ('APPROVED','REJECTED','WITHDRAWN') THEN
    RETURN jsonb_build_object('error', true, 'code', 'APPLICATION_CLOSED', 'status', a.status);
  END IF;

  IF v_action = 'REVIEW' THEN v_to := 'UNDER_REVIEW';
  ELSIF v_action = 'REQUEST_INFO' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code', 'NOTE_REQUIRED'); END IF;
    v_to := 'INFO_REQUESTED';
  ELSIF v_action = 'REJECT' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED'); END IF;
    v_to := 'REJECTED';
  ELSIF v_action = 'APPROVE' THEN v_to := 'APPROVED';
  ELSE RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_ACTION');
  END IF;

  IF v_to = 'APPROVED' THEN
    SELECT count(*) INTO v_missing FROM public.driver_application_documents
     WHERE application_id = v_id AND is_mandatory AND state <> 'VERIFIED';
    IF v_missing > 0 THEN
      RETURN jsonb_build_object('error', true, 'code', 'MANDATORY_DOCUMENTS_NOT_VERIFIED',
        'outstanding', v_missing);
    END IF;

    v_base := upper(regexp_replace(a.first_name || a.last_name, '[^a-zA-Z0-9]', '', 'g'));
    v_base := left(coalesce(nullif(v_base,''), 'DRIVER'), 8);
    v_code := 'DR-' || v_base;
    WHILE EXISTS (SELECT 1 FROM public.drivers WHERE driver_code = v_code) LOOP
      v_n := v_n + 1;
      v_code := 'DR-' || v_base || v_n::text;
    END LOOP;

    INSERT INTO public.drivers (
      driver_code, user_id, driver_type, first_name, middle_name, last_name,
      gender, date_of_birth, nationality, national_id, kra_pin, phone_number,
      email, county, city, country, status, application_status,
      verification_status, created_by
    ) VALUES (
      v_code, a.applicant_user_id, a.driver_type::driver_type, a.first_name, a.middle_name, a.last_name,
      a.gender, a.date_of_birth, a.country, a.national_id, a.kra_pin, a.contact_phone,
      a.contact_email, a.county, coalesce(a.preferred_city, a.town), a.country,
      'pending'::driver_status, 'approved',
      'pending'::doc_verification_status, auth.uid()
    ) RETURNING id INTO v_driver;
  END IF;

  UPDATE public.driver_applications SET
    status = v_to,
    review_notes = coalesce(v_note, review_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    decided_at = CASE WHEN v_to IN ('APPROVED','REJECTED') THEN now() ELSE decided_at END,
    driver_id = coalesce(v_driver, driver_id)
   WHERE id = v_id;

  INSERT INTO public.driver_application_events
    (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (v_id, v_action, a.status, v_to, v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'status', v_to, 'driver_id', coalesce(v_driver, a.driver_id));
END; $$;

CREATE OR REPLACE FUNCTION public.provider_document_decide(_document_id uuid, _decision text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid(); v_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin') OR public.has_role(v_actor,'operations_admin')) THEN
    RAISE EXCEPTION 'DOCUMENT_REVIEW_NOT_PERMITTED';
  END IF;
  IF _decision NOT IN ('VERIFIED','REJECTED') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  IF _decision = 'REJECTED' AND coalesce(btrim(_note),'') = '' THEN RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'; END IF;

  UPDATE public.provider_documents
     SET status = _decision, review_note = _note, reviewed_by = v_actor, reviewed_at = now()
   WHERE id = _document_id
   RETURNING status INTO v_status;

  IF v_status IS NULL THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('id', _document_id, 'status', v_status);
END; $$;
DO $$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure s, p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY['_driver_application_staff','_driver_finance_staff','driver_earning_accrue','driver_portal_summary','driver_rides_self','driver_set_availability','driver_duty_state','driver_advance_trip','driver_earning_release','driver_withdrawal_request','driver_withdrawal_decide','driver_payout_recipients','driver_application_submit','driver_application_status','driver_application_decide','provider_document_decide','has_staff_permission']) LOOP
EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.s); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.s);
IF r.proname NOT IN ('_driver_application_staff','_driver_finance_staff','driver_earning_accrue') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.s); END IF;
IF r.proname='driver_application_status' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.s); END IF;
END LOOP; END $$;
