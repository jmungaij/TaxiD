-- 1. Fine-grained governance access grants -----------------------------------
CREATE TABLE public.governance_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface text NOT NULL CHECK (surface IN ('alert_history','concierge_audit','report_schedules','incident_detail','webhook_admin')),
  corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  corporate_role text CHECK (corporate_role IN ('corporate_admin','corporate_manager','corporate_employee')),
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  can_read boolean NOT NULL DEFAULT true,
  can_export boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gag_surface ON public.governance_access_grants(surface);
CREATE INDEX idx_gag_corporate ON public.governance_access_grants(corporate_id, surface);
CREATE INDEX idx_gag_user ON public.governance_access_grants(user_id, surface);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.governance_access_grants TO authenticated;
GRANT ALL ON public.governance_access_grants TO service_role;
ALTER TABLE public.governance_access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gag_admin_manage" ON public.governance_access_grants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "gag_read_own" ON public.governance_access_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER governance_access_grants_touch
  BEFORE UPDATE ON public.governance_access_grants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.has_governance_access(
  _user_id uuid,
  _surface text,
  _capability text DEFAULT 'read'
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id,'admin')
    OR public.has_role(_user_id,'super_admin')
    OR EXISTS (
      SELECT 1
      FROM public.governance_access_grants g
      LEFT JOIN public.corporate_employees e
        ON e.user_id = _user_id
       AND e.status = 'active'
      WHERE g.surface = _surface
        AND (CASE _capability
               WHEN 'export' THEN g.can_export
               WHEN 'manage' THEN g.can_manage
               ELSE g.can_read
             END)
        AND (
          g.user_id = _user_id
          OR (
            g.user_id IS NULL
            AND e.id IS NOT NULL
            AND (g.corporate_id IS NULL OR g.corporate_id = e.corporate_id)
            AND (g.corporate_role IS NULL OR g.corporate_role = e.role::text)
            AND (g.department_id IS NULL OR g.department_id = e.department_id)
          )
        )
    );
$$;

DROP POLICY IF EXISTS "eah_admin_read" ON public.executive_alert_history;
CREATE POLICY "eah_governed_read" ON public.executive_alert_history
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'finance_admin')
    OR public.has_governance_access(auth.uid(),'alert_history','read')
  );

DROP POLICY IF EXISTS "rer_admin_read" ON public.report_export_runs;
CREATE POLICY "rer_governed_read" ON public.report_export_runs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'finance_admin')
    OR public.has_governance_access(auth.uid(),'report_schedules','read')
  );

-- 2. Export job history: retries + artifacts ---------------------------------
ALTER TABLE public.report_export_runs
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS artifact_path text,
  ADD COLUMN IF NOT EXISTS artifact_bytes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_report_export_runs_retry
  ON public.report_export_runs(next_retry_at)
  WHERE status = 'retry_scheduled';

CREATE POLICY "report_exports_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-exports'
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'))
  );

CREATE OR REPLACE FUNCTION public.report_export_run_fail(
  _run_id uuid,
  _error text,
  _error_code text DEFAULT 'unknown'
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.report_export_runs;
  new_status text;
BEGIN
  SELECT * INTO r FROM public.report_export_runs WHERE id = _run_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF r.attempt >= r.max_attempts THEN
    new_status := 'failed';
    UPDATE public.report_export_runs
       SET status = new_status, error = _error, last_error_code = _error_code,
           next_retry_at = NULL, completed_at = now()
     WHERE id = _run_id;
  ELSE
    new_status := 'retry_scheduled';
    UPDATE public.report_export_runs
       SET status = new_status, error = _error, last_error_code = _error_code,
           attempt = r.attempt + 1,
           next_retry_at = now() + (interval '5 minutes' * power(2, r.attempt)::int)
     WHERE id = _run_id;
  END IF;
  RETURN new_status;
END;
$$;

-- 3. Outbound governance webhooks --------------------------------------------
CREATE TABLE public.governance_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
  events text[] NOT NULL DEFAULT ARRAY['alert.raised','audit.recorded','report.delivered','report.failed'],
  active boolean NOT NULL DEFAULT true,
  tolerance_seconds integer NOT NULL DEFAULT 300 CHECK (tolerance_seconds BETWEEN 30 AND 3600),
  description text,
  last_status text,
  last_delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.governance_webhook_endpoints TO authenticated;
GRANT ALL ON public.governance_webhook_endpoints TO service_role;
ALTER TABLE public.governance_webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gwe_admin_manage" ON public.governance_webhook_endpoints
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER governance_webhook_endpoints_touch
  BEFORE UPDATE ON public.governance_webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.governance_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES public.governance_webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature text,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  response_code integer,
  response_body text,
  error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_gwd_endpoint ON public.governance_webhook_deliveries(endpoint_id, created_at DESC);
CREATE UNIQUE INDEX idx_gwd_event_unique ON public.governance_webhook_deliveries(endpoint_id, event_id);

GRANT SELECT ON public.governance_webhook_deliveries TO authenticated;
GRANT ALL ON public.governance_webhook_deliveries TO service_role;
ALTER TABLE public.governance_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gwd_admin_read" ON public.governance_webhook_deliveries
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.governance_webhook_replay_guard (
  nonce text PRIMARY KEY,
  endpoint_id uuid REFERENCES public.governance_webhook_endpoints(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.governance_webhook_replay_guard TO authenticated;
GRANT ALL ON public.governance_webhook_replay_guard TO service_role;
ALTER TABLE public.governance_webhook_replay_guard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gwrg_super_admin_read" ON public.governance_webhook_replay_guard
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.cleanup_governance_replay_guard()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.governance_webhook_replay_guard WHERE seen_at < now() - interval '24 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;