-- ============================================================
-- Phase 8.5.x — Finance governance: immutable audit, RBAC,
-- shared eligibility pre-check, confidence-based auto sign-off.
-- ============================================================

-- 1. Canonical finance authority --------------------------------
CREATE OR REPLACE FUNCTION public.is_finance_approver(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid, 'finance_admin'::app_role) OR
    public.has_role(_uid, 'super_admin'::app_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_finance_auditor(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid, 'finance_admin'::app_role) OR
    public.has_role(_uid, 'super_admin'::app_role) OR
    public.has_role(_uid, 'compliance_admin'::app_role)
  );
$$;

-- 2. Immutable finance change audit ----------------------------
CREATE TABLE IF NOT EXISTS public.finance_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL,
  entity_key text NOT NULL,
  entity_id uuid,
  operation text NOT NULL,
  field text NOT NULL,
  field_class text NOT NULL,
  value_before text,
  value_after text,
  snapshot_before jsonb,
  snapshot_after jsonb,
  changed_by uuid,
  changed_by_email text,
  change_source text NOT NULL DEFAULT 'app',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fca_entity_kind_check CHECK (entity_kind IN
    ('service_line_financial_terms','revenue_recognition_rules','commercial_transactions','city_pricing_rules')),
  CONSTRAINT fca_operation_check CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  CONSTRAINT fca_field_class_check CHECK (field_class IN
    ('currency','tax','commission','partner_entitlement','recognition_rule','review','other'))
);

CREATE INDEX IF NOT EXISTS idx_fca_entity ON public.finance_change_audit (entity_kind, entity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fca_class ON public.finance_change_audit (field_class, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fca_actor ON public.finance_change_audit (changed_by, created_at DESC);

GRANT SELECT ON public.finance_change_audit TO authenticated;
GRANT ALL ON public.finance_change_audit TO service_role;
ALTER TABLE public.finance_change_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance and compliance read finance audit" ON public.finance_change_audit;
CREATE POLICY "finance and compliance read finance audit"
  ON public.finance_change_audit FOR SELECT TO authenticated
  USING (public.is_finance_auditor(auth.uid()));

-- Append-only: no client inserts, and never any update or delete.
CREATE OR REPLACE FUNCTION public.deny_finance_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'finance_change_audit is append-only and immutable';
END; $$;

DROP TRIGGER IF EXISTS trg_fca_immutable ON public.finance_change_audit;
CREATE TRIGGER trg_fca_immutable
  BEFORE UPDATE OR DELETE ON public.finance_change_audit
  FOR EACH ROW EXECUTE FUNCTION public.deny_finance_audit_mutation();

-- 3. Audit writer + change triggers ----------------------------
CREATE OR REPLACE FUNCTION public.log_finance_change(
  _entity_kind text, _entity_key text, _entity_id uuid, _operation text,
  _field text, _field_class text, _before text, _after text,
  _snapshot_before jsonb, _snapshot_after jsonb, _source text DEFAULT 'app', _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); actor_email text;
BEGIN
  SELECT email INTO actor_email FROM auth.users WHERE id = actor;
  INSERT INTO public.finance_change_audit (entity_kind, entity_key, entity_id, operation, field,
    field_class, value_before, value_after, snapshot_before, snapshot_after, changed_by,
    changed_by_email, change_source, reason)
  VALUES (_entity_kind, _entity_key, _entity_id, _operation, _field, _field_class, _before, _after,
    _snapshot_before, _snapshot_after, actor, actor_email, COALESCE(_source,'app'), _reason);
END; $$;

REVOKE ALL ON FUNCTION public.log_finance_change(text,text,uuid,text,text,text,text,text,jsonb,jsonb,text,text) FROM public, anon, authenticated;

-- generic diff trigger driven by field->class mapping in TG_ARGV[0..]
CREATE OR REPLACE FUNCTION public.audit_finance_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  entity_kind text := TG_TABLE_NAME;
  key_col text := TG_ARGV[0];
  pairs text[] := TG_ARGV[1:array_length(TG_ARGV,1)-1];
  jb jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  jold jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  jnew jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  ent_key text; ent_id uuid; i integer; fld text; cls text; b text; a text;
BEGIN
  ent_key := jb->>key_col;
  BEGIN ent_id := (jb->>'id')::uuid; EXCEPTION WHEN others THEN ent_id := NULL; END;

  i := 1;
  WHILE i <= array_length(pairs,1) LOOP
    fld := pairs[i]; cls := pairs[i+1];
    b := jold->>fld; a := jnew->>fld;
    IF TG_OP = 'UPDATE' AND b IS NOT DISTINCT FROM a THEN
      i := i + 2; CONTINUE;
    END IF;
    IF TG_OP = 'INSERT' AND a IS NULL THEN i := i + 2; CONTINUE; END IF;
    PERFORM public.log_finance_change(entity_kind, ent_key, ent_id, TG_OP, fld, cls, b, a,
      jold, jnew, 'db_trigger', NULL);
    i := i + 2;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_slft ON public.service_line_financial_terms;
CREATE TRIGGER trg_audit_slft
  AFTER INSERT OR UPDATE OR DELETE ON public.service_line_financial_terms
  FOR EACH ROW EXECUTE FUNCTION public.audit_finance_fields('service_line',
    'currency','currency','tax_rate_bps','tax','tax_inclusive','tax',
    'commission_bps','commission','payment_cost_bps','commission',
    'principal_contract','partner_entitlement','approved_by','review');

DROP TRIGGER IF EXISTS trg_audit_rrr ON public.revenue_recognition_rules;
CREATE TRIGGER trg_audit_rrr
  AFTER INSERT OR UPDATE OR DELETE ON public.revenue_recognition_rules
  FOR EACH ROW EXECUTE FUNCTION public.audit_finance_fields('rule_key',
    'approved_by','review','approved_at','review','is_active','recognition_rule',
    'recognise_gross','recognition_rule','requires_payment','recognition_rule',
    'requires_invoice','recognition_rule','requires_settlement','recognition_rule',
    'requires_fulfilment','recognition_rule','requires_economics_complete','recognition_rule',
    'min_amount_cents','recognition_rule','effective_from','recognition_rule','effective_to','recognition_rule');

DROP TRIGGER IF EXISTS trg_audit_ctx_money ON public.commercial_transactions;
CREATE TRIGGER trg_audit_ctx_money
  AFTER UPDATE ON public.commercial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_finance_fields('transaction_ref',
    'currency','currency','tax_cents','tax','platform_revenue_cents','commission',
    'partner_entitlement_cents','partner_entitlement','payment_cost_cents','commission',
    'financial_review_status','review','financial_reviewed_by','review');

-- 4. Shared, read-only Gate H pre-check ------------------------
CREATE OR REPLACE FUNCTION public.revenue_gate_precheck(
  _transaction_ref text DEFAULT NULL, _transaction_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx record; r record; missing text[] := ARRAY[]::text[]; blockers text[] := ARRAY[]::text[];
  complete boolean; eligible boolean; amount bigint; needs_payment boolean;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_finance_auditor(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to pre-check revenue eligibility';
  END IF;
  IF _transaction_id IS NULL AND _transaction_ref IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transaction_identifier_required');
  END IF;

  SELECT * INTO tx FROM commercial_transactions
   WHERE (_transaction_id IS NOT NULL AND id = _transaction_id)
      OR (_transaction_id IS NULL AND transaction_ref = upper(trim(_transaction_ref)))
   LIMIT 1;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'transaction_not_found'); END IF;

  SELECT * INTO r FROM revenue_recognition_rules
   WHERE is_active AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
     AND service_line = tx.service_line
   ORDER BY effective_from DESC LIMIT 1;

  needs_payment := COALESCE(r.requires_payment, true);

  IF tx.currency IS NULL OR length(trim(tx.currency)) = 0 THEN missing := array_append(missing,'currency'); END IF;
  IF tx.customer_charge_cents IS NULL THEN missing := array_append(missing,'customer_charge_cents'); END IF;
  IF tx.gross_transaction_value_cents IS NULL THEN missing := array_append(missing,'gross_transaction_value_cents'); END IF;
  IF tx.tax_cents IS NULL THEN missing := array_append(missing,'tax_cents'); END IF;
  IF tx.platform_revenue_cents IS NULL THEN missing := array_append(missing,'commission_platform_revenue_cents'); END IF;
  IF tx.partner_entitlement_cents IS NULL THEN missing := array_append(missing,'partner_entitlement_cents'); END IF;
  IF tx.provider_ref IS NULL THEN missing := array_append(missing,'provider_ref'); END IF;
  IF needs_payment AND tx.payment_ref IS NULL THEN missing := array_append(missing,'payment_ref'); END IF;
  IF needs_payment AND tx.payment_status IS NULL THEN missing := array_append(missing,'payment_status'); END IF;
  IF COALESCE(r.requires_invoice,false) AND tx.invoice_id IS NULL THEN missing := array_append(missing,'invoice_id'); END IF;
  IF tx.fulfilled_at IS NULL THEN missing := array_append(missing,'fulfilled_at'); END IF;

  complete := array_length(missing,1) IS NULL;

  IF r.rule_key IS NULL THEN
    blockers := array_append(blockers, format('No active recognition rule covers service line "%s".', tx.service_line));
  ELSE
    IF r.approved_by IS NULL THEN blockers := array_append(blockers, format('Recognition rule %s has not been signed off by finance.', r.rule_key)); END IF;
    IF r.requires_fulfilment AND tx.fulfilled_at IS NULL THEN blockers := array_append(blockers,'Service is not authoritatively fulfilled.'); END IF;
    IF r.requires_payment AND tx.paid_at IS NULL THEN blockers := array_append(blockers,'Rule requires captured payment; no authoritative capture recorded.'); END IF;
    IF r.requires_invoice AND tx.invoice_id IS NULL THEN blockers := array_append(blockers,'Rule requires an issued invoice; none linked.'); END IF;
    IF r.requires_settlement AND tx.settlement_id IS NULL THEN blockers := array_append(blockers,'Rule requires partner settlement; none linked.'); END IF;
    IF r.requires_economics_complete AND NOT complete THEN
      blockers := array_append(blockers, format('Economics incomplete — missing %s.', array_to_string(missing,', ')));
    END IF;
    amount := CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END;
    IF amount IS NULL THEN blockers := array_append(blockers,'Recognisable amount is not stated.');
    ELSIF amount < r.min_amount_cents THEN blockers := array_append(blockers,'Recognisable amount is below the rule minimum.'); END IF;
  END IF;

  IF tx.recognised_at IS NOT NULL THEN blockers := array_append(blockers,'Revenue has already been recognised.'); END IF;
  IF tx.cancelled_at IS NOT NULL THEN blockers := array_append(blockers,'Transaction is cancelled.'); END IF;
  IF tx.financial_review_status <> 'approved' THEN
    blockers := array_append(blockers, format('Captured financial fields are %s finance review.', tx.financial_review_status));
  END IF;

  eligible := array_length(blockers,1) IS NULL;

  RETURN jsonb_build_object(
    'ok', true, 'read_only', true,
    'transaction_id', tx.id, 'transaction_ref', tx.transaction_ref,
    'service_line', tx.service_line, 'status', tx.status,
    'rule_key', r.rule_key, 'eligible', eligible,
    'economics_complete', complete,
    'missing_fields', to_jsonb(missing), 'blockers', to_jsonb(blockers),
    'review_status', tx.financial_review_status,
    'financials_source', tx.financials_source,
    'recognisable_amount_cents', CASE WHEN r.recognise_gross THEN tx.gross_transaction_value_cents ELSE tx.platform_revenue_cents END,
    'reason', CASE WHEN eligible THEN format('Eligible under %s.', r.rule_key) ELSE array_to_string(blockers,' ') END,
    'checked_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.revenue_gate_precheck(text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revenue_gate_precheck(text,uuid) TO authenticated, service_role;

-- 5. Confidence-scored auto sign-off ---------------------------
ALTER TABLE public.commercial_transactions
  ADD COLUMN IF NOT EXISTS financial_confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS financial_auto_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financial_confidence_factors jsonb;

CREATE TABLE IF NOT EXISTS public.financial_autoapproval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by uuid,
  dry_run boolean NOT NULL DEFAULT true,
  threshold numeric(5,2) NOT NULL DEFAULT 85,
  scanned integer NOT NULL DEFAULT 0,
  auto_approved integer NOT NULL DEFAULT 0,
  left_for_review integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

GRANT SELECT ON public.financial_autoapproval_runs TO authenticated;
GRANT ALL ON public.financial_autoapproval_runs TO service_role;
ALTER TABLE public.financial_autoapproval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance reads autoapproval runs" ON public.financial_autoapproval_runs;
CREATE POLICY "finance reads autoapproval runs"
  ON public.financial_autoapproval_runs FOR SELECT TO authenticated
  USING (public.is_finance_auditor(auth.uid()));

-- Score one transaction's captured financials (read-only).
CREATE OR REPLACE FUNCTION public.score_financial_capture(_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx record; terms record; pre jsonb; score numeric := 0;
  factors jsonb := '[]'::jsonb; ambiguities text[] := ARRAY[]::text[];
  waterfall bigint; variance bigint; paid_ok boolean;
BEGIN
  SELECT * INTO tx FROM commercial_transactions WHERE id = _transaction_id;
  IF tx.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error','transaction_not_found'); END IF;
  SELECT * INTO terms FROM service_line_financial_terms WHERE service_line = tx.service_line;
  pre := public.revenue_gate_precheck(NULL, _transaction_id);

  IF COALESCE((pre->>'economics_complete')::boolean, false) THEN
    score := score + 40; factors := factors || jsonb_build_object('factor','economics_complete','weight',40);
  ELSE
    ambiguities := array_append(ambiguities, format('Missing fields: %s',
      COALESCE(nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(pre->'missing_fields')), ', '),''),'unknown')));
  END IF;

  IF tx.financials_source IS NULL THEN
    ambiguities := array_append(ambiguities,'No capture provenance recorded.');
  ELSIF tx.financials_source LIKE 'capture_at_source%' THEN
    score := score + 25; factors := factors || jsonb_build_object('factor','captured_at_source','weight',25);
  ELSIF tx.financials_source LIKE 'backfill_derived_from_terms%' THEN
    score := score + 18; factors := factors || jsonb_build_object('factor','derived_from_approved_terms','weight',18);
  ELSE
    score := score + 8; factors := factors || jsonb_build_object('factor','other_provenance','weight',8);
  END IF;

  IF terms.service_line IS NULL THEN
    ambiguities := array_append(ambiguities, format('No financial terms exist for service line %s.', tx.service_line));
  ELSIF terms.approved_by IS NULL THEN
    ambiguities := array_append(ambiguities, format('Financial terms for %s are not signed off.', tx.service_line));
  ELSE
    score := score + 12; factors := factors || jsonb_build_object('factor','terms_signed_off','weight',12);
  END IF;

  paid_ok := tx.payment_ref IS NOT NULL AND tx.paid_at IS NOT NULL
    AND lower(COALESCE(tx.payment_status,'')) IN ('completed','success','succeeded','paid','captured','settled');
  IF paid_ok THEN
    score := score + 20; factors := factors || jsonb_build_object('factor','verified_payment_evidence','weight',20);
  ELSIF tx.payment_ref IS NOT NULL THEN
    score := score + 6; factors := factors || jsonb_build_object('factor','unverified_payment_reference','weight',6);
    ambiguities := array_append(ambiguities, format('Payment %s is recorded as %s, not a confirmed capture.',
      tx.payment_ref, COALESCE(tx.payment_status,'unknown')));
  ELSE
    ambiguities := array_append(ambiguities,'No payment reference linked to the transaction.');
  END IF;

  IF tx.customer_charge_cents IS NOT NULL AND tx.tax_cents IS NOT NULL
     AND tx.partner_entitlement_cents IS NOT NULL AND tx.platform_revenue_cents IS NOT NULL THEN
    waterfall := tx.tax_cents + tx.partner_entitlement_cents + tx.platform_revenue_cents;
    variance := abs(tx.customer_charge_cents - waterfall);
    IF variance <= 2 THEN
      score := score + 3; factors := factors || jsonb_build_object('factor','waterfall_reconciles','weight',3);
    ELSE
      ambiguities := array_append(ambiguities, format(
        'Economic waterfall does not reconcile: charge %s vs tax+partner+platform %s (variance %s cents).',
        tx.customer_charge_cents, waterfall, variance));
    END IF;
  END IF;

  IF tx.integrity_flags IS NOT NULL AND jsonb_typeof(tx.integrity_flags) = 'array'
     AND jsonb_array_length(tx.integrity_flags) > 0 THEN
    ambiguities := array_append(ambiguities, 'Open integrity flags on the transaction.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'transaction_id', tx.id, 'transaction_ref', tx.transaction_ref,
    'service_line', tx.service_line, 'confidence', round(score,2), 'factors', factors,
    'ambiguities', to_jsonb(ambiguities),
    'unambiguous', array_length(ambiguities,1) IS NULL,
    'review_status', tx.financial_review_status, 'precheck', pre);
END; $$;

REVOKE ALL ON FUNCTION public.score_financial_capture(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.score_financial_capture(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auto_approve_financial_capture(
  _dry_run boolean DEFAULT true, _limit integer DEFAULT 200, _threshold numeric DEFAULT 85)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx record; s jsonb; run_id uuid;
  scanned integer := 0; approved integer := 0; manual integer := 0;
  decisions jsonb := '[]'::jsonb; auto boolean;
BEGIN
  IF NOT public.is_finance_approver(auth.uid()) THEN
    RAISE EXCEPTION 'Only finance or super admins may run financial auto sign-off';
  END IF;
  IF _threshold < 60 OR _threshold > 100 THEN
    RAISE EXCEPTION 'Auto sign-off threshold must be between 60 and 100';
  END IF;

  INSERT INTO financial_autoapproval_runs (run_by, dry_run, threshold)
  VALUES (auth.uid(), _dry_run, _threshold) RETURNING id INTO run_id;

  FOR tx IN
    SELECT * FROM commercial_transactions
     WHERE financial_review_status = 'pending' AND recognised_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at LIMIT _limit
  LOOP
    scanned := scanned + 1;
    s := public.score_financial_capture(tx.id);
    auto := COALESCE((s->>'unambiguous')::boolean, false)
        AND COALESCE((s->>'confidence')::numeric, 0) >= _threshold;

    IF auto THEN approved := approved + 1; ELSE manual := manual + 1; END IF;

    IF NOT _dry_run THEN
      UPDATE commercial_transactions SET
        financial_confidence = (s->>'confidence')::numeric,
        financial_confidence_factors = s->'factors',
        financial_review_status = CASE WHEN auto THEN 'approved' ELSE 'pending' END,
        financial_reviewed_by = CASE WHEN auto THEN auth.uid() ELSE financial_reviewed_by END,
        financial_reviewed_at = CASE WHEN auto THEN now() ELSE financial_reviewed_at END,
        financial_auto_approved = CASE WHEN auto THEN true ELSE financial_auto_approved END,
        financial_review_notes = CASE
          WHEN auto THEN format('Auto signed off at confidence %s (threshold %s), run %s.',
            s->>'confidence', _threshold, run_id)
          ELSE format('Held for manual review at confidence %s: %s', s->>'confidence',
            COALESCE(nullif(array_to_string(ARRAY(SELECT jsonb_array_elements_text(s->'ambiguities')),' '),''),
                     'confidence below threshold')) END,
        updated_at = now()
      WHERE id = tx.id;

      IF auto THEN
        PERFORM public.log_finance_change('commercial_transactions', tx.transaction_ref, tx.id, 'UPDATE',
          'financial_review_status', 'review', 'pending', 'approved', NULL, s, 'auto_signoff',
          format('Automated finance sign-off, confidence %s >= threshold %s.', s->>'confidence', _threshold));
      END IF;
      PERFORM public.check_revenue_eligibility(tx.id, 'auto_signoff');
    END IF;

    decisions := decisions || jsonb_build_object(
      'transaction_ref', tx.transaction_ref, 'service_line', tx.service_line,
      'confidence', s->>'confidence', 'decision', CASE WHEN auto THEN 'auto_approved' ELSE 'manual_review' END,
      'ambiguities', s->'ambiguities');
  END LOOP;

  UPDATE financial_autoapproval_runs SET
    scanned = scanned, auto_approved = approved, left_for_review = manual,
    report = jsonb_build_object('decisions', decisions), finished_at = now()
  WHERE id = run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', run_id, 'dry_run', _dry_run,
    'threshold', _threshold, 'scanned', scanned, 'auto_approved', approved,
    'left_for_review', manual, 'decisions', decisions);
END; $$;

REVOKE ALL ON FUNCTION public.auto_approve_financial_capture(boolean,integer,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.auto_approve_financial_capture(boolean,integer,numeric) TO authenticated, service_role;

-- 6. Tighten RBAC on recognition-rule writes -------------------
DROP POLICY IF EXISTS "commercial staff write recognition rules" ON public.revenue_recognition_rules;
CREATE POLICY "finance writes recognition rules"
  ON public.revenue_recognition_rules FOR ALL TO authenticated
  USING (public.is_finance_approver(auth.uid()))
  WITH CHECK (public.is_finance_approver(auth.uid()));

REVOKE ALL ON FUNCTION public.is_finance_approver(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.is_finance_auditor(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_finance_approver(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_finance_auditor(uuid) TO authenticated, service_role;