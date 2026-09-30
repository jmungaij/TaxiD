
-- 1) Build provenance on runs (idempotent)
ALTER TABLE public.payment_certification_runs
  ADD COLUMN IF NOT EXISTS deployment_version text,
  ADD COLUMN IF NOT EXISTS git_revision text,
  ADD COLUMN IF NOT EXISTS build_timestamp timestamptz;

-- 2) Baseline table — one row per environment holding the last CERTIFIED metrics.
CREATE TABLE IF NOT EXISTS public.payment_certification_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL UNIQUE,
  run_id uuid REFERENCES public.payment_certification_runs(id) ON DELETE SET NULL,
  suite_version text,
  deployment_version text,
  git_revision text,
  readiness_score numeric,
  overall_score numeric,
  signal_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  certified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_certification_baselines TO authenticated;
GRANT ALL ON public.payment_certification_baselines TO service_role;

ALTER TABLE public.payment_certification_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read baselines" ON public.payment_certification_baselines;
CREATE POLICY "admins read baselines" ON public.payment_certification_baselines
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'finance_admin')
  );

DROP POLICY IF EXISTS "service writes baselines" ON public.payment_certification_baselines;
CREATE POLICY "service writes baselines" ON public.payment_certification_baselines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Production readiness gate — the single authoritative decision.
CREATE OR REPLACE FUNCTION public.payment_orchestrator_readiness_gate()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_readiness   record;
  v_wf          record;
  v_failed_wf   int := 0;
  v_critical    int := 0;
  v_warnings    int := 0;
  v_passed      text[] := ARRAY[]::text[];
  v_failed      text[] := ARRAY[]::text[];
  v_blocking    jsonb := '[]'::jsonb;
  v_score       numeric := 0;
  v_ready       boolean := false;
  v_recent_run  record;
BEGIN
  -- Latest readiness snapshot
  SELECT * INTO v_readiness
  FROM public.platform_readiness_snapshots
  ORDER BY computed_at DESC
  LIMIT 1;

  IF v_readiness IS NULL THEN
    RETURN jsonb_build_object(
      'ready', false, 'score', 0, 'critical_failures', 1, 'warnings', 0,
      'blocking_conditions', jsonb_build_array(
        jsonb_build_object('code','no_readiness_snapshot','detail','Run the certification suite first')),
      'failed_checks', to_jsonb(ARRAY['readiness_snapshot']),
      'passed_checks', '[]'::jsonb,
      'evaluated_at', now()
    );
  END IF;

  v_score := COALESCE(v_readiness.readiness_score, 0);

  -- Critical: any failed signals
  IF v_readiness.failed_signals IS NOT NULL AND array_length(v_readiness.failed_signals, 1) > 0 THEN
    v_critical := v_critical + array_length(v_readiness.failed_signals, 1);
    v_failed := v_failed || v_readiness.failed_signals;
    v_blocking := v_blocking || jsonb_build_object(
      'code','signals_failed','detail',to_jsonb(v_readiness.failed_signals));
  ELSE
    v_passed := v_passed || ARRAY['callback_success','oauth_health','stk_health','settlement_health'];
  END IF;

  -- Critical: any workflow FAILED / any critical workflow < CERTIFIED
  FOR v_wf IN
    SELECT workflow_key, workflow_name, status, criticality, score
    FROM public.certification_workflows
  LOOP
    IF v_wf.status = 'FAILED' THEN
      v_failed_wf := v_failed_wf + 1;
      v_failed := v_failed || ARRAY['workflow:'||v_wf.workflow_key];
      v_blocking := v_blocking || jsonb_build_object(
        'code','workflow_failed','workflow',v_wf.workflow_key,'detail','Workflow certification FAILED');
    ELSIF v_wf.criticality = 'critical' AND v_wf.status <> 'CERTIFIED' THEN
      v_failed_wf := v_failed_wf + 1;
      v_failed := v_failed || ARRAY['critical_workflow:'||v_wf.workflow_key];
      v_blocking := v_blocking || jsonb_build_object(
        'code','critical_workflow_not_certified','workflow',v_wf.workflow_key,'status',v_wf.status);
    ELSIF v_wf.status = 'DEGRADED' THEN
      v_warnings := v_warnings + 1;
    ELSIF v_wf.status = 'CERTIFIED' THEN
      v_passed := v_passed || ARRAY['workflow:'||v_wf.workflow_key];
    END IF;
  END LOOP;

  IF v_failed_wf > 0 THEN v_critical := v_critical + v_failed_wf; END IF;

  -- Freshness: latest completed run within 24h
  SELECT * INTO v_recent_run
  FROM public.payment_certification_runs
  WHERE completed_at IS NOT NULL AND status = 'PASSED'
  ORDER BY completed_at DESC
  LIMIT 1;

  IF v_recent_run IS NULL OR v_recent_run.completed_at < now() - interval '24 hours' THEN
    v_warnings := v_warnings + 1;
    v_blocking := v_blocking || jsonb_build_object(
      'code','stale_certification','detail','No passing certification run in the last 24 hours');
  ELSE
    v_passed := v_passed || ARRAY['recent_certification'];
  END IF;

  -- Score threshold
  IF v_score < 90 THEN
    v_critical := v_critical + 1;
    v_blocking := v_blocking || jsonb_build_object(
      'code','score_below_threshold','detail',format('Readiness %s%% < 90%%', v_score));
    v_failed := v_failed || ARRAY['readiness_score'];
  ELSE
    v_passed := v_passed || ARRAY['readiness_score'];
  END IF;

  v_ready := (v_critical = 0) AND v_score >= 90;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'score', v_score,
    'critical_failures', v_critical,
    'warnings', v_warnings,
    'blocking_conditions', v_blocking,
    'failed_checks', to_jsonb(v_failed),
    'passed_checks', to_jsonb(v_passed),
    'signal_scores', COALESCE(v_readiness.signal_scores, '{}'::jsonb),
    'latest_run_id', v_recent_run.id,
    'evaluated_at', now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.payment_orchestrator_readiness_gate() TO authenticated;

-- 4) Baseline comparison — compares latest completed run to stored baseline.
CREATE OR REPLACE FUNCTION public.payment_certification_baseline_compare(_environment text DEFAULT 'sandbox')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curr record;
  v_base record;
  v_regressions jsonb := '[]'::jsonb;
  v_improvements jsonb := '[]'::jsonb;
  v_unchanged jsonb := '[]'::jsonb;
  v_curr_metrics jsonb;
  v_base_metrics jsonb;
  k text;
  cv numeric; bv numeric; delta numeric;
BEGIN
  SELECT * INTO v_curr FROM public.payment_certification_runs
   WHERE environment = _environment AND completed_at IS NOT NULL
   ORDER BY completed_at DESC LIMIT 1;

  SELECT * INTO v_base FROM public.payment_certification_baselines WHERE environment = _environment;

  IF v_curr IS NULL THEN
    RETURN jsonb_build_object('has_current', false, 'has_baseline', v_base IS NOT NULL);
  END IF;

  v_curr_metrics := COALESCE(v_curr.summary, '{}'::jsonb) ||
    jsonb_build_object('overall_score', v_curr.overall_score,
                       'passed', v_curr.passed_scenarios,
                       'failed', v_curr.failed_scenarios);

  IF v_base IS NULL THEN
    RETURN jsonb_build_object(
      'has_current', true, 'has_baseline', false,
      'current', jsonb_build_object('run_id', v_curr.id, 'metrics', v_curr_metrics,
        'deployment_version', v_curr.deployment_version, 'git_revision', v_curr.git_revision));
  END IF;

  v_base_metrics := COALESCE(v_base.metrics, '{}'::jsonb);

  FOR k IN SELECT jsonb_object_keys(v_curr_metrics) LOOP
    BEGIN cv := (v_curr_metrics ->> k)::numeric; EXCEPTION WHEN OTHERS THEN cv := NULL; END;
    BEGIN bv := (v_base_metrics ->> k)::numeric; EXCEPTION WHEN OTHERS THEN bv := NULL; END;
    IF cv IS NULL OR bv IS NULL THEN CONTINUE; END IF;
    delta := cv - bv;
    IF k IN ('failed') THEN
      IF delta > 0 THEN v_regressions := v_regressions || jsonb_build_object('metric',k,'baseline',bv,'current',cv,'delta',delta);
      ELSIF delta < 0 THEN v_improvements := v_improvements || jsonb_build_object('metric',k,'baseline',bv,'current',cv,'delta',delta);
      ELSE v_unchanged := v_unchanged || jsonb_build_object('metric',k,'value',cv); END IF;
    ELSE
      IF delta < 0 THEN v_regressions := v_regressions || jsonb_build_object('metric',k,'baseline',bv,'current',cv,'delta',delta);
      ELSIF delta > 0 THEN v_improvements := v_improvements || jsonb_build_object('metric',k,'baseline',bv,'current',cv,'delta',delta);
      ELSE v_unchanged := v_unchanged || jsonb_build_object('metric',k,'value',cv); END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'has_current', true, 'has_baseline', true,
    'environment', _environment,
    'baseline', jsonb_build_object('run_id', v_base.run_id, 'certified_at', v_base.certified_at,
      'deployment_version', v_base.deployment_version, 'git_revision', v_base.git_revision,
      'readiness_score', v_base.readiness_score, 'metrics', v_base_metrics),
    'current', jsonb_build_object('run_id', v_curr.id, 'completed_at', v_curr.completed_at,
      'deployment_version', v_curr.deployment_version, 'git_revision', v_curr.git_revision,
      'overall_score', v_curr.overall_score, 'metrics', v_curr_metrics),
    'regressions', v_regressions,
    'improvements', v_improvements,
    'unchanged', v_unchanged,
    'regressed', jsonb_array_length(v_regressions) > 0
  );
END $$;

GRANT EXECUTE ON FUNCTION public.payment_certification_baseline_compare(text) TO authenticated;

-- 5) Promote-to-baseline helper (service_role only)
CREATE OR REPLACE FUNCTION public.payment_certification_promote_baseline(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run record;
  v_readiness numeric;
  v_signals jsonb;
BEGIN
  SELECT * INTO v_run FROM public.payment_certification_runs WHERE id = _run_id;
  IF v_run IS NULL OR v_run.status <> 'PASSED' THEN
    RAISE EXCEPTION 'run % is not a passing run', _run_id;
  END IF;

  SELECT readiness_score, signal_scores INTO v_readiness, v_signals
  FROM public.platform_readiness_snapshots ORDER BY computed_at DESC LIMIT 1;

  INSERT INTO public.payment_certification_baselines
    (environment, run_id, suite_version, deployment_version, git_revision,
     readiness_score, overall_score, signal_scores, metrics, certified_at)
  VALUES
    (COALESCE(v_run.environment,'sandbox'), v_run.id, v_run.suite_version,
     v_run.deployment_version, v_run.git_revision,
     v_readiness, v_run.overall_score, COALESCE(v_signals,'{}'::jsonb),
     COALESCE(v_run.summary,'{}'::jsonb) || jsonb_build_object(
       'overall_score', v_run.overall_score,
       'passed', v_run.passed_scenarios,
       'failed', v_run.failed_scenarios),
     now())
  ON CONFLICT (environment) DO UPDATE
    SET run_id = EXCLUDED.run_id,
        suite_version = EXCLUDED.suite_version,
        deployment_version = EXCLUDED.deployment_version,
        git_revision = EXCLUDED.git_revision,
        readiness_score = EXCLUDED.readiness_score,
        overall_score = EXCLUDED.overall_score,
        signal_scores = EXCLUDED.signal_scores,
        metrics = EXCLUDED.metrics,
        certified_at = EXCLUDED.certified_at,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'run_id', v_run.id, 'environment', COALESCE(v_run.environment,'sandbox'));
END $$;

REVOKE ALL ON FUNCTION public.payment_certification_promote_baseline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_certification_promote_baseline(uuid) TO service_role;
