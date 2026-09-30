
-- Phase D5.3 — Enterprise Production Acceptance Qualification

-- 1) PCI snapshots (hourly)
CREATE TABLE public.payment_pci_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at timestamptz NOT NULL DEFAULT now(),
  score numeric(6,2) NOT NULL,
  per_domain jsonb NOT NULL DEFAULT '{}'::jsonb,
  streak_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pci_snapshots_computed_at ON public.payment_pci_snapshots(computed_at DESC);
GRANT SELECT ON public.payment_pci_snapshots TO authenticated;
GRANT ALL ON public.payment_pci_snapshots TO service_role;
ALTER TABLE public.payment_pci_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pci_snapshots_forensic_read" ON public.payment_pci_snapshots
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 2) PCI streak (singleton row per streak state)
CREATE TABLE public.payment_pci_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  current_days integer NOT NULL DEFAULT 0,
  best_days integer NOT NULL DEFAULT 0,
  last_score numeric(6,2),
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_pci_streaks TO authenticated;
GRANT ALL ON public.payment_pci_streaks TO service_role;
ALTER TABLE public.payment_pci_streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pci_streaks_forensic_read" ON public.payment_pci_streaks
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 3) Configuration baseline (canonical fingerprint of known-good config surface)
CREATE TABLE public.payment_config_baseline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  surface jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_config_baseline_current ON public.payment_config_baseline(is_current) WHERE is_current;
GRANT SELECT ON public.payment_config_baseline TO authenticated;
GRANT ALL ON public.payment_config_baseline TO service_role;
ALTER TABLE public.payment_config_baseline ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_baseline_forensic_read" ON public.payment_config_baseline
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 4) Config certifications (pre-flight per cycle)
CREATE TABLE public.payment_config_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL,
  passed boolean NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  drift_from_baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_config_certs_ran_at ON public.payment_config_certifications(ran_at DESC);
GRANT SELECT ON public.payment_config_certifications TO authenticated;
GRANT ALL ON public.payment_config_certifications TO service_role;
ALTER TABLE public.payment_config_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_certs_forensic_read" ON public.payment_config_certifications
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 5) Replay certifications (weekly)
CREATE TABLE public.payment_replay_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  sample_size integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  diverged integer NOT NULL DEFAULT 0,
  critical boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'running',
  sample_correlation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_replay_certs_started_at ON public.payment_replay_certifications(started_at DESC);
GRANT SELECT ON public.payment_replay_certifications TO authenticated;
GRANT ALL ON public.payment_replay_certifications TO service_role;
ALTER TABLE public.payment_replay_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "replay_certs_forensic_read" ON public.payment_replay_certifications
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 6) Replay cert divergences (per-payment mismatches)
CREATE TABLE public.payment_replay_cert_divergences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES public.payment_replay_certifications(id) ON DELETE CASCADE,
  correlation_id text NOT NULL,
  dimension text NOT NULL,
  expected jsonb,
  actual jsonb,
  severity text NOT NULL DEFAULT 'medium',
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_replay_div_cert ON public.payment_replay_cert_divergences(certification_id);
CREATE INDEX idx_replay_div_corr ON public.payment_replay_cert_divergences(correlation_id);
GRANT SELECT ON public.payment_replay_cert_divergences TO authenticated;
GRANT ALL ON public.payment_replay_cert_divergences TO service_role;
ALTER TABLE public.payment_replay_cert_divergences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "replay_div_forensic_read" ON public.payment_replay_cert_divergences
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 7) Confidence reports (nightly narrative)
CREATE TABLE public.payment_confidence_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  confidence_pct numeric(5,2) NOT NULL,
  can_process_production_money boolean NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_confidence_reports_generated ON public.payment_confidence_reports(generated_at DESC);
GRANT SELECT ON public.payment_confidence_reports TO authenticated;
GRANT ALL ON public.payment_confidence_reports TO service_role;
ALTER TABLE public.payment_confidence_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "confidence_reports_forensic_read" ON public.payment_confidence_reports
  FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));

-- 8) PCI computation RPC
CREATE OR REPLACE FUNCTION public.payment_compute_pci()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Rolling stability (20): avg success rate across latest windows
  SELECT COALESCE(AVG(success_rate) * 20, 0) INTO v_stability
  FROM (
    SELECT success_rate FROM public.payment_stability_windows
    ORDER BY window_end DESC LIMIT 4
  ) s;

  -- Financial integrity (20): latest avg fin integrity score
  SELECT COALESCE(AVG(financial_integrity_score) / 100.0 * 20, 0) INTO v_financial
  FROM (
    SELECT financial_integrity_score FROM public.payment_qualification_evidence_packs
    WHERE generated_at > now() - interval '7 days'
    ORDER BY generated_at DESC LIMIT 20
  ) f;

  -- Qualification history (15): success ratio last 30d
  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE overall_status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 15, 0
  ) INTO v_qual_hist
  FROM public.payment_continuous_qualification_runs
  WHERE started_at > now() - interval '30 days';

  -- Chaos recovery (10)
  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 10, 0
  ) INTO v_chaos
  FROM public.payment_chaos_runs
  WHERE started_at > now() - interval '30 days';

  -- Load qualification (10)
  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 10, 0
  ) INTO v_load
  FROM public.payment_load_qualification_runs
  WHERE started_at > now() - interval '30 days';

  -- Evidence integrity (10)
  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE status = 'passed')::numeric / NULLIF(COUNT(*),0)) * 10, 0
  ) INTO v_evidence
  FROM public.payment_evidence_retention_checks
  WHERE checked_at > now() - interval '30 days';

  -- Shadow equivalence (10): inverse of divergence rate
  SELECT COALESCE(
    GREATEST(0, 1 - (COUNT(*) FILTER (WHERE diverged)::numeric / NULLIF(COUNT(*),0))) * 10, 10
  ) INTO v_shadow
  FROM public.payment_orchestrator_shadow_diffs
  WHERE created_at > now() - interval '7 days';

  -- Operational SLOs (5)
  SELECT COALESCE(
    (COUNT(*) FILTER (WHERE within_slo)::numeric / NULLIF(COUNT(*),0)) * 5, 5
  ) INTO v_slo
  FROM public.payment_slo_measurements
  WHERE measured_at > now() - interval '7 days';

  -- Incident history (5): 0 critical in 72h -> full 5, else penalized
  SELECT COUNT(*) INTO v_tmp FROM public.payment_alerts
  WHERE severity = 'critical' AND created_at > now() - interval '72 hours';
  v_incident := GREATEST(0, 5 - LEAST(5, v_tmp::numeric));

  -- Deployment stability (5)
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
$$;

-- 9) PCI streak day count
CREATE OR REPLACE FUNCTION public.payment_pci_streak_days()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(current_days, 0) FROM public.payment_pci_streaks
  ORDER BY updated_at DESC LIMIT 1
$$;

-- 10) Strengthened promotion gate v2
CREATE OR REPLACE FUNCTION public.payment_promotion_eligibility_v2()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  WHERE severity = 'critical' AND created_at > now() - interval '72 hours';

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
$$;

GRANT EXECUTE ON FUNCTION public.payment_compute_pci() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_pci_streak_days() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payment_promotion_eligibility_v2() TO authenticated, service_role;
