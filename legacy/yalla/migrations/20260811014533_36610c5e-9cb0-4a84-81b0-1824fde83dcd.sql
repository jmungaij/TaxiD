-- =====================================================================
-- PHASE 8.5 — YALLA TRANSACTION, REVENUE & CONTROL CLOSURE ENGINE
-- Closes the economic loop on the existing YTX spine. No new revenue is
-- invented anywhere in this migration: every figure is derived from an
-- authoritative source record, and anything unprovable is refused.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 8.5.1 — Canonical lineage: the 14 production stages
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commercial_lineage_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.commercial_transactions(id) ON DELETE CASCADE,
  transaction_ref text NOT NULL,
  stage_no smallint NOT NULL CHECK (stage_no BETWEEN 1 AND 14),
  stage_key text NOT NULL,
  authoritative_id text,
  authoritative_table text,
  status text NOT NULL DEFAULT 'recorded',
  occurred_at timestamptz,
  source text NOT NULL,
  actor_kind text NOT NULL DEFAULT 'system',
  actor_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, stage_no)
);

GRANT SELECT ON public.commercial_lineage_stages TO authenticated;
GRANT ALL ON public.commercial_lineage_stages TO service_role;
ALTER TABLE public.commercial_lineage_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read lineage stages"
  ON public.commercial_lineage_stages FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

CREATE INDEX IF NOT EXISTS idx_lineage_tx ON public.commercial_lineage_stages(transaction_id, stage_no);

CREATE TABLE IF NOT EXISTS public.commercial_decision_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid REFERENCES public.commercial_actions(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.commercial_transactions(id) ON DELETE SET NULL,
  exception_id uuid REFERENCES public.commercial_exceptions(id) ON DELETE SET NULL,
  decision text NOT NULL,
  hypothesis text,
  action_taken text,
  result text,
  variance_pct numeric,
  cause text,
  learning text NOT NULL,
  rule_or_model text,
  rule_update_applied boolean NOT NULL DEFAULT false,
  confidence_pct numeric CHECK (confidence_pct IS NULL OR (confidence_pct BETWEEN 0 AND 100)),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.commercial_decision_learning TO authenticated;
GRANT ALL ON public.commercial_decision_learning TO service_role;
ALTER TABLE public.commercial_decision_learning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read learning"
  ON public.commercial_decision_learning FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "Commercial staff record learning"
  ON public.commercial_decision_learning FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() AND recorded_by = auth.uid());

CREATE TABLE IF NOT EXISTS public.commercial_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL DEFAULT '8.5',
  verdict text NOT NULL CHECK (verdict IN ('PASS','FAIL')),
  score numeric NOT NULL,
  criteria jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.commercial_certification_runs TO authenticated;
GRANT ALL ON public.commercial_certification_runs TO service_role;
ALTER TABLE public.commercial_certification_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read certification runs"
  ON public.commercial_certification_runs FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

-- Idempotency spine for revenue: one revenue event per transaction, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_revenue_events_source_ref
  ON public.revenue_events(source_ref) WHERE source_ref LIKE 'YTX-%';

-- Payment evidence kind: distinguishes cash/wallet/invoice/gateway proof.
ALTER TABLE public.commercial_transactions
  ADD COLUMN IF NOT EXISTS payment_evidence_kind text,
  ADD COLUMN IF NOT EXISTS integrity_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------
-- Lineage recorder
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_lineage_stage(
  _transaction_id uuid,
  _stage_no smallint,
  _stage_key text,
  _authoritative_id text DEFAULT NULL,
  _authoritative_table text DEFAULT NULL,
  _status text DEFAULT 'recorded',
  _occurred_at timestamptz DEFAULT now(),
  _source text DEFAULT 'system',
  _actor_kind text DEFAULT 'system',
  _actor_id uuid DEFAULT NULL,
  _evidence jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ref text; sid uuid;
BEGIN
  SELECT transaction_ref INTO ref FROM commercial_transactions WHERE id = _transaction_id;
  IF ref IS NULL THEN RETURN NULL; END IF;

  INSERT INTO commercial_lineage_stages (
    transaction_id, transaction_ref, stage_no, stage_key, authoritative_id, authoritative_table,
    status, occurred_at, source, actor_kind, actor_id, evidence)
  VALUES (_transaction_id, ref, _stage_no, _stage_key, _authoritative_id, _authoritative_table,
    _status, _occurred_at, _source, _actor_kind, COALESCE(_actor_id, auth.uid()), COALESCE(_evidence, '{}'::jsonb))
  ON CONFLICT (transaction_id, stage_no) DO UPDATE SET
    stage_key = EXCLUDED.stage_key,
    authoritative_id = COALESCE(EXCLUDED.authoritative_id, commercial_lineage_stages.authoritative_id),
    authoritative_table = COALESCE(EXCLUDED.authoritative_table, commercial_lineage_stages.authoritative_table),
    status = EXCLUDED.status,
    occurred_at = COALESCE(EXCLUDED.occurred_at, commercial_lineage_stages.occurred_at),
    source = EXCLUDED.source,
    evidence = commercial_lineage_stages.evidence || EXCLUDED.evidence,
    updated_at = now()
  RETURNING id INTO sid;

  RETURN sid;
END; $$;

-- Rebuilds the 14-stage trace from whatever the source records actually
-- prove. Stages with no authoritative record are recorded as 'missing' —
-- never as complete.
CREATE OR REPLACE FUNCTION public.rebuild_commercial_lineage(_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE tx record; present int := 0; total int := 14;
  PROCEDURE_stage record;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  PERFORM record_lineage_stage(tx.id, 1::smallint, 'market_signal',
    tx.demand_intent_ref, 'demand_signals',
    CASE WHEN tx.demand_intent_ref IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.created_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 2::smallint, 'opportunity_intent',
    tx.opportunity_id::text, 'commercial_opportunities',
    CASE WHEN tx.opportunity_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.created_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 3::smallint, 'offer',
    COALESCE(tx.offer_ref, tx.quote_id::text), 'charter_quotes',
    CASE WHEN COALESCE(tx.offer_ref, tx.quote_id::text) IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.created_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 4::smallint, 'capacity_commitment',
    tx.commitment_id::text, 'capacity_commitments',
    CASE WHEN tx.commitment_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.committed_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 5::smallint, 'booking',
    tx.booking_id::text, tx.booking_table,
    CASE WHEN tx.booking_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.booked_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 6::smallint, 'orchestration',
    tx.dispatch_assignment_id::text, 'dispatch_assignments',
    CASE WHEN tx.dispatch_assignment_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.booked_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 7::smallint, 'fulfilment',
    tx.booking_id::text, tx.booking_table,
    CASE WHEN tx.fulfilled_at IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.fulfilled_at, COALESCE(tx.fulfilment_source, 'spine_rebuild'));
  PERFORM record_lineage_stage(tx.id, 8::smallint, 'invoice',
    tx.invoice_id::text, tx.invoice_table,
    CASE WHEN tx.invoice_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    NULL, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 9::smallint, 'payment',
    tx.payment_ref, tx.payment_table,
    CASE WHEN tx.payment_ref IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.paid_at, COALESCE(tx.payment_provider, 'spine_rebuild'));
  PERFORM record_lineage_stage(tx.id, 10::smallint, 'settlement',
    tx.settlement_id::text, 'settlement_obligations',
    CASE WHEN tx.settlement_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    NULL, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 11::smallint, 'revenue_event',
    tx.revenue_event_id::text, 'revenue_events',
    CASE WHEN tx.revenue_event_id IS NOT NULL THEN 'recorded' ELSE 'missing' END,
    tx.recognised_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 12::smallint, 'revenue_ledger',
    (SELECT re.journal_id::text FROM revenue_events re WHERE re.id = tx.revenue_event_id), 'journals',
    CASE WHEN EXISTS (SELECT 1 FROM revenue_events re WHERE re.id = tx.revenue_event_id AND re.journal_id IS NOT NULL)
         THEN 'recorded' ELSE 'missing' END,
    tx.recognised_at, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 13::smallint, 'outcome',
    (SELECT o.id::text FROM commercial_action_outcomes o WHERE o.action_id = tx.commercial_action_id ORDER BY o.measured_at DESC LIMIT 1),
    'commercial_action_outcomes',
    CASE WHEN EXISTS (SELECT 1 FROM commercial_action_outcomes o WHERE o.action_id = tx.commercial_action_id)
         THEN 'recorded' ELSE 'missing' END,
    NULL, 'spine_rebuild');
  PERFORM record_lineage_stage(tx.id, 14::smallint, 'learning',
    (SELECT l.id::text FROM commercial_decision_learning l WHERE l.transaction_id = tx.id ORDER BY l.created_at DESC LIMIT 1),
    'commercial_decision_learning',
    CASE WHEN EXISTS (SELECT 1 FROM commercial_decision_learning l WHERE l.transaction_id = tx.id)
         THEN 'recorded' ELSE 'missing' END,
    NULL, 'spine_rebuild');

  SELECT count(*) INTO present FROM commercial_lineage_stages
   WHERE transaction_id = tx.id AND status <> 'missing';

  UPDATE commercial_transactions
     SET lineage = jsonb_build_object('stages_present', present, 'stages_total', total,
                                      'completeness_pct', round((present::numeric / total) * 100, 1),
                                      'rebuilt_at', now()),
         updated_at = now()
   WHERE id = tx.id;

  RETURN jsonb_build_object('ok', true, 'transaction_ref', tx.transaction_ref,
    'stages_present', present, 'stages_total', total,
    'completeness_pct', round((present::numeric / total) * 100, 1));
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.3 — Rule-aware financial eligibility.
-- Payment proof is demanded only where the commercial rule requires it:
-- a corporate ride is billed on invoice, not on a gateway receipt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_revenue_eligibility(_transaction_id uuid, _source text DEFAULT 'manual'::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tx record; r record; missing text[] := ARRAY[]::text[]; blockers text[] := ARRAY[]::text[];
  complete boolean; eligible boolean; amount bigint; reason text; needs_payment boolean;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  SELECT * INTO r FROM revenue_recognition_rules
   WHERE is_active AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
     AND service_line = tx.service_line
   ORDER BY effective_from DESC LIMIT 1;

  needs_payment := COALESCE(r.requires_payment, true);

  IF tx.currency IS NULL OR length(trim(tx.currency)) = 0 THEN missing := array_append(missing, 'currency'); END IF;
  IF tx.customer_charge_cents IS NULL THEN missing := array_append(missing, 'customer_charge_cents'); END IF;
  IF tx.gross_transaction_value_cents IS NULL THEN missing := array_append(missing, 'gross_transaction_value_cents'); END IF;
  IF tx.tax_cents IS NULL THEN missing := array_append(missing, 'tax_cents'); END IF;
  IF tx.platform_revenue_cents IS NULL THEN missing := array_append(missing, 'commission_platform_revenue_cents'); END IF;
  IF tx.partner_entitlement_cents IS NULL THEN missing := array_append(missing, 'partner_entitlement_cents'); END IF;
  IF tx.provider_ref IS NULL THEN missing := array_append(missing, 'provider_ref'); END IF;
  IF needs_payment AND tx.payment_ref IS NULL THEN missing := array_append(missing, 'payment_ref'); END IF;
  IF needs_payment AND tx.payment_status IS NULL THEN missing := array_append(missing, 'payment_status'); END IF;
  IF COALESCE(r.requires_invoice, false) AND tx.invoice_id IS NULL THEN missing := array_append(missing, 'invoice_id'); END IF;
  IF tx.fulfilled_at IS NULL THEN missing := array_append(missing, 'fulfilled_at'); END IF;

  complete := array_length(missing, 1) IS NULL;

  IF r.rule_key IS NULL THEN
    blockers := array_append(blockers, format('No active recognition rule covers service line "%s".', tx.service_line));
  ELSE
    IF r.approved_by IS NULL THEN blockers := array_append(blockers, format('Recognition rule %s has not been signed off by finance.', r.rule_key)); END IF;
    IF r.requires_fulfilment AND tx.fulfilled_at IS NULL THEN blockers := array_append(blockers, 'Service is not authoritatively fulfilled.'); END IF;
    IF r.requires_payment AND tx.paid_at IS NULL THEN blockers := array_append(blockers, 'Rule requires captured payment; no authoritative capture recorded.'); END IF;
    IF r.requires_invoice AND tx.invoice_id IS NULL THEN blockers := array_append(blockers, 'Rule requires an issued invoice; none linked.'); END IF;
    IF r.requires_settlement AND tx.settlement_id IS NULL THEN blockers := array_append(blockers, 'Rule requires partner settlement; none linked.'); END IF;
    IF r.requires_economics_complete AND NOT complete THEN
      blockers := array_append(blockers, format('Economics incomplete — missing %s.', array_to_string(missing, ', ')));
    END IF;
    amount := CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END;
    IF amount IS NULL THEN blockers := array_append(blockers, 'Recognisable amount is not stated.');
    ELSIF amount < r.min_amount_cents THEN blockers := array_append(blockers, 'Recognisable amount is below the rule minimum.'); END IF;
  END IF;

  IF tx.recognised_at IS NOT NULL THEN blockers := array_append(blockers, 'Revenue has already been recognised.'); END IF;
  IF tx.cancelled_at IS NOT NULL THEN blockers := array_append(blockers, 'Transaction is cancelled.'); END IF;
  IF tx.financial_review_status <> 'approved' THEN
    blockers := array_append(blockers, format('Captured financial fields are %s finance review.', tx.financial_review_status));
  END IF;

  eligible := array_length(blockers, 1) IS NULL;
  reason := CASE WHEN eligible THEN format('Eligible under %s.', r.rule_key) ELSE array_to_string(blockers, ' ') END;

  UPDATE commercial_transactions SET
    economics_complete = complete,
    missing_fields = to_jsonb(missing),
    financially_eligible = eligible,
    eligibility_reason = reason,
    provenance = CASE WHEN complete THEN 'LIVE' ELSE 'INCOMPLETE' END,
    updated_at = now()
  WHERE id = _transaction_id;

  INSERT INTO revenue_eligibility_checks (transaction_id, transaction_ref, service_line, rule_key,
    eligible, missing_fields, blockers, economics_complete, review_status, source, checked_by)
  VALUES (tx.id, tx.transaction_ref, tx.service_line, r.rule_key, eligible, to_jsonb(missing),
    to_jsonb(blockers), complete, tx.financial_review_status, _source, auth.uid());

  RETURN jsonb_build_object('ok', true, 'transaction_ref', tx.transaction_ref, 'eligible', eligible,
    'economics_complete', complete, 'missing_fields', to_jsonb(missing), 'blockers', to_jsonb(blockers),
    'rule_key', r.rule_key, 'reason', reason,
    'recognisable_amount_cents', CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END);
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.4 — Idempotent revenue event emitter.
-- A retry, a replayed webhook or a double click can never mint a second
-- revenue event: the source_ref unique index is the hard guarantee and
-- the recognised_at stamp is the soft one.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_revenue_event(_transaction_id uuid, _source text DEFAULT 'emitter')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  tx record; r record; elig jsonb; ev_id uuid; amount bigint; ev_type revenue_event_type;
  rev_account text; existing uuid;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id FOR UPDATE;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  SELECT id INTO existing FROM revenue_events WHERE source_ref = tx.transaction_ref;
  IF existing IS NOT NULL THEN
    UPDATE commercial_transactions SET revenue_event_id = existing, updated_at = now()
     WHERE id = tx.id AND revenue_event_id IS DISTINCT FROM existing;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'revenue_event_id', existing,
      'transaction_ref', tx.transaction_ref, 'reason', 'Revenue event already exists for this transaction.');
  END IF;

  elig := check_revenue_eligibility(_transaction_id, _source);
  IF NOT (elig->>'eligible')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'emitted', false, 'transaction_ref', tx.transaction_ref,
      'error', 'not_eligible', 'reason', elig->>'reason', 'blockers', elig->'blockers');
  END IF;

  SELECT * INTO r FROM revenue_recognition_rules
   WHERE is_active AND service_line = tx.service_line
     AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
   ORDER BY effective_from DESC LIMIT 1;

  amount := CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END;
  IF amount IS NULL OR amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'emitted', false, 'error', 'non_positive_amount',
      'reason', 'The recognisable amount is not a positive figure; nothing was emitted.');
  END IF;

  ev_type := CASE tx.service_line
    WHEN 'delivery' THEN 'DELIVERY_COMPLETED'::revenue_event_type
    WHEN 'rental' THEN 'RENTAL_COMPLETED'::revenue_event_type
    ELSE 'RIDE_COMPLETED'::revenue_event_type END;

  rev_account := CASE tx.service_line
    WHEN 'delivery' THEN '4100' WHEN 'corporate' THEN '4200' WHEN 'rental' THEN '4300'
    WHEN 'charter' THEN '4000' ELSE CASE WHEN r.recognise_gross THEN '4000' ELSE '4400' END END;

  INSERT INTO revenue_events (event_type, occurred_at, source_ref, driver_id, rider_id, corporate_id,
    gross_amount_cents, currency, recognized_at, status, metadata)
  VALUES (ev_type, COALESCE(tx.fulfilled_at, now()), tx.transaction_ref, tx.driver_id,
    CASE WHEN tx.customer_kind = 'rider' THEN tx.customer_user_id END, tx.corporate_id,
    amount, COALESCE(tx.currency, 'KES'), now(), 'RECOGNIZED',
    jsonb_build_object(
      'phase', '8.5.4', 'rule_key', r.rule_key, 'rule_version', r.version,
      'basis', CASE WHEN r.recognise_gross THEN 'gross' ELSE 'net_platform' END,
      'service_line', tx.service_line, 'booking_table', tx.booking_table, 'booking_id', tx.booking_id,
      'customer_charge_cents', tx.customer_charge_cents, 'tax_cents', tx.tax_cents,
      'partner_entitlement_cents', tx.partner_entitlement_cents,
      'platform_revenue_cents', tx.platform_revenue_cents,
      'refund_cents', COALESCE(tx.refund_cents, 0), 'adjustment_cents', COALESCE(tx.adjustment_cents, 0),
      'payment_ref', tx.payment_ref, 'payment_evidence_kind', tx.payment_evidence_kind,
      'emitted_by_source', _source, 'provenance', 'LIVE'))
  RETURNING id INTO ev_id;

  INSERT INTO revenue_allocations (event_id, kind, amount_cents, currency, account_code, memo)
  VALUES (ev_id, 'GROSS_REVENUE'::revenue_allocation_kind, amount, COALESCE(tx.currency, 'KES'), rev_account,
          format('%s recognised under %s', tx.transaction_ref, r.rule_key));

  IF COALESCE(tx.tax_cents, 0) > 0 AND r.recognise_gross THEN
    INSERT INTO revenue_allocations (event_id, kind, amount_cents, currency, account_code, memo)
    VALUES (ev_id, 'VAT'::revenue_allocation_kind, tx.tax_cents, COALESCE(tx.currency, 'KES'), '2200',
            format('VAT on %s', tx.transaction_ref));
  END IF;

  IF COALESCE(tx.partner_entitlement_cents, 0) > 0 AND r.recognise_gross THEN
    INSERT INTO revenue_allocations (event_id, kind, amount_cents, currency, account_code, memo)
    VALUES (ev_id, 'DRIVER_LIABILITY'::revenue_allocation_kind, tx.partner_entitlement_cents,
            COALESCE(tx.currency, 'KES'), '2000', format('Partner entitlement on %s', tx.transaction_ref));
  END IF;

  UPDATE commercial_transactions
     SET revenue_event_id = ev_id, recognised_at = now(), status = 'recognised', updated_at = now()
   WHERE id = tx.id;

  PERFORM record_lineage_stage(tx.id, 11::smallint, 'revenue_event', ev_id::text, 'revenue_events',
    'recorded', now(), _source, 'system', auth.uid(),
    jsonb_build_object('amount_cents', amount, 'rule_key', r.rule_key));

  RETURN jsonb_build_object('ok', true, 'emitted', true, 'idempotent', false,
    'revenue_event_id', ev_id, 'transaction_ref', tx.transaction_ref,
    'amount_cents', amount, 'rule_key', r.rule_key, 'currency', COALESCE(tx.currency, 'KES'));
END; $$;

-- Batch emitter: only touches transactions that pass the gate.
CREATE OR REPLACE FUNCTION public.emit_eligible_revenue_events(_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t record; res jsonb; emitted int := 0; skipped int := 0; details jsonb := '[]'::jsonb;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
  FOR t IN SELECT id FROM commercial_transactions
            WHERE recognised_at IS NULL AND cancelled_at IS NULL AND fulfilled_at IS NOT NULL
            ORDER BY fulfilled_at LIMIT _limit LOOP
    res := emit_revenue_event(t.id, 'batch_emitter');
    IF COALESCE((res->>'emitted')::boolean, false) THEN emitted := emitted + 1;
    ELSE skipped := skipped + 1; details := details || jsonb_build_array(res); END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'emitted', emitted, 'skipped', skipped, 'skipped_detail', details);
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.6 — Partner settlement obligations
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_settlement_obligation(_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE tx record; sid uuid; existing uuid;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;
  IF tx.fulfilled_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_fulfilled',
      'reason', 'A partner is owed nothing until the service is authoritatively fulfilled.');
  END IF;
  IF COALESCE(tx.partner_entitlement_cents, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_entitlement',
      'reason', 'No partner entitlement was captured for this transaction.');
  END IF;

  SELECT id INTO existing FROM settlement_obligations WHERE transaction_id = tx.id;
  IF existing IS NOT NULL THEN
    UPDATE commercial_transactions SET settlement_id = existing, updated_at = now() WHERE id = tx.id;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'settlement_id', existing);
  END IF;

  INSERT INTO settlement_obligations (transaction_id, provider_kind, provider_ref, driver_id,
    entitlement_cents, currency, calculation, status, payable_at)
  VALUES (tx.id, COALESCE(tx.provider_kind, 'driver'), tx.provider_ref, tx.driver_id,
    tx.partner_entitlement_cents, COALESCE(tx.currency, 'KES'),
    jsonb_build_object('customer_charge_cents', tx.customer_charge_cents, 'tax_cents', tx.tax_cents,
      'platform_revenue_cents', tx.platform_revenue_cents,
      'partner_entitlement_cents', tx.partner_entitlement_cents, 'basis', 'captured_at_source'),
    'calculated', tx.fulfilled_at)
  RETURNING id INTO sid;

  UPDATE commercial_transactions SET settlement_id = sid, updated_at = now() WHERE id = tx.id;
  PERFORM record_lineage_stage(tx.id, 10::smallint, 'settlement', sid::text, 'settlement_obligations',
    'recorded', now(), 'settlement_engine');

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'settlement_id', sid,
    'entitlement_cents', tx.partner_entitlement_cents);
END; $$;

CREATE OR REPLACE FUNCTION public.reconcile_settlement_obligation(
  _settlement_id uuid, _paid_cents bigint, _payout_ref text DEFAULT NULL, _paid_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; var bigint;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
  SELECT * INTO s FROM settlement_obligations WHERE id = _settlement_id;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'settlement_not_found'); END IF;

  var := COALESCE(_paid_cents, 0) - s.entitlement_cents;

  UPDATE settlement_obligations SET
    paid_cents = _paid_cents, paid_at = _paid_at, reconciled_at = now(),
    variance_cents = var,
    variance_reason = CASE WHEN var = 0 THEN NULL
                           WHEN var < 0 THEN 'Partner underpaid against entitlement.'
                           ELSE 'Partner overpaid against entitlement.' END,
    status = CASE WHEN var = 0 THEN 'reconciled' ELSE 'variance' END,
    updated_at = now()
  WHERE id = _settlement_id;

  RETURN jsonb_build_object('ok', true, 'settlement_id', _settlement_id, 'variance_cents', var,
    'status', CASE WHEN var = 0 THEN 'reconciled' ELSE 'variance' END);
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.7 / 8.5.10 — Continuous money reconciliation and prioritised
-- exceptions. Priority = exposure x urgency x loss probability x
-- customer impact, so a KSh 2M / 30-minute break outranks a KSh 500
-- data anomaly regardless of age.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_commercial_exception(
  _transaction_id uuid, _stage text, _kind text, _severity text,
  _exposure_cents bigint, _loss_probability_pct numeric, _customer_impact text,
  _sla_hours numeric, _owner_team text, _root_cause text, _recommended_action text,
  _evidence jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eid uuid; ref text; tref text; urgency numeric; impact numeric; score numeric;
BEGIN
  SELECT transaction_ref INTO tref FROM commercial_transactions WHERE id = _transaction_id;

  SELECT id INTO eid FROM commercial_exceptions
   WHERE transaction_id IS NOT DISTINCT FROM _transaction_id AND kind = _kind
     AND status IN ('open','acknowledged','in_progress','escalated');
  IF eid IS NOT NULL THEN
    UPDATE commercial_exceptions SET value_at_risk_cents = _exposure_cents,
      evidence = evidence || _evidence, updated_at = now() WHERE id = eid;
    RETURN eid;
  END IF;

  urgency := CASE WHEN _sla_hours <= 0.5 THEN 4 WHEN _sla_hours <= 4 THEN 3
                  WHEN _sla_hours <= 24 THEN 2 ELSE 1 END;
  impact := CASE _customer_impact WHEN 'severe' THEN 4 WHEN 'high' THEN 3
                                  WHEN 'moderate' THEN 2 ELSE 1 END;
  score := round((GREATEST(_exposure_cents, 0)::numeric / 100)
                 * urgency * (GREATEST(LEAST(_loss_probability_pct, 100), 0) / 100) * impact, 2);

  ref := 'YEX-' || to_char(now(), 'YYYY') || '-' || lpad((
    (SELECT count(*) + 1 FROM commercial_exceptions
      WHERE created_at >= date_trunc('year', now())))::text, 6, '0');

  INSERT INTO commercial_exceptions (exception_ref, transaction_id, transaction_ref, stage, kind, severity,
    value_at_risk_cents, currency, loss_probability_pct, customer_impact, priority_score,
    sla_hours, sla_due_at, owner_team, root_cause, recommended_action, status, evidence)
  VALUES (ref, _transaction_id, tref, _stage, _kind, _severity, _exposure_cents, 'KES',
    _loss_probability_pct, _customer_impact, score, _sla_hours, now() + make_interval(mins => (_sla_hours * 60)::int),
    _owner_team, _root_cause, _recommended_action, 'open', _evidence)
  RETURNING id INTO eid;

  RETURN eid;
END; $$;

CREATE OR REPLACE FUNCTION public.run_commercial_money_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t record; raised int := 0; scanned int := 0; breaks jsonb := '{}'::jsonb;
  c_unbilled int := 0; c_unpaid int := 0; c_no_settle int := 0; c_no_rev int := 0;
  c_var int := 0; c_dup int := 0; exposure bigint := 0;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;

  FOR t IN SELECT * FROM commercial_transactions WHERE cancelled_at IS NULL LOOP
    scanned := scanned + 1;

    -- fulfilled but never billed / never paid
    IF t.fulfilled_at IS NOT NULL AND t.invoice_id IS NULL AND t.payment_ref IS NULL THEN
      c_unbilled := c_unbilled + 1;
      exposure := exposure + COALESCE(t.customer_charge_cents, 0);
      PERFORM raise_commercial_exception(t.id, 'invoice', 'fulfilled_without_billing', 'high',
        COALESCE(t.customer_charge_cents, 0), 60, 'moderate', 24, 'finance',
        'Service was delivered but neither an invoice nor a payment reference exists.',
        'Raise the invoice or attach the authoritative payment reference, then re-run eligibility.',
        jsonb_build_object('service_line', t.service_line, 'fulfilled_at', t.fulfilled_at));
      raised := raised + 1;
    END IF;

    -- invoiced but unpaid past terms
    IF t.invoice_id IS NOT NULL AND t.paid_at IS NULL AND t.fulfilled_at < now() - interval '7 days' THEN
      c_unpaid := c_unpaid + 1;
      exposure := exposure + COALESCE(t.customer_charge_cents, 0);
      PERFORM raise_commercial_exception(t.id, 'payment', 'invoice_unpaid', 'high',
        COALESCE(t.customer_charge_cents, 0), 40, 'moderate', 24, 'collections',
        'Invoice issued more than seven days ago with no payment recorded.',
        'Chase collection and confirm the receipt against the invoice.',
        jsonb_build_object('invoice_id', t.invoice_id));
      raised := raised + 1;
    END IF;

    -- payment recorded but no transaction economics
    IF t.payment_ref IS NOT NULL AND NOT t.economics_complete THEN
      PERFORM raise_commercial_exception(t.id, 'transaction', 'payment_without_economics', 'critical',
        COALESCE(t.customer_charge_cents, 0), 70, 'high', 4, 'finance',
        'Money was received against a transaction whose economics are incomplete.',
        'Capture the missing financial fields at source before recognising revenue.',
        t.missing_fields);
      raised := raised + 1;
    END IF;

    -- partial / over payment
    IF t.paid_at IS NOT NULL AND t.customer_charge_cents IS NOT NULL
       AND t.payment_status IN ('captured','paid') AND COALESCE(t.refund_cents, 0) = 0 THEN
      NULL; -- amount-level comparison happens in the payments reconciliation below
    END IF;

    -- fulfilled, entitled, but no settlement obligation
    IF t.fulfilled_at IS NOT NULL AND COALESCE(t.partner_entitlement_cents, 0) > 0 AND t.settlement_id IS NULL THEN
      c_no_settle := c_no_settle + 1;
      PERFORM raise_commercial_exception(t.id, 'settlement', 'settlement_not_raised', 'medium',
        COALESCE(t.partner_entitlement_cents, 0), 30, 'low', 24, 'finance',
        'A partner is owed money for a fulfilled service but no settlement obligation exists.',
        'Create the settlement obligation so the payable is visible and reconcilable.',
        jsonb_build_object('entitlement_cents', t.partner_entitlement_cents));
      raised := raised + 1;
    END IF;

    -- eligible but no revenue event
    IF t.financially_eligible AND t.revenue_event_id IS NULL THEN
      c_no_rev := c_no_rev + 1;
      PERFORM raise_commercial_exception(t.id, 'revenue_event', 'eligible_without_revenue_event', 'high',
        COALESCE(t.platform_revenue_cents, 0), 50, 'low', 4, 'finance',
        'Transaction passed the eligibility gate but no revenue event was emitted.',
        'Run the revenue emitter for this transaction.', '{}'::jsonb);
      raised := raised + 1;
    END IF;
  END LOOP;

  -- settlement variances
  FOR t IN SELECT s.*, ct.transaction_ref FROM settlement_obligations s
            JOIN commercial_transactions ct ON ct.id = s.transaction_id
           WHERE s.status = 'variance' LOOP
    c_var := c_var + 1;
    PERFORM raise_commercial_exception(t.transaction_id, 'settlement', 'settlement_variance', 'high',
      abs(COALESCE(t.variance_cents, 0)), 60, 'moderate', 8, 'finance',
      COALESCE(t.variance_reason, 'Partner payout does not match the entitlement.'),
      'Investigate the payout and either correct the payment or record an approved adjustment.',
      jsonb_build_object('variance_cents', t.variance_cents));
    raised := raised + 1;
  END LOOP;

  -- duplicate revenue guard (defence in depth against the unique index)
  SELECT count(*) INTO c_dup FROM (
    SELECT source_ref FROM revenue_events WHERE source_ref LIKE 'YTX-%'
     GROUP BY source_ref HAVING count(*) > 1) d;

  breaks := jsonb_build_object(
    'fulfilled_without_billing', c_unbilled,
    'invoice_unpaid', c_unpaid,
    'settlement_not_raised', c_no_settle,
    'eligible_without_revenue_event', c_no_rev,
    'settlement_variance', c_var,
    'duplicate_revenue_events', c_dup);

  RETURN jsonb_build_object('ok', true, 'scanned', scanned, 'exceptions_raised', raised,
    'exposure_cents', exposure, 'breaks', breaks, 'run_at', now());
END; $$;

-- SLA escalation, inside RBAC.
CREATE OR REPLACE FUNCTION public.escalate_breached_exceptions()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
  WITH bumped AS (
    UPDATE commercial_exceptions
       SET escalation_level = LEAST(COALESCE(escalation_level, 0) + 1, 3),
           status = 'escalated', notification_status = 'pending', updated_at = now()
     WHERE status IN ('open','acknowledged','in_progress')
       AND sla_due_at < now()
     RETURNING id)
  SELECT count(*) INTO n FROM bumped;
  RETURN jsonb_build_object('ok', true, 'escalated', n);
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.8 — Revenue integrity score
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_revenue_integrity()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  total int; fulfilled int; complete int; eligible int; recognised int; invoiced int; paid int;
  settled int; settled_ok int; rev_count int; rev_sum bigint; ledger_sum bigint; dup int;
  open_exc int; unbilled int; score numeric; lineage_pct numeric;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE fulfilled_at IS NOT NULL),
         count(*) FILTER (WHERE economics_complete),
         count(*) FILTER (WHERE financially_eligible),
         count(*) FILTER (WHERE recognised_at IS NOT NULL),
         count(*) FILTER (WHERE invoice_id IS NOT NULL),
         count(*) FILTER (WHERE paid_at IS NOT NULL),
         count(*) FILTER (WHERE fulfilled_at IS NOT NULL AND invoice_id IS NULL AND payment_ref IS NULL)
    INTO total, fulfilled, complete, eligible, recognised, invoiced, paid, unbilled
    FROM commercial_transactions WHERE cancelled_at IS NULL;

  SELECT count(*), count(*) FILTER (WHERE status IN ('reconciled','paid'))
    INTO settled, settled_ok FROM settlement_obligations;

  SELECT count(*), COALESCE(sum(gross_amount_cents), 0) INTO rev_count, rev_sum
    FROM revenue_events WHERE source_ref LIKE 'YTX-%' AND status = 'RECOGNIZED';

  SELECT COALESCE(sum(a.amount_cents), 0) INTO ledger_sum
    FROM revenue_allocations a JOIN revenue_events e ON e.id = a.event_id
   WHERE e.source_ref LIKE 'YTX-%' AND e.status = 'RECOGNIZED' AND a.kind = 'GROSS_REVENUE';

  SELECT count(*) INTO dup FROM (
    SELECT source_ref FROM revenue_events WHERE source_ref LIKE 'YTX-%'
     GROUP BY source_ref HAVING count(*) > 1) d;

  SELECT count(*) INTO open_exc FROM commercial_exceptions
   WHERE status IN ('open','acknowledged','in_progress','escalated');

  SELECT COALESCE(round(avg(CASE WHEN status <> 'missing' THEN 1 ELSE 0 END) * 100, 1), 0)
    INTO lineage_pct FROM commercial_lineage_stages;

  score := round((
      (CASE WHEN total = 0 THEN 0 ELSE complete::numeric / total END) * 25
    + (CASE WHEN eligible = 0 THEN CASE WHEN fulfilled = 0 THEN 0 ELSE 0 END
            ELSE recognised::numeric / GREATEST(eligible, 1) END) * 25
    + (CASE WHEN rev_sum = 0 AND ledger_sum = 0 THEN 0 WHEN rev_sum = ledger_sum THEN 1 ELSE 0 END) * 15
    + (CASE WHEN settled = 0 THEN 0 ELSE settled_ok::numeric / settled END) * 15
    + (CASE WHEN dup = 0 THEN 1 ELSE 0 END) * 10
    + (COALESCE(lineage_pct, 0) / 100) * 10) , 1);

  RETURN jsonb_build_object(
    'ok', true, 'score_pct', score, 'provenance', 'LIVE',
    'transactions', total, 'fulfilled', fulfilled, 'economics_complete', complete,
    'eligible', eligible, 'recognised', recognised, 'invoiced', invoiced, 'paid', paid,
    'unbilled_fulfilments', unbilled,
    'revenue_events', rev_count, 'revenue_events_cents', rev_sum, 'ledger_cents', ledger_sum,
    'ledger_reconciles', rev_sum = ledger_sum,
    'settlements', settled, 'settlements_reconciled', settled_ok,
    'duplicate_revenue_events', dup, 'open_exceptions', open_exc,
    'lineage_completeness_pct', COALESCE(lineage_pct, 0),
    'computed_at', now());
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.15 — Morning commercial brief
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_morning_brief(_as_of date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  y_start timestamptz := (_as_of - 1)::timestamptz;
  y_end timestamptz := _as_of::timestamptz;
  y_rev bigint; y_contrib bigint; y_tx int; y_ful int; y_coll bigint; y_exc int;
  risks jsonb; actions jsonb; approvals int; incidents int; learning jsonb;
BEGIN
  SELECT COALESCE(sum(gross_amount_cents), 0) INTO y_rev FROM revenue_events
   WHERE status = 'RECOGNIZED' AND recognized_at >= y_start AND recognized_at < y_end;

  SELECT COALESCE(sum(contribution_cents), 0), count(*),
         count(*) FILTER (WHERE fulfilled_at >= y_start AND fulfilled_at < y_end),
         COALESCE(sum(customer_charge_cents) FILTER (WHERE paid_at >= y_start AND paid_at < y_end), 0)
    INTO y_contrib, y_tx, y_ful, y_coll
    FROM commercial_transactions
   WHERE created_at >= y_start AND created_at < y_end OR (fulfilled_at >= y_start AND fulfilled_at < y_end);

  SELECT count(*) INTO y_exc FROM commercial_exceptions WHERE created_at >= y_start AND created_at < y_end;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'priority_score' DESC), '[]'::jsonb) INTO risks FROM (
    SELECT jsonb_build_object('exception_ref', exception_ref, 'transaction_ref', transaction_ref,
      'stage', stage, 'kind', kind, 'severity', severity,
      'exposure_cents', value_at_risk_cents, 'priority_score', priority_score,
      'sla_due_at', sla_due_at, 'owner_team', owner_team,
      'recommended_action', recommended_action) x
      FROM commercial_exceptions
     WHERE status IN ('open','acknowledged','in_progress','escalated')
     ORDER BY priority_score DESC NULLS LAST LIMIT 10) s;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO actions FROM (
    SELECT to_jsonb(a) - 'evidence' x FROM commercial_actions a
     WHERE a.status IN ('proposed','approved','in_progress')
     ORDER BY COALESCE(a.priority_score, 0) DESC LIMIT 10) s;

  SELECT count(*) INTO approvals FROM commercial_transactions WHERE financial_review_status = 'pending';
  SELECT count(*) INTO incidents FROM commercial_exceptions WHERE severity = 'critical'
     AND status IN ('open','acknowledged','in_progress','escalated');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('learning', learning, 'cause', cause,
    'variance_pct', variance_pct, 'created_at', created_at)), '[]'::jsonb) INTO learning
    FROM (SELECT * FROM commercial_decision_learning ORDER BY created_at DESC LIMIT 5) l;

  RETURN jsonb_build_object('ok', true, 'as_of', _as_of, 'provenance', 'LIVE',
    'yesterday', jsonb_build_object('revenue_cents', y_rev, 'contribution_cents', y_contrib,
      'transactions', y_tx, 'fulfilments', y_ful, 'collections_cents', y_coll, 'exceptions', y_exc),
    'today', jsonb_build_object('top_risks', risks, 'top_actions', actions,
      'approvals_required', approvals, 'critical_incidents', incidents),
    'learning', learning,
    'integrity', commercial_revenue_integrity());
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.16 / 8.5.17 — Explainable drill-down and the 14-stage trace
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_transaction_trace(_transaction_ref text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE tx record; stages jsonb; checks jsonb; exc jsonb; settle jsonb; rev jsonb;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
  SELECT * INTO tx FROM commercial_transactions WHERE transaction_ref = _transaction_ref;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  PERFORM rebuild_commercial_lineage(tx.id);

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.stage_no), '[]'::jsonb) INTO stages
    FROM commercial_lineage_stages s WHERE s.transaction_id = tx.id;
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.checked_at DESC), '[]'::jsonb) INTO checks
    FROM (SELECT * FROM revenue_eligibility_checks WHERE transaction_id = tx.id ORDER BY checked_at DESC LIMIT 10) c;
  SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb) INTO exc
    FROM commercial_exceptions e WHERE e.transaction_id = tx.id;
  SELECT COALESCE(to_jsonb(s), 'null'::jsonb) INTO settle
    FROM settlement_obligations s WHERE s.transaction_id = tx.id LIMIT 1;
  SELECT COALESCE(to_jsonb(r), 'null'::jsonb) INTO rev
    FROM revenue_events r WHERE r.source_ref = tx.transaction_ref LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'transaction', to_jsonb(tx), 'stages', stages,
    'eligibility_checks', checks, 'exceptions', exc, 'settlement', settle, 'revenue_event', rev);
END; $$;

CREATE OR REPLACE FUNCTION public.commercial_revenue_explain(_from timestamptz DEFAULT now() - interval '30 days')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE by_service jsonb; by_customer jsonb; events jsonb; total bigint;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;

  SELECT COALESCE(sum(e.gross_amount_cents), 0) INTO total FROM revenue_events e
   WHERE e.status = 'RECOGNIZED' AND e.recognized_at >= _from;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'amount_cents')::bigint DESC), '[]'::jsonb) INTO by_service FROM (
    SELECT jsonb_build_object('service_line', ct.service_line, 'events', count(*),
      'amount_cents', sum(e.gross_amount_cents)) x
      FROM revenue_events e JOIN commercial_transactions ct ON ct.transaction_ref = e.source_ref
     WHERE e.status = 'RECOGNIZED' AND e.recognized_at >= _from GROUP BY ct.service_line) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'amount_cents')::bigint DESC), '[]'::jsonb) INTO by_customer FROM (
    SELECT jsonb_build_object('customer_kind', ct.customer_kind, 'corporate_id', ct.corporate_id,
      'events', count(*), 'amount_cents', sum(e.gross_amount_cents)) x
      FROM revenue_events e JOIN commercial_transactions ct ON ct.transaction_ref = e.source_ref
     WHERE e.status = 'RECOGNIZED' AND e.recognized_at >= _from
     GROUP BY ct.customer_kind, ct.corporate_id LIMIT 25) s;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO events FROM (
    SELECT jsonb_build_object('transaction_ref', e.source_ref, 'amount_cents', e.gross_amount_cents,
      'recognized_at', e.recognized_at, 'rule_key', e.metadata->>'rule_key',
      'booking_table', e.metadata->>'booking_table', 'payment_ref', e.metadata->>'payment_ref') x
      FROM revenue_events e WHERE e.status = 'RECOGNIZED' AND e.recognized_at >= _from
     ORDER BY e.recognized_at DESC LIMIT 100) s;

  RETURN jsonb_build_object('ok', true, 'from', _from, 'total_cents', total, 'provenance', 'LIVE',
    'by_service_line', by_service, 'by_customer', by_customer, 'events', events);
END; $$;

CREATE OR REPLACE FUNCTION public.commercial_revenue_at_risk()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE items jsonb; total bigint;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
  SELECT COALESCE(sum(value_at_risk_cents), 0) INTO total FROM commercial_exceptions
   WHERE status IN ('open','acknowledged','in_progress','escalated');
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'priority_score')::numeric DESC NULLS LAST), '[]'::jsonb) INTO items FROM (
    SELECT jsonb_build_object('exception_ref', exception_ref, 'transaction_ref', transaction_ref,
      'stage', stage, 'kind', kind, 'severity', severity, 'exposure_cents', value_at_risk_cents,
      'priority_score', priority_score, 'owner_team', owner_team, 'sla_due_at', sla_due_at,
      'root_cause', root_cause, 'recommended_action', recommended_action, 'status', status) x
      FROM commercial_exceptions WHERE status IN ('open','acknowledged','in_progress','escalated')) s;
  RETURN jsonb_build_object('ok', true, 'total_at_risk_cents', total, 'items', items, 'provenance', 'LIVE');
END; $$;

-- ---------------------------------------------------------------------
-- 8.5.18 — Certification gate
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.certify_phase_8_5()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  integ jsonb; criteria jsonb := '[]'::jsonb; passed int := 0; total int := 0;
  dup int; eligible int; recognised int; rev_sum bigint; ledger_sum bigint;
  settle_var int; lineage_pct numeric; full_chain int; verdict text; score numeric; rid uuid;

  PROCEDURE_noop int;
  FUNCTION_add text;
BEGIN
  IF NOT is_commercial_staff() THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
  integ := commercial_revenue_integrity();

  dup := (integ->>'duplicate_revenue_events')::int;
  eligible := (integ->>'eligible')::int;
  recognised := (integ->>'recognised')::int;
  rev_sum := (integ->>'revenue_events_cents')::bigint;
  ledger_sum := (integ->>'ledger_cents')::bigint;
  lineage_pct := (integ->>'lineage_completeness_pct')::numeric;

  SELECT count(*) INTO settle_var FROM settlement_obligations WHERE status = 'variance';

  SELECT count(*) INTO full_chain FROM commercial_transactions ct
   WHERE ct.revenue_event_id IS NOT NULL AND ct.fulfilled_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM commercial_lineage_stages s
                      WHERE s.transaction_id = ct.id AND s.stage_no <= 12 AND s.status = 'missing');

  criteria := jsonb_build_array(
    jsonb_build_object('key','no_duplicate_revenue','label','No duplicate financial events','pass', dup = 0,
      'detail', format('%s duplicated revenue source references', dup)),
    jsonb_build_object('key','eligible_recognised','label','Every eligible fulfilment has exactly one revenue event',
      'pass', eligible = 0 OR recognised >= eligible,
      'detail', format('%s eligible, %s recognised', eligible, recognised)),
    jsonb_build_object('key','ledger_reconciles','label','Revenue events reconcile to the ledger',
      'pass', rev_sum = ledger_sum, 'detail', format('events %s vs ledger %s (cents)', rev_sum, ledger_sum)),
    jsonb_build_object('key','settlements_reconcile','label','Partner settlements reconcile',
      'pass', settle_var = 0, 'detail', format('%s settlement variances open', settle_var)),
    jsonb_build_object('key','lineage','label','Commercial lineage is recorded',
      'pass', COALESCE(lineage_pct,0) >= 80, 'detail', format('%s%% of stages carry an authoritative record', COALESCE(lineage_pct,0))),
    jsonb_build_object('key','end_to_end','label','At least one real transaction passes the full chain',
      'pass', full_chain > 0, 'detail', format('%s transactions trace demand to revenue ledger', full_chain)),
    jsonb_build_object('key','exceptions_detected','label','Exceptions are automatically detected',
      'pass', EXISTS (SELECT 1 FROM commercial_exceptions), 'detail', 'Reconciliation engine has raised exceptions'),
    jsonb_build_object('key','no_simulated_revenue','label','No simulated data presented as live',
      'pass', NOT EXISTS (SELECT 1 FROM revenue_events WHERE source_ref LIKE 'YTX-%'
                            AND COALESCE(metadata->>'provenance','LIVE') <> 'LIVE'),
      'detail', 'All recognised revenue carries LIVE provenance'));

  SELECT count(*) FILTER (WHERE (c->>'pass')::boolean), count(*) INTO passed, total
    FROM jsonb_array_elements(criteria) c;

  score := round((passed::numeric / GREATEST(total,1)) * 100, 1);
  verdict := CASE WHEN passed = total THEN 'PASS' ELSE 'FAIL' END;

  INSERT INTO commercial_certification_runs (phase, verdict, score, criteria, evidence, run_by)
  VALUES ('8.5', verdict, score, criteria, integ, auth.uid()) RETURNING id INTO rid;

  RETURN jsonb_build_object('ok', true, 'run_id', rid, 'verdict', verdict, 'score_pct', score,
    'criteria_passed', passed, 'criteria_total', total, 'criteria', criteria, 'integrity', integ);
END; $$;

-- ---------------------------------------------------------------------
-- Backfill lineage for the existing forensic records (no data invented)
-- ---------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM commercial_transactions LOOP
    PERFORM rebuild_commercial_lineage(t.id);
  END LOOP;
END $$;
