-- 1. Per-user alert preferences (toast vs email + quiet hours)
CREATE TABLE public.user_alert_prefs (
  user_id uuid PRIMARY KEY,
  sla_toast boolean NOT NULL DEFAULT true,
  sla_email boolean NOT NULL DEFAULT true,
  integration_toast boolean NOT NULL DEFAULT true,
  integration_email boolean NOT NULL DEFAULT true,
  circuit_toast boolean NOT NULL DEFAULT true,
  circuit_email boolean NOT NULL DEFAULT false,
  min_severity text NOT NULL DEFAULT 'warning',
  muted_integrations jsonb NOT NULL DEFAULT '[]'::jsonb,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_start_minute integer NOT NULL DEFAULT 1260,
  quiet_end_minute integer NOT NULL DEFAULT 420,
  quiet_allow_critical boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_alert_prefs_min_severity_check CHECK (min_severity IN ('warning','critical')),
  CONSTRAINT user_alert_prefs_quiet_start_check CHECK (quiet_start_minute BETWEEN 0 AND 1439),
  CONSTRAINT user_alert_prefs_quiet_end_check CHECK (quiet_end_minute BETWEEN 0 AND 1439)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_alert_prefs TO authenticated;
GRANT ALL ON public.user_alert_prefs TO service_role;
ALTER TABLE public.user_alert_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "uap_own_read" ON public.user_alert_prefs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "uap_own_write" ON public.user_alert_prefs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER user_alert_prefs_touch BEFORE UPDATE ON public.user_alert_prefs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Executive alert history timeline
CREATE TABLE public.executive_alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  metric_key text,
  value numeric,
  integration_key text,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  incident_ref text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_exec_alert_history_created ON public.executive_alert_history (created_at DESC);
CREATE INDEX idx_exec_alert_history_sev ON public.executive_alert_history (severity, created_at DESC);
CREATE INDEX idx_exec_alert_history_integration ON public.executive_alert_history (integration_key, created_at DESC);
GRANT SELECT, INSERT ON public.executive_alert_history TO authenticated;
GRANT ALL ON public.executive_alert_history TO service_role;
ALTER TABLE public.executive_alert_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eah_admin_read" ON public.executive_alert_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'finance_admin'::app_role));
CREATE POLICY "eah_insert_own" ON public.executive_alert_history FOR INSERT TO authenticated
  WITH CHECK (created_by IS NULL OR created_by = auth.uid());

-- 3. Immutable concierge approval audit trail
CREATE TABLE public.concierge_approval_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid,
  reference text NOT NULL,
  event text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid,
  actor_email text,
  corporate_id uuid,
  amount_kes numeric,
  clauses jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_caa_reference ON public.concierge_approval_audit (reference, created_at);
CREATE INDEX idx_caa_created ON public.concierge_approval_audit (created_at DESC);
GRANT SELECT, INSERT ON public.concierge_approval_audit TO authenticated;
GRANT ALL ON public.concierge_approval_audit TO service_role;
ALTER TABLE public.concierge_approval_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caa_read" ON public.concierge_approval_audit FOR SELECT TO authenticated
  USING (actor_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'compliance_admin'::app_role));
CREATE POLICY "caa_insert_own" ON public.concierge_approval_audit FOR INSERT TO authenticated
  WITH CHECK (actor_id IS NULL OR actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.deny_concierge_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'concierge_approval_audit is append-only';
END;
$$;
CREATE TRIGGER caa_append_only BEFORE UPDATE OR DELETE ON public.concierge_approval_audit
  FOR EACH ROW EXECUTE FUNCTION public.deny_concierge_audit_mutation();

-- 4. Scheduled report exports
CREATE TABLE public.report_export_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  report_key text NOT NULL,
  cadence text NOT NULL,
  format text NOT NULL DEFAULT 'csv',
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  corporate_id uuid,
  range_days integer NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT res_cadence_check CHECK (cadence IN ('daily','weekly','monthly')),
  CONSTRAINT res_format_check CHECK (format IN ('csv','pdf','both')),
  CONSTRAINT res_range_check CHECK (range_days BETWEEN 1 AND 365)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_export_schedules TO authenticated;
GRANT ALL ON public.report_export_schedules TO service_role;
ALTER TABLE public.report_export_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "res_admin_manage" ON public.report_export_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE TRIGGER report_export_schedules_touch BEFORE UPDATE ON public.report_export_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.report_export_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.report_export_schedules(id) ON DELETE CASCADE,
  report_key text NOT NULL,
  format text NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  range_from timestamptz,
  range_to timestamptz,
  row_count integer NOT NULL DEFAULT 0,
  csv_bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_report_export_runs_created ON public.report_export_runs (created_at DESC);
GRANT SELECT ON public.report_export_runs TO authenticated;
GRANT ALL ON public.report_export_runs TO service_role;
ALTER TABLE public.report_export_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rer_admin_read" ON public.report_export_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'finance_admin'::app_role));

CREATE OR REPLACE FUNCTION public.advance_report_export_schedule(p_schedule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence text;
BEGIN
  SELECT cadence INTO v_cadence FROM public.report_export_schedules WHERE id = p_schedule_id;
  IF v_cadence IS NULL THEN RETURN; END IF;
  UPDATE public.report_export_schedules
     SET last_run_at = now(),
         next_run_at = now() + CASE v_cadence
           WHEN 'daily' THEN interval '1 day'
           WHEN 'weekly' THEN interval '7 days'
           ELSE interval '1 month' END
   WHERE id = p_schedule_id;
END;
$$;