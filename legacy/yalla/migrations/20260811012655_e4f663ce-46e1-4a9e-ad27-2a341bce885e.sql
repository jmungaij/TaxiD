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
REVOKE EXECUTE ON FUNCTION public.capture_charter_financials(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_charter_financials(uuid, text) TO authenticated, service_role;