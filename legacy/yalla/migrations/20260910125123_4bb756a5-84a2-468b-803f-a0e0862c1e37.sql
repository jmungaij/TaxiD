-- =====================================================================
-- PROVIDER SETTLEMENT SPINE
-- 15% platform commission retained at the Yalla paybill, 85% disbursed to
-- the mobility service provider's M-Pesa number over the SAME Daraja B2C
-- rail already used for carrier payouts. No simulated money movement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Commission / settlement configuration (single authoritative row)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_settlement_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  commission_bps integer NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 10000),
  platform_paybill text NOT NULL DEFAULT '4148095',
  min_payout_cents bigint NOT NULL DEFAULT 1000 CHECK (min_payout_cents >= 1000),
  currency text NOT NULL DEFAULT 'KES',
  auto_prepare boolean NOT NULL DEFAULT true,
  requires_finance_approval boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_settlement_settings TO authenticated;
GRANT ALL ON public.provider_settlement_settings TO service_role;
ALTER TABLE public.provider_settlement_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement settings readable by signed in" ON public.provider_settlement_settings;
CREATE POLICY "settlement settings readable by signed in"
  ON public.provider_settlement_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service role manages settlement settings" ON public.provider_settlement_settings;
CREATE POLICY "service role manages settlement settings"
  ON public.provider_settlement_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.provider_settlement_settings (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Operator M-Pesa payout account (the "mpesa account")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id uuid NOT NULL,
  msisdn text NOT NULL,
  account_name text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  verification_state text NOT NULL DEFAULT 'IN_REVIEW'
    CHECK (verification_state IN ('IN_REVIEW','VERIFIED','REJECTED')),
  verification_note text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_user_id, msisdn)
);

CREATE INDEX IF NOT EXISTS provider_payout_accounts_owner_idx
  ON public.provider_payout_accounts (provider_user_id, verification_state);

GRANT SELECT ON public.provider_payout_accounts TO authenticated;
GRANT ALL ON public.provider_payout_accounts TO service_role;
ALTER TABLE public.provider_payout_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator reads own payout accounts" ON public.provider_payout_accounts;
CREATE POLICY "operator reads own payout accounts"
  ON public.provider_payout_accounts FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid() OR public.capacity_can_approve(auth.uid()));

DROP POLICY IF EXISTS "service role manages payout accounts" ON public.provider_payout_accounts;
CREATE POLICY "service role manages payout accounts"
  ON public.provider_payout_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._provider_settlement_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_payout_accounts_touch ON public.provider_payout_accounts;
CREATE TRIGGER provider_payout_accounts_touch BEFORE UPDATE ON public.provider_payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_touch();

DROP TRIGGER IF EXISTS provider_settlement_settings_touch ON public.provider_settlement_settings;
CREATE TRIGGER provider_settlement_settings_touch BEFORE UPDATE ON public.provider_settlement_settings
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_touch();

-- ---------------------------------------------------------------------
-- 3. Earnings ledger: one row per delivered booking, 15/85 split frozen
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id uuid NOT NULL,
  booking_id uuid NOT NULL UNIQUE REFERENCES public.provider_bookings(id) ON DELETE CASCADE,
  booking_reference text NOT NULL,
  gross_cents bigint NOT NULL CHECK (gross_cents >= 0),
  commission_bps integer NOT NULL,
  commission_cents bigint NOT NULL CHECK (commission_cents >= 0),
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  currency text NOT NULL DEFAULT 'KES',
  state text NOT NULL DEFAULT 'ACCRUED'
    CHECK (state IN ('ACCRUED','PAYABLE','RESERVED','PAID','CANCELLED')),
  customer_paid_at timestamptz,
  payout_request_id uuid,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_earnings_owner_state_idx
  ON public.provider_earnings (provider_user_id, state);

GRANT SELECT ON public.provider_earnings TO authenticated;
GRANT ALL ON public.provider_earnings TO service_role;
ALTER TABLE public.provider_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator reads own earnings" ON public.provider_earnings;
CREATE POLICY "operator reads own earnings"
  ON public.provider_earnings FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid() OR public.capacity_can_approve(auth.uid()));

DROP POLICY IF EXISTS "service role manages earnings" ON public.provider_earnings;
CREATE POLICY "service role manages earnings"
  ON public.provider_earnings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS provider_earnings_touch ON public.provider_earnings;
CREATE TRIGGER provider_earnings_touch BEFORE UPDATE ON public.provider_earnings
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_touch();

-- Financial identity of an accrued earning is immutable.
CREATE OR REPLACE FUNCTION public._provider_earning_identity_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.gross_cents <> OLD.gross_cents OR NEW.net_cents <> OLD.net_cents
     OR NEW.commission_cents <> OLD.commission_cents
     OR NEW.provider_user_id <> OLD.provider_user_id
     OR NEW.booking_id <> OLD.booking_id THEN
    RAISE EXCEPTION 'provider earning amounts are immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_earnings_identity ON public.provider_earnings;
CREATE TRIGGER provider_earnings_identity BEFORE UPDATE ON public.provider_earnings
  FOR EACH ROW EXECUTE FUNCTION public._provider_earning_identity_immutable();

-- ---------------------------------------------------------------------
-- 4. Payout requests (finance-approved batches of payable earnings)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_reference text NOT NULL UNIQUE,
  provider_user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.provider_payout_accounts(id),
  msisdn text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  earnings_count integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (state IN ('PENDING_APPROVAL','APPROVED','PROCESSING','PAID','FAILED','CANCELLED')),
  approved_by uuid,
  approved_at timestamptz,
  decision_note text,
  disbursement_id uuid,
  provider_transaction_id text,
  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_payout_requests_one_open
  ON public.provider_payout_requests (provider_user_id)
  WHERE state IN ('PENDING_APPROVAL','APPROVED','PROCESSING');

GRANT SELECT ON public.provider_payout_requests TO authenticated;
GRANT ALL ON public.provider_payout_requests TO service_role;
ALTER TABLE public.provider_payout_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operator reads own payout requests" ON public.provider_payout_requests;
CREATE POLICY "operator reads own payout requests"
  ON public.provider_payout_requests FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid() OR public.capacity_can_approve(auth.uid()));

DROP POLICY IF EXISTS "service role manages payout requests" ON public.provider_payout_requests;
CREATE POLICY "service role manages payout requests"
  ON public.provider_payout_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS provider_payout_requests_touch ON public.provider_payout_requests;
CREATE TRIGGER provider_payout_requests_touch BEFORE UPDATE ON public.provider_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public._provider_settlement_touch();

CREATE TABLE IF NOT EXISTS public.provider_payout_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.provider_payout_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  state_from text,
  state_to text,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_payout_events TO authenticated;
GRANT ALL ON public.provider_payout_events TO service_role;
ALTER TABLE public.provider_payout_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payout events visible with request" ON public.provider_payout_events;
CREATE POLICY "payout events visible with request"
  ON public.provider_payout_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.provider_payout_requests r
                  WHERE r.id = request_id
                    AND (r.provider_user_id = auth.uid() OR public.capacity_can_approve(auth.uid()))));

DROP POLICY IF EXISTS "service role manages payout events" ON public.provider_payout_events;
CREATE POLICY "service role manages payout events"
  ON public.provider_payout_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._provider_payout_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'provider_payout_events is append-only';
END $$;

DROP TRIGGER IF EXISTS provider_payout_events_append_only ON public.provider_payout_events;
CREATE TRIGGER provider_payout_events_append_only
  BEFORE UPDATE OR DELETE ON public.provider_payout_events
  FOR EACH ROW EXECUTE FUNCTION public._provider_payout_events_append_only();

-- ---------------------------------------------------------------------
-- 5. Extend the single payout rail to provider beneficiaries
-- ---------------------------------------------------------------------
ALTER TABLE public.payout_disbursements
  DROP CONSTRAINT IF EXISTS payout_disbursements_beneficiary_type_check;
ALTER TABLE public.payout_disbursements
  ADD CONSTRAINT payout_disbursements_beneficiary_type_check
  CHECK (beneficiary_type IN ('DRIVER','FLEET_OWNER','PROVIDER'));

ALTER TABLE public.payout_disbursements
  DROP CONSTRAINT IF EXISTS payout_disbursements_source_kind_check;
ALTER TABLE public.payout_disbursements
  ADD CONSTRAINT payout_disbursements_source_kind_check
  CHECK (source_kind IN ('carrier_withdrawal','driver_payout','provider_payout'));

DROP POLICY IF EXISTS "operator reads own disbursements" ON public.payout_disbursements;
CREATE POLICY "operator reads own disbursements"
  ON public.payout_disbursements FOR SELECT TO authenticated
  USING (source_kind = 'provider_payout' AND beneficiary_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. Accrual: delivered booking -> earning with the 15/85 split
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._provider_booking_accrue_earning()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bps integer;
  v_comm bigint;
BEGIN
  IF NEW.status <> 'DELIVERED' OR NEW.is_test THEN RETURN NEW; END IF;
  IF NEW.amount_cents IS NULL OR NEW.amount_cents <= 0 THEN RETURN NEW; END IF;

  SELECT commission_bps INTO v_bps FROM public.provider_settlement_settings WHERE id;
  v_bps := coalesce(v_bps, 1500);
  v_comm := round(NEW.amount_cents::numeric * v_bps / 10000);

  INSERT INTO public.provider_earnings
    (provider_user_id, booking_id, booking_reference, gross_cents, commission_bps,
     commission_cents, net_cents, currency, state)
  VALUES (NEW.provider_user_id, NEW.id, NEW.booking_reference, NEW.amount_cents, v_bps,
          v_comm, NEW.amount_cents - v_comm, coalesce(NEW.currency,'KES'), 'ACCRUED')
  ON CONFLICT (booking_id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS provider_booking_accrue_earning ON public.provider_bookings;
CREATE TRIGGER provider_booking_accrue_earning
  AFTER INSERT OR UPDATE OF status ON public.provider_bookings
  FOR EACH ROW EXECUTE FUNCTION public._provider_booking_accrue_earning();

-- ---------------------------------------------------------------------
-- 7. Earnings become payable ONLY once the customer's invoice is paid
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_earnings_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_accrued integer := 0;
  v_payable integer := 0;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.capacity_can_approve(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  -- Backfill any delivered booking that predates the accrual trigger.
  WITH ins AS (
    INSERT INTO public.provider_earnings
      (provider_user_id, booking_id, booking_reference, gross_cents, commission_bps,
       commission_cents, net_cents, currency, state)
    SELECT b.provider_user_id, b.id, b.booking_reference, b.amount_cents, s.commission_bps,
           round(b.amount_cents::numeric * s.commission_bps / 10000),
           b.amount_cents - round(b.amount_cents::numeric * s.commission_bps / 10000),
           coalesce(b.currency,'KES'), 'ACCRUED'
      FROM public.provider_bookings b
      CROSS JOIN public.provider_settlement_settings s
     WHERE b.status = 'DELIVERED' AND b.is_test = false AND b.amount_cents > 0
    ON CONFLICT (booking_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_accrued FROM ins;

  -- Customer money actually collected: linked tax invoice fully paid.
  WITH upd AS (
    UPDATE public.provider_earnings e
       SET state = 'PAYABLE',
           customer_paid_at = coalesce(e.customer_paid_at, now())
     WHERE e.state = 'ACCRUED'
       AND EXISTS (
         SELECT 1 FROM public.provider_bookings b
         JOIN public.tax_invoices i ON i.id = b.invoice_id
          WHERE b.id = e.booking_id
            AND i.status = 'paid'
            AND i.paid_cents >= i.total_cents)
    RETURNING 1)
  SELECT count(*) INTO v_payable FROM upd;

  RETURN jsonb_build_object('ok', true, 'accrued', v_accrued, 'made_payable', v_payable);
END $$;

REVOKE ALL ON FUNCTION public.provider_earnings_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_earnings_sync() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Operator saves the M-Pesa number; staff verify it
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_payout_account_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_raw text := btrim(coalesce(p->>'msisdn',''));
  v_digits text;
  v_msisdn text;
  v_name text := btrim(coalesce(p->>'account_name',''));
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'ACCOUNT_NAME_REQUIRED'; END IF;

  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_msisdn := CASE
    WHEN v_digits ~ '^254[17][0-9]{8}$' THEN v_digits
    WHEN v_digits ~ '^0[17][0-9]{8}$' THEN '254' || substr(v_digits, 2)
    WHEN v_digits ~ '^[17][0-9]{8}$' THEN '254' || v_digits
    ELSE NULL END;
  IF v_msisdn IS NULL THEN RAISE EXCEPTION 'INVALID_MPESA_NUMBER'; END IF;

  INSERT INTO public.provider_payout_accounts (provider_user_id, msisdn, account_name, verification_state)
  VALUES (v_uid, v_msisdn, v_name, 'IN_REVIEW')
  ON CONFLICT (provider_user_id, msisdn) DO UPDATE
     SET account_name = excluded.account_name,
         verification_state = CASE WHEN public.provider_payout_accounts.verification_state = 'VERIFIED'
                                   THEN 'VERIFIED' ELSE 'IN_REVIEW' END
  RETURNING id INTO v_id;

  UPDATE public.provider_payout_accounts
     SET is_default = (id = v_id)
   WHERE provider_user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'msisdn', v_msisdn);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_account_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_account_save(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_payout_account_decide(_account_id uuid, _state text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.capacity_can_approve(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF _state NOT IN ('VERIFIED','REJECTED','IN_REVIEW') THEN RAISE EXCEPTION 'UNKNOWN_STATE'; END IF;

  UPDATE public.provider_payout_accounts
     SET verification_state = _state,
         verification_note = _note,
         verified_by = CASE WHEN _state = 'VERIFIED' THEN v_uid ELSE NULL END,
         verified_at = CASE WHEN _state = 'VERIFIED' THEN now() ELSE NULL END
   WHERE id = _account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_ACCOUNT'; END IF;

  RETURN jsonb_build_object('ok', true, 'state', _state);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_account_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_account_decide(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Prepare payouts: reserve payable earnings into one request per operator
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_payout_prepare()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_set public.provider_settlement_settings;
  r record;
  v_id uuid;
  v_ref text;
  v_count integer;
  v_created integer := 0;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.capacity_can_approve(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  FOR r IN
    SELECT e.provider_user_id,
           sum(e.net_cents) AS payable_cents,
           count(*) AS n,
           min(e.currency) AS currency,
           a.id AS account_id, a.msisdn
      FROM public.provider_earnings e
      JOIN public.provider_payout_accounts a
        ON a.provider_user_id = e.provider_user_id
       AND a.verification_state = 'VERIFIED'
       AND a.is_default
     WHERE e.state = 'PAYABLE'
       AND NOT EXISTS (SELECT 1 FROM public.provider_payout_requests q
                        WHERE q.provider_user_id = e.provider_user_id
                          AND q.state IN ('PENDING_APPROVAL','APPROVED','PROCESSING'))
     GROUP BY e.provider_user_id, a.id, a.msisdn
    HAVING sum(e.net_cents) >= v_set.min_payout_cents
  LOOP
    v_ref := 'POP-' || to_char(now(),'YYYYMM') || '-' ||
             upper(substr(md5(r.provider_user_id::text || now()::text), 1, 8));

    INSERT INTO public.provider_payout_requests
      (request_reference, provider_user_id, account_id, msisdn, amount_cents,
       currency, earnings_count, state)
    VALUES (v_ref, r.provider_user_id, r.account_id, r.msisdn, r.payable_cents,
            coalesce(r.currency,'KES'), r.n,
            CASE WHEN v_set.requires_finance_approval THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END)
    RETURNING id INTO v_id;

    UPDATE public.provider_earnings
       SET state = 'RESERVED', payout_request_id = v_id
     WHERE provider_user_id = r.provider_user_id AND state = 'PAYABLE';

    SELECT count(*) INTO v_count FROM public.provider_earnings WHERE payout_request_id = v_id;

    INSERT INTO public.provider_payout_events (request_id, event_type, state_to, detail)
    VALUES (v_id, 'PREPARED',
            CASE WHEN v_set.requires_finance_approval THEN 'PENDING_APPROVAL' ELSE 'APPROVED' END,
            jsonb_build_object('earnings', v_count, 'amount_cents', r.payable_cents));

    v_created := v_created + 1;
    v_out := v_out || jsonb_build_object('request_id', v_id, 'reference', v_ref,
                                         'amount_cents', r.payable_cents);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'created', v_created, 'requests', v_out);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_prepare() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_prepare() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 10. Finance decision
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_payout_decide(_request_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_payout_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.capacity_can_approve(v_uid)
          OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_REQUEST'; END IF;
  IF v_row.state <> 'PENDING_APPROVAL' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state);
  END IF;

  IF _approve THEN
    UPDATE public.provider_payout_requests
       SET state='APPROVED', approved_by=v_uid, approved_at=now(), decision_note=_note
     WHERE id = _request_id;
    INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, note, actor_user_id)
    VALUES (_request_id, 'APPROVED', 'PENDING_APPROVAL', 'APPROVED', _note, v_uid);
    RETURN jsonb_build_object('ok', true, 'state','APPROVED');
  END IF;

  UPDATE public.provider_payout_requests
     SET state='CANCELLED', decision_note=_note, approved_by=v_uid, approved_at=now()
   WHERE id = _request_id;
  UPDATE public.provider_earnings
     SET state='PAYABLE', payout_request_id=NULL
   WHERE payout_request_id = _request_id AND state='RESERVED';
  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, note, actor_user_id)
  VALUES (_request_id, 'CANCELLED', 'PENDING_APPROVAL', 'CANCELLED', _note, v_uid);

  RETURN jsonb_build_object('ok', true, 'state','CANCELLED');
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_decide(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 11. Claim: APPROVED request -> DRAFT disbursement on the M-Pesa rail
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_payout_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src uuid := (p->>'request_id')::uuid;
  v_row public.provider_payout_requests;
  v_acct public.provider_payout_accounts;
  v_existing public.payout_disbursements;
  v_key text;
  v_ref text;
  v_id uuid;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = v_src FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_REQUEST'); END IF;

  v_key := 'payout:provider_payout:' || v_src::text;
  SELECT * INTO v_existing FROM public.payout_disbursements WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'disbursement_id', v_existing.id,
      'reference', v_existing.disbursement_reference, 'state', v_existing.state,
      'msisdn', v_existing.msisdn, 'amount', v_existing.amount);
  END IF;

  IF v_row.state <> 'APPROVED' THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_APPROVED', 'state', v_row.state);
  END IF;

  SELECT * INTO v_acct FROM public.provider_payout_accounts
   WHERE id = v_row.account_id AND provider_user_id = v_row.provider_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_FOUND'); END IF;
  IF v_acct.verification_state <> 'VERIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_VERIFIED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.provider_earnings
                  WHERE payout_request_id = v_src AND state = 'RESERVED') THEN
    RETURN jsonb_build_object('error', true, 'code','NO_RESERVED_EARNINGS');
  END IF;

  v_ref := 'PYT-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key), 1, 8));

  INSERT INTO public.payout_disbursements
    (disbursement_reference, beneficiary_type, beneficiary_id, source_kind, source_id,
     destination_snapshot, msisdn, amount, currency, state, idempotency_key, initiated_by)
  VALUES (v_ref, 'PROVIDER', v_row.provider_user_id, 'provider_payout', v_src,
     jsonb_build_object('account_id', v_acct.id, 'type','MPESA',
                        'account_name', v_acct.account_name,
                        'verification_state', v_acct.verification_state,
                        'verified_at', v_acct.verified_at),
     v_acct.msisdn, round(v_row.amount_cents::numeric / 100, 2), coalesce(v_row.currency,'KES'),
     'DRAFT', v_key, auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.provider_payout_requests SET disbursement_id = v_id WHERE id = v_src;

  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, detail, actor_user_id)
  VALUES (v_src, 'PAYOUT_CREATED', v_row.state, v_row.state,
          jsonb_build_object('disbursement_id', v_id, 'reference', v_ref), auth.uid());

  RETURN jsonb_build_object('ok', true, 'disbursement_id', v_id, 'reference', v_ref,
    'state','DRAFT', 'msisdn', v_acct.msisdn,
    'amount', round(v_row.amount_cents::numeric / 100, 2),
    'request_reference', v_row.request_reference);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_claim(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_claim(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. Provider result branch on the shared apply-result path
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payout_disbursement_apply_result(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv text := p->>'conversation_id';
  v_id uuid := nullif(p->>'disbursement_id','')::uuid;
  v_row public.payout_disbursements;
  v_code text := p->>'result_code';
  v_txn text := nullif(p->>'provider_transaction_id','');
  v_amount numeric := nullif(p->>'amount','')::numeric;
  v_hash text;
  v_entry uuid;
  v_recon text;
  v_evidence jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.payout_disbursements WHERE id = v_id FOR UPDATE;
  ELSE
    SELECT * INTO v_row FROM public.payout_disbursements
     WHERE provider_conversation_id = v_conv FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNMATCHED_RESULT'); END IF;

  v_hash := encode(sha256(convert_to(coalesce(p->'payload','{}'::jsonb)::text,'utf8')),'hex');

  INSERT INTO public.payout_provider_events
    (disbursement_id, event_type, provider_conversation_id, provider_transaction_id,
     result_code, result_desc, amount, recipient, transacted_at, payload, payload_hash)
  VALUES (v_row.id, 'RESULT', v_conv, v_txn, v_code, p->>'result_desc', v_amount,
          p->>'recipient', nullif(p->>'transacted_at','')::timestamptz,
          coalesce(p->'payload','{}'::jsonb), v_hash)
  ON CONFLICT (provider, payload_hash) DO NOTHING;

  IF v_row.state IN ('SUCCESS','FAILED','REVERSED') THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state,
      'reconciliation_state', v_row.reconciliation_state, 'ledger_entry_id', v_row.ledger_entry_id);
  END IF;

  -- ---------------- failure ----------------
  IF v_code IS DISTINCT FROM '0' THEN
    UPDATE public.payout_disbursements
       SET state='FAILED', result_code=v_code, result_desc=p->>'result_desc',
           failure_reason=coalesce(p->>'result_desc','provider failure'),
           completed_at=now(), reconciliation_state='PENDING'
     WHERE id = v_row.id;

    IF v_row.source_kind = 'provider_payout' THEN
      UPDATE public.provider_payout_requests
         SET state='FAILED', failure_reason=coalesce(p->>'result_desc','provider failure')
       WHERE id = v_row.source_id;
      UPDATE public.provider_earnings
         SET state='PAYABLE', payout_request_id=NULL
       WHERE payout_request_id = v_row.source_id AND state='RESERVED';
      INSERT INTO public.provider_payout_events (request_id, event_type, state_to, detail)
      VALUES (v_row.source_id, 'PAYOUT_FAILED', 'FAILED',
              jsonb_build_object('result_code', v_code, 'result_desc', p->>'result_desc'));
    ELSE
      UPDATE public.carrier_withdrawal_requests
         SET state='FAILED', failure_reason=coalesce(p->>'result_desc','provider failure')
       WHERE id = v_row.source_id AND state IN ('APPROVED','EXECUTED');
      INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
      SELECT v_row.source_id, 'PAYOUT_FAILED', 'APPROVED', 'FAILED', NULL,
             jsonb_build_object('result_code', v_code, 'result_desc', p->>'result_desc')
       WHERE EXISTS (SELECT 1 FROM public.carrier_withdrawal_requests WHERE id = v_row.source_id);
    END IF;

    RETURN jsonb_build_object('ok', true, 'state','FAILED', 'result_code', v_code);
  END IF;

  IF v_txn IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','INCOMPLETE_EVIDENCE',
      'detail','provider transaction reference missing; payout not marked executed');
  END IF;

  v_recon := CASE WHEN v_amount IS NULL THEN 'EXCEPTION'
                  WHEN v_amount = v_row.amount THEN 'MATCHED'
                  ELSE 'EXCEPTION' END;

  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'provider', v_row.provider,
    'provider_transaction_id', v_txn,
    'conversation_id', v_conv,
    'result_code', v_code,
    'result_desc', p->>'result_desc',
    'amount', v_amount,
    'recipient', p->>'recipient',
    'transacted_at', p->>'transacted_at',
    'disbursement_id', v_row.id,
    'disbursement_reference', v_row.disbursement_reference,
    'payload_hash', v_hash));

  -- ---------------- success ----------------
  IF v_row.source_kind = 'provider_payout' THEN
    UPDATE public.payout_disbursements
       SET state='SUCCESS', result_code=v_code, result_desc=p->>'result_desc',
           provider_transaction_id=v_txn, payment_evidence=v_evidence,
           completed_at=now(),
           settlement_reference='STL-' || v_row.disbursement_reference,
           reconciliation_state=v_recon,
           reconciliation_detail=jsonb_build_object(
             'payout_amount', v_row.amount, 'provider_amount', v_amount)
     WHERE id = v_row.id;

    UPDATE public.provider_payout_requests
       SET state='PAID', paid_at=now(), provider_transaction_id=v_txn
     WHERE id = v_row.source_id;

    UPDATE public.provider_earnings
       SET state='PAID', paid_at=now()
     WHERE payout_request_id = v_row.source_id AND state='RESERVED';

    INSERT INTO public.provider_payout_events (request_id, event_type, state_to, detail)
    VALUES (v_row.source_id, 'PAID', 'PAID',
            jsonb_build_object('payment_evidence', v_evidence, 'reconciliation_state', v_recon));

    RETURN jsonb_build_object('ok', true, 'state','SUCCESS', 'provider_transaction_id', v_txn,
      'reconciliation_state', v_recon,
      'settlement_reference', 'STL-' || v_row.disbursement_reference);
  END IF;

  v_entry := public.partner_ledger_post(
    v_row.partner_id, 'settlement_payout'::partner_ledger_kind, 'DEBIT'::ledger_direction,
    v_row.amount,
    'Fleet Owner payout ' || v_row.disbursement_reference || ' (M-Pesa ' || v_txn || ')',
    NULL, NULL, v_row.disbursement_reference,
    'payout_disbursement:' || v_row.id::text, true);

  UPDATE public.payout_disbursements
     SET state='SUCCESS', result_code=v_code, result_desc=p->>'result_desc',
         provider_transaction_id=v_txn, payment_evidence=v_evidence,
         ledger_entry_id=v_entry, completed_at=now(),
         settlement_reference='STL-' || v_row.disbursement_reference,
         reconciliation_state=v_recon,
         reconciliation_detail=jsonb_build_object(
           'payable_amount', v_row.amount, 'payout_amount', v_row.amount,
           'provider_amount', v_amount, 'settlement_amount', v_row.amount)
   WHERE id = v_row.id;

  UPDATE public.carrier_withdrawal_requests
     SET state='EXECUTED', executed_at=now(), payment_evidence=v_evidence
   WHERE id = v_row.source_id;

  INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
  SELECT v_row.source_id, 'EXECUTED', 'APPROVED', 'EXECUTED', NULL,
         jsonb_build_object('payment_evidence', v_evidence, 'ledger_entry_id', v_entry,
                            'reconciliation_state', v_recon)
   WHERE EXISTS (SELECT 1 FROM public.carrier_withdrawal_requests WHERE id = v_row.source_id);

  RETURN jsonb_build_object('ok', true, 'state','SUCCESS', 'ledger_entry_id', v_entry,
    'reconciliation_state', v_recon, 'provider_transaction_id', v_txn,
    'settlement_reference', 'STL-' || v_row.disbursement_reference);
END $$;

REVOKE ALL ON FUNCTION public.payout_disbursement_apply_result(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_apply_result(jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 13. Read models
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_settlement_self()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  RETURN jsonb_build_object(
    'commission_bps', v_set.commission_bps,
    'min_payout_cents', v_set.min_payout_cents,
    'requires_finance_approval', v_set.requires_finance_approval,
    'account', (SELECT jsonb_build_object('id', a.id, 'msisdn', a.msisdn,
                  'account_name', a.account_name, 'verification_state', a.verification_state,
                  'verification_note', a.verification_note, 'verified_at', a.verified_at)
                  FROM public.provider_payout_accounts a
                 WHERE a.provider_user_id = v_uid AND a.is_default LIMIT 1),
    'totals', jsonb_build_object(
      'accrued_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings
                         WHERE provider_user_id = v_uid AND state='ACCRUED'),
      'payable_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings
                         WHERE provider_user_id = v_uid AND state='PAYABLE'),
      'reserved_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings
                          WHERE provider_user_id = v_uid AND state='RESERVED'),
      'paid_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings
                      WHERE provider_user_id = v_uid AND state='PAID'),
      'commission_cents', (SELECT coalesce(sum(commission_cents),0) FROM public.provider_earnings
                            WHERE provider_user_id = v_uid AND state <> 'CANCELLED')),
    'earnings', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'booking_reference', e.booking_reference, 'gross_cents', e.gross_cents,
        'commission_cents', e.commission_cents, 'net_cents', e.net_cents, 'currency', e.currency,
        'state', e.state, 'customer_paid_at', e.customer_paid_at, 'paid_at', e.paid_at,
        'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
        FROM public.provider_earnings e WHERE e.provider_user_id = v_uid),
    'payouts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'reference', q.request_reference, 'amount_cents', q.amount_cents,
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
      'platform_paybill', v_set.platform_paybill, 'min_payout_cents', v_set.min_payout_cents,
      'requires_finance_approval', v_set.requires_finance_approval,
      'auto_prepare', v_set.auto_prepare),
    'summary', jsonb_build_object(
      'commission_cents', (SELECT coalesce(sum(commission_cents),0) FROM public.provider_earnings
                            WHERE state <> 'CANCELLED'),
      'accrued_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings WHERE state='ACCRUED'),
      'payable_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings WHERE state='PAYABLE'),
      'reserved_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings WHERE state='RESERVED'),
      'paid_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings WHERE state='PAID'),
      'awaiting_approval', (SELECT count(*) FROM public.provider_payout_requests WHERE state='PENDING_APPROVAL'),
      'accounts_in_review', (SELECT count(*) FROM public.provider_payout_accounts WHERE verification_state='IN_REVIEW')),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'provider_user_id', a.provider_user_id, 'msisdn', a.msisdn,
        'account_name', a.account_name, 'verification_state', a.verification_state,
        'verification_note', a.verification_note, 'verified_at', a.verified_at,
        'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
        FROM public.provider_payout_accounts a),
    'payouts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'reference', q.request_reference, 'provider_user_id', q.provider_user_id,
        'msisdn', q.msisdn, 'amount_cents', q.amount_cents, 'currency', q.currency,
        'state', q.state, 'earnings_count', q.earnings_count,
        'provider_transaction_id', q.provider_transaction_id, 'paid_at', q.paid_at,
        'failure_reason', q.failure_reason, 'approved_at', q.approved_at,
        'created_at', q.created_at) ORDER BY q.created_at DESC), '[]'::jsonb)
        FROM public.provider_payout_requests q),
    'earnings', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'provider_user_id', e.provider_user_id, 'booking_reference', e.booking_reference,
        'gross_cents', e.gross_cents, 'commission_cents', e.commission_cents,
        'net_cents', e.net_cents, 'state', e.state, 'currency', e.currency,
        'customer_paid_at', e.customer_paid_at, 'created_at', e.created_at)
        ORDER BY e.created_at DESC), '[]'::jsonb)
        FROM public.provider_earnings e));
END $$;

REVOKE ALL ON FUNCTION public.provider_settlement_console() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_settlement_console() TO authenticated, service_role;