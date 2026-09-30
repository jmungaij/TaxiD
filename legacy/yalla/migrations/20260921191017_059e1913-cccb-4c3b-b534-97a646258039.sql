-- ============ 1. Service-specific pricing engine register ============
CREATE TABLE IF NOT EXISTS public.pricing_service_engines (
  code text PRIMARY KEY,
  name text NOT NULL,
  quote_kind text NOT NULL CHECK (quote_kind IN ('instant','rated','rfq')),
  default_basis text NOT NULL,
  allows_spot_price boolean NOT NULL DEFAULT true,
  requires_resource_hold boolean NOT NULL DEFAULT false,
  spot_approval_role text NOT NULL DEFAULT 'sales_manager',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing_service_engines TO authenticated;
GRANT ALL ON public.pricing_service_engines TO service_role;
ALTER TABLE public.pricing_service_engines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engines readable by commercial staff" ON public.pricing_service_engines;
CREATE POLICY "engines readable by commercial staff"
ON public.pricing_service_engines FOR SELECT TO authenticated
USING (public.is_platform_admin()
       OR public.is_commercial_staff()
       OR public.has_staff_permission('staff.commercial.read')
       OR public.has_staff_permission('staff.pricing.read'));

DROP POLICY IF EXISTS "engines configurable by pricing authority" ON public.pricing_service_engines;
CREATE POLICY "engines configurable by pricing authority"
ON public.pricing_service_engines FOR ALL TO authenticated
USING (public.is_platform_admin() OR public.has_staff_permission('staff.pricing.manage'))
WITH CHECK (public.is_platform_admin() OR public.has_staff_permission('staff.pricing.manage'));

CREATE TRIGGER pricing_service_engines_touch
BEFORE UPDATE ON public.pricing_service_engines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.pricing_service_engines
  (code, name, quote_kind, default_basis, allows_spot_price, requires_resource_hold, spot_approval_role, params, notes)
VALUES
  ('mobility','Mobility (road passenger)','instant','per_trip', true,  false, 'sales_manager',
   jsonb_build_object('distance_allowance','included_distance_km','excess_charging','excess_distance_rate'),
   'Airport transfers, day trips, executive and long-term road mobility.'),
  ('logistics','Logistics (parcel, courier, freight)','rated','per_kg', true, false, 'sales_manager',
   jsonb_build_object('volumetric_divisor',5000,'dimension_unit','cm','weight_unit','kg','round_billable_to',0.5,'stop_charging','per_stop'),
   'Billable weight is the greater of actual and volumetric weight.'),
  ('charter','Charter (aircraft and dedicated asset)','rfq','per_trip', true, true, 'commercial_director',
   jsonb_build_object('minimum_options',2,'hold_required',true),
   'Sourced against operators; priced per confirmed option, never instantly.')
ON CONFLICT (code) DO NOTHING;

-- Service types declare which engine prices them.
ALTER TABLE public.pricing_service_types
  ADD COLUMN IF NOT EXISTS engine_code text REFERENCES public.pricing_service_engines(code);
UPDATE public.pricing_service_types SET engine_code = 'mobility' WHERE engine_code IS NULL;

-- A spot price has no recommendation to compare against.
ALTER TABLE public.pricing_negotiations ALTER COLUMN recommended_amount DROP NOT NULL;

-- ============ 2. Price resolution with a spot-price path ============
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
  v_reason text := nullif(p_input->>'commercial_reason','');
  v_card public.commercial_rate_cards;
  v_line public.commercial_rate_lines;
  v_cust public.pricing_customer_rates;
  v_engine public.pricing_service_engines;
  v_cost numeric;
  v_recommended numeric;
  v_applied numeric;
  v_source text;
  v_variance numeric := 0;
  v_variance_pct numeric := 0;
  v_guard jsonb;
  v_can_see_cost boolean;
  v_can_see_market boolean;
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

  SELECT e.* INTO v_engine
    FROM public.pricing_service_engines e
    JOIN public.pricing_service_types t ON t.engine_code = e.code
   WHERE t.code = v_service AND e.status = 'active'
   LIMIT 1;
  IF v_engine.code IS NULL THEN
    SELECT * INTO v_engine FROM public.pricing_service_engines
     WHERE code = coalesce(nullif(p_input->>'engine_code',''),'mobility') AND status = 'active' LIMIT 1;
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

  v_can_see_cost := public.is_platform_admin()
    OR public.has_staff_permission('staff.finance.read')
    OR public.has_staff_permission('staff.pricing.manage');
  v_can_see_market := v_can_see_cost
    OR public.has_staff_permission('staff.commercial.read')
    OR public.has_staff_permission('staff.pricing.read');

  IF v_line.id IS NULL THEN
    -- No published rate for this lane. A one-off (spot) price is still a
    -- legitimate commercial act, but it needs a price, a written reason and
    -- approval — it is never silently treated as a tariff.
    IF NOT coalesce(v_engine.allows_spot_price, false) THEN
      RETURN jsonb_build_object('status','NO_VALID_RATE','reason_code','SPOT_PRICING_NOT_ALLOWED',
        'engine', v_engine.code, 'rate_card_version', v_card.version);
    END IF;
    IF v_proposed IS NULL THEN
      RETURN jsonb_build_object('status','NO_VALID_RATE','reason_code','PRICE_REQUIRED_NO_PUBLISHED_RATE',
        'engine', v_engine.code, 'spot_allowed', true, 'rate_card_version', v_card.version);
    END IF;
    IF v_reason IS NULL THEN
      RETURN jsonb_build_object('status','NO_VALID_RATE','reason_code','COMMERCIAL_REASON_REQUIRED_FOR_SPOT_PRICE',
        'engine', v_engine.code, 'spot_allowed', true, 'rate_card_version', v_card.version);
    END IF;

    v_basis := coalesce(v_basis, v_engine.default_basis);
    v_applied := v_proposed;
    v_source := 'SPOT';
    v_guard := jsonb_build_object(
      'code','NO_REFERENCE_PRICE','action','approve',
      'required_role', v_engine.spot_approval_role,
      'label','No published rate for this lane — approval required');
    v_explain := jsonb_build_array(
      jsonb_build_object('label','No published rate for this lane','amount',0,
        'detail', v_card.name || ' ' || v_card.version || ' has no ' || v_category || ' line for ' ||
                  coalesce(nullif(v_scope,''),'this scope')),
      jsonb_build_object('label','Spot price agreed with customer','amount', v_applied, 'detail', v_reason));

    SELECT coalesce(b.driver_cost,0) + coalesce(b.fuel_cost,0) + coalesce(b.tolls_parking,0)
         + coalesce(b.supplier_cost,0) + coalesce(b.operational_cost,0) + coalesce(b.platform_cost,0)
      INTO v_cost
      FROM public.pricing_cost_baselines b
     WHERE b.service_code = v_service AND b.category_code = v_category
       AND b.pricing_basis = v_basis
       AND (b.scope_label = '' OR b.scope_label = v_scope)
       AND (b.effective_from IS NULL OR b.effective_from <= current_date)
       AND (b.effective_to IS NULL OR b.effective_to >= current_date)
     ORDER BY (b.scope_label = v_scope) DESC, b.effective_from DESC NULLS LAST LIMIT 1;

    SELECT avg(o.amount) INTO v_market
      FROM public.pricing_competitor_observations o
     WHERE o.service_code = v_service AND o.category_code = v_category
       AND o.pricing_basis = v_basis
       AND (o.scope_label = '' OR o.scope_label = v_scope)
       AND o.observed_on >= current_date - interval '180 days';

    RETURN jsonb_build_object(
      'status','OK','currency', v_card.currency,
      'recommended_price', NULL, 'applied_price', v_applied,
      'quantity', v_qty, 'line_total', v_applied * v_qty,
      'variance_amount', 0, 'variance_percent', 0,
      'pricing_source', v_source, 'engine', v_engine.code,
      'rate_card_id', v_card.id, 'rate_card_code', v_card.code,
      'rate_card_version', v_card.version, 'rate_line_id', NULL,
      'pricing_basis', v_basis, 'guardrail', v_guard, 'approval_required', true,
      'estimated_cost', CASE WHEN v_can_see_cost THEN v_cost END,
      'margin_amount', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL THEN v_applied - v_cost END,
      'margin_percent', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL AND v_applied > 0
                            THEN round(((v_applied - v_cost) / v_applied) * 100, 2) END,
      'market_reference', CASE WHEN v_can_see_market THEN round(v_market, 2) END,
      'explanation', v_explain);
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
      'detail', coalesce(v_reason,'Commercial negotiation')));
    v_applied := v_proposed;
    v_source := 'NEGOTIATED';
  END IF;

  v_variance := v_applied - v_recommended;
  v_variance_pct := CASE WHEN v_recommended > 0
    THEN round(((v_applied - v_recommended) / v_recommended) * 100, 2) ELSE 0 END;
  v_guard := public.pricing_guardrail_for(v_variance_pct);

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
    'engine', v_engine.code,
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
    'market_reference', CASE WHEN v_can_see_market THEN round(v_market, 2) END,
    'explanation', v_explain);
END;
$function$;

-- ============ 3. Logistics rating engine ============
CREATE OR REPLACE FUNCTION public.logistics_rate_quote(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_engine public.pricing_service_engines;
  v_service text := coalesce(nullif(p_input->>'service_code',''),'parcel_delivery');
  v_category text := coalesce(nullif(p_input->>'category_code',''),'parcel');
  v_scope text := coalesce(p_input->>'scope_label','');
  v_actual numeric := coalesce((p_input->>'weight_kg')::numeric, 0);
  v_l numeric := coalesce((p_input->>'length_cm')::numeric, 0);
  v_w numeric := coalesce((p_input->>'width_cm')::numeric, 0);
  v_h numeric := coalesce((p_input->>'height_cm')::numeric, 0);
  v_stops integer := greatest(coalesce((p_input->>'stops')::integer, 1), 1);
  v_divisor numeric;
  v_round numeric;
  v_volumetric numeric;
  v_billable numeric;
  v_line public.commercial_rate_lines;
  v_card public.commercial_rate_cards;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;

  SELECT * INTO v_engine FROM public.pricing_service_engines
   WHERE code = 'logistics' AND status = 'active';
  IF v_engine.code IS NULL THEN
    RETURN jsonb_build_object('status','ENGINE_NOT_CONFIGURED');
  END IF;

  v_divisor := nullif(v_engine.params->>'volumetric_divisor','')::numeric;
  v_round := coalesce(nullif(v_engine.params->>'round_billable_to','')::numeric, 0.5);
  IF v_divisor IS NULL OR v_divisor <= 0 THEN
    RETURN jsonb_build_object('status','VOLUMETRIC_DIVISOR_NOT_CONFIGURED');
  END IF;

  v_volumetric := round((v_l * v_w * v_h) / v_divisor, 3);
  v_billable := greatest(v_actual, v_volumetric);
  IF v_billable <= 0 THEN
    RETURN jsonb_build_object('status','WEIGHT_OR_DIMENSIONS_REQUIRED');
  END IF;
  v_billable := ceil(v_billable / v_round) * v_round;

  SELECT c.* INTO v_card FROM public.commercial_rate_cards c
   WHERE c.code = coalesce(p_input->>'rate_card_code','corporate_charter_rate_card')
     AND c.status = 'approved' AND c.retired_at IS NULL
   ORDER BY coalesce(c.effective_from,'1900-01-01') DESC LIMIT 1;

  IF v_card.id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.commercial_rate_lines
     WHERE rate_card_id = v_card.id AND service_code = v_service
       AND category_code = v_category
       AND (v_scope = '' OR scope_label = v_scope)
     ORDER BY (scope_label = v_scope) DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_line.id IS NULL THEN 'RATE_DATA_NOT_AVAILABLE' ELSE 'OK' END,
    'engine','logistics',
    'actual_weight_kg', v_actual,
    'volumetric_weight_kg', v_volumetric,
    'volumetric_divisor', v_divisor,
    'billable_weight_kg', v_billable,
    'stops', v_stops,
    'unit_rate', v_line.amount,
    'pricing_basis', v_line.pricing_basis,
    'currency', coalesce(v_line.currency, v_card.currency),
    'rate_card_version', v_card.version,
    'recommended_price', CASE WHEN v_line.id IS NOT NULL THEN round(v_line.amount * v_billable, 2) END);
END;
$function$;

REVOKE ALL ON FUNCTION public.logistics_rate_quote(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_rate_quote(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_rate_quote(jsonb) TO service_role;

-- ============ 4. Charter RFQ lifecycle on the existing charter quote ============
ALTER TABLE public.charter_quotes
  ADD COLUMN IF NOT EXISTS rfq_state text
    CHECK (rfq_state IN ('REQUESTED','SOURCING','OPTIONS_FOUND','QUOTED','CUSTOMER_REVIEW',
                         'NEGOTIATION','OPERATOR_CONFIRMED','CUSTOMER_ACCEPTED','DEPOSIT_PENDING',
                         'BOOKED','COMPLETED','CANCELLED')),
  ADD COLUMN IF NOT EXISTS rfq_state_at timestamptz;

CREATE TABLE IF NOT EXISTS public.charter_rfq_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.charter_quotes(id) ON DELETE CASCADE,
  state_from text,
  state_to text NOT NULL,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_rfq_events TO authenticated;
GRANT ALL ON public.charter_rfq_events TO service_role;
ALTER TABLE public.charter_rfq_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "charter rfq history readable by commercial staff" ON public.charter_rfq_events;
CREATE POLICY "charter rfq history readable by commercial staff"
ON public.charter_rfq_events FOR SELECT TO authenticated
USING (public.is_platform_admin() OR public.is_commercial_staff()
       OR public.has_staff_permission('staff.commercial.read'));

CREATE OR REPLACE FUNCTION public._charter_rfq_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'charter_rfq_events is append-only';
END $$;

DROP TRIGGER IF EXISTS charter_rfq_events_append_only ON public.charter_rfq_events;
CREATE TRIGGER charter_rfq_events_append_only
BEFORE UPDATE OR DELETE ON public.charter_rfq_events
FOR EACH ROW EXECUTE FUNCTION public._charter_rfq_events_append_only();

CREATE OR REPLACE FUNCTION public.charter_rfq_advance(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := nullif(p->>'quote_id','')::uuid;
  v_to text := upper(coalesce(p->>'state',''));
  v_from text;
  v_allowed jsonb := jsonb_build_object(
    'REQUESTED', jsonb_build_array('SOURCING','CANCELLED'),
    'SOURCING', jsonb_build_array('OPTIONS_FOUND','CANCELLED'),
    'OPTIONS_FOUND', jsonb_build_array('QUOTED','CANCELLED'),
    'QUOTED', jsonb_build_array('CUSTOMER_REVIEW','NEGOTIATION','CANCELLED'),
    'CUSTOMER_REVIEW', jsonb_build_array('NEGOTIATION','OPERATOR_CONFIRMED','CANCELLED'),
    'NEGOTIATION', jsonb_build_array('QUOTED','OPERATOR_CONFIRMED','CANCELLED'),
    'OPERATOR_CONFIRMED', jsonb_build_array('CUSTOMER_ACCEPTED','CANCELLED'),
    'CUSTOMER_ACCEPTED', jsonb_build_array('DEPOSIT_PENDING','BOOKED','CANCELLED'),
    'DEPOSIT_PENDING', jsonb_build_array('BOOKED','CANCELLED'),
    'BOOKED', jsonb_build_array('COMPLETED','CANCELLED'));
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  IF v_id IS NULL OR v_to = '' THEN
    RAISE EXCEPTION 'invalid_input: quote_id and state are required';
  END IF;

  SELECT coalesce(rfq_state,'REQUESTED') INTO v_from FROM public.charter_quotes WHERE id = v_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'unknown_charter_quote'; END IF;

  IF NOT (v_allowed->v_from ? v_to) THEN
    RETURN jsonb_build_object('ok', false, 'refusal','TRANSITION_NOT_ALLOWED',
                              'state_from', v_from, 'state_to', v_to);
  END IF;

  UPDATE public.charter_quotes SET rfq_state = v_to, rfq_state_at = now() WHERE id = v_id;
  INSERT INTO public.charter_rfq_events (quote_id, state_from, state_to, reason, detail, actor_id)
  VALUES (v_id, v_from, v_to, nullif(p->>'reason',''), coalesce(p->'detail','{}'::jsonb), auth.uid());

  RETURN jsonb_build_object('ok', true, 'state_from', v_from, 'state_to', v_to);
END;
$function$;

REVOKE ALL ON FUNCTION public.charter_rfq_advance(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.charter_rfq_advance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.charter_rfq_advance(jsonb) TO service_role;