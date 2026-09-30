
-- 1) Safeguards config (single-row)
CREATE TABLE IF NOT EXISTS public.payment_certification_safeguards (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  max_concurrent_runs INT NOT NULL DEFAULT 2,
  max_runs_per_hour INT NOT NULL DEFAULT 12,
  cooldown_minutes_after_failure INT NOT NULL DEFAULT 15,
  stale_run_minutes INT NOT NULL DEFAULT 30,
  exclude_synthetic_from_facts BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
GRANT SELECT ON public.payment_certification_safeguards TO authenticated;
GRANT ALL ON public.payment_certification_safeguards TO service_role;
ALTER TABLE public.payment_certification_safeguards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cert safeguards admin read" ON public.payment_certification_safeguards
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "cert safeguards service manage" ON public.payment_certification_safeguards
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
INSERT INTO public.payment_certification_safeguards (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- 2) Nightly continuous qualification run history
CREATE TABLE IF NOT EXISTS public.payment_continuous_qualification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_by TEXT NOT NULL DEFAULT 'cron',
  chain_key TEXT NOT NULL DEFAULT 'e2e_14_step',
  status TEXT NOT NULL DEFAULT 'RUNNING',        -- RUNNING | PASSED | FAILED | ERROR | SKIPPED
  cert_run_id UUID,
  total_steps INT,
  passed_steps INT,
  failed_steps INT,
  correlation_ids TEXT[],
  forensic_bundle JSONB,
  error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_continuous_qualification_runs TO authenticated;
GRANT ALL ON public.payment_continuous_qualification_runs TO service_role;
ALTER TABLE public.payment_continuous_qualification_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cq runs admin read" ON public.payment_continuous_qualification_runs
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "cq runs service manage" ON public.payment_continuous_qualification_runs
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX IF NOT EXISTS idx_cq_runs_triggered_at ON public.payment_continuous_qualification_runs (triggered_at DESC);

-- 3) Register outbox → notification-worker consumer for payment.notify.*
INSERT INTO public.event_consumers (
  consumer_name, event_pattern, webhook_url, max_attempts, backoff_base_seconds, enabled, channel, status
)
SELECT 'payment-notification-worker', 'payment.notify.*', 'notification-worker', 8, 15, TRUE, 'webhook', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_consumers WHERE consumer_name = 'payment-notification-worker'
);
