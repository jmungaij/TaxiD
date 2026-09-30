
CREATE TABLE public.assurance_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha text,
  branch text,
  status text NOT NULL CHECK (status IN ('passed','failed','partial')),
  production_score numeric,
  indices jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpi_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  failing_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.assurance_runs TO authenticated;
GRANT ALL ON public.assurance_runs TO service_role;
ALTER TABLE public.assurance_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read assurance_runs" ON public.assurance_runs FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service writes assurance_runs" ON public.assurance_runs FOR ALL
  TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_assurance_runs_started ON public.assurance_runs (started_at DESC);

CREATE TABLE public.assurance_flakiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario text NOT NULL UNIQUE,
  domain text,
  flips integer NOT NULL DEFAULT 0,
  last_10 jsonb NOT NULL DEFAULT '[]'::jsonb,
  quarantined_at timestamptz,
  stabilized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.assurance_flakiness TO authenticated;
GRANT ALL ON public.assurance_flakiness TO service_role;
ALTER TABLE public.assurance_flakiness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read flakiness" ON public.assurance_flakiness FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service writes flakiness" ON public.assurance_flakiness FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.assurance_deployment_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.assurance_runs(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('APPROVED','BLOCKED','WARNING')),
  reason text,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.assurance_deployment_decisions TO authenticated;
GRANT ALL ON public.assurance_deployment_decisions TO service_role;
ALTER TABLE public.assurance_deployment_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read decisions" ON public.assurance_deployment_decisions FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service writes decisions" ON public.assurance_deployment_decisions FOR ALL
  TO service_role USING (true) WITH CHECK (true);
