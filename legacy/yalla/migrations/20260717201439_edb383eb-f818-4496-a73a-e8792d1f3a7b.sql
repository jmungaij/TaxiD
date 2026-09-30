CREATE OR REPLACE FUNCTION public.compute_payment_reliability_score(_window_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_callback numeric := 0;
  v_journey numeric := 0;
  v_edge numeric := 0;
  v_slo numeric := 0;
  v_cert numeric := 0;
  v_score numeric := 0;
  v_details jsonb := '{}'::jsonb;
  v_cb record;
  v_ef_total int; v_ef_healthy int;
  v_slo_total int; v_slo_ok int;
  v_cert_total int; v_cert_pass int;
  v_journey_total int; v_journey_ok int;
BEGIN
  SELECT * INTO v_cb FROM public.v_callback_invocation_health;
  v_callback := CASE WHEN v_cb.inv_24h = 0 THEN 0 ELSE v_cb.success_rate_24h END;

  SELECT count(*), count(*) FILTER (WHERE health = 'HEALTHY')
    INTO v_ef_total, v_ef_healthy
    FROM public.v_edge_function_health
    WHERE is_payment_critical;
  v_edge := CASE WHEN v_ef_total = 0 THEN 100 ELSE (v_ef_healthy::numeric / v_ef_total) * 100 END;

  SELECT count(*), count(*) FILTER (WHERE compliant)
    INTO v_slo_total, v_slo_ok
    FROM (
      SELECT DISTINCT ON (slo_id) slo_id, compliant
      FROM public.payment_slo_measurements
      WHERE window_end > now() - (_window_minutes || ' minutes')::interval
      ORDER BY slo_id, window_end DESC
    ) latest;
  v_slo := CASE WHEN v_slo_total = 0 THEN 100 ELSE (v_slo_ok::numeric / v_slo_total) * 100 END;

  SELECT count(*), count(*) FILTER (WHERE status = 'PASSED')
    INTO v_cert_total, v_cert_pass
    FROM public.payment_certification_runs
    WHERE completed_at > now() - (_window_minutes || ' minutes')::interval;
  v_cert := CASE WHEN v_cert_total = 0 THEN 100 ELSE (v_cert_pass::numeric / v_cert_total) * 100 END;

  SELECT count(*), count(*) FILTER (WHERE status = 'PASS')
    INTO v_journey_total, v_journey_ok
    FROM public.payment_journey_validations
    WHERE computed_at > now() - (_window_minutes || ' minutes')::interval;
  v_journey := CASE WHEN v_journey_total = 0 THEN coalesce(v_callback,0) ELSE (v_journey_ok::numeric / v_journey_total) * 100 END;

  v_score := round(
    (v_callback * 0.30) + (v_journey * 0.25) + (v_edge * 0.20) + (v_slo * 0.15) + (v_cert * 0.10)
  , 2);

  v_details := jsonb_build_object(
    'callback', jsonb_build_object('score', v_callback, 'inv_24h', v_cb.inv_24h, 'success_rate_24h', v_cb.success_rate_24h, 'health', v_cb.health),
    'edge_functions', jsonb_build_object('score', v_edge, 'healthy', v_ef_healthy, 'total', v_ef_total),
    'slo', jsonb_build_object('score', v_slo, 'compliant', v_slo_ok, 'total', v_slo_total),
    'certification', jsonb_build_object('score', v_cert, 'passed', v_cert_pass, 'total', v_cert_total),
    'journey', jsonb_build_object('score', v_journey, 'passed', v_journey_ok, 'total', v_journey_total)
  );

  INSERT INTO public.payment_reliability_snapshots(
    reliability_score, callback_score, journey_score, edge_function_score, slo_score, certification_score,
    window_minutes, details
  ) VALUES (v_score, v_callback, v_journey, v_edge, v_slo, v_cert, _window_minutes, v_details);

  RETURN jsonb_build_object('reliability_score', v_score, 'window_minutes', _window_minutes, 'details', v_details);
END $$;