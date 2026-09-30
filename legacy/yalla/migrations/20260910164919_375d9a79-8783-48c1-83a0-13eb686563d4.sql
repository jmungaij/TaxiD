-- ============ 1. Operator invoice register ============
CREATE TABLE IF NOT EXISTS public.provider_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE,
  provider_user_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  lines_count integer NOT NULL DEFAULT 0,
  gross_cents bigint NOT NULL DEFAULT 0,
  commission_bps integer NOT NULL DEFAULT 1500,
  commission_cents bigint NOT NULL DEFAULT 0,
  net_cents bigint NOT NULL DEFAULT 0,
  withdrawal_fee_bps integer NOT NULL DEFAULT 500,
  estimated_fee_cents bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','QUERIED')),
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_invoices_one_draft
  ON public.provider_invoices (provider_user_id, period_start, period_end)
  WHERE state = 'DRAFT';
CREATE INDEX IF NOT EXISTS provider_invoices_state_idx
  ON public.provider_invoices (state, created_at DESC);

CREATE TABLE IF NOT EXISTS public.provider_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.provider_invoices(id) ON DELETE CASCADE,
  earning_id uuid NOT NULL,
  booking_reference text NOT NULL,
  service_date date,
  gross_cents bigint NOT NULL,
  commission_cents bigint NOT NULL,
  net_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, earning_id)
);
CREATE INDEX IF NOT EXISTS provider_invoice_lines_invoice_idx
  ON public.provider_invoice_lines (invoice_id);

GRANT SELECT ON public.provider_invoices TO authenticated;
GRANT ALL ON public.provider_invoices TO service_role;
GRANT SELECT ON public.provider_invoice_lines TO authenticated;
GRANT ALL ON public.provider_invoice_lines TO service_role;

ALTER TABLE public.provider_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_invoices_read ON public.provider_invoices;
CREATE POLICY provider_invoices_read ON public.provider_invoices
FOR SELECT TO authenticated
USING (provider_user_id = auth.uid()
       OR public.has_staff_permission('staff.finance.settlement.manage'));

DROP POLICY IF EXISTS provider_invoices_no_client_write ON public.provider_invoices;
CREATE POLICY provider_invoices_no_client_write ON public.provider_invoices
AS RESTRICTIVE FOR ALL TO authenticated
USING (true) WITH CHECK (false);

DROP POLICY IF EXISTS provider_invoice_lines_read ON public.provider_invoice_lines;
CREATE POLICY provider_invoice_lines_read ON public.provider_invoice_lines
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.provider_invoices i
                WHERE i.id = invoice_id
                  AND (i.provider_user_id = auth.uid()
                       OR public.has_staff_permission('staff.finance.settlement.manage'))));

DROP POLICY IF EXISTS provider_invoice_lines_no_client_write ON public.provider_invoice_lines;
CREATE POLICY provider_invoice_lines_no_client_write ON public.provider_invoice_lines
AS RESTRICTIVE FOR ALL TO authenticated
USING (true) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public._provider_invoice_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_provider_invoice_touch ON public.provider_invoices;
CREATE TRIGGER trg_provider_invoice_touch BEFORE UPDATE ON public.provider_invoices
FOR EACH ROW EXECUTE FUNCTION public._provider_invoice_touch();

-- lines are frozen once the statement leaves draft
CREATE OR REPLACE FUNCTION public._provider_invoice_lines_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.provider_invoices
   WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id);
  IF v_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'INVOICE_LINES_FROZEN';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_provider_invoice_lines_frozen ON public.provider_invoice_lines;
CREATE TRIGGER trg_provider_invoice_lines_frozen
BEFORE INSERT OR UPDATE OR DELETE ON public.provider_invoice_lines
FOR EACH ROW EXECUTE FUNCTION public._provider_invoice_lines_frozen();

CREATE SEQUENCE IF NOT EXISTS public.provider_invoice_seq;

-- ============ 2. Settings: invoice approval gate + several payout numbers ============
ALTER TABLE public.provider_settlement_settings
  ADD COLUMN IF NOT EXISTS require_invoice_approval boolean NOT NULL DEFAULT true;

-- ============ 3. Build / submit / decide ============
CREATE OR REPLACE FUNCTION public.provider_invoice_prepare(_period_start date, _period_end date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
  v_id uuid;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start THEN
    RAISE EXCEPTION 'INVALID_PERIOD';
  END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  SELECT id INTO v_id FROM public.provider_invoices
   WHERE provider_user_id = v_uid AND period_start = _period_start
     AND period_end = _period_end AND state = 'DRAFT' FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.provider_invoices (provider_user_id, period_start, period_end,
      currency, commission_bps, withdrawal_fee_bps)
    VALUES (v_uid, _period_start, _period_end, v_set.currency,
      v_set.commission_bps, v_set.withdrawal_fee_bps)
    RETURNING id INTO v_id;
  ELSE
    DELETE FROM public.provider_invoice_lines WHERE invoice_id = v_id;
  END IF;

  -- every line is recomputed from the recorded trip, never from client input
  INSERT INTO public.provider_invoice_lines (invoice_id, earning_id, booking_reference,
    service_date, gross_cents, commission_cents, net_cents, currency)
  SELECT v_id, e.id, e.booking_reference,
         coalesce(e.credited_at, e.fulfilled_at, e.created_at)::date,
         e.gross_cents, e.commission_cents, e.net_cents, e.currency
    FROM public.provider_earnings e
   WHERE e.provider_user_id = v_uid
     AND e.state <> 'CANCELLED'
     AND coalesce(e.credited_at, e.fulfilled_at, e.created_at)::date
         BETWEEN _period_start AND _period_end
     AND NOT EXISTS (
       SELECT 1 FROM public.provider_invoice_lines l
         JOIN public.provider_invoices i ON i.id = l.invoice_id
        WHERE l.earning_id = e.id AND i.state IN ('SUBMITTED','APPROVED'));

  SELECT count(*) INTO v_count FROM public.provider_invoice_lines WHERE invoice_id = v_id;

  UPDATE public.provider_invoices i
     SET lines_count = v_count,
         gross_cents = coalesce(s.gross, 0),
         commission_cents = coalesce(s.commission, 0),
         net_cents = coalesce(s.net, 0),
         estimated_fee_cents = (coalesce(s.net, 0) * coalesce(v_set.withdrawal_fee_bps, 500)) / 10000,
         commission_bps = v_set.commission_bps,
         withdrawal_fee_bps = v_set.withdrawal_fee_bps
    FROM (SELECT sum(gross_cents) gross, sum(commission_cents) commission, sum(net_cents) net
            FROM public.provider_invoice_lines WHERE invoice_id = v_id) s
   WHERE i.id = v_id;

  RETURN jsonb_build_object('ok', true, 'invoice_id', v_id, 'lines', v_count);
END $$;

REVOKE ALL ON FUNCTION public.provider_invoice_prepare(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_invoice_prepare(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_invoice_submit(_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_invoices;
  v_number text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.provider_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_INVOICE'; END IF;
  IF v_row.provider_user_id <> v_uid THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF v_row.state = 'SUBMITTED' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'invoice_number', v_row.invoice_number);
  END IF;
  IF v_row.state NOT IN ('DRAFT','QUERIED') THEN RAISE EXCEPTION 'INVOICE_NOT_EDITABLE'; END IF;
  IF v_row.lines_count = 0 OR v_row.net_cents <= 0 THEN RAISE EXCEPTION 'INVOICE_EMPTY'; END IF;

  v_number := coalesce(v_row.invoice_number,
    'YM-OPS-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.provider_invoice_seq')::text, 4, '0'));

  UPDATE public.provider_invoices
     SET state = 'SUBMITTED', invoice_number = v_number, submitted_at = now(),
         decision_note = NULL, decided_by = NULL, decided_at = NULL
   WHERE id = _invoice_id;

  RETURN jsonb_build_object('ok', true, 'invoice_number', v_number);
END $$;

REVOKE ALL ON FUNCTION public.provider_invoice_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_invoice_submit(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_invoice_decide(_invoice_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_invoices;
  v_recomputed bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO v_row FROM public.provider_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_INVOICE'; END IF;
  IF v_row.state <> 'SUBMITTED' THEN RAISE EXCEPTION 'INVOICE_NOT_PENDING'; END IF;
  IF NOT _approve AND coalesce(btrim(_note), '') = '' THEN RAISE EXCEPTION 'QUERY_REASON_REQUIRED'; END IF;

  -- the platform's own trip records decide the amount, not the statement
  SELECT coalesce(sum(e.net_cents), 0) INTO v_recomputed
    FROM public.provider_invoice_lines l
    JOIN public.provider_earnings e ON e.id = l.earning_id
   WHERE l.invoice_id = _invoice_id AND e.provider_user_id = v_row.provider_user_id;

  IF _approve AND v_recomputed <> v_row.net_cents THEN
    RAISE EXCEPTION 'INVOICE_AMOUNT_MISMATCH';
  END IF;

  UPDATE public.provider_invoices
     SET state = CASE WHEN _approve THEN 'APPROVED' ELSE 'QUERIED' END,
         decided_by = v_uid, decided_at = now(), decision_note = btrim(_note)
   WHERE id = _invoice_id;

  RETURN jsonb_build_object('ok', true,
    'state', CASE WHEN _approve THEN 'APPROVED' ELSE 'QUERIED' END);
END $$;

REVOKE ALL ON FUNCTION public.provider_invoice_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_invoice_decide(uuid, boolean, text) TO authenticated, service_role;

-- ============ 4. Reading: operator's own statements, finance queue ============
CREATE OR REPLACE FUNCTION public.provider_invoices_self()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  RETURN jsonb_build_object(
    'commission_bps', v_set.commission_bps,
    'withdrawal_fee_bps', v_set.withdrawal_fee_bps,
    'require_invoice_approval', v_set.require_invoice_approval,
    'uninvoiced', (
      SELECT jsonb_build_object(
        'trips', count(*), 'gross_cents', coalesce(sum(e.gross_cents),0),
        'net_cents', coalesce(sum(e.net_cents),0))
        FROM public.provider_earnings e
       WHERE e.provider_user_id = v_uid AND e.state <> 'CANCELLED'
         AND NOT EXISTS (SELECT 1 FROM public.provider_invoice_lines l
                           JOIN public.provider_invoices i ON i.id = l.invoice_id
                          WHERE l.earning_id = e.id AND i.state IN ('SUBMITTED','APPROVED'))),
    'invoices', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'invoice_number', i.invoice_number, 'period_start', i.period_start,
        'period_end', i.period_end, 'currency', i.currency, 'lines_count', i.lines_count,
        'gross_cents', i.gross_cents, 'commission_bps', i.commission_bps,
        'commission_cents', i.commission_cents, 'net_cents', i.net_cents,
        'withdrawal_fee_bps', i.withdrawal_fee_bps, 'estimated_fee_cents', i.estimated_fee_cents,
        'state', i.state, 'submitted_at', i.submitted_at, 'decided_at', i.decided_at,
        'decision_note', i.decision_note, 'created_at', i.created_at,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'booking_reference', l.booking_reference, 'service_date', l.service_date,
            'gross_cents', l.gross_cents, 'commission_cents', l.commission_cents,
            'net_cents', l.net_cents) ORDER BY l.service_date DESC), '[]'::jsonb)
           FROM public.provider_invoice_lines l WHERE l.invoice_id = i.id)
        ) ORDER BY i.created_at DESC), '[]'::jsonb)
        FROM public.provider_invoices i WHERE i.provider_user_id = v_uid)
  );
END $$;

REVOKE ALL ON FUNCTION public.provider_invoices_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_invoices_self() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_invoice_queue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_staff_permission('staff.finance.settlement.manage')
          OR public.capacity_can_approve(v_uid)) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  RETURN jsonb_build_object(
    'can_decide', public.has_staff_permission('staff.finance.settlement.manage'),
    'summary', (SELECT jsonb_build_object(
        'submitted', count(*) FILTER (WHERE state = 'SUBMITTED'),
        'submitted_net_cents', coalesce(sum(net_cents) FILTER (WHERE state = 'SUBMITTED'), 0),
        'approved', count(*) FILTER (WHERE state = 'APPROVED'),
        'approved_net_cents', coalesce(sum(net_cents) FILTER (WHERE state = 'APPROVED'), 0),
        'queried', count(*) FILTER (WHERE state = 'QUERIED'))
      FROM public.provider_invoices),
    'invoices', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'invoice_number', i.invoice_number, 'provider_user_id', i.provider_user_id,
        'period_start', i.period_start, 'period_end', i.period_end, 'currency', i.currency,
        'lines_count', i.lines_count, 'gross_cents', i.gross_cents,
        'commission_cents', i.commission_cents, 'net_cents', i.net_cents,
        'estimated_fee_cents', i.estimated_fee_cents, 'state', i.state,
        'submitted_at', i.submitted_at, 'decided_at', i.decided_at,
        'decision_note', i.decision_note, 'created_at', i.created_at,
        'recomputed_net_cents', (SELECT coalesce(sum(e.net_cents),0)
            FROM public.provider_invoice_lines l
            JOIN public.provider_earnings e ON e.id = l.earning_id
           WHERE l.invoice_id = i.id),
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', l.id, 'booking_reference', l.booking_reference, 'service_date', l.service_date,
            'gross_cents', l.gross_cents, 'commission_cents', l.commission_cents,
            'net_cents', l.net_cents) ORDER BY l.service_date DESC), '[]'::jsonb)
           FROM public.provider_invoice_lines l WHERE l.invoice_id = i.id)
        ) ORDER BY i.created_at DESC), '[]'::jsonb)
      FROM public.provider_invoices i
     WHERE i.state <> 'DRAFT')
  );
END $$;

REVOKE ALL ON FUNCTION public.provider_invoice_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_invoice_queue() TO authenticated, service_role;

-- ============ 5. Several payout numbers per operator ============
CREATE OR REPLACE FUNCTION public.provider_payout_accounts_self()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'msisdn', a.msisdn, 'account_name', a.account_name,
      'is_default', a.is_default, 'verification_state', a.verification_state,
      'verification_note', a.verification_note, 'verified_at', a.verified_at,
      'created_at', a.created_at) ORDER BY a.is_default DESC, a.created_at), '[]'::jsonb)
    FROM public.provider_payout_accounts a WHERE a.provider_user_id = v_uid);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_accounts_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_accounts_self() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_payout_account_set_default(_account_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_payout_accounts;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.provider_payout_accounts
   WHERE id = _account_id AND provider_user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_ACCOUNT'; END IF;

  UPDATE public.provider_payout_accounts
     SET is_default = (id = _account_id)
   WHERE provider_user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'id', _account_id);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_account_set_default(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_account_set_default(uuid) TO authenticated, service_role;

-- saving a number no longer forces it to be the default
CREATE OR REPLACE FUNCTION public.provider_payout_account_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_raw text := btrim(coalesce(p->>'msisdn',''));
  v_digits text;
  v_msisdn text;
  v_name text := btrim(coalesce(p->>'account_name',''));
  v_make_default boolean := coalesce((p->>'make_default')::boolean, false);
  v_had_any boolean;
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

  SELECT EXISTS (SELECT 1 FROM public.provider_payout_accounts WHERE provider_user_id = v_uid)
    INTO v_had_any;

  INSERT INTO public.provider_payout_accounts (provider_user_id, msisdn, account_name, verification_state)
  VALUES (v_uid, v_msisdn, v_name, 'IN_REVIEW')
  ON CONFLICT (provider_user_id, msisdn) DO UPDATE
     SET account_name = excluded.account_name,
         verification_state = CASE WHEN public.provider_payout_accounts.verification_state = 'VERIFIED'
                                   THEN 'VERIFIED' ELSE 'IN_REVIEW' END
  RETURNING id INTO v_id;

  IF v_make_default OR NOT v_had_any THEN
    UPDATE public.provider_payout_accounts
       SET is_default = (id = v_id)
     WHERE provider_user_id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'msisdn', v_msisdn,
    'is_default', v_make_default OR NOT v_had_any);
END $$;

-- ============ 6. Withdrawal screening: approved invoice cover ============
CREATE OR REPLACE FUNCTION public._provider_invoice_cover(_provider uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT sum(i.net_cents) FROM public.provider_invoices i
                    WHERE i.provider_user_id = _provider AND i.state = 'APPROVED'), 0)
       - coalesce((SELECT w.lifetime_withdrawn_cents FROM public.provider_wallets w
                    WHERE w.provider_user_id = _provider), 0);
$$;

REVOKE ALL ON FUNCTION public._provider_invoice_cover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._provider_invoice_cover(uuid) TO authenticated, service_role;

-- ============ 7. Finance figures ============
CREATE OR REPLACE FUNCTION public.provider_finance_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', now())::date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_staff_permission('staff.finance.settlement.manage')
          OR public.capacity_can_approve(v_uid)) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'withdrawals', (SELECT jsonb_build_object(
        'pending_count', count(*) FILTER (WHERE state IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL')),
        'pending_cents', coalesce(sum(amount_cents) FILTER (WHERE state IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL')), 0),
        'approved_count', count(*) FILTER (WHERE state = 'APPROVED'),
        'approved_cents', coalesce(sum(amount_cents) FILTER (WHERE state = 'APPROVED'), 0),
        'in_flight_count', count(*) FILTER (WHERE state = 'PROCESSING'),
        'in_flight_cents', coalesce(sum(amount_cents) FILTER (WHERE state = 'PROCESSING'), 0),
        'paid_count', count(*) FILTER (WHERE state = 'PAID'),
        'paid_cents', coalesce(sum(amount_cents) FILTER (WHERE state = 'PAID'), 0),
        'failed_count', count(*) FILTER (WHERE state = 'FAILED'),
        'rejected_count', count(*) FILTER (WHERE state = 'CANCELLED'))
      FROM public.provider_payout_requests),
    'income', (SELECT jsonb_build_object(
        'commission_cents', coalesce(sum(amount_cents) FILTER (WHERE posting_type = 'COMMISSION'), 0),
        'commission_month_cents', coalesce(sum(amount_cents) FILTER (WHERE posting_type = 'COMMISSION' AND created_at >= v_month_start), 0),
        'fee_cents', coalesce(sum(amount_cents) FILTER (WHERE posting_type = 'WITHDRAWAL_FEE'), 0),
        'fee_month_cents', coalesce(sum(amount_cents) FILTER (WHERE posting_type = 'WITHDRAWAL_FEE' AND created_at >= v_month_start), 0))
      FROM public.provider_platform_postings),
    'wallets', (SELECT jsonb_build_object(
        'operators', count(*),
        'held_cents', coalesce(sum(held_cents), 0),
        'available_cents', coalesce(sum(available_cents), 0),
        'reserved_cents', coalesce(sum(reserved_cents), 0),
        'lifetime_earned_cents', coalesce(sum(lifetime_earned_cents), 0),
        'lifetime_withdrawn_cents', coalesce(sum(lifetime_withdrawn_cents), 0))
      FROM public.provider_wallets),
    'invoices', (SELECT jsonb_build_object(
        'submitted', count(*) FILTER (WHERE state = 'SUBMITTED'),
        'submitted_net_cents', coalesce(sum(net_cents) FILTER (WHERE state = 'SUBMITTED'), 0),
        'approved', count(*) FILTER (WHERE state = 'APPROVED'),
        'queried', count(*) FILTER (WHERE state = 'QUERIED'))
      FROM public.provider_invoices),
    'trend', (
      WITH months AS (
        SELECT date_trunc('month', d)::date m
          FROM generate_series(date_trunc('month', now()) - interval '5 months',
                               date_trunc('month', now()), interval '1 month') d)
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'month', to_char(m, 'YYYY-MM'),
          'commission_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_platform_postings p
                                WHERE p.posting_type='COMMISSION'
                                  AND p.created_at >= m AND p.created_at < (m + interval '1 month')),
          'fee_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_platform_postings p
                         WHERE p.posting_type='WITHDRAWAL_FEE'
                           AND p.created_at >= m AND p.created_at < (m + interval '1 month')),
          'paid_out_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_payout_requests r
                              WHERE r.state='PAID' AND r.paid_at >= m AND r.paid_at < (m + interval '1 month')),
          'earned_cents', (SELECT coalesce(sum(net_cents),0) FROM public.provider_earnings e
                            WHERE e.created_at >= m AND e.created_at < (m + interval '1 month'))
        ) ORDER BY m), '[]'::jsonb) FROM months),
    'operators', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
          'provider_user_id', w.provider_user_id,
          'currency', w.currency,
          'earned_cents', w.lifetime_earned_cents,
          'withdrawn_cents', w.lifetime_withdrawn_cents,
          'fees_cents', w.lifetime_fees_cents,
          'held_cents', w.held_cents,
          'available_cents', w.available_cents,
          'reserved_cents', w.reserved_cents,
          'invoice_cover_cents', public._provider_invoice_cover(w.provider_user_id)
        ) ORDER BY w.lifetime_earned_cents DESC), '[]'::jsonb)
      FROM public.provider_wallets w)
  );
END $$;

REVOKE ALL ON FUNCTION public.provider_finance_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_finance_dashboard() TO authenticated, service_role;