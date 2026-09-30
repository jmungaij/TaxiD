
-- ============ 1. payment_forecast_accuracy ============
CREATE TABLE IF NOT EXISTS public.payment_forecast_accuracy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric TEXT NOT NULL,
  forecast_id UUID,
  model_version TEXT,
  window_start TIMESTAMPTZ NOT NULL,
  window_end   TIMESTAMPTZ NOT NULL,
  predicted_value NUMERIC NOT NULL,
  actual_value    NUMERIC NOT NULL,
  absolute_error  NUMERIC GENERATED ALWAYS AS (abs(actual_value - predicted_value)) STORED,
  percent_error   NUMERIC GENERATED ALWAYS AS (
    CASE WHEN actual_value = 0 THEN NULL
         ELSE abs(actual_value - predicted_value) / abs(actual_value) * 100 END
  ) STORED,
  drift_flag BOOLEAN NOT NULL DEFAULT false,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pfa_metric_time ON public.payment_forecast_accuracy(metric, window_end DESC);

GRANT SELECT ON public.payment_forecast_accuracy TO authenticated;
GRANT ALL ON public.payment_forecast_accuracy TO service_role;
ALTER TABLE public.payment_forecast_accuracy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "forensic roles read forecast accuracy"
  ON public.payment_forecast_accuracy FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));
CREATE POLICY "service role writes forecast accuracy"
  ON public.payment_forecast_accuracy FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============ 2. payment_continuous_qualification_reruns ============
CREATE TABLE IF NOT EXISTS public.payment_continuous_qualification_reruns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_run_id UUID NOT NULL REFERENCES public.payment_continuous_qualification_runs(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  new_run_id UUID REFERENCES public.payment_continuous_qualification_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pcqr_original ON public.payment_continuous_qualification_reruns(original_run_id, created_at DESC);

GRANT SELECT ON public.payment_continuous_qualification_reruns TO authenticated;
GRANT ALL ON public.payment_continuous_qualification_reruns TO service_role;
ALTER TABLE public.payment_continuous_qualification_reruns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "forensic roles read qual reruns"
  ON public.payment_continuous_qualification_reruns FOR SELECT TO authenticated
  USING (public.payment_has_forensic_access(auth.uid()));
CREATE POLICY "service role writes qual reruns"
  ON public.payment_continuous_qualification_reruns FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============ 3. Signed-package columns on payment_evidence_exports ============
ALTER TABLE public.payment_evidence_exports
  ADD COLUMN IF NOT EXISTS package_format TEXT
    CHECK (package_format IN ('json','pdf','bundle')) DEFAULT 'json',
  ADD COLUMN IF NOT EXISTS signature_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS signer_key_id TEXT,
  ADD COLUMN IF NOT EXISTS signed_manifest JSONB;

-- ============ 4. Drill-down cache on payment_incident_groups ============
ALTER TABLE public.payment_incident_groups
  ADD COLUMN IF NOT EXISTS drill_down_context JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============ 5. RPC: payment_record_forecast_accuracy ============
CREATE OR REPLACE FUNCTION public.payment_record_forecast_accuracy(
  _metric TEXT,
  _forecast_id UUID,
  _model_version TEXT,
  _window_start TIMESTAMPTZ,
  _window_end TIMESTAMPTZ,
  _predicted NUMERIC,
  _actual NUMERIC,
  _drift_threshold_pct NUMERIC DEFAULT 15
) RETURNS TABLE (
  id UUID,
  percent_error NUMERIC,
  rolling_mape NUMERIC,
  drift_flag BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct NUMERIC;
  v_drift BOOLEAN;
  v_id UUID;
  v_mape NUMERIC;
BEGIN
  v_pct := CASE WHEN _actual = 0 THEN NULL
                ELSE abs(_actual - _predicted) / abs(_actual) * 100 END;
  v_drift := COALESCE(v_pct, 0) >= _drift_threshold_pct;

  INSERT INTO public.payment_forecast_accuracy(
    metric, forecast_id, model_version, window_start, window_end,
    predicted_value, actual_value, drift_flag
  ) VALUES (
    _metric, _forecast_id, _model_version, _window_start, _window_end,
    _predicted, _actual, v_drift
  ) RETURNING payment_forecast_accuracy.id INTO v_id;

  SELECT avg(percent_error) INTO v_mape
    FROM public.payment_forecast_accuracy
    WHERE metric = _metric AND created_at > now() - interval '7 days';

  RETURN QUERY SELECT v_id, v_pct, v_mape, v_drift;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_record_forecast_accuracy(TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_record_forecast_accuracy(TEXT,UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,NUMERIC,NUMERIC,NUMERIC) TO service_role;

-- ============ 6. RPC: payment_incident_group_drilldown ============
CREATE OR REPLACE FUNCTION public.payment_incident_group_drilldown(_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Pick most recent alert's correlation id, if any, to seed twin drill-down.
  SELECT (a.details->>'correlation_id') INTO v_correlation_id
    FROM public.payment_incident_group_members m
    JOIN public.payment_alerts a ON a.id = m.alert_id
    WHERE m.group_id = _group_id
      AND a.details ? 'correlation_id'
    ORDER BY a.created_at DESC LIMIT 1;

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
$$;

REVOKE ALL ON FUNCTION public.payment_incident_group_drilldown(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_incident_group_drilldown(UUID) TO authenticated, service_role;

-- ============ 7. RPC: payment_continuous_qualification_rerun ============
CREATE OR REPLACE FUNCTION public.payment_continuous_qualification_rerun(
  _original_run_id UUID,
  _reason TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.payment_has_forensic_access(auth.uid()) THEN
    RAISE EXCEPTION 'forensic_access_required';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 4 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  INSERT INTO public.payment_continuous_qualification_reruns(
    original_run_id, requested_by, reason, status
  ) VALUES (_original_run_id, auth.uid(), _reason, 'QUEUED')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_continuous_qualification_rerun(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_continuous_qualification_rerun(UUID,TEXT) TO authenticated, service_role;
