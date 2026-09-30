CREATE OR REPLACE FUNCTION public.payment_incident_group_drilldown(_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group JSONB;
  v_alerts JSONB;
  v_correlation_id TEXT;
  v_twin JSONB;
  v_timeline JSONB;
  v_decisions JSONB;
BEGIN
  IF NOT public.payment_has_forensic_access(auth.uid()) THEN
    RAISE EXCEPTION 'forensic_access_required';
  END IF;

  SELECT to_jsonb(g.*) INTO v_group
    FROM public.payment_incident_groups g WHERE g.id = _group_id;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'group_not_found';
  END IF;

  SELECT jsonb_agg(to_jsonb(a.*)) INTO v_alerts
    FROM public.payment_incident_group_members m
    JOIN public.payment_alerts a ON a.id = m.alert_id
    WHERE m.group_id = _group_id;

  SELECT (a.details->>'correlation_id') INTO v_correlation_id
    FROM public.payment_incident_group_members m
    JOIN public.payment_alerts a ON a.id = m.alert_id
    WHERE m.group_id = _group_id
      AND a.details ? 'correlation_id'
    ORDER BY a.fired_at DESC LIMIT 1;

  IF v_correlation_id IS NOT NULL THEN
    BEGIN
      v_twin := public.payment_digital_twin_v2(v_correlation_id);
    EXCEPTION WHEN OTHERS THEN v_twin := NULL;
    END;

    SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.recorded_at) INTO v_timeline
      FROM public.payment_step_traces t WHERE t.correlation_id = v_correlation_id;

    SELECT jsonb_agg(to_jsonb(d.*) ORDER BY d.decided_at DESC) INTO v_decisions
      FROM public.payment_orchestrator_decisions d
      WHERE (d.evidence->>'correlation_id') = v_correlation_id
         OR d.reason ILIKE '%'||v_correlation_id||'%'
      LIMIT 25;
  END IF;

  RETURN jsonb_build_object(
    'group', v_group,
    'alerts', COALESCE(v_alerts, '[]'::jsonb),
    'correlation_id', v_correlation_id,
    'digital_twin', v_twin,
    'timeline', COALESCE(v_timeline, '[]'::jsonb),
    'decisions', COALESCE(v_decisions, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.payment_promotion_eligibility_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_streak integer;
  v_last_score numeric;
  v_config_ok boolean;
  v_replay_ok boolean;
  v_critical_72h integer;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  SELECT COALESCE(current_days,0), COALESCE(last_score,0)
    INTO v_streak, v_last_score
  FROM public.payment_pci_streaks ORDER BY updated_at DESC LIMIT 1;

  SELECT bool_and(passed) INTO v_config_ok
  FROM public.payment_config_certifications
  WHERE ran_at > now() - interval '24 hours';
  v_config_ok := COALESCE(v_config_ok, false);

  SELECT NOT critical AND started_at > now() - interval '8 days'
    INTO v_replay_ok
  FROM public.payment_replay_certifications
  ORDER BY started_at DESC LIMIT 1;
  v_replay_ok := COALESCE(v_replay_ok, false);

  SELECT COUNT(*) INTO v_critical_72h FROM public.payment_alerts
  WHERE severity = 'critical' AND fired_at > now() - interval '72 hours';

  IF v_streak < 14 THEN v_blockers := array_append(v_blockers, 'pci_streak_below_14d'); END IF;
  IF v_last_score < 95 THEN v_blockers := array_append(v_blockers, 'pci_below_95'); END IF;
  IF NOT v_config_ok THEN v_blockers := array_append(v_blockers, 'config_drift_detected'); END IF;
  IF NOT v_replay_ok THEN v_blockers := array_append(v_blockers, 'replay_certification_stale_or_critical'); END IF;
  IF v_critical_72h > 0 THEN v_blockers := array_append(v_blockers, 'critical_incidents_72h'); END IF;

  RETURN jsonb_build_object(
    'eligible', array_length(v_blockers,1) IS NULL,
    'pci_score', v_last_score,
    'pci_streak_days', v_streak,
    'config_certification_ok', v_config_ok,
    'replay_certification_ok', v_replay_ok,
    'critical_incidents_72h', v_critical_72h,
    'blockers', to_jsonb(v_blockers)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.payment_compute_pci()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stability numeric := 0;
  v_financial numeric := 0;
  v_qual_hist numeric := 0;
  v_chaos numeric := 0;
  v_load numeric := 0;
  v_evidence numeric := 0;
  v_shadow numeric := 0;
  v_slo numeric := 0;
  v_incident numeric := 0;
  v_deploy numeric := 0;
  v_score numeric := 0;
  v_tmp numeric;
BEGIN
  SELECT COALESCE(AVG(success_rate) * 20, 0) INTO v_stability
  FROM (
    SELECT success_rate FROM public.payment_stability_windows
    ORDER BY window_end DESC LIMIT 4
  ) s;

  SELECT COALESCE(AVG(financial_integrity_score) / 100.0 * 20, 0) INTO v_financial
  FROM (
    SELECT financial_integrity_score FROM public.payment_qualification_evidence_packs
    WHERE generated_at > now() - interval '7 days'
    ORDER BY generated_at DESC LIMIT 20
  ) f;

  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE overall_status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 15, 0
  ) INTO v_qual_hist
  FROM public.payment_continuous_qualification_runs
  WHERE started_at > now() - interval '30 days';

  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 10, 0
  ) INTO v_chaos
  FROM public.payment_chaos_runs
  WHERE started_at > now() - interval '30 days';

  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 10, 0
  ) INTO v_load
  FROM public.payment_load_qualification_runs
  WHERE started_at > now() - interval '30 days';

  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 10, 0
  ) INTO v_evidence
  FROM public.payment_evidence_retention_checks
  WHERE checked_at > now() - interval '30 days';

  SELECT COALESCE(
    GREATEST(0, 1 - (COUNT(*) FILTER (WHERE diverged)::numeric / NULLIF(COUNT(*),0))) * 10, 10
  ) INTO v_shadow
  FROM public.payment_orchestrator_shadow_diffs
  WHERE created_at > now() - interval '7 days';

  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE within_slo)::numeric / NULLIF(COUNT(*),0)) * 5, 5
  ) INTO v_slo
  FROM public.payment_slo_measurements
  WHERE measured_at > now() - interval '7 days';

  SELECT COUNT(*) INTO v_tmp FROM public.payment_alerts
  WHERE severity = 'critical' AND fired_at > now() - interval '72 hours';
  v_incident := GREATEST(0, 5 - LEAST(5, v_tmp::numeric));

  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE decision = 'approved')::numeric / NULLIF(COUNT(*),0)) * 5, 5
  ) INTO v_deploy
  FROM public.assurance_deployment_decisions
  WHERE created_at > now() - interval '30 days';

  v_score := v_stability + v_financial + v_qual_hist + v_chaos + v_load
           + v_evidence + v_shadow + v_slo + v_incident + v_deploy;

  RETURN jsonb_build_object(
    'score', ROUND(v_score, 2),
    'per_domain', jsonb_build_object(
      'rolling_stability', ROUND(v_stability, 2),
      'financial_integrity', ROUND(v_financial, 2),
      'qualification_history', ROUND(v_qual_hist, 2),
      'chaos_recovery', ROUND(v_chaos, 2),
      'load_qualification', ROUND(v_load, 2),
      'evidence_integrity', ROUND(v_evidence, 2),
      'shadow_equivalence', ROUND(v_shadow, 2),
      'operational_slos', ROUND(v_slo, 2),
      'incident_history', ROUND(v_incident, 2),
      'deployment_stability', ROUND(v_deploy, 2)
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('score', 0, 'per_domain', '{}'::jsonb, 'error', SQLERRM);
END;
$function$;