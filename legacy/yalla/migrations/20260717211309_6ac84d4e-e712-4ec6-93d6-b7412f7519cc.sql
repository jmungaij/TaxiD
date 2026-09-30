
-- Phase 5.1: Autonomous Orchestrator Control + Evidence Exports

-- 1. Rollout stage plan (configurable)
CREATE TABLE IF NOT EXISTS public.payment_orchestrator_rollout_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_order INT NOT NULL UNIQUE,
  target_percent INT NOT NULL CHECK (target_percent BETWEEN 0 AND 100),
  min_dwell_minutes INT NOT NULL DEFAULT 30,
  min_reliability_score NUMERIC NOT NULL DEFAULT 95,
  min_shadow_equivalence NUMERIC NOT NULL DEFAULT 99,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_orchestrator_rollout_stages TO authenticated;
GRANT ALL ON public.payment_orchestrator_rollout_stages TO service_role;
ALTER TABLE public.payment_orchestrator_rollout_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read rollout stages"
  ON public.payment_orchestrator_rollout_stages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.payment_orchestrator_rollout_stages (stage_order, target_percent)
VALUES (0,0),(1,5),(2,10),(3,25),(4,50),(5,75),(6,100)
ON CONFLICT (stage_order) DO NOTHING;

-- 2. Autonomous decisions ledger (immutable audit)
CREATE TABLE IF NOT EXISTS public.payment_orchestrator_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL CHECK (action IN ('promote','hold','rollback','no_change')),
  from_percent INT NOT NULL,
  to_percent INT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  gate_ready BOOLEAN,
  reliability_score NUMERIC,
  callback_health TEXT,
  shadow_equivalence NUMERIC,
  active_critical_incidents INT NOT NULL DEFAULT 0,
  correlation_id TEXT
);
GRANT SELECT ON public.payment_orchestrator_decisions TO authenticated;
GRANT ALL ON public.payment_orchestrator_decisions TO service_role;
ALTER TABLE public.payment_orchestrator_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read orch decisions"
  ON public.payment_orchestrator_decisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_orch_decisions_decided_at
  ON public.payment_orchestrator_decisions (decided_at DESC);

-- 3. Evidence export registry
CREATE TABLE IF NOT EXISTS public.payment_evidence_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  identifier_kind TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  correlation_id TEXT,
  bundle_sha256 TEXT,
  row_count INT,
  bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'complete'
);
GRANT SELECT, INSERT ON public.payment_evidence_exports TO authenticated;
GRANT ALL ON public.payment_evidence_exports TO service_role;
ALTER TABLE public.payment_evidence_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read evidence exports"
  ON public.payment_evidence_exports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins create evidence exports"
  ON public.payment_evidence_exports FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND requested_by = auth.uid());
