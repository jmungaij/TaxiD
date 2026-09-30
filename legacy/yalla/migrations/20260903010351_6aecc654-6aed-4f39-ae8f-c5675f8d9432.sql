CREATE OR REPLACE FUNCTION public.opt_optimization_open(
  _code text, _objective text, _domain text, _hypothesis text,
  _target_metric_code text, _expected_impact jsonb, _confidence numeric,
  _risk_class public.opt_risk_class, _rollback_condition text,
  _baseline_measurement_id uuid DEFAULT NULL, _experiment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid(); v_id uuid; v_human boolean; b public.opt_measurements;
        v_state public.opt_state;
BEGIN
  IF NOT (public._ai_is_worker() OR public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to open optimisations';
  END IF;
  IF coalesce(trim(_objective),'') = '' OR coalesce(trim(_hypothesis),'') = ''
     OR coalesce(trim(_rollback_condition),'') = '' THEN
    RAISE EXCEPTION 'Objective, hypothesis and rollback condition are all required';
  END IF;
  PERFORM 1 FROM public.opt_metrics WHERE code = _target_metric_code AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown target metric %', _target_metric_code; END IF;

  IF _baseline_measurement_id IS NOT NULL THEN
    SELECT * INTO b FROM public.opt_measurements WHERE id = _baseline_measurement_id;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Unknown baseline measurement'; END IF;
    IF b.metric_code <> _target_metric_code THEN
      RAISE EXCEPTION 'Baseline measures % but the optimisation targets %', b.metric_code, _target_metric_code;
    END IF;
  END IF;

  v_human := _risk_class IN ('FINANCIAL','PRICING','HIGH');
  v_state := CASE WHEN _baseline_measurement_id IS NULL
                  THEN 'DRAFT'::public.opt_state ELSE 'MEASURED'::public.opt_state END;

  SELECT id INTO v_id FROM public.opt_optimizations WHERE code = _code;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('optimization_id', v_id, 'duplicate', true);
  END IF;

  INSERT INTO public.opt_optimizations
    (code, objective, domain, hypothesis, expected_impact, confidence, risk_class,
     approval_required, human_only, baseline_measurement_id, target_metric_code,
     experiment_id, rollback_condition, state, created_by)
  VALUES (_code, _objective, _domain, _hypothesis, _expected_impact, _confidence, _risk_class,
     true, v_human, _baseline_measurement_id, _target_metric_code, _experiment_id,
     _rollback_condition, v_state, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.opt_events (event_type, optimization_id, actor_id, detail)
  VALUES ('OPTIMIZATION_OPENED', v_id, v_actor,
    jsonb_build_object('risk_class', _risk_class, 'human_only', v_human, 'code', _code));

  RETURN jsonb_build_object('optimization_id', v_id, 'duplicate', false,
    'human_only', v_human, 'state', v_state);
END $$;