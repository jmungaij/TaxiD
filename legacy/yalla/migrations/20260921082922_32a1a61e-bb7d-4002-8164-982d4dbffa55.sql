CREATE OR REPLACE FUNCTION public.pricing_resolve(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_service text := p_input->>'service_code';
  v_scope text := coalesce(p_input->>'scope_label','');
  v_category text := p_input->>'category_code';
  v_basis text := nullif(p_input->>'pricing_basis','');
  v_qty numeric := greatest(coalesce((p_input->>'quantity')::numeric,1),1);
  v_account uuid := nullif(p_input->>'account_id','')::uuid;
  v_proposed numeric := nullif(p_input->>'proposed_amount','')::numeric;
  v_card public.commercial_rate_cards;
  v_line public.commercial_rate_lines;
  v_cust public.pricing_customer_rates;
  v_cost numeric;
  v_recommended numeric;
  v_applied numeric;
  v_source text;
  v_variance numeric := 0;
  v_variance_pct numeric := 0;
  v_guard jsonb;
  v_can_see_cost boolean;
  v_market numeric;
  v_explain jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  IF v_service IS NULL OR v_category IS NULL THEN
    RAISE EXCEPTION 'invalid_input: service_code and category_code are required';
  END IF;

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE code = coalesce(p_input->>'rate_card_code','corporate_charter_rate_card')
     AND status = 'approved' AND retired_at IS NULL
   ORDER BY coalesce(effective_from,'1900-01-01') DESC, created_at DESC LIMIT 1;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_PUBLISHED_RATE_CARD');
  END IF;

  SELECT * INTO v_line FROM public.commercial_rate_lines
   WHERE rate_card_id = v_card.id AND service_code = v_service
     AND category_code = v_category
     AND (v_basis IS NULL OR pricing_basis = v_basis)
     AND (v_scope = '' OR scope_label = v_scope)
   ORDER BY (scope_label = v_scope) DESC LIMIT 1;
  IF v_line.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_VALID_RATE','rate_card_version',v_card.version);
  END IF;
  v_basis := v_line.pricing_basis;

  v_recommended := v_line.amount;
  v_applied := v_recommended;
  v_source := 'RECOMMENDED';
  v_explain := v_explain || jsonb_build_array(jsonb_build_object(
    'label','Recommended rate card rate','amount',v_recommended,
    'detail', v_card.name || ' ' || v_card.version));

  SELECT * INTO v_cust FROM public.pricing_customer_rates r
   WHERE r.status = 'active' AND r.account_id = v_account
     AND r.service_code = v_service AND r.category_code = v_category
     AND (r.scope_label = '' OR r.scope_label = v_scope)
     AND r.pricing_basis = v_basis
     AND (r.effective_from IS NULL OR r.effective_from <= current_date)
     AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND v_qty >= r.min_quantity
   ORDER BY CASE r.rate_kind
              WHEN 'contract' THEN 1 WHEN 'customer' THEN 2 WHEN 'project' THEN 3
              WHEN 'promotional' THEN 4 WHEN 'seasonal' THEN 5 WHEN 'volume' THEN 6
              WHEN 'competitive' THEN 7 ELSE 8 END,
            r.min_quantity DESC
   LIMIT 1;

  IF v_cust.id IS NOT NULL THEN
    v_applied := v_cust.amount;
    v_source := upper(v_cust.rate_kind);
    v_explain := v_explain || jsonb_build_array(jsonb_build_object(
      'label', initcap(v_cust.rate_kind) || ' rate',
      'amount', v_cust.amount - v_recommended,
      'detail', coalesce(v_cust.reason,'Agreed customer pricing')));
  END IF;

  IF v_proposed IS NOT NULL THEN
    v_explain := v_explain || jsonb_build_array(jsonb_build_object(
      'label','Negotiated adjustment','amount', v_proposed - v_applied,
      'detail', coalesce(nullif(p_input->>'commercial_reason',''),'Commercial negotiation')));
    v_applied := v_proposed;
    v_source := 'NEGOTIATED';
  END IF;

  v_variance := v_applied - v_recommended;
  v_variance_pct := CASE WHEN v_recommended > 0
    THEN round(((v_applied - v_recommended) / v_recommended) * 100, 2) ELSE 0 END;
  v_guard := public.pricing_guardrail_for(v_variance_pct);

  v_can_see_cost := public.is_platform_admin()
    OR public.has_staff_permission('staff.commercial.read');

  -- Cost baseline: summed from its recorded components. No component is assumed.
  SELECT coalesce(b.driver_cost,0) + coalesce(b.fuel_cost,0) + coalesce(b.tolls_parking,0)
       + coalesce(b.supplier_cost,0) + coalesce(b.operational_cost,0) + coalesce(b.platform_cost,0)
    INTO v_cost
    FROM public.pricing_cost_baselines b
   WHERE b.service_code = v_service AND b.category_code = v_category
     AND b.pricing_basis = v_basis
     AND (b.scope_label = '' OR b.scope_label = v_scope)
     AND (b.effective_from IS NULL OR b.effective_from <= current_date)
     AND (b.effective_to IS NULL OR b.effective_to >= current_date)
   ORDER BY (b.scope_label = v_scope) DESC, b.effective_from DESC NULLS LAST
   LIMIT 1;

  SELECT avg(o.amount) INTO v_market
    FROM public.pricing_competitor_observations o
   WHERE o.service_code = v_service AND o.category_code = v_category
     AND o.pricing_basis = v_basis
     AND (o.scope_label = '' OR o.scope_label = v_scope)
     AND o.observed_on >= current_date - interval '180 days';

  RETURN jsonb_build_object(
    'status','OK',
    'currency', v_line.currency,
    'recommended_price', v_recommended,
    'customer_rate_price', v_cust.amount,
    'applied_price', v_applied,
    'quantity', v_qty,
    'line_total', v_applied * v_qty,
    'variance_amount', v_variance,
    'variance_percent', v_variance_pct,
    'pricing_source', v_source,
    'rate_card_id', v_card.id,
    'rate_card_code', v_card.code,
    'rate_card_version', v_card.version,
    'rate_line_id', v_line.id,
    'pricing_basis', v_line.pricing_basis,
    'included_distance_km', v_line.included_distance_km,
    'distance_unit', v_line.distance_unit,
    'excess_distance_rate', v_line.excess_distance_rate,
    'included_hours', v_line.included_hours,
    'excess_hour_rate', v_line.excess_hour_rate,
    'waiting_rate_per_hour', v_line.waiting_rate_per_hour,
    'guardrail', v_guard,
    'approval_required', (v_guard->>'action') = 'approve',
    'estimated_cost', CASE WHEN v_can_see_cost THEN v_cost END,
    'margin_amount', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL
                          THEN v_applied - v_cost END,
    'margin_percent', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL AND v_applied > 0
                          THEN round(((v_applied - v_cost) / v_applied) * 100, 2) END,
    'market_reference', CASE WHEN v_can_see_cost THEN round(v_market, 2) END,
    'explanation', v_explain);
END;
$function$;

REVOKE ALL ON FUNCTION public.pricing_resolve(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_resolve(jsonb) TO authenticated, service_role;