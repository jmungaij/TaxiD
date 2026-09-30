CREATE OR REPLACE FUNCTION public.opt_measure(
  _metric_code text,
  _window_days integer DEFAULT 30,
  _scope_kind text DEFAULT 'PLATFORM',
  _scope_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.opt_metrics; ws timestamptz; we timestamptz;
        v_n integer := 0; v_num numeric := 0; v_val numeric; v_suf public.opt_sufficiency;
        v_ev jsonb := '{}'::jsonb; v_id uuid; v_actor uuid := auth.uid();
BEGIN
  IF NOT (public._ai_is_worker() OR public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to compute optimisation measurements';
  END IF;
  SELECT * INTO m FROM public.opt_metrics WHERE code = _metric_code AND active;
  IF m.code IS NULL THEN RAISE EXCEPTION 'Unknown or inactive metric %', _metric_code; END IF;
  IF _window_days IS NULL OR _window_days < 1 THEN RAISE EXCEPTION 'Window must be at least one day'; END IF;

  we := now(); ws := now() - make_interval(days => _window_days);

  IF _metric_code = 'DISPATCH_MATCH_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE outcome IN ('MATCHED','SELECTED','SUCCESS'))
      INTO v_n, v_num FROM public.logistics_match_runs WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'TIME_TO_MATCH_MS' THEN
    SELECT count(*) FILTER (WHERE matching_duration_ms IS NOT NULL),
           coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY matching_duration_ms), 0)
      INTO v_n, v_num FROM public.logistics_match_runs WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'ROUTE_CAPACITY_UTILISATION' THEN
    SELECT count(*), coalesce(sum(reserved_capacity_kg),0)
      INTO v_n, v_num FROM public.freight_route_instances
     WHERE created_at BETWEEN ws AND we AND coalesce(planned_capacity_kg,0) > 0;
    SELECT jsonb_build_object('planned_capacity_kg', coalesce(sum(planned_capacity_kg),0))
      INTO v_ev FROM public.freight_route_instances
     WHERE created_at BETWEEN ws AND we AND coalesce(planned_capacity_kg,0) > 0;
  ELSIF _metric_code = 'FLEET_ASSIGNMENT_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.logistics_dispatch_requests d
       WHERE d.assigned_vehicle_id = f.vehicle_id AND d.created_at BETWEEN ws AND we))
      INTO v_n, v_num FROM public.logistics_fleet_capacity f;
  ELSIF _metric_code = 'DELIVERY_COMPLETION_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE upper(status) IN ('DELIVERED','COMPLETED','CLOSED'))
      INTO v_n, v_num FROM public.delivery_orders WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'EXCEPTION_RATE' THEN
    SELECT count(*) INTO v_n FROM public.delivery_orders WHERE created_at BETWEEN ws AND we;
    SELECT count(*) INTO v_num FROM public.logistics_exceptions WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'QUOTE_CONVERSION_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE accepted_at IS NOT NULL)
      INTO v_n, v_num FROM public.freight_quotations WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'INVOICE_COLLECTION_RATE' THEN
    SELECT count(*), coalesce(sum(paid_total),0)
      INTO v_n, v_num FROM public.freight_invoices
     WHERE created_at BETWEEN ws AND we AND voided_at IS NULL AND coalesce(total,0) > 0;
    SELECT jsonb_build_object('invoiced_total', coalesce(sum(total),0))
      INTO v_ev FROM public.freight_invoices
     WHERE created_at BETWEEN ws AND we AND voided_at IS NULL AND coalesce(total,0) > 0;
  ELSIF _metric_code = 'EMPTY_RETURN_LEG_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM public.freight_route_instances b
        JOIN public.freight_repeat_routes rb ON rb.id = b.route_id
       WHERE rb.origin_label = ra.destination_label AND rb.destination_label = ra.origin_label
         AND b.service_date = i.service_date))
      INTO v_n, v_num
      FROM public.freight_route_instances i
      JOIN public.freight_repeat_routes ra ON ra.id = i.route_id
     WHERE i.created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'AI_RECOMMENDATION_ACCEPTANCE' THEN
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.ai_action_approvals ap
       WHERE ap.action_request_id = r.id AND ap.decision = 'APPROVED'))
      INTO v_n, v_num FROM public.ai_action_requests r WHERE r.created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'AI_ACTION_SUCCESS_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE verified)
      INTO v_n, v_num FROM public.ai_action_executions WHERE started_at BETWEEN ws AND we;
  ELSE
    RAISE EXCEPTION 'Metric % has no authoritative computation and must not be estimated', _metric_code;
  END IF;

  IF v_n = 0 THEN
    v_suf := 'NO_DATA'; v_val := NULL;
  ELSIF v_n < m.min_sample_size THEN
    v_suf := 'INSUFFICIENT_DATA'; v_val := NULL;
  ELSE
    v_suf := 'SUFFICIENT';
    v_val := CASE
      WHEN _metric_code = 'TIME_TO_MATCH_MS' THEN v_num
      WHEN _metric_code = 'ROUTE_CAPACITY_UTILISATION'
        THEN CASE WHEN coalesce((v_ev->>'planned_capacity_kg')::numeric,0) > 0
                  THEN round(v_num / (v_ev->>'planned_capacity_kg')::numeric, 4) ELSE NULL END
      WHEN _metric_code = 'INVOICE_COLLECTION_RATE'
        THEN CASE WHEN coalesce((v_ev->>'invoiced_total')::numeric,0) > 0
                  THEN round(v_num / (v_ev->>'invoiced_total')::numeric, 4) ELSE NULL END
      ELSE round(v_num::numeric / v_n::numeric, 4) END;
    IF v_val IS NULL THEN v_suf := 'INSUFFICIENT_DATA'; END IF;
  END IF;

  INSERT INTO public.opt_measurements
    (metric_code, scope_kind, scope_ref, window_start, window_end, value, sample_size, sufficiency, evidence, computed_by)
  VALUES (_metric_code, _scope_kind, _scope_ref, ws, we, v_val, v_n, v_suf,
          v_ev || jsonb_build_object('numerator', v_num, 'min_sample_size', m.min_sample_size,
                                     'source', m.source_description), v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.opt_events (event_type, measurement_id, actor_id, actor_kind, detail)
  VALUES ('MEASUREMENT_RECORDED', v_id, v_actor,
          CASE WHEN public._ai_is_worker() THEN 'WORKER' ELSE 'OPERATOR' END,
          jsonb_build_object('metric', _metric_code, 'sufficiency', v_suf, 'sample_size', v_n));

  RETURN jsonb_build_object('measurement_id', v_id, 'metric', _metric_code, 'value', v_val,
    'sample_size', v_n, 'min_sample_size', m.min_sample_size, 'sufficiency', v_suf,
    'window_start', ws, 'window_end', we);
END $$;

UPDATE public.ai_security_ledger
   SET finding_count = 944, updated_at = now(),
       evidence = evidence || jsonb_build_object('stage15_note',
         'Five Stage 15 optimisation functions (opt_measure, opt_optimization_open/simulate/decide/conclude) are SECURITY DEFINER and callable only by administrators or the service role; anon EXECUTE is revoked.')
 WHERE finding_key = 'linter.security_definer_authenticated_executable';