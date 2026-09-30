-- =====================================================================
-- Phase 8.4.11–8.4.13 — capture-at-source financials, payment linkage,
-- strict recognition eligibility, controlled backfill, finance review.
-- =====================================================================

-- 1. Authoritative commercial terms per service line -------------------
CREATE TABLE public.service_line_financial_terms (
  service_line text PRIMARY KEY,
  currency text NOT NULL DEFAULT 'KES',
  tax_rate_bps integer NOT NULL DEFAULT 0,
  tax_inclusive boolean NOT NULL DEFAULT true,
  commission_bps integer NOT NULL DEFAULT 0,
  payment_cost_bps integer NOT NULL DEFAULT 0,
  principal_contract boolean NOT NULL DEFAULT false,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slft_service_line_check CHECK (service_line = ANY (ARRAY['ride_hailing','airport','corporate','charter','delivery','rental'])),
  CONSTRAINT slft_tax_bps_check CHECK (tax_rate_bps BETWEEN 0 AND 5000),
  CONSTRAINT slft_commission_bps_check CHECK (commission_bps BETWEEN 0 AND 10000),
  CONSTRAINT slft_payment_bps_check CHECK (payment_cost_bps BETWEEN 0 AND 2000)
);
GRANT SELECT ON public.service_line_financial_terms TO authenticated;
GRANT ALL ON public.service_line_financial_terms TO service_role;
ALTER TABLE public.service_line_financial_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read financial terms" ON public.service_line_financial_terms
  FOR SELECT TO authenticated USING (public.is_commercial_staff() OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "finance writes financial terms" ON public.service_line_financial_terms
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER trg_slft_updated_at BEFORE UPDATE ON public.service_line_financial_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Capture-at-source columns on the originating booking flows -------
ALTER TABLE public.trip_bookings
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS tax_cents bigint,
  ADD COLUMN IF NOT EXISTS commission_bps integer,
  ADD COLUMN IF NOT EXISTS commission_cents bigint,
  ADD COLUMN IF NOT EXISTS partner_entitlement_cents bigint,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS financials_source text,
  ADD COLUMN IF NOT EXISTS financials_captured_at timestamptz;

ALTER TABLE public.charter_bookings
  ADD COLUMN IF NOT EXISTS tax_cents bigint,
  ADD COLUMN IF NOT EXISTS commission_bps integer,
  ADD COLUMN IF NOT EXISTS commission_cents bigint,
  ADD COLUMN IF NOT EXISTS partner_entitlement_cents bigint,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS financials_source text,
  ADD COLUMN IF NOT EXISTS financials_captured_at timestamptz;

-- 3. Payment linkage + finance review on the transaction spine --------
ALTER TABLE public.commercial_transactions
  ADD COLUMN IF NOT EXISTS payment_ref text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS financials_source text,
  ADD COLUMN IF NOT EXISTS financial_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS financial_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS financial_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS financial_review_notes text;

ALTER TABLE public.commercial_transactions
  DROP CONSTRAINT IF EXISTS commercial_transactions_review_check;
ALTER TABLE public.commercial_transactions
  ADD CONSTRAINT commercial_transactions_review_check
  CHECK (financial_review_status = ANY (ARRAY['pending','approved','rejected','not_required']));

CREATE INDEX IF NOT EXISTS commercial_transactions_review_idx
  ON public.commercial_transactions (financial_review_status, created_at DESC);

-- 4. Append-only eligibility check log --------------------------------
CREATE TABLE public.revenue_eligibility_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.commercial_transactions(id) ON DELETE CASCADE,
  transaction_ref text NOT NULL,
  service_line text NOT NULL,
  rule_key text,
  eligible boolean NOT NULL,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  economics_complete boolean NOT NULL DEFAULT false,
  review_status text,
  source text NOT NULL DEFAULT 'manual',
  checked_by uuid,
  checked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.revenue_eligibility_checks TO authenticated;
GRANT ALL ON public.revenue_eligibility_checks TO service_role;
ALTER TABLE public.revenue_eligibility_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read eligibility checks" ON public.revenue_eligibility_checks
  FOR SELECT TO authenticated USING (public.is_commercial_staff() OR public.has_role(auth.uid(),'finance_admin'));
CREATE INDEX revenue_eligibility_checks_tx_idx ON public.revenue_eligibility_checks (transaction_id, checked_at DESC);

CREATE OR REPLACE FUNCTION public.deny_eligibility_check_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'revenue_eligibility_checks is append-only';
END; $$;
CREATE TRIGGER trg_eligibility_checks_immutable
  BEFORE UPDATE OR DELETE ON public.revenue_eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION public.deny_eligibility_check_mutation();

-- 5. Controlled backfill run log -------------------------------------
CREATE TABLE public.commercial_financial_backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by uuid,
  dry_run boolean NOT NULL DEFAULT true,
  attempted integer NOT NULL DEFAULT 0,
  populated integer NOT NULL DEFAULT 0,
  still_incomplete integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.commercial_financial_backfill_runs TO authenticated;
GRANT ALL ON public.commercial_financial_backfill_runs TO service_role;
ALTER TABLE public.commercial_financial_backfill_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read backfill runs" ON public.commercial_financial_backfill_runs
  FOR SELECT TO authenticated USING (public.is_commercial_staff() OR public.has_role(auth.uid(),'finance_admin'));

-- 6. Capture-at-source routines --------------------------------------
CREATE OR REPLACE FUNCTION public.capture_trip_financials(_booking_id uuid, _source text DEFAULT 'derived_from_terms')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b record; t record; line text;
  charge bigint; tax bigint; comm bigint; partner bigint; paycost bigint; tx_id uuid;
BEGIN
  SELECT * INTO b FROM trip_bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;

  line := CASE WHEN b.intent = 'business' OR b.payment_method = 'corporate' THEN 'corporate' ELSE 'ride_hailing' END;
  SELECT * INTO t FROM service_line_financial_terms WHERE service_line = line;
  IF t.service_line IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_terms_for_service_line', 'service_line', line); END IF;
  IF b.total_fare IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_customer_charge'); END IF;

  charge := round(b.total_fare * 100)::bigint;
  tax := CASE WHEN t.tax_inclusive
              THEN round(charge::numeric * t.tax_rate_bps / (10000 + t.tax_rate_bps))::bigint
              ELSE round(charge::numeric * t.tax_rate_bps / 10000)::bigint END;
  comm := round((charge - tax)::numeric * t.commission_bps / 10000)::bigint;
  partner := charge - tax - comm;
  paycost := round(charge::numeric * t.payment_cost_bps / 10000)::bigint;

  UPDATE trip_bookings SET
    currency = t.currency,
    tax_cents = tax,
    commission_bps = t.commission_bps,
    commission_cents = comm,
    partner_entitlement_cents = partner,
    payment_provider = COALESCE(payment_provider, b.payment_method),
    financials_source = _source,
    financials_captured_at = now(),
    updated_at = now()
  WHERE id = _booking_id;

  UPDATE commercial_transactions SET
    service_line = line,
    currency = t.currency,
    customer_charge_cents = charge,
    gross_transaction_value_cents = charge - tax,
    tax_cents = tax,
    partner_entitlement_cents = partner,
    platform_revenue_cents = comm,
    payment_cost_cents = paycost,
    contribution_cents = comm - paycost,
    fulfilled_at = COALESCE(fulfilled_at, b.completed_at),
    fulfilment_source = COALESCE(fulfilment_source, 'trip_bookings.completed_at'),
    provider_ref = COALESCE(provider_ref, b.driver_id::text),
    driver_id = COALESCE(driver_id, b.driver_id),
    customer_user_id = COALESCE(customer_user_id, b.rider_user_id),
    financials_source = _source,
    financial_review_status = CASE WHEN financial_review_status = 'approved' THEN 'pending' ELSE financial_review_status END,
    updated_at = now()
  WHERE booking_table = 'trip_bookings' AND booking_id = _booking_id
  RETURNING id INTO tx_id;

  RETURN jsonb_build_object('ok', true, 'transaction_id', tx_id, 'service_line', line,
    'charge_cents', charge, 'tax_cents', tax, 'commission_cents', comm, 'partner_entitlement_cents', partner);
END; $$;

CREATE OR REPLACE FUNCTION public.capture_charter_financials(_booking_id uuid, _source text DEFAULT 'derived_from_terms')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b record; t record; charge bigint; tax bigint; comm bigint; partner bigint; paycost bigint; tx_id uuid;
BEGIN
  SELECT * INTO b FROM charter_bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found'); END IF;
  SELECT * INTO t FROM service_line_financial_terms WHERE service_line = 'charter';
  IF t.service_line IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_terms_for_service_line'); END IF;
  IF b.amount IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_customer_charge'); END IF;

  charge := round(b.amount * 100)::bigint;
  tax := CASE WHEN t.tax_inclusive
              THEN round(charge::numeric * t.tax_rate_bps / (10000 + t.tax_rate_bps))::bigint
              ELSE round(charge::numeric * t.tax_rate_bps / 10000)::bigint END;
  comm := round((charge - tax)::numeric * t.commission_bps / 10000)::bigint;
  partner := charge - tax - comm;
  paycost := round(charge::numeric * t.payment_cost_bps / 10000)::bigint;

  UPDATE charter_bookings SET
    tax_cents = tax,
    commission_bps = t.commission_bps,
    commission_cents = comm,
    partner_entitlement_cents = partner,
    payment_provider = COALESCE(payment_provider, b.payment_method),
    payment_reference = COALESCE(payment_reference, b.mpesa_receipt, b.checkout_request_id),
    financials_source = _source,
    financials_captured_at = now(),
    updated_at = now()
  WHERE id = _booking_id;

  UPDATE commercial_transactions SET
    currency = COALESCE(b.currency, t.currency),
    customer_charge_cents = charge,
    gross_transaction_value_cents = charge - tax,
    tax_cents = tax,
    partner_entitlement_cents = partner,
    platform_revenue_cents = comm,
    payment_cost_cents = paycost,
    contribution_cents = comm - paycost,
    provider_ref = COALESCE(provider_ref, b.asset_name),
    customer_user_id = COALESCE(customer_user_id, b.user_id),
    customer_ref = customer_ref,
    payment_ref = COALESCE(payment_ref, b.mpesa_receipt, b.checkout_request_id),
    payment_status = COALESCE(payment_status, b.payment_status),
    payment_provider = COALESCE(payment_provider, b.payment_method),
    paid_at = COALESCE(paid_at, b.paid_at),
    financials_source = _source,
    financial_review_status = CASE WHEN financial_review_status = 'approved' THEN 'pending' ELSE financial_review_status END,
    updated_at = now()
  WHERE booking_table = 'charter_bookings' AND booking_id = _booking_id
  RETURNING id INTO tx_id;

  RETURN jsonb_build_object('ok', true, 'transaction_id', tx_id, 'charge_cents', charge,
    'tax_cents', tax, 'commission_cents', comm, 'partner_entitlement_cents', partner);
END; $$;

-- 7. Authoritative payment linkage -----------------------------------
CREATE OR REPLACE FUNCTION public.link_transaction_payment(
  _booking_table text, _booking_id uuid, _payment_ref text, _payment_status text,
  _payment_provider text DEFAULT NULL, _paid_at timestamptz DEFAULT now(),
  _payment_id uuid DEFAULT NULL, _payment_table text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx record; captured boolean;
BEGIN
  IF _booking_table NOT IN ('trip_bookings','charter_bookings') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_booking_table');
  END IF;
  IF _payment_ref IS NULL OR length(trim(_payment_ref)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_reference_required');
  END IF;
  captured := _payment_status IN ('captured','paid','succeeded','settled','completed');

  IF _booking_table = 'trip_bookings' THEN
    UPDATE trip_bookings SET payment_reference = _payment_ref, payment_status = _payment_status,
      payment_provider = COALESCE(_payment_provider, payment_provider),
      paid_at = CASE WHEN captured THEN COALESCE(_paid_at, now()) ELSE paid_at END,
      updated_at = now()
    WHERE id = _booking_id;
  ELSE
    UPDATE charter_bookings SET payment_reference = _payment_ref, payment_status = _payment_status,
      payment_provider = COALESCE(_payment_provider, payment_provider),
      paid_at = CASE WHEN captured THEN COALESCE(_paid_at, now()) ELSE paid_at END,
      updated_at = now()
    WHERE id = _booking_id;
  END IF;

  UPDATE commercial_transactions SET
    payment_ref = _payment_ref,
    payment_status = _payment_status,
    payment_provider = COALESCE(_payment_provider, payment_provider),
    payment_id = COALESCE(_payment_id, payment_id),
    payment_table = COALESCE(_payment_table, payment_table),
    paid_at = CASE WHEN captured THEN COALESCE(_paid_at, now()) ELSE paid_at END,
    status = CASE WHEN captured AND status IN ('booked','orchestrating','fulfilled','invoiced') THEN 'paid' ELSE status END,
    updated_at = now()
  WHERE booking_table = _booking_table AND booking_id = _booking_id
  RETURNING * INTO tx;

  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_transaction_for_booking'); END IF;
  PERFORM public.check_revenue_eligibility(tx.id, 'payment_linkage');
  RETURN jsonb_build_object('ok', true, 'transaction_ref', tx.transaction_ref, 'captured', captured);
END; $$;

-- 8. Strict eligibility pre-check with exact missing-field logging ----
CREATE OR REPLACE FUNCTION public.check_revenue_eligibility(_transaction_id uuid, _source text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx record; r record; missing text[] := '{}'; blockers text[] := '{}';
  complete boolean; eligible boolean; amount bigint; reason text;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  IF tx.currency IS NULL OR length(trim(tx.currency)) = 0 THEN missing := missing || 'currency'; END IF;
  IF tx.customer_charge_cents IS NULL THEN missing := missing || 'customer_charge_cents'; END IF;
  IF tx.gross_transaction_value_cents IS NULL THEN missing := missing || 'gross_transaction_value_cents'; END IF;
  IF tx.tax_cents IS NULL THEN missing := missing || 'tax_cents'; END IF;
  IF tx.platform_revenue_cents IS NULL THEN missing := missing || 'commission_platform_revenue_cents'; END IF;
  IF tx.partner_entitlement_cents IS NULL THEN missing := missing || 'partner_entitlement_cents'; END IF;
  IF tx.provider_ref IS NULL THEN missing := missing || 'provider_ref'; END IF;
  IF tx.payment_ref IS NULL THEN missing := missing || 'payment_ref'; END IF;
  IF tx.payment_status IS NULL THEN missing := missing || 'payment_status'; END IF;
  IF tx.fulfilled_at IS NULL THEN missing := missing || 'fulfilled_at'; END IF;

  complete := array_length(missing, 1) IS NULL;

  SELECT * INTO r FROM revenue_recognition_rules
   WHERE is_active AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
     AND service_line = tx.service_line
   ORDER BY effective_from DESC LIMIT 1;

  IF r.rule_key IS NULL THEN
    blockers := blockers || format('No active recognition rule covers service line "%s".', tx.service_line);
  ELSE
    IF r.approved_by IS NULL THEN blockers := blockers || format('Recognition rule %s has not been signed off by finance.', r.rule_key); END IF;
    IF r.requires_fulfilment AND tx.fulfilled_at IS NULL THEN blockers := blockers || 'Service is not authoritatively fulfilled.'; END IF;
    IF r.requires_payment AND tx.paid_at IS NULL THEN blockers := blockers || 'Rule requires captured payment; no authoritative capture recorded.'; END IF;
    IF r.requires_invoice AND tx.invoice_id IS NULL THEN blockers := blockers || 'Rule requires an issued invoice; none linked.'; END IF;
    IF r.requires_settlement AND tx.settlement_id IS NULL THEN blockers := blockers || 'Rule requires partner settlement; none linked.'; END IF;
    IF r.requires_economics_complete AND NOT complete THEN
      blockers := blockers || format('Economics incomplete — missing %s.', array_to_string(missing, ', '));
    END IF;
    amount := CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END;
    IF amount IS NULL THEN blockers := blockers || 'Recognisable amount is not stated.';
    ELSIF amount < r.min_amount_cents THEN blockers := blockers || 'Recognisable amount is below the rule minimum.'; END IF;
  END IF;

  IF tx.recognised_at IS NOT NULL THEN blockers := blockers || 'Revenue has already been recognised.'; END IF;
  IF tx.cancelled_at IS NOT NULL THEN blockers := blockers || 'Transaction is cancelled.'; END IF;
  IF tx.financial_review_status <> 'approved' THEN
    blockers := blockers || format('Captured financial fields are %s finance review.', tx.financial_review_status);
  END IF;

  eligible := array_length(blockers, 1) IS NULL;
  reason := CASE WHEN eligible THEN format('Eligible under %s.', r.rule_key)
                 ELSE array_to_string(blockers, ' ') END;

  UPDATE commercial_transactions SET
    economics_complete = complete,
    missing_fields = to_jsonb(missing),
    financially_eligible = eligible,
    eligibility_reason = reason,
    provenance = CASE WHEN complete THEN provenance ELSE 'INCOMPLETE' END,
    updated_at = now()
  WHERE id = _transaction_id;

  INSERT INTO revenue_eligibility_checks (transaction_id, transaction_ref, service_line, rule_key,
    eligible, missing_fields, blockers, economics_complete, review_status, source, checked_by)
  VALUES (tx.id, tx.transaction_ref, tx.service_line, r.rule_key, eligible, to_jsonb(missing),
    to_jsonb(blockers), complete, tx.financial_review_status, _source, auth.uid());

  RETURN jsonb_build_object('ok', true, 'transaction_ref', tx.transaction_ref, 'eligible', eligible,
    'economics_complete', complete, 'missing_fields', to_jsonb(missing), 'blockers', to_jsonb(blockers),
    'rule_key', r.rule_key, 'reason', reason);
END; $$;

-- 9. Controlled backfill over existing trips and charters -------------
CREATE OR REPLACE FUNCTION public.backfill_commercial_financials(_dry_run boolean DEFAULT true, _limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx record; res jsonb; run_id uuid;
  attempted integer := 0; populated integer := 0; incomplete integer := 0;
  gaps jsonb := '[]'::jsonb; elig jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Only finance or super admins may run the financial backfill';
  END IF;

  INSERT INTO commercial_financial_backfill_runs (run_by, dry_run) VALUES (auth.uid(), _dry_run)
  RETURNING id INTO run_id;

  FOR tx IN
    SELECT * FROM commercial_transactions
     WHERE recognised_at IS NULL AND booking_id IS NOT NULL
       AND (NOT economics_complete OR payment_ref IS NULL)
     ORDER BY created_at LIMIT _limit
  LOOP
    attempted := attempted + 1;
    IF NOT _dry_run THEN
      IF tx.booking_table = 'trip_bookings' THEN
        res := public.capture_trip_financials(tx.booking_id, 'backfill_derived_from_terms');
      ELSIF tx.booking_table = 'charter_bookings' THEN
        res := public.capture_charter_financials(tx.booking_id, 'backfill_derived_from_terms');
      ELSE
        res := jsonb_build_object('ok', false, 'error', 'unsupported_booking_table');
      END IF;
      IF (res->>'ok')::boolean THEN populated := populated + 1; END IF;
    END IF;

    elig := public.check_revenue_eligibility(tx.id, 'backfill');
    IF NOT (elig->>'economics_complete')::boolean THEN
      incomplete := incomplete + 1;
      gaps := gaps || jsonb_build_object(
        'transaction_ref', tx.transaction_ref,
        'service_line', tx.service_line,
        'booking_table', tx.booking_table,
        'missing_fields', elig->'missing_fields',
        'blockers', elig->'blockers');
    END IF;
  END LOOP;

  UPDATE commercial_financial_backfill_runs SET
    attempted = attempted, populated = populated, still_incomplete = incomplete,
    report = jsonb_build_object('gaps', gaps), finished_at = now()
  WHERE id = run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', run_id, 'dry_run', _dry_run,
    'attempted', attempted, 'populated', populated, 'still_incomplete', incomplete, 'gaps', gaps);
END; $$;

-- 10. Finance review of captured figures ------------------------------
CREATE OR REPLACE FUNCTION public.review_transaction_financials(
  _transaction_id uuid, _decision text, _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tx record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Only finance or super admins may approve captured financial fields';
  END IF;
  IF _decision NOT IN ('approved','rejected','pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_decision');
  END IF;

  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;
  IF _decision = 'approved' AND NOT tx.economics_complete THEN
    RETURN jsonb_build_object('ok', false, 'error', 'economics_incomplete', 'missing_fields', tx.missing_fields);
  END IF;

  UPDATE commercial_transactions SET
    financial_review_status = _decision,
    financial_reviewed_by = auth.uid(),
    financial_reviewed_at = now(),
    financial_review_notes = _notes,
    updated_at = now()
  WHERE id = _transaction_id;

  RETURN public.check_revenue_eligibility(_transaction_id, 'finance_review') || jsonb_build_object('decision', _decision);
END; $$;

CREATE OR REPLACE FUNCTION public.approve_recognition_rule(_rule_key text, _approve boolean DEFAULT true, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Only finance or super admins may sign off recognition rules';
  END IF;
  UPDATE revenue_recognition_rules SET
    approved_by = CASE WHEN _approve THEN auth.uid() ELSE NULL END,
    approved_at = CASE WHEN _approve THEN now() ELSE NULL END,
    notes = COALESCE(_notes, notes), updated_at = now()
  WHERE rule_key = _rule_key RETURNING * INTO r;
  IF r.rule_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'rule_not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'rule_key', r.rule_key, 'approved', _approve);
END; $$;

GRANT EXECUTE ON FUNCTION public.capture_trip_financials(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_charter_financials(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_transaction_payment(text, uuid, text, text, text, timestamptz, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_revenue_eligibility(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_commercial_financials(boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_transaction_financials(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_recognition_rule(text, boolean, text) TO authenticated, service_role;