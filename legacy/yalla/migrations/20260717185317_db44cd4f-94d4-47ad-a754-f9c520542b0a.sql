
-- ============================================================
-- Slice 3: Enterprise Validation, Certification & Readiness
-- ============================================================

-- 1. Certification runs (one row per suite execution)
CREATE TABLE public.payment_certification_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  triggered_by UUID REFERENCES auth.users(id),
  environment TEXT NOT NULL DEFAULT 'sandbox',
  suite_version TEXT NOT NULL DEFAULT 'slice3.v1',
  status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | PASSED | FAILED | ABORTED
  total_scenarios INT NOT NULL DEFAULT 0,
  passed_scenarios INT NOT NULL DEFAULT 0,
  failed_scenarios INT NOT NULL DEFAULT 0,
  skipped_scenarios INT NOT NULL DEFAULT 0,
  overall_score NUMERIC(5,2),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_certification_runs TO authenticated;
GRANT ALL ON public.payment_certification_runs TO service_role;
ALTER TABLE public.payment_certification_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view certification runs"
  ON public.payment_certification_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages certification runs"
  ON public.payment_certification_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. Individual scenario results
CREATE TABLE public.payment_certification_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.payment_certification_runs(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  correlation_id UUID,
  payment_attempt_id UUID,
  checkout_request_id TEXT,
  merchant_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | RUNNING | PASSED | FAILED | SKIPPED
  expected_outcome TEXT NOT NULL,
  observed_outcome TEXT,
  gate_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  duration_ms INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_certification_scenarios TO authenticated;
GRANT ALL ON public.payment_certification_scenarios TO service_role;
ALTER TABLE public.payment_certification_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view certification scenarios"
  ON public.payment_certification_scenarios FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages certification scenarios"
  ON public.payment_certification_scenarios FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX idx_cert_scenarios_run ON public.payment_certification_scenarios(run_id);
CREATE INDEX idx_cert_scenarios_corr ON public.payment_certification_scenarios(correlation_id);

-- 3. Per-journey validation output
CREATE TABLE public.payment_journey_validations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  correlation_id UUID NOT NULL,
  scenario_id UUID REFERENCES public.payment_certification_scenarios(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- PASS | FAIL
  checks JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{key, ok, detail}]
  missing_stages TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  duplicate_events INT NOT NULL DEFAULT 0,
  orphan_transitions INT NOT NULL DEFAULT 0,
  callback_persisted BOOLEAN,
  ledger_ok BOOLEAN,
  settlement_ok BOOLEAN,
  notification_ok BOOLEAN,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_journey_validations TO authenticated;
GRANT ALL ON public.payment_journey_validations TO service_role;
ALTER TABLE public.payment_journey_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view journey validations"
  ON public.payment_journey_validations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages journey validations"
  ON public.payment_journey_validations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX idx_journey_validations_corr ON public.payment_journey_validations(correlation_id);

-- 4. Aggregated platform health KPIs (rolling snapshots)
CREATE TABLE public.payment_platform_health (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  edge_invocations INT NOT NULL DEFAULT 0,
  stk_attempts INT NOT NULL DEFAULT 0,
  stk_success_rate NUMERIC(5,2),
  callbacks_received INT NOT NULL DEFAULT 0,
  callback_success_rate NUMERIC(5,2),
  duplicate_callbacks INT NOT NULL DEFAULT 0,
  oauth_success_rate NUMERIC(5,2),
  avg_callback_latency_ms INT,
  infra_cert_status TEXT, -- PASS | FAIL | UNKNOWN
  journeys_completed INT NOT NULL DEFAULT 0,
  journeys_stalled INT NOT NULL DEFAULT 0,
  active_incidents INT NOT NULL DEFAULT 0,
  idempotency_violations INT NOT NULL DEFAULT 0,
  overall_health_score NUMERIC(5,2),
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_platform_health TO authenticated;
GRANT ALL ON public.payment_platform_health TO service_role;
ALTER TABLE public.payment_platform_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view platform health"
  ON public.payment_platform_health FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Service role manages platform health"
  ON public.payment_platform_health FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX idx_platform_health_window ON public.payment_platform_health(window_end DESC);

-- 5. Journey validation helper: compute completeness for a correlation_id
CREATE OR REPLACE FUNCTION public.validate_payment_journey(_correlation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_count INT;
  stage_count INT;
  step_count INT;
  transition_count INT;
  callback_count INT;
  duplicate_cb INT;
  failed_steps INT;
  checks JSONB := '[]'::jsonb;
  missing TEXT[] := ARRAY[]::TEXT[];
  overall TEXT := 'PASS';
BEGIN
  SELECT COUNT(*) INTO inv_count FROM public.workflow_invocations WHERE correlation_id = _correlation_id;
  SELECT COUNT(*) INTO stage_count FROM public.payment_journey_stages WHERE correlation_id = _correlation_id;
  SELECT COUNT(*) INTO step_count FROM public.payment_step_traces WHERE correlation_id = _correlation_id;
  SELECT COUNT(*) INTO transition_count FROM public.payment_state_transitions WHERE correlation_id = _correlation_id;
  SELECT COUNT(*) INTO callback_count FROM public.mpesa_callback_logs
    WHERE (raw_payload->>'correlation_id') = _correlation_id::text
       OR (raw_payload->'Body'->'stkCallback'->>'MerchantRequestID') IN (
          SELECT merchant_request_id FROM public.mpesa_stk_attempts
          WHERE correlation_id = _correlation_id AND merchant_request_id IS NOT NULL
       );
  SELECT COUNT(*) INTO failed_steps FROM public.payment_step_traces
    WHERE correlation_id = _correlation_id AND status = 'FAILED';

  duplicate_cb := GREATEST(callback_count - 1, 0);

  checks := checks || jsonb_build_object('key','has_invocations','ok', inv_count > 0, 'detail', inv_count);
  checks := checks || jsonb_build_object('key','has_stages','ok', stage_count > 0, 'detail', stage_count);
  checks := checks || jsonb_build_object('key','has_step_traces','ok', step_count > 0, 'detail', step_count);
  checks := checks || jsonb_build_object('key','has_transitions','ok', transition_count > 0, 'detail', transition_count);
  checks := checks || jsonb_build_object('key','callback_pre_persisted','ok', callback_count > 0, 'detail', callback_count);

  IF inv_count = 0 THEN missing := array_append(missing, 'invocations'); overall := 'FAIL'; END IF;
  IF stage_count = 0 THEN missing := array_append(missing, 'stages'); overall := 'FAIL'; END IF;
  IF step_count = 0 THEN missing := array_append(missing, 'step_traces'); overall := 'FAIL'; END IF;

  RETURN jsonb_build_object(
    'correlation_id', _correlation_id,
    'status', overall,
    'checks', checks,
    'missing_stages', to_jsonb(missing),
    'duplicate_callbacks', duplicate_cb,
    'failed_steps', failed_steps
  );
END;
$$;

-- 6. Platform-health snapshot computation
CREATE OR REPLACE FUNCTION public.compute_platform_health(_window_minutes INT DEFAULT 60)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start TIMESTAMPTZ := now() - (_window_minutes || ' minutes')::interval;
  _end   TIMESTAMPTZ := now();
  _inv   INT;
  _stk   INT;
  _stk_ok INT;
  _cb    INT;
  _cb_ok INT;
  _dup   INT;
  _lat   INT;
  _infra TEXT;
  _completed INT;
  _stalled INT;
  _id UUID;
  _score NUMERIC(5,2);
  _stk_rate NUMERIC(5,2);
  _cb_rate NUMERIC(5,2);
BEGIN
  SELECT COUNT(*) INTO _inv FROM public.workflow_invocations WHERE started_at BETWEEN _start AND _end;
  SELECT COUNT(*) INTO _stk FROM public.mpesa_stk_attempts WHERE created_at BETWEEN _start AND _end;
  SELECT COUNT(*) INTO _stk_ok FROM public.mpesa_stk_attempts
    WHERE created_at BETWEEN _start AND _end AND status IN ('SUCCEEDED','COMPLETED','ok');
  SELECT COUNT(*) INTO _cb FROM public.mpesa_callback_logs WHERE created_at BETWEEN _start AND _end;
  SELECT COUNT(*) INTO _cb_ok FROM public.mpesa_callback_logs
    WHERE created_at BETWEEN _start AND _end AND (raw_payload->'Body'->'stkCallback'->>'ResultCode')::int = 0;
  SELECT COUNT(*) FILTER (WHERE cnt > 1) INTO _dup FROM (
    SELECT COUNT(*) cnt FROM public.mpesa_callback_logs
    WHERE created_at BETWEEN _start AND _end
    GROUP BY raw_payload->'Body'->'stkCallback'->>'CheckoutRequestID'
  ) d;
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))*1000)::int, 0) INTO _lat
    FROM public.workflow_invocations
    WHERE function_name = 'mpesa-callback' AND started_at BETWEEN _start AND _end AND finished_at IS NOT NULL;
  SELECT CASE WHEN bool_and(overall_ok) THEN 'PASS' ELSE 'FAIL' END INTO _infra
    FROM public.infrastructure_certification_runs WHERE ran_at BETWEEN _start AND _end;
  SELECT COUNT(*) INTO _completed FROM public.workflow_invocations
    WHERE started_at BETWEEN _start AND _end AND execution_status = 'SUCCEEDED';
  SELECT COUNT(*) INTO _stalled FROM public.workflow_invocations
    WHERE started_at BETWEEN _start AND _end AND finished_at IS NULL AND started_at < now() - interval '5 minutes';

  _stk_rate := CASE WHEN _stk > 0 THEN (_stk_ok::numeric*100/_stk) ELSE NULL END;
  _cb_rate  := CASE WHEN _cb  > 0 THEN (_cb_ok::numeric*100/_cb)  ELSE NULL END;
  _score := ROUND(
    COALESCE(_stk_rate, 100) * 0.35 +
    COALESCE(_cb_rate,  100) * 0.35 +
    CASE WHEN _infra = 'PASS' THEN 100 WHEN _infra = 'FAIL' THEN 40 ELSE 80 END * 0.20 +
    CASE WHEN _stalled = 0 THEN 100 WHEN _stalled < 5 THEN 70 ELSE 30 END * 0.10
  , 2);

  INSERT INTO public.payment_platform_health(
    window_start, window_end, edge_invocations, stk_attempts, stk_success_rate,
    callbacks_received, callback_success_rate, duplicate_callbacks, avg_callback_latency_ms,
    infra_cert_status, journeys_completed, journeys_stalled, overall_health_score,
    breakdown
  ) VALUES (
    _start, _end, _inv, _stk, _stk_rate, _cb, _cb_rate, _dup, _lat,
    COALESCE(_infra,'UNKNOWN'), _completed, _stalled, _score,
    jsonb_build_object('window_minutes', _window_minutes)
  ) RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_payment_journey(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_platform_health(INT) TO authenticated, service_role;
