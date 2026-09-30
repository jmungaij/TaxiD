-- =====================================================================
-- ASSET PRICING 360 — pricing authority, floor engine, lifecycle.
-- =====================================================================

-- Resolve the live version for a category at a point in time.
CREATE OR REPLACE FUNCTION public.ap360_live_version(p_category text, p_at timestamptz DEFAULT now())
RETURNS public.ap360_versions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.* FROM public.ap360_versions v
  JOIN public.ap360_profiles p ON p.id = v.profile_id
  WHERE p.category_code = p_category
    AND v.status IN ('published','active')
    AND v.effective_from <= p_at
    AND (v.effective_to IS NULL OR v.effective_to > p_at)
  ORDER BY v.effective_from DESC, v.version DESC
  LIMIT 1;
$$;

-- Market statistics for a category (guidance only).
CREATE OR REPLACE FUNCTION public.ap360_market_stats(p_category text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
        'observations', count(*),
        'low', MIN(observed_price),
        'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY observed_price),
        'high', MAX(observed_price),
        'unit', MIN(pricing_unit))
     FROM public.ap360_market_references
     WHERE category_code = p_category
       AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
     HAVING count(*) > 0),
    -- No observations: fall back to the configured reference band, stated as such.
    (SELECT jsonb_build_object('observations', 0, 'low', reference_low, 'median', NULL,
                               'high', reference_high, 'unit', reference_unit)
     FROM public.ap360_categories WHERE code = p_category));
$$;

-- Applicable fuel price.
CREATE OR REPLACE FUNCTION public.ap360_fuel_price(
  p_fuel text, p_region text DEFAULT 'National', p_country text DEFAULT 'KE', p_at date DEFAULT CURRENT_DATE)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT price FROM public.ap360_fuel_index
  WHERE fuel_type = p_fuel AND country = p_country
    AND region IN (p_region, 'National')
    AND effective_from <= p_at AND (effective_to IS NULL OR effective_to >= p_at)
  ORDER BY (region = p_region) DESC, effective_from DESC
  LIMIT 1;
$$;

-- Applicable tax rule for a family.
CREATE OR REPLACE FUNCTION public.ap360_tax_rule(
  p_family text, p_code text DEFAULT NULL, p_geo text DEFAULT 'KE', p_at date DEFAULT CURRENT_DATE)
RETURNS public.ap360_tax_rules
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.ap360_tax_rules
  WHERE active
    AND (p_code IS NULL OR code = p_code)
    AND (p_code IS NOT NULL OR p_family = ANY(family_codes))
    AND geography = p_geo
    AND effective_from <= p_at AND (effective_to IS NULL OR effective_to >= p_at)
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

-- Profitability band from contribution margin.
CREATE OR REPLACE FUNCTION public.ap360_band(p_contribution numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_contribution < 0 THEN 'RED'
    WHEN p_contribution < 10 THEN 'ORANGE'
    WHEN p_contribution < 15 THEN 'YELLOW'
    WHEN p_contribution < 25 THEN 'GREEN'
    ELSE 'BLUE' END;
$$;

-- ---------------------------------------------------------------------
-- THE PRICING AUTHORITY. Every customer price in the platform derives
-- from this function. Engine-routed, floor-governed, fully explained.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ap360_quote(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat      public.ap360_categories;
  v_ver      public.ap360_versions;
  v_tax      public.ap360_tax_rules;
  v_params   jsonb;
  v_market   jsonb;
  v_lines    jsonb := '[]'::jsonb;
  v_notices  jsonb := '[]'::jsonb;

  -- inputs (all optional; each engine uses only what it needs)
  v_days     numeric := GREATEST(0, COALESCE((p_input->>'days')::numeric, 0));
  v_hours    numeric := GREATEST(0, COALESCE((p_input->>'hours')::numeric, 0));
  v_km       numeric := GREATEST(0, COALESCE((p_input->>'distance_km')::numeric, 0));
  v_return_km numeric := GREATEST(0, COALESCE((p_input->>'empty_return_km')::numeric, 0));
  v_pax      numeric := GREATEST(0, COALESCE((p_input->>'passengers')::numeric, 0));
  v_nights   numeric := GREATEST(0, COALESCE((p_input->>'nights')::numeric, 0));
  v_positioning numeric := GREATEST(0, COALESCE((p_input->>'positioning_hours')::numeric, 0));
  v_landings numeric := GREATEST(0, COALESCE((p_input->>'landings')::numeric, 0));
  v_mobilise boolean := COALESCE((p_input->>'mobilisation')::boolean, true);
  v_standby  numeric := GREATEST(0, COALESCE((p_input->>'standby_hours')::numeric, 0));
  v_waiting  numeric := GREATEST(0, COALESCE((p_input->>'waiting_hours')::numeric, 0));
  v_day_type text    := COALESCE(p_input->>'day_type','standard');
  v_demand   numeric := GREATEST(1, COALESCE((p_input->>'demand_multiplier')::numeric, 1));
  v_corp     boolean := COALESCE((p_input->>'corporate')::boolean, false);
  v_discount_req numeric := GREATEST(0, COALESCE((p_input->>'discount_pct')::numeric, 0));
  v_region   text    := COALESCE(p_input->>'region','National');
  v_shared   boolean := COALESCE((p_input->>'shared')::boolean, false);

  v_num      numeric;
  v_gross    numeric := 0;   -- pre-modifier subtotal
  v_mult     numeric := 1;
  v_demand_applied numeric;
  v_discount numeric := 0;
  v_discount_pct numeric := 0;
  v_net      numeric;
  v_commission numeric;
  v_tax_amt  numeric := 0;
  v_total    numeric;
  v_floor    numeric := 0;
  v_direct   numeric := 0;
  v_overhead numeric := 0;
  v_risk     numeric := 0;
  v_operator_net numeric;
  v_contribution numeric;
  v_band     text;
  v_status   text := 'OK';
  v_ceiling  numeric;
  v_fuel_price numeric;
  r          record;

  FUNCTION_MARKER text := '';
BEGIN
  IF p_input->>'category_code' IS NULL THEN
    RETURN jsonb_build_object('status','INVALID_INPUT','error','category_code is required');
  END IF;

  SELECT * INTO v_cat FROM public.ap360_categories WHERE code = p_input->>'category_code';
  IF v_cat.code IS NULL THEN
    RETURN jsonb_build_object('status','UNKNOWN_CATEGORY','category_code', p_input->>'category_code');
  END IF;

  v_ver := public.ap360_live_version(v_cat.code, COALESCE((p_input->>'at')::timestamptz, now()));
  IF v_ver.id IS NULL THEN
    -- Truthful: no published pricing means no price, never a fallback price.
    RETURN jsonb_build_object('status','NO_PUBLISHED_VERSION','category_code', v_cat.code,
      'engine_code', v_cat.engine_code,
      'message','No published pricing version governs this category yet.');
  END IF;

  v_params := v_ver.params;
  v_market := public.ap360_market_stats(v_cat.code);

  -- ============ ENGINE ROUTING ============
  IF v_ver.engine_code = 'negotiated' THEN
    RETURN jsonb_build_object(
      'status','QUOTE_REQUIRED',
      'category_code', v_cat.code, 'engine_code', v_ver.engine_code,
      'version_id', v_ver.id, 'version', v_ver.version,
      'indicative_from', v_params->>'indicative_from',
      'indicative_to', v_params->>'indicative_to',
      'quote_validity_days', v_params->>'quote_validity_days',
      'market', v_market,
      'message','This asset is priced by negotiated project quote. No automatic customer price is produced.');

  ELSIF v_ver.engine_code = 'time_distance' THEN
    v_days := GREATEST(v_days, COALESCE((v_params->>'minimum_rental_days')::numeric, 1));
    v_num := COALESCE((v_params->>'base_daily_rate')::numeric,0) * v_days;
    v_gross := v_gross + v_num;
    v_lines := v_lines || jsonb_build_object('code','base','label','Day rate','amount',ROUND(v_num,2),
      'reason', v_days || ' day(s) at governed day rate');
    v_num := GREATEST(0, v_km - COALESCE((v_params->>'included_km_per_day')::numeric,0) * v_days)
             * COALESCE((v_params->>'excess_km_rate')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','excess_km','label','Excess mileage','amount',ROUND(v_num,2),
        'reason','Kilometres beyond the included allowance');
    END IF;
    IF COALESCE((p_input->>'driver')::boolean,false) THEN
      v_num := COALESCE((v_params->>'driver_rate')::numeric,0) * v_days;
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','driver','label','Chauffeur','amount',ROUND(v_num,2),'reason','Driver per day');
    END IF;
    v_mult := CASE v_day_type
      WHEN 'weekend' THEN COALESCE((v_params->>'weekend_multiplier')::numeric,1)
      WHEN 'holiday' THEN COALESCE((v_params->>'holiday_multiplier')::numeric,1)
      WHEN 'peak'    THEN COALESCE((v_params->>'peak_multiplier')::numeric,1)
      ELSE 1 END;

  ELSIF v_ver.engine_code = 'trip_payload' THEN
    v_num := COALESCE((v_params->>'base_trip_fee')::numeric,0);
    v_gross := v_gross + v_num;
    v_lines := v_lines || jsonb_build_object('code','base_trip','label','Base trip fee','amount',ROUND(v_num,2),'reason','Trip mobilisation and handling');
    v_num := (v_km + v_return_km * COALESCE((v_params->>'empty_return_pct')::numeric,100)/100)
             * COALESCE((v_params->>'cost_per_km')::numeric,0);
    v_gross := v_gross + v_num;
    v_lines := v_lines || jsonb_build_object('code','distance','label','Loaded + empty return distance','amount',ROUND(v_num,2),
      'reason', v_km || ' km loaded, ' || v_return_km || ' km empty return');
    v_num := COALESCE((v_params->>'loading_fee')::numeric,0) + COALESCE((v_params->>'unloading_fee')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','handling','label','Loading & unloading','amount',ROUND(v_num,2),'reason','Fixed handling fees');
    END IF;
    v_num := v_waiting * COALESCE((v_params->>'waiting_hourly')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','waiting','label','Waiting time','amount',ROUND(v_num,2),'reason', v_waiting || ' hour(s)');
    END IF;
    IF v_gross < COALESCE((v_params->>'minimum_trip_charge')::numeric,0) THEN
      v_lines := v_lines || jsonb_build_object('code','min_trip','label','Minimum trip charge applied',
        'amount', ROUND(COALESCE((v_params->>'minimum_trip_charge')::numeric,0) - v_gross,2),
        'reason','Trip priced up to the governed minimum');
      v_gross := COALESCE((v_params->>'minimum_trip_charge')::numeric,0);
    END IF;

  ELSIF v_ver.engine_code = 'hours_mobilisation' THEN
    v_hours := GREATEST(v_hours, COALESCE((v_params->>'minimum_billable_hours')::numeric,1));
    v_num := v_hours * COALESCE((v_params->>'operating_hour_rate')::numeric,0);
    v_gross := v_gross + v_num;
    v_lines := v_lines || jsonb_build_object('code','machine_hours','label','Operating hours','amount',ROUND(v_num,2),
      'reason', v_hours || ' billable machine hour(s)');
    IF v_mobilise THEN
      v_num := COALESCE((v_params->>'mobilisation_fee')::numeric,0) + COALESCE((v_params->>'demobilisation_fee')::numeric,0)
               + COALESCE((v_params->>'transport_fee')::numeric,0);
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','mobilisation','label','Mobilisation & demobilisation','amount',ROUND(v_num,2),
        'reason','Separately governed machine movement, not a per-km charge');
    END IF;
    IF COALESCE((p_input->>'operator')::boolean,true) THEN
      v_num := v_hours * COALESCE((v_params->>'operator_rate')::numeric,0);
      IF v_num > 0 THEN
        v_gross := v_gross + v_num;
        v_lines := v_lines || jsonb_build_object('code','operator','label','Machine operator','amount',ROUND(v_num,2),'reason','Operator per hour');
      END IF;
    END IF;
    v_num := v_standby * COALESCE((v_params->>'standby_hourly')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','standby','label','Standby','amount',ROUND(v_num,2),'reason', v_standby || ' standby hour(s)');
    END IF;

  ELSIF v_ver.engine_code = 'block_hour' THEN
    v_hours := GREATEST(v_hours, COALESCE((v_params->>'minimum_billable_hours')::numeric,1));
    v_num := v_hours * COALESCE((v_params->>'block_hour_rate')::numeric,0);
    v_gross := v_gross + v_num;
    v_lines := v_lines || jsonb_build_object('code','block_hours','label','Block hours','amount',ROUND(v_num,2),
      'reason', v_hours || ' billable block hour(s)');
    v_num := v_positioning * COALESCE((v_params->>'positioning_hourly')::numeric,0)
             + COALESCE((v_params->>'positioning_fee')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','positioning','label','Positioning','amount',ROUND(v_num,2),
        'reason', v_positioning || ' positioning hour(s) plus positioning fee');
    END IF;
    v_num := GREATEST(v_landings,0) * COALESCE((v_params->>'landing_fee')::numeric,0)
             + GREATEST(v_landings,0) * COALESCE((v_params->>'airstrip_fee')::numeric,0)
             + COALESCE((v_params->>'handling_fee')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','airport','label','Landing, airstrip & handling','amount',ROUND(v_num,2),
        'reason', v_landings || ' landing(s)');
    END IF;
    v_num := v_nights * COALESCE((v_params->>'overnight_fee')::numeric,0) + COALESCE((v_params->>'crew_fee')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','crew','label','Crew & overnight','amount',ROUND(v_num,2),'reason', v_nights || ' night(s)');
    END IF;

  ELSIF v_ver.engine_code = 'vessel_hours' THEN
    v_hours := GREATEST(v_hours, COALESCE((v_params->>'minimum_hours')::numeric,1));
    IF v_shared THEN
      v_num := v_pax * COALESCE((v_params->>'passenger_price')::numeric,0);
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','passengers','label','Per-passenger fare','amount',ROUND(v_num,2),
        'reason', v_pax || ' passenger(s) on a shared sailing');
    ELSE
      v_num := v_hours * COALESCE((v_params->>'private_hourly_rate')::numeric,0);
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','cruising','label','Cruising hours','amount',ROUND(v_num,2),
        'reason', v_hours || ' cruising hour(s) — vessels are not priced per kilometre');
    END IF;
    v_num := COALESCE((v_params->>'captain_fee')::numeric,0) + COALESCE((v_params->>'crew_fee')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','crew','label','Captain & crew','amount',ROUND(v_num,2),'reason','Per sailing');
    END IF;
    v_num := COALESCE((v_params->>'marina_fee')::numeric,0) + COALESCE((v_params->>'berth_fee')::numeric,0)
             + COALESCE((v_params->>'landing_fee')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','marine_fees','label','Marina, berth & landing','amount',ROUND(v_num,2),'reason','Marine fees');
    END IF;
    v_num := v_pax * COALESCE((v_params->>'catering_per_passenger')::numeric,0);
    IF v_num > 0 THEN
      v_gross := v_gross + v_num;
      v_lines := v_lines || jsonb_build_object('code','catering','label','Catering','amount',ROUND(v_num,2),'reason', v_pax || ' passenger(s)');
    END IF;

  ELSIF v_ver.engine_code = 'contract' THEN
    v_num := COALESCE((v_params->>'contract_rate')::numeric,0)
             * CASE COALESCE(v_params->>'rate_unit','per_day')
                 WHEN 'per_day' THEN GREATEST(v_days,1)
                 WHEN 'per_hour' THEN GREATEST(v_hours,1)
                 WHEN 'per_trip' THEN 1
                 WHEN 'per_km' THEN v_km
                 WHEN 'per_passenger' THEN GREATEST(v_pax,1)
                 ELSE 1 END;
    v_gross := v_gross + v_num;
    v_lines := v_lines || jsonb_build_object('code','contract','label','Contracted rate','amount',ROUND(v_num,2),
      'reason','Negotiated contract rate (' || COALESCE(v_params->>'rate_unit','per_day') || ')');
    v_discount_pct := GREATEST(v_discount_pct, COALESCE((v_params->>'volume_discount_pct')::numeric,0));
  ELSE
    RETURN jsonb_build_object('status','UNKNOWN_ENGINE','engine_code', v_ver.engine_code);
  END IF;

  -- ============ FUEL (index driven, only when charged to the customer) ============
  IF v_ver.fuel_policy IN ('surcharge','indexed') THEN
    v_fuel_price := public.ap360_fuel_price(
      COALESCE(p_input->>'fuel_type', CASE WHEN v_cat.family_code IN ('aircraft','helicopters') THEN 'jet_a1'
                                           WHEN v_cat.family_code IN ('boats','yachts') THEN 'marine_diesel'
                                           ELSE 'diesel' END), v_region);
    IF v_fuel_price IS NULL THEN
      v_notices := v_notices || jsonb_build_object('code','FUEL_INDEX_MISSING',
        'message','No fuel index entry covers this region and date, so no fuel surcharge was applied.');
    ELSE
      v_num := ROUND(v_fuel_price * (
          COALESCE((v_params->>'fuel_consumption_l_per_hour')::numeric,0) * v_hours
        + COALESCE((v_params->>'fuel_consumption_l_per_100km')::numeric,0) * (v_km + v_return_km) / 100), 2);
      IF v_num > 0 THEN
        v_gross := v_gross + v_num;
        v_lines := v_lines || jsonb_build_object('code','fuel','label','Fuel (indexed)','amount',v_num,
          'reason','Indexed at ' || v_fuel_price || ' per litre');
      END IF;
    END IF;
  END IF;

  -- ============ MULTIPLIERS AND BOUNDED DEMAND ============
  v_ceiling := v_ver.demand_ceiling;
  v_demand_applied := LEAST(v_demand, v_ceiling);
  IF v_demand > v_ceiling THEN
    v_notices := v_notices || jsonb_build_object('code','DEMAND_CEILING_APPLIED',
      'message','Requested demand multiplier ' || v_demand || ' exceeded the governed ceiling ' || v_ceiling || ' and was capped.');
  END IF;
  IF v_mult <> 1 OR v_demand_applied <> 1 THEN
    v_num := ROUND(v_gross * (v_mult * v_demand_applied - 1), 2);
    v_lines := v_lines || jsonb_build_object('code','modifiers','label','Day-type and demand modifiers','amount',v_num,
      'reason','× ' || v_mult || ' (' || v_day_type || ') × ' || v_demand_applied || ' (demand, ceiling ' || v_ceiling || ')');
    v_gross := ROUND(v_gross * v_mult * v_demand_applied, 2);
  END IF;

  -- ============ ECONOMIC FLOOR ============
  FOR r IN SELECT * FROM public.ap360_cost_inputs WHERE version_id = v_ver.id LOOP
    v_num := r.amount * CASE r.unit
      WHEN 'per_day' THEN GREATEST(v_days,1)
      WHEN 'per_hour' THEN GREATEST(v_hours,1)
      WHEN 'per_block_hour' THEN GREATEST(v_hours,1)
      WHEN 'per_km' THEN v_km + v_return_km
      WHEN 'per_night' THEN v_nights
      WHEN 'per_passenger' THEN v_pax
      WHEN 'per_movement' THEN 2
      ELSE 1 END;
    IF r.category = 'direct' THEN v_direct := v_direct + v_num;
    ELSIF r.category = 'overhead' THEN v_overhead := v_overhead + v_num;
    ELSE v_risk := v_risk + v_num; END IF;
  END LOOP;
  v_floor := ROUND((v_direct + v_overhead + v_risk) * (1 + v_ver.target_margin_pct/100), 2);
  IF v_direct + v_overhead + v_risk = 0 THEN
    v_notices := v_notices || jsonb_build_object('code','NO_COST_MODEL',
      'message','No cost inputs are configured for this version, so the operator floor is not proven — it is reported as zero, not assumed safe.');
  END IF;

  -- ============ DISCOUNT (never through the floor) ============
  v_discount_pct := LEAST(GREATEST(v_discount_pct, v_discount_req,
      CASE WHEN v_corp THEN COALESCE((v_params->>'corporate_discount_pct')::numeric,0) ELSE 0 END),
      v_ver.max_discount_pct);
  v_discount := ROUND(v_gross * v_discount_pct / 100, 2);
  IF v_gross - v_discount < v_floor THEN
    v_discount := GREATEST(0, ROUND(v_gross - v_floor, 2));
    v_notices := v_notices || jsonb_build_object('code','DISCOUNT_CLAMPED_TO_FLOOR',
      'message','The requested discount would have taken the price below the operator economic floor and was reduced.');
  END IF;
  IF v_discount > 0 THEN
    v_lines := v_lines || jsonb_build_object('code','discount','label','Discount','amount', -v_discount,
      'reason', ROUND(v_discount / NULLIF(v_gross,0) * 100, 2) || '% (cap ' || v_ver.max_discount_pct || '%)');
  END IF;

  v_net := v_gross - v_discount;

  -- ============ FLOOR ENFORCEMENT ============
  IF v_floor > 0 AND v_net < v_floor THEN
    v_net := v_floor;
    v_status := 'PRICE_RAISED_TO_FLOOR';
    v_lines := v_lines || jsonb_build_object('code','floor','label','Raised to operator economic floor',
      'amount', ROUND(v_floor - (v_gross - v_discount),2),
      'reason','Direct cost + overhead + risk reserve + target margin');
  END IF;

  -- Market ceiling test: a floor above the market high is an exception, not a forced booking.
  IF v_floor > 0 AND (v_market->>'high') IS NOT NULL
     AND v_floor > (v_market->>'high')::numeric * GREATEST(v_days, v_hours, 1) THEN
    v_status := 'PRICE_EXCEPTION_REQUIRED';
    v_notices := v_notices || jsonb_build_object('code','FLOOR_ABOVE_MARKET_CEILING',
      'message','The operator economic floor exceeds the market ceiling. This must be negotiated as a governed exception rather than booked at a loss.');
  END IF;

  -- ============ COMMISSION ============
  v_commission := ROUND(v_net * v_ver.commission_pct / 100, 2);
  v_operator_net := ROUND(v_net - v_commission, 2);
  IF v_operator_net < v_direct + v_overhead THEN
    v_notices := v_notices || jsonb_build_object('code','COMMISSION_ERODES_OPERATOR',
      'message','Marketplace commission leaves the operator below its direct and overhead cost. An approved exception is required.');
    IF v_status = 'OK' THEN v_status := 'PRICE_EXCEPTION_REQUIRED'; END IF;
  END IF;

  -- ============ TAX (rule driven) ============
  v_tax := public.ap360_tax_rule(v_cat.family_code, v_ver.tax_rule_code);
  IF v_tax.code IS NULL THEN
    v_notices := v_notices || jsonb_build_object('code','NO_TAX_RULE',
      'message','No tax rule matches this asset family, date and geography, so no tax was applied.');
    v_total := v_net;
  ELSIF v_tax.taxable_status <> 'standard' THEN
    v_total := v_net;
    v_lines := v_lines || jsonb_build_object('code','tax','label', v_tax.label,'amount',0,
      'reason', v_tax.taxable_status);
  ELSIF v_tax.inclusive THEN
    v_tax_amt := ROUND(v_net - v_net / (1 + v_tax.rate_pct/100), 2);
    v_total := v_net;
    v_lines := v_lines || jsonb_build_object('code','tax','label', v_tax.label || ' (inclusive)','amount', v_tax_amt,
      'reason', v_tax.rate_pct || '% included in the price');
  ELSE
    v_tax_amt := ROUND(v_net * v_tax.rate_pct/100, 2);
    v_total := v_net + v_tax_amt;
    v_lines := v_lines || jsonb_build_object('code','tax','label', v_tax.label,'amount', v_tax_amt,
      'reason', v_tax.rate_pct || '% ' || v_tax.tax_type);
  END IF;

  -- ============ MARGIN AND BAND ============
  v_contribution := CASE WHEN v_net > 0 AND (v_direct + v_overhead + v_risk) > 0
    THEN ROUND((v_operator_net - (v_direct + v_overhead + v_risk)) / v_net * 100, 3) ELSE NULL END;
  v_band := CASE WHEN v_contribution IS NULL THEN 'UNPROVEN' ELSE public.ap360_band(v_contribution) END;
  IF v_band = 'RED' THEN v_status := 'PRICE_EXCEPTION_REQUIRED'; END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'category_code', v_cat.code, 'family_code', v_cat.family_code, 'category_label', v_cat.label,
    'engine_code', v_ver.engine_code,
    'profile_id', v_ver.profile_id, 'version_id', v_ver.id, 'version', v_ver.version,
    'currency','KES',
    'lines', v_lines,
    'notices', v_notices,
    'market', v_market,
    'market_position', CASE
      WHEN (v_market->>'median') IS NULL THEN 'NO_MARKET_DATA'
      WHEN v_net < (v_market->>'median')::numeric * 0.8 THEN 'LOW_PRICE_WARNING'
      WHEN v_net <= (v_market->>'median')::numeric * 1.2 THEN 'MARKET_ALIGNED'
      WHEN v_net <= (v_market->>'median')::numeric * 1.4 THEN 'PREMIUM_WARNING'
      ELSE 'MARKET_OUTLIER' END,
    'direct_cost', v_direct, 'overhead', v_overhead, 'risk_reserve', v_risk,
    'operator_floor', v_floor,
    'subtotal', ROUND(v_gross,2), 'discount', v_discount,
    'net_before_tax', ROUND(v_net,2),
    'commission', v_commission, 'tax', v_tax_amt,
    'tax_rule', v_tax.code,
    'customer_price', ROUND(v_total,2),
    'operator_net', v_operator_net,
    'yalla_revenue', v_commission,
    'contribution_pct', v_contribution,
    'profitability_band', v_band,
    'demand_ceiling', v_ceiling, 'demand_applied', v_demand_applied,
    'calculated_at', now());
END $$;

-- ---------------------------------------------------------------------
-- Save an immutable quote snapshot from a server-recalculated price.
-- The client never supplies the price.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ap360_save_quote(p_input jsonb, p_quote_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb; v_id uuid;
BEGIN
  IF NOT public.is_staff_portal_member(auth.uid()) THEN
    RAISE EXCEPTION 'AP360: not authorised to issue quotes';
  END IF;
  v_res := public.ap360_quote(p_input);
  IF v_res->>'status' NOT IN ('OK','PRICE_RAISED_TO_FLOOR') THEN
    RETURN jsonb_build_object('saved', false, 'result', v_res);
  END IF;
  INSERT INTO public.ap360_quote_snapshots(
    quote_ref, profile_id, version_id, category_code, engine_code, version_number,
    inputs, result, customer_price, operator_net, yalla_revenue, operator_floor,
    contribution_pct, profitability_band, calculated_by, valid_until)
  VALUES (
    p_quote_ref, (v_res->>'profile_id')::uuid, (v_res->>'version_id')::uuid,
    v_res->>'category_code', v_res->>'engine_code', (v_res->>'version')::int,
    p_input, v_res,
    (v_res->>'customer_price')::numeric, (v_res->>'operator_net')::numeric,
    (v_res->>'yalla_revenue')::numeric, (v_res->>'operator_floor')::numeric,
    NULLIF(v_res->>'contribution_pct','')::numeric, v_res->>'profitability_band',
    auth.uid(), now() + interval '14 days')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('saved', true, 'snapshot_id', v_id, 'result', v_res);
END $$;

-- ---------------------------------------------------------------------
-- Validation: a version can only be published in a valid state.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ap360_validate_version(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ver public.ap360_versions; v_eng public.ap360_engines;
  v_errors jsonb := '[]'::jsonb; v_warnings jsonb := '[]'::jsonb;
  k text; v numeric;
BEGIN
  SELECT * INTO v_ver FROM public.ap360_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN RETURN jsonb_build_object('valid', false, 'errors', jsonb_build_array('Version not found')); END IF;
  SELECT * INTO v_eng FROM public.ap360_engines WHERE code = v_ver.engine_code;

  FOREACH k IN ARRAY v_eng.required_keys LOOP
    IF (v_ver.params->>k) IS NULL OR (v_ver.params->>k) = '' THEN
      v_errors := v_errors || to_jsonb('Required parameter missing: ' || k);
    END IF;
  END LOOP;

  FOR k IN SELECT jsonb_object_keys(v_ver.params) LOOP
    IF NOT (k = ANY(v_eng.parameter_keys)) THEN
      v_errors := v_errors || to_jsonb('Parameter "' || k || '" is not valid for the ' || v_eng.label || ' engine');
      CONTINUE;
    END IF;
    BEGIN v := (v_ver.params->>k)::numeric; EXCEPTION WHEN others THEN v := NULL; END;
    IF v IS NOT NULL THEN
      IF v < 0 THEN v_errors := v_errors || to_jsonb(k || ' cannot be negative'); END IF;
      IF k LIKE '%multiplier%' AND v < 1 THEN v_errors := v_errors || to_jsonb(k || ' must be at least 1'); END IF;
      IF k LIKE '%_pct%' AND v > 100 THEN v_errors := v_errors || to_jsonb(k || ' cannot exceed 100%'); END IF;
      IF k LIKE 'minimum_%hours' AND v <= 0 THEN v_errors := v_errors || to_jsonb(k || ' must be greater than zero'); END IF;
    END IF;
  END LOOP;

  IF (v_ver.params->>'indicative_from') IS NOT NULL AND (v_ver.params->>'indicative_to') IS NOT NULL
     AND (v_ver.params->>'indicative_to')::numeric < (v_ver.params->>'indicative_from')::numeric THEN
    v_errors := v_errors || to_jsonb('Maximum indicative price is below the minimum'::text);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ap360_cost_inputs WHERE version_id = p_version_id) THEN
    v_warnings := v_warnings || to_jsonb('No cost inputs configured — the operator economic floor cannot be proven'::text);
  END IF;
  IF v_ver.engine_code <> 'negotiated' AND NOT EXISTS (
     SELECT 1 FROM public.ap360_market_references m
     JOIN public.ap360_profiles p ON p.id = v_ver.profile_id
     WHERE m.category_code = p.category_code) THEN
    v_warnings := v_warnings || to_jsonb('No market references recorded — market positioning cannot be assessed'::text);
  END IF;

  RETURN jsonb_build_object('valid', jsonb_array_length(v_errors) = 0,
    'errors', v_errors, 'warnings', v_warnings, 'version', v_ver.version, 'status', v_ver.status);
END $$;

-- ---------------------------------------------------------------------
-- Lifecycle transitions with RBAC.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ap360_transition_version(
  p_version_id uuid, p_action text, p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ver public.ap360_versions; v_val jsonb; v_new text; v_approver boolean;
BEGIN
  SELECT * INTO v_ver FROM public.ap360_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN RAISE EXCEPTION 'AP360: version not found'; END IF;

  v_approver := public.has_any_role(auth.uid(), ARRAY['super_admin'::app_role,'finance_admin'::app_role]);

  IF p_action = 'submit' THEN
    IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'AP360: not authorised to submit pricing'; END IF;
    IF v_ver.status NOT IN ('draft','validating','rejected') THEN
      RAISE EXCEPTION 'AP360: only a draft can be submitted (current status %)', v_ver.status; END IF;
    v_val := public.ap360_validate_version(p_version_id);
    IF NOT (v_val->>'valid')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'validation', v_val); END IF;
    v_new := 'submitted';

  ELSIF p_action = 'approve' THEN
    IF NOT v_approver THEN RAISE EXCEPTION 'AP360: approval requires super admin or finance admin'; END IF;
    IF v_ver.status <> 'submitted' THEN RAISE EXCEPTION 'AP360: only a submitted version can be approved'; END IF;
    UPDATE public.ap360_versions SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
      reason = COALESCE(NULLIF(p_reason,''), reason) WHERE id = p_version_id;
    RETURN jsonb_build_object('ok', true, 'status','approved');

  ELSIF p_action = 'reject' THEN
    IF NOT v_approver THEN RAISE EXCEPTION 'AP360: rejection requires super admin or finance admin'; END IF;
    v_new := 'rejected';

  ELSIF p_action = 'publish' THEN
    IF NOT v_approver THEN RAISE EXCEPTION 'AP360: publishing requires super admin or finance admin'; END IF;
    IF v_ver.status <> 'approved' THEN RAISE EXCEPTION 'AP360: only an approved version can be published'; END IF;
    v_val := public.ap360_validate_version(p_version_id);
    IF NOT (v_val->>'valid')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'validation', v_val); END IF;
    -- Supersede the incumbent, keeping it for history.
    UPDATE public.ap360_versions SET status = 'superseded', superseded_at = now(), effective_to = now()
      WHERE profile_id = v_ver.profile_id AND status IN ('published','active') AND id <> p_version_id;
    UPDATE public.ap360_versions SET status = 'published', published_by = auth.uid(), published_at = now(),
      effective_from = GREATEST(effective_from, now()) WHERE id = p_version_id;
    RETURN jsonb_build_object('ok', true, 'status','published');

  ELSIF p_action = 'archive' THEN
    IF NOT v_approver THEN RAISE EXCEPTION 'AP360: archiving requires super admin or finance admin'; END IF;
    v_new := 'archived';
  ELSE
    RAISE EXCEPTION 'AP360: unknown action %', p_action;
  END IF;

  UPDATE public.ap360_versions SET status = v_new, reason = COALESCE(NULLIF(p_reason,''), reason)
    WHERE id = p_version_id;
  RETURN jsonb_build_object('ok', true, 'status', v_new);
END $$;

-- Roll back to a previous version by publishing an exact copy (history preserved).
CREATE OR REPLACE FUNCTION public.ap360_rollback(p_version_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src public.ap360_versions; v_next int; v_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin'::app_role,'finance_admin'::app_role]) THEN
    RAISE EXCEPTION 'AP360: rollback requires super admin or finance admin'; END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'AP360: a rollback reason is required'; END IF;
  SELECT * INTO v_src FROM public.ap360_versions WHERE id = p_version_id;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'AP360: version not found'; END IF;

  SELECT COALESCE(MAX(version),0) + 1 INTO v_next FROM public.ap360_versions WHERE profile_id = v_src.profile_id;
  INSERT INTO public.ap360_versions(profile_id, version, status, engine_code, params, commission_pct,
    max_discount_pct, demand_ceiling, override_tolerance_pct, target_margin_pct, fuel_policy, tax_rule_code,
    reason, source, created_by, approved_by, approved_at)
  VALUES (v_src.profile_id, v_next, 'approved', v_src.engine_code, v_src.params, v_src.commission_pct,
    v_src.max_discount_pct, v_src.demand_ceiling, v_src.override_tolerance_pct, v_src.target_margin_pct,
    v_src.fuel_policy, v_src.tax_rule_code,
    'Rollback to v' || v_src.version || ': ' || p_reason, 'rollback', auth.uid(), auth.uid(), now())
  RETURNING id INTO v_id;

  INSERT INTO public.ap360_cost_inputs(version_id, cost_key, label, unit, amount, category, note)
  SELECT v_id, cost_key, label, unit, amount, category, note
  FROM public.ap360_cost_inputs WHERE version_id = v_src.id;

  RETURN public.ap360_transition_version(v_id, 'publish', 'Rollback to v' || v_src.version);
END $$;

-- ---------------------------------------------------------------------
-- Shadow pricing: legacy engine vs Asset Pricing 360, same inputs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ap360_shadow_compare(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_new jsonb; v_o numeric; v_n numeric;
BEGIN
  IF NOT public.is_staff_portal_member(auth.uid()) THEN
    RAISE EXCEPTION 'AP360: not authorised'; END IF;
  BEGIN v_old := public.asset_pricing_calculate(p_input);
  EXCEPTION WHEN others THEN v_old := jsonb_build_object('status','LEGACY_ERROR','error', SQLERRM); END;
  v_new := public.ap360_quote(p_input);
  v_o := NULLIF(v_old->>'total','')::numeric;
  v_n := NULLIF(v_new->>'customer_price','')::numeric;
  RETURN jsonb_build_object(
    'inputs', p_input,
    'legacy', v_old, 'ap360', v_new,
    'legacy_total', v_o, 'ap360_total', v_n,
    'difference', CASE WHEN v_o IS NULL OR v_n IS NULL THEN NULL ELSE ROUND(v_n - v_o, 2) END,
    'difference_pct', CASE WHEN v_o IS NULL OR v_n IS NULL OR v_o = 0 THEN NULL
                           ELSE ROUND((v_n - v_o) / v_o * 100, 2) END,
    'comparable', v_o IS NOT NULL AND v_n IS NOT NULL);
END $$;

-- Only signed-in callers may reach the pricing authority.
REVOKE EXECUTE ON FUNCTION public.ap360_quote(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_save_quote(jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_validate_version(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_transition_version(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_rollback(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_shadow_compare(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_live_version(text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_market_stats(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_fuel_price(text, text, text, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ap360_tax_rule(text, text, text, date) FROM anon;