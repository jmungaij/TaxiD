CREATE OR REPLACE FUNCTION public.opt_optimization_conclude(
  _optimization_id uuid, _result_measurement_id uuid, _guardrail_breached boolean, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.opt_optimizations; b public.opt_measurements; r public.opt_measurements;
        v_actor uuid := auth.uid(); v_state public.opt_state; v_delta numeric;
        v_dir text; v_improved boolean; v_code text;
BEGIN
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Only an administrator may conclude an optimisation';
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Record a reason'; END IF;
  SELECT * INTO o FROM public.opt_optimizations WHERE id = _optimization_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown optimisation'; END IF;
  IF o.state NOT IN ('APPROVED','ACTIVE') THEN
    RETURN jsonb_build_object('optimization_id', o.id, 'accepted', false, 'code','NOT_APPROVED', 'state', o.state);
  END IF;

  SELECT * INTO r FROM public.opt_measurements WHERE id = _result_measurement_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Unknown result measurement'; END IF;
  IF r.metric_code <> o.target_metric_code THEN
    RAISE EXCEPTION 'Result measures % but the optimisation targets %', r.metric_code, o.target_metric_code;
  END IF;
  IF r.id = o.baseline_measurement_id THEN
    RAISE EXCEPTION 'The result measurement must be distinct from the baseline';
  END IF;
  SELECT * INTO b FROM public.opt_measurements WHERE id = o.baseline_measurement_id;
  SELECT direction INTO v_dir FROM public.opt_metrics WHERE code = o.target_metric_code;

  IF _guardrail_breached THEN
    v_state := 'ROLLED_BACK'; v_code := 'GUARDRAIL_BREACHED';
  ELSIF r.sufficiency <> 'SUFFICIENT' THEN
    v_state := 'ROLLED_BACK'; v_code := 'INSUFFICIENT_RESULT_EVIDENCE';
  ELSIF b.id IS NULL OR b.value IS NULL THEN
    v_state := 'ROLLED_BACK'; v_code := 'NO_COMPARABLE_BASELINE';
  ELSE
    v_delta := r.value - b.value;
    v_improved := CASE
      WHEN v_dir = 'HIGHER_IS_BETTER' THEN v_delta > 0
      WHEN v_dir = 'LOWER_IS_BETTER'  THEN v_delta < 0
      ELSE false END;
    IF v_improved THEN
      v_state := 'ADOPTED'; v_code := 'IMPROVEMENT_MEASURED';
    ELSE
      -- flat or worse: an unproven change is never adopted
      v_state := 'ROLLED_BACK'; v_code := 'NO_MEASURED_IMPROVEMENT';
    END IF;
  END IF;

  UPDATE public.opt_optimizations
     SET state = v_state,
         result_measurement_id = r.id,
         result = jsonb_build_object('baseline', b.value, 'result', r.value, 'delta', v_delta,
                    'direction', v_dir, 'outcome_code', v_code,
                    'guardrail_breached', _guardrail_breached,
                    'result_sufficiency', r.sufficiency, 'result_sample_size', r.sample_size),
         adopted_at = CASE WHEN v_state = 'ADOPTED' THEN now() ELSE NULL END,
         rolled_back_at = CASE WHEN v_state = 'ROLLED_BACK' THEN now() ELSE NULL END,
         decision_reason = _reason, updated_at = now()
   WHERE id = o.id;

  INSERT INTO public.opt_events (event_type, optimization_id, measurement_id, actor_id, detail)
  VALUES (CASE WHEN v_state = 'ADOPTED' THEN 'OPTIMIZATION_ADOPTED' ELSE 'OPTIMIZATION_ROLLED_BACK' END,
          o.id, r.id, v_actor,
          jsonb_build_object('baseline', b.value, 'result', r.value, 'delta', v_delta,
            'direction', v_dir, 'outcome_code', v_code,
            'guardrail_breached', _guardrail_breached, 'reason', _reason));

  RETURN jsonb_build_object('optimization_id', o.id, 'accepted', true, 'state', v_state,
    'code', v_code, 'baseline', b.value, 'result', r.value, 'delta', v_delta, 'direction', v_dir);
END $$;

-- the earlier adoption was recorded with a zero delta and must not stand as evidence
UPDATE public.opt_optimizations
   SET state = 'ROLLED_BACK', adopted_at = NULL, rolled_back_at = now(),
       result = coalesce(result,'{}'::jsonb) || jsonb_build_object('outcome_code','NO_MEASURED_IMPROVEMENT',
         'correction','Adopted under the pre-fix rule with delta 0; corrected to rolled back.'),
       decision_reason = 'Corrected: zero measured improvement may not be adopted',
       updated_at = now()
 WHERE state = 'ADOPTED' AND (result->>'delta')::numeric = 0;