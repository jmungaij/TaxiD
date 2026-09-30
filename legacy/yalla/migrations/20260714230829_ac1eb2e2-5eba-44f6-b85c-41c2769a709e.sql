
CREATE TABLE IF NOT EXISTS public.digital_twin_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scale TEXT NOT NULL,                       -- tiny|small|medium|large|enterprise
  mode TEXT NOT NULL DEFAULT 'seed',         -- seed|reset|validate
  status TEXT NOT NULL DEFAULT 'running',    -- running|succeeded|failed
  triggered_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  domains_completed TEXT[] NOT NULL DEFAULT '{}',
  rows_by_domain JSONB NOT NULL DEFAULT '{}'::jsonb,
  rows_by_table JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { orphans:0, ledger_balanced:true, wallets_balanced:true, ... }
  readiness_score INTEGER,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_digital_twin_runs_started ON public.digital_twin_runs(started_at DESC);

GRANT SELECT ON public.digital_twin_runs TO authenticated;
GRANT ALL ON public.digital_twin_runs TO service_role;
ALTER TABLE public.digital_twin_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read digital twin runs"
  ON public.digital_twin_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role manages digital twin runs"
  ON public.digital_twin_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
