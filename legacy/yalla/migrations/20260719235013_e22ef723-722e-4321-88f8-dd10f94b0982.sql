
-- =============================================================
-- Phase D5.1 Priority 1 — Continuous Qualification lifecycle,
-- failure classification, evidence packs, financial integrity.
-- =============================================================

-- 1. Per-step lifecycle traces for every qualification cycle.
CREATE TABLE IF NOT EXISTS public.payment_qualification_step_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cq_run_id UUID NOT NULL REFERENCES public.payment_continuous_qualification_runs(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',           -- PENDING | RUNNING | PASSED | FAILED | SKIPPED
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  latency_ms INT,
  correlation_id TEXT,
  evidence_ref JSONB DEFAULT '{}'::jsonb,
  error_class TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pq_step_traces_run ON public.payment_qualification_step_traces (cq_run_id, step_index);
GRANT SELECT ON public.payment_qualification_step_traces TO authenticated;
GRANT ALL ON public.payment_qualification_step_traces TO service_role;
ALTER TABLE public.payment_qualification_step_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read step traces" ON public.payment_qualification_step_traces
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "service_role manages step traces" ON public.payment_qualification_step_traces
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Enumerated failure classifications (catalog).
CREATE TABLE IF NOT EXISTS public.payment_qualification_failure_classes (
  class_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'high',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_qualification_failure_classes TO authenticated;
GRANT ALL ON public.payment_qualification_failure_classes TO service_role;
ALTER TABLE public.payment_qualification_failure_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read failure classes" ON public.payment_qualification_failure_classes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service manages failure classes" ON public.payment_qualification_failure_classes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.payment_qualification_failure_classes(class_key,label,description,severity) VALUES
  ('oauth_failure','OAuth Failure','Daraja OAuth token could not be obtained','critical'),
  ('daraja_failure','Daraja Failure','Daraja STK push rejected or timed out','critical'),
  ('callback_never_received','Callback Never Received','STK accepted but no callback ever hit the endpoint','critical'),
  ('callback_not_persisted','Callback Received Not Persisted','Callback hit endpoint but did not persist in mpesa_callback_logs','critical'),
  ('wallet_failure','Wallet Failure','Wallet credit did not post for a paid transaction','critical'),
  ('ledger_failure','Ledger Failure','Journal or journal line was not created / not balanced','critical'),
  ('settlement_failure','Settlement Failure','Settlement batch never generated for the transaction','high'),
  ('notification_failure','Notification Failure','Downstream notification was not dispatched','medium'),
  ('evidence_failure','Evidence Failure','Evidence export / verification could not be produced','high'),
  ('schema_drift','Schema Drift','Detected required column/table missing','high'),
  ('financial_integrity_failure','Financial Integrity Failure','Wallet / ledger / settlement deltas do not reconcile','critical'),
  ('unknown','Unknown','Failure could not be classified','high')
ON CONFLICT (class_key) DO NOTHING;

-- 3. Immutable qualification evidence packs (one per run).
CREATE TABLE IF NOT EXISTS public.payment_qualification_evidence_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cq_run_id UUID NOT NULL UNIQUE REFERENCES public.payment_continuous_qualification_runs(id) ON DELETE CASCADE,
  build_version TEXT,
  git_revision TEXT,
  migration_version TEXT,
  correlation_id TEXT,
  checkout_request_id TEXT,
  merchant_request_id TEXT,
  final_verdict TEXT NOT NULL,                       -- PASSED | FAILED | ERROR
  failure_class TEXT REFERENCES public.payment_qualification_failure_classes(class_key),
  financial_integrity_score NUMERIC(5,2),
  reliability_score NUMERIC(5,2),
  readiness_score NUMERIC(5,2),
  slo_evaluation JSONB DEFAULT '{}'::jsonb,
  canonical_payload JSONB NOT NULL,
  canonical_sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL DEFAULT 'default',
  signature_algorithm TEXT NOT NULL DEFAULT 'HMAC-SHA256',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pq_evidence_packs_run ON public.payment_qualification_evidence_packs(cq_run_id);
CREATE INDEX IF NOT EXISTS idx_pq_evidence_packs_verdict ON public.payment_qualification_evidence_packs(final_verdict, created_at DESC);
GRANT SELECT ON public.payment_qualification_evidence_packs TO authenticated;
GRANT ALL ON public.payment_qualification_evidence_packs TO service_role;
ALTER TABLE public.payment_qualification_evidence_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read evidence packs" ON public.payment_qualification_evidence_packs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "service manages evidence packs" ON public.payment_qualification_evidence_packs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Immutability trigger — once written, evidence packs cannot be mutated.
CREATE OR REPLACE FUNCTION public.pq_evidence_pack_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_qualification_evidence_packs is immutable (cq_run_id=%)', OLD.cq_run_id
    USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_pq_evidence_pack_immutable ON public.payment_qualification_evidence_packs;
CREATE TRIGGER trg_pq_evidence_pack_immutable
  BEFORE UPDATE OR DELETE ON public.payment_qualification_evidence_packs
  FOR EACH ROW EXECUTE FUNCTION public.pq_evidence_pack_immutable();

-- 4. Add classification + financial-integrity columns to the parent run table.
ALTER TABLE public.payment_continuous_qualification_runs
  ADD COLUMN IF NOT EXISTS failure_class TEXT REFERENCES public.payment_qualification_failure_classes(class_key),
  ADD COLUMN IF NOT EXISTS financial_integrity_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS reliability_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS readiness_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS evidence_pack_id UUID REFERENCES public.payment_qualification_evidence_packs(id),
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;

-- 5. Failure-classification RPC (best-effort inspection of step traces).
CREATE OR REPLACE FUNCTION public.classify_qualification_failure(_run_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  first_failed RECORD;
  klass TEXT;
BEGIN
  SELECT step_name, error_message
  INTO first_failed
  FROM public.payment_qualification_step_traces
  WHERE cq_run_id = _run_id AND status = 'FAILED'
  ORDER BY step_index ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  klass := CASE
    WHEN first_failed.step_name ILIKE '%oauth%'            THEN 'oauth_failure'
    WHEN first_failed.step_name ILIKE '%stk%'              THEN 'daraja_failure'
    WHEN first_failed.step_name ILIKE '%callback_received%' THEN 'callback_never_received'
    WHEN first_failed.step_name ILIKE '%callback_persist%'  THEN 'callback_not_persisted'
    WHEN first_failed.step_name ILIKE '%wallet%'            THEN 'wallet_failure'
    WHEN first_failed.step_name ILIKE '%ledger%'            THEN 'ledger_failure'
    WHEN first_failed.step_name ILIKE '%settlement%'        THEN 'settlement_failure'
    WHEN first_failed.step_name ILIKE '%notify%'            THEN 'notification_failure'
    WHEN first_failed.step_name ILIKE '%evidence%'          THEN 'evidence_failure'
    WHEN first_failed.step_name ILIKE '%integrity%'         THEN 'financial_integrity_failure'
    WHEN first_failed.error_message ILIKE '%does not exist%' OR first_failed.error_message ILIKE '%column%'
                                                            THEN 'schema_drift'
    ELSE 'unknown'
  END;

  UPDATE public.payment_continuous_qualification_runs
  SET failure_class = klass
  WHERE id = _run_id;

  RETURN klass;
END;
$$;
GRANT EXECUTE ON FUNCTION public.classify_qualification_failure(UUID) TO service_role, authenticated;

-- 6. Convenience view: streak of consecutive successful runs (D5.1 exit gate).
CREATE OR REPLACE VIEW public.payment_qualification_streak AS
WITH ordered AS (
  SELECT id, status, triggered_at,
         SUM(CASE WHEN status <> 'PASSED' THEN 1 ELSE 0 END)
           OVER (ORDER BY triggered_at DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS non_pass_prefix
  FROM public.payment_continuous_qualification_runs
  ORDER BY triggered_at DESC
)
SELECT COUNT(*) FILTER (WHERE non_pass_prefix = 0) AS consecutive_passes,
       MAX(triggered_at) FILTER (WHERE non_pass_prefix = 0) AS last_pass_at
FROM ordered;

GRANT SELECT ON public.payment_qualification_streak TO authenticated, service_role;
