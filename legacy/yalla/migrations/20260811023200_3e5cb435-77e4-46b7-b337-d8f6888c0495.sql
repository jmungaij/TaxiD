CREATE OR REPLACE FUNCTION public.emit_revenue_event(_transaction_id uuid, _source text DEFAULT 'emitter'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF r.rule_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'emitted', false, 'transaction_ref', tx.transaction_ref,
      'error', 'no_active_rule',
      'reason', format('No active revenue recognition rule exists for service line %s.', tx.service_line));
  END IF;

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
      'phase', '8.5.4', 'rule_key', r.rule_key, 'rule_effective_from', r.effective_from,
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
END; $function$;

REVOKE ALL ON FUNCTION public.emit_revenue_event(uuid, text) FROM anon;