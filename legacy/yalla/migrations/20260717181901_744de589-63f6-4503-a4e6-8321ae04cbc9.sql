
-- =========================================================================
-- Phase 0 – Payment Journey Certification Foundation
-- =========================================================================

-- 1. Edge Function Registry -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.edge_function_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL UNIQUE,
  version TEXT,
  git_sha TEXT,
  deployment_id TEXT,
  deployed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_invocation_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  invocation_count BIGINT NOT NULL DEFAULT 0,
  success_count BIGINT NOT NULL DEFAULT 0,
  failure_count BIGINT NOT NULL DEFAULT 0,
  avg_latency_ms NUMERIC,
  health_status TEXT NOT NULL DEFAULT 'unknown',
  owner_team TEXT,
  workflow_membership TEXT[] DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.edge_function_registry TO authenticated;
GRANT ALL ON public.edge_function_registry TO service_role;
ALTER TABLE public.edge_function_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read edge_function_registry" ON public.edge_function_registry
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages edge_function_registry" ON public.edge_function_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Workflow Registry ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,
  expected_steps JSONB NOT NULL DEFAULT '[]',
  sla_seconds INTEGER,
  timeout_seconds INTEGER,
  retry_policy JSONB NOT NULL DEFAULT '{}',
  owner_team TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.workflow_registry TO authenticated;
GRANT ALL ON public.workflow_registry TO service_role;
ALTER TABLE public.workflow_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read workflow_registry" ON public.workflow_registry
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role manages workflow_registry" ON public.workflow_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Workflow Invocations ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_name TEXT NOT NULL,
  workflow_version TEXT,
  correlation_id UUID NOT NULL,
  parent_correlation_id UUID,
  request_id UUID NOT NULL,
  function_name TEXT NOT NULL,
  deployment_id TEXT,
  git_sha TEXT,
  user_id UUID,
  caller TEXT,
  caller_role TEXT,
  tenant_id UUID,
  region TEXT,
  environment TEXT,
  current_step TEXT,
  current_state TEXT,
  execution_status TEXT NOT NULL DEFAULT 'STARTED'
    CHECK (execution_status IN ('STARTED','SUCCEEDED','FAILED','ABORTED','TIMED_OUT')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  ip TEXT,
  user_agent TEXT,
  http_method TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_inv_correlation ON public.workflow_invocations(correlation_id);
CREATE INDEX IF NOT EXISTS idx_wf_inv_function ON public.workflow_invocations(function_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_inv_workflow ON public.workflow_invocations(workflow_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_inv_status ON public.workflow_invocations(execution_status, started_at DESC);
GRANT SELECT ON public.workflow_invocations TO authenticated;
GRANT ALL ON public.workflow_invocations TO service_role;
ALTER TABLE public.workflow_invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read workflow_invocations" ON public.workflow_invocations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages workflow_invocations" ON public.workflow_invocations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. Callback Endpoint Registry --------------------------------------------
CREATE TABLE IF NOT EXISTS public.callback_endpoint_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  environment TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_certified_at TIMESTAMPTZ,
  last_certification_result TEXT,
  dns_status TEXT,
  tls_status TEXT,
  https_status TEXT,
  secret_valid BOOLEAN,
  deployment_reachable BOOLEAN,
  avg_latency_ms NUMERIC,
  health_score NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, callback_url, environment)
);
GRANT SELECT ON public.callback_endpoint_registry TO authenticated;
GRANT ALL ON public.callback_endpoint_registry TO service_role;
ALTER TABLE public.callback_endpoint_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read callback_endpoint_registry" ON public.callback_endpoint_registry
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages callback_endpoint_registry" ON public.callback_endpoint_registry
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Infrastructure Certification Runs -------------------------------------
CREATE TABLE IF NOT EXISTS public.infrastructure_certification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID REFERENCES public.callback_endpoint_registry(id) ON DELETE CASCADE,
  callback_url TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dns_ok BOOLEAN,
  tls_ok BOOLEAN,
  https_ok BOOLEAN,
  cert_valid BOOLEAN,
  secret_ok BOOLEAN,
  deployment_ok BOOLEAN,
  http_status INTEGER,
  latency_ms INTEGER,
  overall_ok BOOLEAN,
  failure_reason TEXT,
  raw_evidence JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_cert_runs_endpoint ON public.infrastructure_certification_runs(endpoint_id, ran_at DESC);
GRANT SELECT ON public.infrastructure_certification_runs TO authenticated;
GRANT ALL ON public.infrastructure_certification_runs TO service_role;
ALTER TABLE public.infrastructure_certification_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read infrastructure_certification_runs" ON public.infrastructure_certification_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages infrastructure_certification_runs" ON public.infrastructure_certification_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. Payment Journey Events (append-only) ----------------------------------
CREATE TABLE IF NOT EXISTS public.payment_journey_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  parent_correlation_id UUID,
  workflow_name TEXT,
  event_key TEXT NOT NULL,
  event_status TEXT NOT NULL DEFAULT 'OK'
    CHECK (event_status IN ('OK','INVOKED','SKIPPED','FAILED','WAITING','RETRIED')),
  actor TEXT,
  source_component TEXT,
  payment_attempt_id UUID,
  payment_session_id UUID,
  checkout_request_id TEXT,
  merchant_request_id TEXT,
  phone TEXT,
  wallet_id UUID,
  ride_id UUID,
  order_id UUID,
  latency_ms INTEGER,
  evidence JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pje_correlation ON public.payment_journey_events(correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pje_checkout ON public.payment_journey_events(checkout_request_id);
CREATE INDEX IF NOT EXISTS idx_pje_attempt ON public.payment_journey_events(payment_attempt_id);
CREATE INDEX IF NOT EXISTS idx_pje_event_key ON public.payment_journey_events(event_key, occurred_at DESC);
GRANT SELECT ON public.payment_journey_events TO authenticated;
GRANT ALL ON public.payment_journey_events TO service_role;
ALTER TABLE public.payment_journey_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment_journey_events" ON public.payment_journey_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages payment_journey_events" ON public.payment_journey_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- append-only: block updates and deletes for everyone except service_role (already covered by RLS)

-- 7. Payment Journey Stages (per-attempt matrix) ---------------------------
CREATE TABLE IF NOT EXISTS public.payment_journey_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  payment_attempt_id UUID,
  stage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INVOKED'
    CHECK (status IN ('INVOKED','OK','SKIPPED','FAILED','WAITING','TIMED_OUT')),
  latency_ms INTEGER,
  evidence JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(correlation_id, stage_key)
);
CREATE INDEX IF NOT EXISTS idx_pjs_correlation ON public.payment_journey_stages(correlation_id);
CREATE INDEX IF NOT EXISTS idx_pjs_attempt ON public.payment_journey_stages(payment_attempt_id);
GRANT SELECT ON public.payment_journey_stages TO authenticated;
GRANT ALL ON public.payment_journey_stages TO service_role;
ALTER TABLE public.payment_journey_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment_journey_stages" ON public.payment_journey_stages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages payment_journey_stages" ON public.payment_journey_stages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. Payment State Transitions (centralized state machine) -----------------
CREATE TABLE IF NOT EXISTS public.payment_state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  payment_attempt_id UUID,
  from_state TEXT,
  to_state TEXT NOT NULL
    CHECK (to_state IN (
      'INITIATED','SESSION_CREATED','ATTEMPT_CREATED','STK_REQUESTED',
      'TOKEN_GRANTED','DARAJA_ACCEPTED','CUSTOMER_PROMPTED','CALLBACK_RECEIVED',
      'VALIDATED','PROCESSING','WALLET_UPDATED','LEDGER_POSTED','SETTLED',
      'COMPLETED','FAILED','TIMED_OUT','CANCELLED'
    )),
  actor TEXT,
  source_function TEXT,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pst_correlation ON public.payment_state_transitions(correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pst_attempt ON public.payment_state_transitions(payment_attempt_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pst_to_state ON public.payment_state_transitions(to_state, occurred_at DESC);
GRANT SELECT ON public.payment_state_transitions TO authenticated;
GRANT ALL ON public.payment_state_transitions TO service_role;
ALTER TABLE public.payment_state_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment_state_transitions" ON public.payment_state_transitions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages payment_state_transitions" ON public.payment_state_transitions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. Client Journey Events (frontend-emitted) ------------------------------
CREATE TABLE IF NOT EXISTS public.client_journey_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  user_id UUID,
  session_id TEXT,
  event_key TEXT NOT NULL,
  route TEXT,
  component TEXT,
  target_function TEXT,
  http_status INTEGER,
  duration_ms INTEGER,
  success BOOLEAN,
  error_message TEXT,
  evidence JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cje_correlation ON public.client_journey_events(correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_cje_user ON public.client_journey_events(user_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.client_journey_events TO authenticated;
GRANT ALL ON public.client_journey_events TO service_role;
ALTER TABLE public.client_journey_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own client_journey_events" ON public.client_journey_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "Users read own client_journey_events" ON public.client_journey_events
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "Service role manages client_journey_events" ON public.client_journey_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. Root Cause Classifications -------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_rca_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL,
  payment_attempt_id UUID,
  category TEXT NOT NULL,
  last_successful_stage TEXT,
  first_failed_stage TEXT,
  supporting_evidence JSONB NOT NULL DEFAULT '{}',
  classified_by TEXT NOT NULL DEFAULT 'auto',
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(correlation_id, category)
);
CREATE INDEX IF NOT EXISTS idx_rca_category ON public.payment_rca_classifications(category, classified_at DESC);
GRANT SELECT ON public.payment_rca_classifications TO authenticated;
GRANT ALL ON public.payment_rca_classifications TO service_role;
ALTER TABLE public.payment_rca_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read payment_rca_classifications" ON public.payment_rca_classifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Service role manages payment_rca_classifications" ON public.payment_rca_classifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =========================================================================
-- Seed data: known workflows and payment-path edge functions
-- =========================================================================
INSERT INTO public.workflow_registry (workflow_name, description, expected_steps, sla_seconds, timeout_seconds, retry_policy, owner_team)
VALUES
  ('wallet_topup', 'Rider/driver wallet top-up via M-PESA STK Push',
    '["checkout_submitted","invoke_dispatched","function_entered","attempt_opened","oauth_received","daraja_request_sent","daraja_accepted","callback_received","callback_persisted","callback_classified","wallet_credited","ledger_posted","notification_dispatched"]'::jsonb,
    120, 180, '{"max_retries":3,"backoff":"exponential"}'::jsonb, 'payments'),
  ('ride_payment', 'End-of-ride M-PESA charge',
    '["ride_completed","invoke_dispatched","attempt_opened","daraja_request_sent","callback_received","wallet_credited","ledger_posted","settlement_posted"]'::jsonb,
    180, 240, '{"max_retries":3,"backoff":"exponential"}'::jsonb, 'payments'),
  ('corporate_payment', 'Corporate paybill top-up and allocation',
    '["proof_submitted","reconciled","attempt_opened","ledger_posted","notification_dispatched"]'::jsonb,
    600, 900, '{"max_retries":2}'::jsonb, 'corporate-finance'),
  ('settlement', 'Driver / corporate settlement batch',
    '["batch_opened","ledger_posted","payout_dispatched","payout_confirmed"]'::jsonb,
    3600, 7200, '{"max_retries":5}'::jsonb, 'treasury'),
  ('reconciliation', 'M-PESA reconciliation sweep',
    '["window_opened","fetched","matched","posted","closed"]'::jsonb,
    900, 1800, '{"max_retries":3}'::jsonb, 'treasury')
ON CONFLICT (workflow_name) DO NOTHING;

INSERT INTO public.edge_function_registry (function_name, owner_team, workflow_membership, health_status)
VALUES
  ('mpesa-stkpush', 'payments', ARRAY['wallet_topup','ride_payment'], 'unknown'),
  ('mpesa-callback', 'payments', ARRAY['wallet_topup','ride_payment'], 'unknown'),
  ('mpesa-status', 'payments', ARRAY['wallet_topup','ride_payment'], 'unknown'),
  ('mpesa-reverse', 'payments', ARRAY['wallet_topup','ride_payment'], 'unknown'),
  ('mpesa-reconcile-recent', 'treasury', ARRAY['reconciliation'], 'unknown'),
  ('mpesa-diagnostics', 'payments', ARRAY['wallet_topup'], 'unknown'),
  ('mpesa-export-worker', 'treasury', ARRAY['reconciliation'], 'unknown'),
  ('fraud-engine-v2', 'trust', ARRAY['wallet_topup','ride_payment'], 'unknown'),
  ('outbox-processor', 'platform', ARRAY['wallet_topup','ride_payment'], 'unknown')
ON CONFLICT (function_name) DO NOTHING;

-- Seed the known production callback endpoint (URL will be certified by the 15m cron)
INSERT INTO public.callback_endpoint_registry (provider, callback_url, environment, is_active)
VALUES (
  'mpesa',
  'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/mpesa-callback',
  'production',
  true
)
ON CONFLICT (provider, callback_url, environment) DO NOTHING;

-- =========================================================================
-- updated_at triggers
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_efr_updated_at ON public.edge_function_registry;
CREATE TRIGGER trg_efr_updated_at BEFORE UPDATE ON public.edge_function_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_wfr_updated_at ON public.workflow_registry;
CREATE TRIGGER trg_wfr_updated_at BEFORE UPDATE ON public.workflow_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cer_updated_at ON public.callback_endpoint_registry;
CREATE TRIGGER trg_cer_updated_at BEFORE UPDATE ON public.callback_endpoint_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
