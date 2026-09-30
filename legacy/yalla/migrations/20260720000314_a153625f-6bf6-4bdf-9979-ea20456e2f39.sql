
-- =========================================================================
-- Phase D5.2 — Enterprise Production Qualification
-- =========================================================================

-- ------------------------------------------------------------------
-- 1) LOAD QUALIFICATION
-- ------------------------------------------------------------------
CREATE TABLE public.payment_load_qualification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concurrency_tier INTEGER NOT NULL CHECK (concurrency_tier IN (100, 250, 500, 1000)),
  scenario TEXT NOT NULL DEFAULT 'stk_burst',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','aborted')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total_requests INTEGER NOT NULL DEFAULT 0,
  successful_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  callback_latency_p50_ms NUMERIC,
  callback_latency_p95_ms NUMERIC,
  callback_latency_p99_ms NUMERIC,
  controller_latency_p95_ms NUMERIC,
  wallet_posting_latency_p95_ms NUMERIC,
  ledger_latency_p95_ms NUMERIC,
  settlement_latency_p95_ms NUMERIC,
  max_queue_depth INTEGER,
  max_outbox_lag_ms NUMERIC,
  error_rate NUMERIC,
  financial_integrity_score NUMERIC,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_load_qualification_runs TO authenticated;
GRANT ALL ON public.payment_load_qualification_runs TO service_role;
ALTER TABLE public.payment_load_qualification_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_load_runs" ON public.payment_load_qualification_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service_role_all_load_runs" ON public.payment_load_qualification_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_load_runs_started ON public.payment_load_qualification_runs (started_at DESC);
CREATE INDEX idx_load_runs_tier_status ON public.payment_load_qualification_runs (concurrency_tier, status);

-- ------------------------------------------------------------------
-- 2) CHAOS QUALIFICATION
-- ------------------------------------------------------------------
CREATE TABLE public.payment_chaos_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  fault_category TEXT NOT NULL,
  description TEXT NOT NULL,
  max_recovery_ms INTEGER NOT NULL DEFAULT 60000,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_chaos_scenarios TO authenticated;
GRANT ALL ON public.payment_chaos_scenarios TO service_role;
ALTER TABLE public.payment_chaos_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_chaos_scenarios" ON public.payment_chaos_scenarios
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service_role_all_chaos_scenarios" ON public.payment_chaos_scenarios
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.payment_chaos_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES public.payment_chaos_scenarios(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','recovered','failed','aborted')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  recovery_ms INTEGER,
  auto_recovered BOOLEAN NOT NULL DEFAULT false,
  financial_integrity_delta NUMERIC NOT NULL DEFAULT 0,
  data_loss_detected BOOLEAN NOT NULL DEFAULT false,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_chaos_runs TO authenticated;
GRANT ALL ON public.payment_chaos_runs TO service_role;
ALTER TABLE public.payment_chaos_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_chaos_runs" ON public.payment_chaos_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service_role_all_chaos_runs" ON public.payment_chaos_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_chaos_runs_started ON public.payment_chaos_runs (started_at DESC);
CREATE INDEX idx_chaos_runs_scenario ON public.payment_chaos_runs (scenario_id, status);

-- Seed the canonical chaos catalogue
INSERT INTO public.payment_chaos_scenarios (scenario_key, display_name, fault_category, description, max_recovery_ms) VALUES
  ('daraja_timeout',        'Daraja API Timeout',        'upstream',    'Simulates Daraja STK request exceeding timeout budget',            45000),
  ('oauth_failure',         'OAuth Token Failure',       'upstream',    'Simulates Daraja OAuth 401 requiring token refresh',                30000),
  ('callback_loss',         'Callback Never Received',   'upstream',    'STK issued but callback never delivered — orchestrator must resolve via query', 90000),
  ('callback_delay',        'Delayed Callback',          'upstream',    'Callback arrives 60s+ after STK',                                   120000),
  ('duplicate_callback',    'Duplicate Callback',        'idempotency', 'Same callback delivered twice — idempotency layer must dedupe',    5000),
  ('duplicate_stk',         'Duplicate STK',             'idempotency', 'Client sends same request twice — idempotency layer must dedupe',  5000),
  ('network_interruption',  'Network Interruption',      'infra',       'Brief network partition mid-flow',                                  30000),
  ('postgres_latency',      'Postgres High Latency',     'infra',       'Simulated 5s DB latency spike',                                     60000),
  ('notification_failure',  'Notification Dispatch Failure', 'downstream', 'Notification worker fails — must land in DLQ and retry',       60000)
ON CONFLICT (scenario_key) DO NOTHING;

-- ------------------------------------------------------------------
-- 3) EVIDENCE RETENTION QUALIFICATION
-- ------------------------------------------------------------------
CREATE TABLE public.payment_evidence_retention_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_pack_id UUID NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash_ok BOOLEAN NOT NULL,
  signature_ok BOOLEAN NOT NULL,
  replay_ok BOOLEAN NOT NULL,
  drift_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT
);

GRANT SELECT ON public.payment_evidence_retention_checks TO authenticated;
GRANT ALL ON public.payment_evidence_retention_checks TO service_role;
ALTER TABLE public.payment_evidence_retention_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_retention_checks" ON public.payment_evidence_retention_checks
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service_role_all_retention_checks" ON public.payment_evidence_retention_checks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_retention_checks_pack ON public.payment_evidence_retention_checks (evidence_pack_id, checked_at DESC);
CREATE INDEX idx_retention_checks_time ON public.payment_evidence_retention_checks (checked_at DESC);

-- ------------------------------------------------------------------
-- 4) ENTERPRISE QUALIFICATION REPORT (immutable, signed)
-- ------------------------------------------------------------------
CREATE TABLE public.payment_qualification_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL UNIQUE,
  build_version TEXT,
  git_revision TEXT,
  migration_version TEXT,
  rolling_windows JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {24h:{},72h:{},7d:{},30d:{}}
  financial_integrity JSONB NOT NULL DEFAULT '{}'::jsonb,
  reliability JSONB NOT NULL DEFAULT '{}'::jsonb,
  slo_compliance JSONB NOT NULL DEFAULT '{}'::jsonb,
  callback_success JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_percentiles JSONB NOT NULL DEFAULT '{}'::jsonb,
  certification_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  critical_incident_count INTEGER NOT NULL DEFAULT 0,
  chaos_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  load_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  forensics_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  promotion_recommendation TEXT NOT NULL CHECK (promotion_recommendation IN ('eligible','blocked','insufficient_evidence')),
  promotion_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  canonical_payload_sha256 TEXT NOT NULL,
  hmac_signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL DEFAULT 'PAYMENT_EVIDENCE_SIGNING_KEY',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_qualification_reports TO authenticated;
GRANT ALL ON public.payment_qualification_reports TO service_role;
ALTER TABLE public.payment_qualification_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_qual_reports" ON public.payment_qualification_reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "service_role_all_qual_reports" ON public.payment_qualification_reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_qual_reports_date ON public.payment_qualification_reports (report_date DESC);

-- Immutability: qualification reports and retention checks are append-only
CREATE OR REPLACE FUNCTION public.enforce_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Row in % is append-only and cannot be modified or deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_qual_reports_immutable
  BEFORE UPDATE OR DELETE ON public.payment_qualification_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE TRIGGER trg_retention_checks_immutable
  BEFORE UPDATE OR DELETE ON public.payment_evidence_retention_checks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE TRIGGER trg_chaos_runs_no_delete
  BEFORE DELETE ON public.payment_chaos_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE TRIGGER trg_load_runs_no_delete
  BEFORE DELETE ON public.payment_load_qualification_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- ------------------------------------------------------------------
-- 5) ROLLING STABILITY SCORE (24h / 72h / 7d / 30d)
-- ------------------------------------------------------------------
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
    COUNT(*) FILTER (WHERE status = 'failed' AND (failure_class ILIKE '%critical%' OR financial_integrity_score < 99.99)),
    COALESCE(AVG(financial_integrity_score), 100)
  INTO total, successes, critical_failures, avg_integrity
  FROM public.payment_continuous_qualification_runs
  WHERE started_at >= now() - _window;

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

REVOKE ALL ON FUNCTION public.payment_stability_rolling_score(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_stability_rolling_score(INTERVAL) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 6) FORENSICS RECONSTRUCTION (15-hop chain)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_forensics_reconstruct(_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chain JSONB := '{}'::jsonb;
  missing TEXT[] := ARRAY[]::TEXT[];
  attempt RECORD;
  txn RECORD;
BEGIN
  -- Attempt
  SELECT * INTO attempt FROM public.mpesa_stk_attempts WHERE id = _payment_id OR checkout_request_id = _payment_id::TEXT LIMIT 1;
  IF NOT FOUND THEN
    missing := missing || 'attempt';
  ELSE
    chain := chain || jsonb_build_object('attempt', row_to_json(attempt));
  END IF;

  -- Transaction (callback)
  IF attempt.checkout_request_id IS NOT NULL THEN
    SELECT * INTO txn FROM public.mpesa_transactions WHERE checkout_request_id = attempt.checkout_request_id LIMIT 1;
    IF FOUND THEN
      chain := chain || jsonb_build_object('transaction', row_to_json(txn));
    ELSE
      missing := missing || 'transaction';
    END IF;
  END IF;

  -- Wallet, journal, settlement, notification lookups (best-effort presence checks)
  IF NOT EXISTS (SELECT 1 FROM public.wallet_transactions WHERE metadata->>'checkout_request_id' = attempt.checkout_request_id) THEN
    missing := missing || 'wallet';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.journals WHERE reference = attempt.checkout_request_id OR metadata->>'checkout_request_id' = attempt.checkout_request_id) THEN
    missing := missing || 'journal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.settlements WHERE reference = attempt.checkout_request_id) THEN
    missing := missing || 'settlement';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payment_notification_dispatches WHERE payload->>'checkout_request_id' = attempt.checkout_request_id) THEN
    missing := missing || 'notification';
  END IF;

  RETURN jsonb_build_object(
    'payment_id',     _payment_id,
    'chain',          chain,
    'missing_links',  to_jsonb(missing),
    'complete',       COALESCE(array_length(missing,1),0) = 0,
    'reconstructed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payment_forensics_reconstruct(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_forensics_reconstruct(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 7) PROMOTION ELIGIBILITY GATE (7 preconditions)
-- ------------------------------------------------------------------
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

  -- Zero critical incidents in 72h
  SELECT COUNT(*) INTO critical_recent
  FROM public.payment_continuous_qualification_runs
  WHERE started_at >= now() - INTERVAL '72 hours'
    AND status = 'failed'
    AND (failure_class ILIKE '%critical%' OR financial_integrity_score < 99.99);
  IF critical_recent > 0 THEN
    blockers := blockers || jsonb_build_array(jsonb_build_object('code','critical_incidents_72h','count',critical_recent));
  END IF;

  -- Load qualification: passed at >=500 concurrent within last 30d
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

  -- Chaos: all recent scenarios auto-recovered
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

  -- Latest nightly report present within 48h
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

REVOKE ALL ON FUNCTION public.payment_promotion_eligibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_promotion_eligibility() TO authenticated, service_role;
