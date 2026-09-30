CREATE OR REPLACE FUNCTION public.is_internal_service()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_setting('role', true) = 'service_role'
      OR current_user = 'service_role'
      OR COALESCE(current_setting('request.jwt.claim.role', true),
                  (current_setting('request.jwt.claims', true)::jsonb ->> 'role')) = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.is_internal_service() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_service() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revenue_gate_precheck(
  _transaction_ref text DEFAULT NULL, _transaction_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tx record; r record; missing text[] := ARRAY[]::text[]; blockers text[] := ARRAY[]::text[];
  complete boolean; eligible boolean; amount bigint; needs_payment boolean;
BEGIN
  IF NOT (public.is_internal_service() OR public.is_commercial_staff() OR public.is_finance_auditor(auth.uid())) THEN
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