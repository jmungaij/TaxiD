-- =====================================================================
-- Phase 8.5 — Economic Chain Closure Completion
-- =====================================================================

-- 1. System-job identity helper -------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_system_job()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NULL
     AND current_user IN ('postgres', 'supabase_admin', 'service_role', 'authenticator');
$$;

REVOKE ALL ON FUNCTION public.is_system_job() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_system_job() TO authenticated, service_role;

-- 2. Offline payment attestations (append-only) ---------------------------------
CREATE TABLE IF NOT EXISTS public.offline_payment_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.commercial_transactions(id) ON DELETE RESTRICT,
  transaction_ref text NOT NULL,
  method text NOT NULL,
  reference text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  collected_at timestamptz NOT NULL DEFAULT now(),
  attested_by uuid,
  attested_by_identity text NOT NULL,
  attestation_note text,
  evidence_kind text NOT NULL DEFAULT 'operator_attestation',
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.offline_payment_attestations TO authenticated;
GRANT ALL ON public.offline_payment_attestations TO service_role;
ALTER TABLE public.offline_payment_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commercial staff read offline attestations" ON public.offline_payment_attestations;
CREATE POLICY "Commercial staff read offline attestations"
  ON public.offline_payment_attestations FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

CREATE OR REPLACE FUNCTION public._block_attestation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Offline payment attestations are append-only evidence and cannot be % ', TG_OP;
END; $$;

DROP TRIGGER IF EXISTS trg_opa_immutable ON public.offline_payment_attestations;
CREATE TRIGGER trg_opa_immutable
  BEFORE UPDATE OR DELETE ON public.offline_payment_attestations
  FOR EACH ROW EXECUTE FUNCTION public._block_attestation_mutation();

CREATE INDEX IF NOT EXISTS offline_payment_attestations_tx_idx
  ON public.offline_payment_attestations (transaction_id, created_at DESC);

-- 3. Attest an off-platform payment --------------------------------------------
CREATE OR REPLACE FUNCTION public.attest_offline_payment(
  _transaction_id uuid,
  _method text,
  _reference text,
  _attested_by_identity text,
  _amount_cents bigint DEFAULT NULL,
  _collected_at timestamptz DEFAULT NULL,
  _note text DEFAULT NULL,
  _source text DEFAULT 'manual'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE tx record; amount bigint; att_id uuid; when_paid timestamptz;
BEGIN
  IF NOT (public.is_finance_approver(auth.uid()) OR public.is_system_job()) THEN
    RAISE EXCEPTION 'Only finance approvers may attest off-platform payments';
  END IF;
  IF _method IS NULL OR length(trim(_method)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'method_required');
  END IF;
  IF _reference IS NULL OR length(trim(_reference)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reference_required');
  END IF;
  IF _attested_by_identity IS NULL OR length(trim(_attested_by_identity)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attester_identity_required');
  END IF;

  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id FOR UPDATE;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;
  IF tx.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transaction_cancelled');
  END IF;
  IF tx.fulfilled_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_fulfilled',
      'reason', 'Nothing is collectable until the service is authoritatively fulfilled.');
  END IF;
  IF tx.payment_ref IS NOT NULL AND tx.payment_status IN ('paid', 'captured', 'paid_offline') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'transaction_ref', tx.transaction_ref,
      'reason', 'An authoritative payment is already recorded for this transaction.');
  END IF;

  amount := COALESCE(_amount_cents, tx.customer_charge_cents, tx.gross_transaction_value_cents);
  IF amount IS NULL OR amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_unknown',
      'reason', 'No collectable amount is stated on the transaction and none was supplied.');
  END IF;
  when_paid := COALESCE(_collected_at, tx.fulfilled_at, now());

  INSERT INTO offline_payment_attestations (transaction_id, transaction_ref, method, reference,
    amount_cents, currency, collected_at, attested_by, attested_by_identity, attestation_note,
    evidence_kind, source)
  VALUES (tx.id, tx.transaction_ref, trim(_method), trim(_reference), amount,
    COALESCE(tx.currency, 'KES'), when_paid, auth.uid(), trim(_attested_by_identity), _note,
    'operator_attestation', _source)
  RETURNING id INTO att_id;

  UPDATE commercial_transactions SET
    payment_ref = trim(_reference),
    payment_status = 'paid_offline',
    payment_provider = trim(_method),
    paid_at = when_paid,
    payment_evidence_kind = 'operator_attestation',
    updated_at = now()
  WHERE id = tx.id;

  PERFORM public.log_finance_change('commercial_transactions', tx.transaction_ref, tx.id, 'UPDATE',
    'payment_ref', 'payment', COALESCE(tx.payment_ref, '(none)'), trim(_reference), NULL,
    jsonb_build_object('attestation_id', att_id, 'method', trim(_method), 'amount_cents', amount,
      'evidence_kind', 'operator_attestation', 'attested_by_identity', trim(_attested_by_identity)),
    _source, format('Off-platform payment attested by %s: %s.', trim(_attested_by_identity),
      COALESCE(_note, 'no note supplied')));

  PERFORM public.record_lineage_stage(tx.id, 9::smallint, 'payment', trim(_reference),
    'offline_payment_attestations', 'recorded', when_paid, _source, 'human', auth.uid(),
    jsonb_build_object('attestation_id', att_id, 'evidence_kind', 'operator_attestation',
      'amount_cents', amount, 'confidence', 'attested_not_system_captured'));

  PERFORM public.check_revenue_eligibility(tx.id, 'offline_attestation');

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'attestation_id', att_id,
    'transaction_ref', tx.transaction_ref, 'amount_cents', amount,
    'evidence_kind', 'operator_attestation');
END; $$;

REVOKE ALL ON FUNCTION public.attest_offline_payment(uuid, text, text, text, bigint, timestamptz, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.attest_offline_payment(uuid, text, text, text, bigint, timestamptz, text, text) TO authenticated, service_role;

-- 4. Eligibility: invoice only required for account-billed corporate work -------
CREATE OR REPLACE FUNCTION public.check_revenue_eligibility(_transaction_id uuid, _source text DEFAULT 'manual'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  tx record; r record; missing text[] := ARRAY[]::text[]; blockers text[] := ARRAY[]::text[];
  complete boolean; eligible boolean; amount bigint; reason text; needs_payment boolean;
  needs_invoice boolean;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  SELECT * INTO r FROM revenue_recognition_rules
   WHERE is_active AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
     AND service_line = tx.service_line
   ORDER BY effective_from DESC LIMIT 1;

  needs_payment := COALESCE(r.requires_payment, true);
  -- An invoice can only be demanded where an account is actually billed. Pay-as-you-go
  -- work settled directly by the traveller recognises on payment evidence instead.
  needs_invoice := COALESCE(r.requires_invoice, false) AND tx.corporate_id IS NOT NULL;

  IF tx.currency IS NULL OR length(trim(tx.currency)) = 0 THEN missing := array_append(missing, 'currency'); END IF;
  IF tx.customer_charge_cents IS NULL THEN missing := array_append(missing, 'customer_charge_cents'); END IF;
  IF tx.gross_transaction_value_cents IS NULL THEN missing := array_append(missing, 'gross_transaction_value_cents'); END IF;
  IF tx.tax_cents IS NULL THEN missing := array_append(missing, 'tax_cents'); END IF;
  IF tx.platform_revenue_cents IS NULL THEN missing := array_append(missing, 'commission_platform_revenue_cents'); END IF;
  IF tx.partner_entitlement_cents IS NULL THEN missing := array_append(missing, 'partner_entitlement_cents'); END IF;
  IF tx.provider_ref IS NULL THEN missing := array_append(missing, 'provider_ref'); END IF;
  IF needs_payment AND tx.payment_ref IS NULL THEN missing := array_append(missing, 'payment_ref'); END IF;
  IF needs_payment AND tx.payment_status IS NULL THEN missing := array_append(missing, 'payment_status'); END IF;
  IF needs_invoice AND tx.invoice_id IS NULL THEN missing := array_append(missing, 'invoice_id'); END IF;
  IF tx.fulfilled_at IS NULL THEN missing := array_append(missing, 'fulfilled_at'); END IF;

  complete := array_length(missing, 1) IS NULL;

  IF r.rule_key IS NULL THEN
    blockers := array_append(blockers, format('No active recognition rule covers service line "%s".', tx.service_line));
  ELSE
    IF r.approved_by IS NULL THEN blockers := array_append(blockers, format('Recognition rule %s has not been signed off by finance.', r.rule_key)); END IF;
    IF r.requires_fulfilment AND tx.fulfilled_at IS NULL THEN blockers := array_append(blockers, 'Service is not authoritatively fulfilled.'); END IF;
    IF r.requires_payment AND tx.paid_at IS NULL THEN blockers := array_append(blockers, 'Rule requires captured payment; no authoritative capture recorded.'); END IF;
    IF needs_invoice AND tx.invoice_id IS NULL THEN blockers := array_append(blockers, 'Rule requires an issued invoice for account-billed work; none linked.'); END IF;
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
    'rule_key', r.rule_key, 'reason', reason, 'invoice_required', needs_invoice,
    'recognisable_amount_cents', CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END);
END; $function$;

-- 5. Lineage backfill from authoritative references ----------------------------
CREATE OR REPLACE FUNCTION public.backfill_commercial_lineage(_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE tx record; scanned int := 0; recorded int := 0;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_system_job()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  FOR tx IN SELECT * FROM commercial_transactions ORDER BY created_at LIMIT _limit LOOP
    scanned := scanned + 1;

    IF tx.demand_intent_ref IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 1::smallint, 'market_signal', tx.demand_intent_ref,
        'demand_intents', 'recorded', tx.created_at, 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.opportunity_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 2::smallint, 'opportunity_intent', tx.opportunity_id::text,
        'commercial_opportunities', 'recorded', tx.created_at, 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.quote_id IS NOT NULL OR tx.offer_ref IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 3::smallint, 'offer',
        COALESCE(tx.offer_ref, tx.quote_id::text), 'charter_quotes', 'recorded',
        tx.created_at, 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.commitment_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 4::smallint, 'capacity_commitment', tx.commitment_id::text,
        'capacity_commitments', 'recorded', tx.committed_at, 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.booking_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 5::smallint, 'booking', tx.booking_id::text,
        tx.booking_table, 'recorded', COALESCE(tx.booked_at, tx.created_at), 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.dispatch_assignment_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 6::smallint, 'orchestration', tx.dispatch_assignment_id::text,
        'dispatch_assignments', 'recorded', COALESCE(tx.accepted_at, tx.booked_at), 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.fulfilled_at IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 7::smallint, 'fulfilment',
        COALESCE(tx.booking_id::text, tx.transaction_ref), tx.booking_table, 'recorded',
        tx.fulfilled_at, 'lineage_backfill', 'system', NULL,
        jsonb_build_object('fulfilment_source', tx.fulfilment_source));
      recorded := recorded + 1;
    END IF;
    IF tx.invoice_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 8::smallint, 'invoice', tx.invoice_id::text,
        tx.invoice_table, 'recorded', COALESCE(tx.booked_at, tx.created_at), 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.payment_ref IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 9::smallint, 'payment', tx.payment_ref,
        COALESCE(tx.payment_table, 'mpesa_transactions'), 'recorded',
        COALESCE(tx.paid_at, tx.fulfilled_at), 'lineage_backfill', 'system', NULL,
        jsonb_build_object('payment_status', tx.payment_status,
          'evidence_kind', tx.payment_evidence_kind));
      recorded := recorded + 1;
    END IF;
    IF tx.settlement_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 10::smallint, 'settlement', tx.settlement_id::text,
        'settlement_obligations', 'recorded', tx.fulfilled_at, 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
    IF tx.revenue_event_id IS NOT NULL THEN
      PERFORM record_lineage_stage(tx.id, 11::smallint, 'revenue_event', tx.revenue_event_id::text,
        'revenue_events', 'recorded', tx.recognised_at, 'lineage_backfill');
      recorded := recorded + 1;
      PERFORM record_lineage_stage(tx.id, 12::smallint, 'revenue_ledger', tx.revenue_event_id::text,
        'revenue_allocations', 'recorded', tx.recognised_at, 'lineage_backfill');
      recorded := recorded + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', scanned, 'stages_recorded', recorded,
    'note', 'Only stages with an authoritative reference were recorded; the rest remain missing.');
END; $$;

REVOKE ALL ON FUNCTION public.backfill_commercial_lineage(integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.backfill_commercial_lineage(integer) TO authenticated, service_role;

-- 6. Partner settlement payout reconciliation ----------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_settlement_payout(
  _settlement_id uuid,
  _paid_cents bigint,
  _payout_ref text DEFAULT NULL,
  _paid_at timestamptz DEFAULT NULL,
  _variance_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s record; var bigint; new_status text;
BEGIN
  IF NOT (public.is_finance_approver(auth.uid()) OR public.is_system_job()) THEN
    RAISE EXCEPTION 'Only finance approvers may reconcile partner settlements';
  END IF;

  SELECT * INTO s FROM settlement_obligations WHERE id = _settlement_id FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'settlement_not_found'); END IF;
  IF s.status IN ('reconciled', 'paid') AND s.reconciled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'settlement_id', s.id, 'status', s.status);
  END IF;

  var := COALESCE(_paid_cents, 0) - s.entitlement_cents;
  new_status := CASE WHEN var = 0 THEN 'reconciled' ELSE 'variance' END;

  IF new_status = 'variance' AND (_variance_reason IS NULL OR length(trim(_variance_reason)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'variance_reason_required',
      'variance_cents', var,
      'reason', 'A settlement that does not match the entitlement needs a stated reason.');
  END IF;

  UPDATE settlement_obligations SET
    paid_cents = _paid_cents,
    paid_at = COALESCE(_paid_at, now()),
    reconciled_at = now(),
    variance_cents = var,
    variance_reason = CASE WHEN var = 0 THEN NULL ELSE trim(_variance_reason) END,
    status = new_status,
    updated_at = now()
  WHERE id = s.id;

  PERFORM public.record_lineage_stage(s.transaction_id, 10::smallint, 'settlement', s.id::text,
    'settlement_obligations', 'recorded', COALESCE(_paid_at, now()), 'settlement_reconciliation',
    'system', auth.uid(),
    jsonb_build_object('entitlement_cents', s.entitlement_cents, 'paid_cents', _paid_cents,
      'variance_cents', var, 'payout_ref', _payout_ref));

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'settlement_id', s.id,
    'status', new_status, 'entitlement_cents', s.entitlement_cents,
    'paid_cents', _paid_cents, 'variance_cents', var);
END; $$;

REVOKE ALL ON FUNCTION public.reconcile_settlement_payout(uuid, bigint, text, timestamptz, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reconcile_settlement_payout(uuid, bigint, text, timestamptz, text) TO authenticated, service_role;

-- 7. Outcome and learning capture ---------------------------------------------
CREATE OR REPLACE FUNCTION public.record_transaction_outcome(
  _transaction_id uuid,
  _outcome text DEFAULT NULL,
  _learning text DEFAULT NULL,
  _source text DEFAULT 'closure_engine'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE tx record; outcome_label text; learning_note text;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_system_job()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;
  IF tx.recognised_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_recognised',
      'reason', 'An economic outcome is only meaningful once revenue is recognised.');
  END IF;

  outcome_label := COALESCE(_outcome, CASE
    WHEN COALESCE(tx.refund_cents, 0) > 0 THEN 'served_with_refund'
    WHEN tx.contribution_cents IS NULL THEN 'served_contribution_unknown'
    WHEN tx.contribution_cents > 0 THEN 'served_contribution_positive'
    ELSE 'served_contribution_negative' END);

  learning_note := COALESCE(_learning, CASE
    WHEN tx.payment_evidence_kind = 'operator_attestation'
      THEN 'Payment evidence was an operator attestation rather than a system capture; strengthen capture at source for this service line.'
    WHEN tx.financial_auto_approved
      THEN 'Economics were complete enough for automated sign-off; capture-at-source is working for this path.'
    ELSE 'Economics required manual finance review; check which field was missing at source.' END);

  PERFORM public.record_lineage_stage(tx.id, 13::smallint, 'outcome', outcome_label,
    'commercial_transactions', 'recorded', COALESCE(tx.recognised_at, now()), _source, 'system', auth.uid(),
    jsonb_build_object('contribution_cents', tx.contribution_cents,
      'refund_cents', tx.refund_cents, 'service_line', tx.service_line));

  PERFORM public.record_lineage_stage(tx.id, 14::smallint, 'learning', left(learning_note, 120),
    'commercial_decision_learning', 'recorded', now(), _source, 'system', auth.uid(),
    jsonb_build_object('learning', learning_note,
      'payment_evidence_kind', tx.payment_evidence_kind,
      'auto_approved', tx.financial_auto_approved));

  RETURN jsonb_build_object('ok', true, 'transaction_ref', tx.transaction_ref,
    'outcome', outcome_label, 'learning', learning_note);
END; $$;

REVOKE ALL ON FUNCTION public.record_transaction_outcome(uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_transaction_outcome(uuid, text, text, text) TO authenticated, service_role;

-- 8. Close one transaction end to end -----------------------------------------
CREATE OR REPLACE FUNCTION public.close_commercial_transaction(
  _transaction_id uuid,
  _settle boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx record; steps jsonb := '[]'::jsonb; elig jsonb; emitted jsonb; settle jsonb;
  outcome jsonb; obligation record; stopped text;
BEGIN
  IF NOT (public.is_finance_approver(auth.uid()) OR public.is_system_job()) THEN
    RAISE EXCEPTION 'Only finance approvers may close a commercial chain';
  END IF;

  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  elig := public.check_revenue_eligibility(tx.id, 'closure_engine');
  steps := steps || jsonb_build_object('step', 'eligibility',
    'eligible', elig->'eligible', 'blockers', elig->'blockers');

  IF NOT COALESCE((elig->>'eligible')::boolean, false) THEN
    stopped := 'eligibility';
  ELSE
    emitted := public.emit_revenue_event(tx.id, 'closure_engine');
    steps := steps || jsonb_build_object('step', 'revenue_event', 'result', emitted);
    IF NOT COALESCE((emitted->>'ok')::boolean, false) THEN
      stopped := 'revenue_event';
    ELSE
      PERFORM public.record_lineage_stage(tx.id, 12::smallint, 'revenue_ledger',
        COALESCE(emitted->>'revenue_event_id', tx.revenue_event_id::text), 'revenue_allocations',
        'recorded', now(), 'closure_engine');

      IF _settle AND COALESCE(tx.partner_entitlement_cents, 0) > 0 THEN
        settle := public.create_settlement_obligation(tx.id);
        steps := steps || jsonb_build_object('step', 'settlement_obligation', 'result', settle);

        SELECT * INTO obligation FROM settlement_obligations WHERE transaction_id = tx.id LIMIT 1;
        IF obligation.id IS NOT NULL AND obligation.reconciled_at IS NULL THEN
          settle := public.reconcile_settlement_payout(obligation.id, obligation.entitlement_cents,
            format('PAYOUT-%s', tx.transaction_ref), COALESCE(tx.paid_at, now()), NULL);
          steps := steps || jsonb_build_object('step', 'settlement_reconciliation', 'result', settle);
        END IF;
      END IF;

      outcome := public.record_transaction_outcome(tx.id, NULL, NULL, 'closure_engine');
      steps := steps || jsonb_build_object('step', 'outcome_learning', 'result', outcome);
      stopped := NULL;
    END IF;
  END IF;

  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;

  RETURN jsonb_build_object('ok', stopped IS NULL, 'transaction_ref', tx.transaction_ref,
    'closed', stopped IS NULL, 'stopped_at', stopped, 'steps', steps,
    'recognised_at', tx.recognised_at, 'revenue_event_id', tx.revenue_event_id,
    'settlement_id', tx.settlement_id);
END; $$;

REVOKE ALL ON FUNCTION public.close_commercial_transaction(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.close_commercial_transaction(uuid, boolean) TO authenticated, service_role;

-- 9. Batch closure across fulfilled work --------------------------------------
CREATE OR REPLACE FUNCTION public.run_phase_85_closure(
  _dry_run boolean DEFAULT true,
  _limit integer DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx record; res jsonb; scanned int := 0; closed int := 0; blocked int := 0;
  results jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_finance_approver(auth.uid()) OR public.is_system_job()) THEN
    RAISE EXCEPTION 'Only finance approvers may run the closure batch';
  END IF;

  PERFORM public.backfill_commercial_lineage(_limit);

  FOR tx IN
    SELECT * FROM commercial_transactions
     WHERE fulfilled_at IS NOT NULL AND cancelled_at IS NULL AND recognised_at IS NULL
     ORDER BY fulfilled_at LIMIT _limit
  LOOP
    scanned := scanned + 1;
    IF _dry_run THEN
      res := public.check_revenue_eligibility(tx.id, 'closure_dry_run');
      IF COALESCE((res->>'eligible')::boolean, false) THEN closed := closed + 1;
      ELSE blocked := blocked + 1; END IF;
      results := results || jsonb_build_object('transaction_ref', tx.transaction_ref,
        'would_close', res->'eligible', 'blockers', res->'blockers');
    ELSE
      res := public.close_commercial_transaction(tx.id, true);
      IF COALESCE((res->>'closed')::boolean, false) THEN closed := closed + 1;
      ELSE blocked := blocked + 1; END IF;
      results := results || jsonb_build_object('transaction_ref', tx.transaction_ref,
        'closed', res->'closed', 'stopped_at', res->'stopped_at', 'steps', res->'steps');
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'dry_run', _dry_run, 'scanned', scanned,
    'closed', closed, 'blocked', blocked, 'results', results);
END; $$;

REVOKE ALL ON FUNCTION public.run_phase_85_closure(boolean, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.run_phase_85_closure(boolean, integer) TO authenticated, service_role;