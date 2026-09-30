
CREATE TABLE IF NOT EXISTS public.twin_regression_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.digital_twin_runs(id) ON DELETE CASCADE,
  severity TEXT NOT NULL DEFAULT 'warning',    -- info|warning|critical
  kind TEXT NOT NULL,                          -- readiness_regression|idempotency_drift|domain_failure|scheduled_error
  message TEXT NOT NULL,
  readiness_score INTEGER,
  previous_score INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_twin_alerts_created ON public.twin_regression_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_twin_alerts_open ON public.twin_regression_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

GRANT SELECT, UPDATE ON public.twin_regression_alerts TO authenticated;
GRANT ALL ON public.twin_regression_alerts TO service_role;
ALTER TABLE public.twin_regression_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read twin alerts"
  ON public.twin_regression_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins ack twin alerts"
  ON public.twin_regression_alerts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role manages twin alerts"
  ON public.twin_regression_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Nightly deterministic micro seed with idempotency verification.
-- Runs at 03:15 UTC every night. Alerts are inserted by the edge function
-- when readiness drops or idempotency drifts.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('twin-nightly-micro') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'twin-nightly-micro'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'twin-nightly-micro',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/digital-twin-seed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ',
      'x-scheduled', 'nightly'
    ),
    body := jsonb_build_object(
      'scale', 'micro',
      'verify_idempotent', true,
      'scheduled', true,
      'regression_baseline_score', 80
    )
  );
  $$
);
