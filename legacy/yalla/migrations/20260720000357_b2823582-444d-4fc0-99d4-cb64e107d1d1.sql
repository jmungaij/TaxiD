
CREATE OR REPLACE FUNCTION public.payment_stability_rolling_score(_window INTERVAL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total INTEGER;
  successes INTEGER;
  critical_failures INTEGER;
  avg_integrity NUMERIC;
  success_rate NUMERIC;
  passing BOOLEAN;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'succeeded'),
    COUNT(*) FILTER (WHERE status = 'failed' AND (COALESCE(failure_class,'') ILIKE '%critical%' OR COALESCE(financial_integrity_score,100) < 99.99)),
    COALESCE(AVG(financial_integrity_score), 100)
  INTO total, successes, critical_failures, avg_integrity
  FROM public.payment_continuous_qualification_runs
  WHERE triggered_at >= now() - _window;

  success_rate := CASE WHEN total = 0 THEN 0 ELSE (successes::NUMERIC / total) * 100 END;
  passing := (total > 0) AND (success_rate >= 99.5) AND (critical_failures = 0) AND (avg_integrity >= 99.99);

  RETURN jsonb_build_object(
    'window',            _window::TEXT,
    'total_runs',        total,
    'successful_runs',   successes,
    'critical_failures', critical_failures,
    'success_rate',      ROUND(success_rate, 4),
    'avg_financial_integrity', ROUND(avg_integrity, 4),
    'passing',           passing,
    'evaluated_at',      now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_promotion_eligibility()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  blockers JSONB := '[]'::jsonb;
  w24 JSONB;
  w72 JSONB;
  w7d JSONB;
  critical_recent INTEGER;
  latest_load RECORD;
  chaos_pass_rate NUMERIC;
  chaos_total INTEGER;
  chaos_recovered INTEGER;
  latest_report RECORD;
BEGIN
  w24 := public.payment_stability_rolling_score('24 hours'::INTERVAL);
  w72 := public.payment_stability_rolling_score('72 hours'::INTERVAL);
  w7d := public.payment_stability_rolling_score('7 days'::INTERVAL);

  IF NOT COALESCE((w24->>'passing')::BOOLEAN, false) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','stability_24h_failed','detail',w24));
  END IF;
  IF NOT COALESCE((w72->>'passing')::BOOLEAN, false) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','stability_72h_failed','detail',w72));
  END IF;
  IF NOT COALESCE((w7d->>'passing')::BOOLEAN, false) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','stability_7d_failed','detail',w7d));
  END IF;

  SELECT COUNT(*) INTO critical_recent
  FROM public.payment_continuous_qualification_runs
  WHERE triggered_at >= now() - INTERVAL '72 hours'
    AND status = 'failed'
    AND (COALESCE(failure_class,'') ILIKE '%critical%' OR COALESCE(financial_integrity_score,100) < 99.99);
  IF critical_recent > 0 THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','critical_incidents_72h','count',critical_recent));
  END IF;

  SELECT * INTO latest_load
  FROM public.payment_load_qualification_runs
  WHERE concurrency_tier >= 500
    AND status = 'passed'
    AND finished_at >= now() - INTERVAL '30 days'
  ORDER BY finished_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','load_qualification_missing','required','tier>=500 passed within 30d'));
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE auto_recovered AND status = 'recovered' AND NOT data_loss_detected)
  INTO chaos_total, chaos_recovered
  FROM public.payment_chaos_runs
  WHERE started_at >= now() - INTERVAL '30 days';
  chaos_pass_rate := CASE WHEN chaos_total = 0 THEN 0 ELSE (chaos_recovered::NUMERIC / chaos_total)*100 END;
  IF chaos_total = 0 THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','chaos_qualification_missing','required','>=1 run within 30d'));
  ELSIF chaos_pass_rate < 100 THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','chaos_qualification_incomplete','pass_rate',chaos_pass_rate));
  END IF;

  SELECT * INTO latest_report FROM public.payment_qualification_reports
  ORDER BY report_date DESC LIMIT 1;
  IF NOT FOUND OR latest_report.report_date < (CURRENT_DATE - 2) THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','qualification_report_stale'));
  END IF;

  RETURN jsonb_build_object(
    'eligible',          jsonb_array_length(blockers) = 0,
    'blockers',          blockers,
    'stability_windows', jsonb_build_object('24h',w24,'72h',w72,'7d',w7d),
    'critical_incidents_72h', critical_recent,
    'chaos_pass_rate',   chaos_pass_rate,
    'evaluated_at',      now()
  );
END;
$$;
