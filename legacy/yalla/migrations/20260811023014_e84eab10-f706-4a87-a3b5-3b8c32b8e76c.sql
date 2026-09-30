CREATE OR REPLACE FUNCTION public.score_financial_capture(_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  tx record; terms record; pre jsonb; score numeric := 0;
  factors jsonb := '[]'::jsonb; ambiguities text[] := ARRAY[]::text[];
  waterfall bigint; variance bigint; paid_ok boolean; attested_ok boolean;
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
  attested_ok := tx.payment_ref IS NOT NULL AND tx.paid_at IS NOT NULL
    AND lower(COALESCE(tx.payment_evidence_kind,'')) = 'operator_attestation';

  IF paid_ok THEN
    score := score + 20; factors := factors || jsonb_build_object('factor','verified_payment_evidence','weight',20);
  ELSIF attested_ok THEN
    score := score + 12; factors := factors || jsonb_build_object('factor','attested_offline_payment','weight',12);
    ambiguities := array_append(ambiguities, format(
      'Payment %s was collected off-platform and rests on an operator attestation, not a system capture. Manual finance sign-off required.',
      tx.payment_ref));
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
END; $function$;

REVOKE ALL ON FUNCTION public.score_financial_capture(uuid) FROM anon;