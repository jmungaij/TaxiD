
CREATE TABLE IF NOT EXISTS public.payment_step_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  invocation_id uuid,
  payment_attempt_id uuid,
  function_name text NOT NULL,
  step_number int NOT NULL,
  step_key text NOT NULL,
  step_name text,
  status text NOT NULL CHECK (status IN ('STARTED','OK','SKIPPED','FAILED','TIMED_OUT','RETRIED')),
  latency_ms int,
  error_code text,
  error_message text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pst_correlation ON public.payment_step_traces(correlation_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pst_function ON public.payment_step_traces(function_name, occurred_at DESC);
GRANT SELECT ON public.payment_step_traces TO authenticated;
GRANT ALL ON public.payment_step_traces TO service_role;
ALTER TABLE public.payment_step_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read step traces" ON public.payment_step_traces
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "service role manages step traces" ON public.payment_step_traces
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.journey_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  payment_attempt_id uuid,
  score numeric(5,2) NOT NULL,
  grade text NOT NULL,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jhs_correlation ON public.journey_health_snapshots(correlation_id, computed_at DESC);
GRANT SELECT ON public.journey_health_snapshots TO authenticated;
GRANT ALL ON public.journey_health_snapshots TO service_role;
ALTER TABLE public.journey_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read health snapshots" ON public.journey_health_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service role manages health snapshots" ON public.journey_health_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.fraud_engine_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL,
  payment_attempt_id uuid,
  user_id uuid,
  decision text NOT NULL,
  score int NOT NULL,
  rules_fired jsonb NOT NULL DEFAULT '[]'::jsonb,
  latency_ms int,
  error_message text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fet_correlation ON public.fraud_engine_traces(correlation_id, occurred_at DESC);
GRANT SELECT ON public.fraud_engine_traces TO authenticated;
GRANT ALL ON public.fraud_engine_traces TO service_role;
ALTER TABLE public.fraud_engine_traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read fraud traces" ON public.fraud_engine_traces
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service role manages fraud traces" ON public.fraud_engine_traces
  FOR ALL TO service_role USING (true) WITH CHECK (true);
