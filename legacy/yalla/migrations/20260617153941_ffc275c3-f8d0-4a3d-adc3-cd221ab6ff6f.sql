
ALTER TABLE public.executive_alert_rules
  ADD COLUMN IF NOT EXISTS target_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_channels jsonb NOT NULL DEFAULT '["toast"]'::jsonb,
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_slack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS slack_webhook_url text,
  ADD COLUMN IF NOT EXISTS email_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.alerts_events
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channels_dispatched jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_alerts_events_stream_sev
  ON public.alerts_events (stream, severity, created_at DESC);

ALTER TABLE public.document_review_sla
  ADD COLUMN IF NOT EXISTS grace_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rule_key text;

DROP FUNCTION IF EXISTS public.escalate_overdue_document_slas();

CREATE FUNCTION public.escalate_overdue_document_slas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT *
    FROM public.document_review_sla
    WHERE status IN ('pending','overdue')
      AND completed_at IS NULL
      AND (due_at + make_interval(mins => COALESCE(grace_minutes,0))) < now()
  LOOP
    UPDATE public.document_review_sla
       SET status = CASE WHEN escalation_level >= 2 THEN 'escalated' ELSE 'overdue' END,
           escalation_level = escalation_level + 1,
           last_escalated_at = now()
     WHERE id = r.id;

    INSERT INTO public.document_review_escalations
      (sla_id, action_id, escalation_level, reason, triggered_by, payload)
    VALUES
      (r.id, r.action_id, r.escalation_level + 1,
       'Overdue after grace period ('||COALESCE(r.grace_minutes,0)||'m)',
       'system',
       jsonb_build_object('due_at', r.due_at, 'grace_minutes', r.grace_minutes, 'rule_key', r.rule_key));

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.escalate_overdue_document_slas() FROM public;
GRANT EXECUTE ON FUNCTION public.escalate_overdue_document_slas() TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.audit_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly','monthly')),
  range_days integer NOT NULL DEFAULT 7,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  include_audit boolean NOT NULL DEFAULT true,
  include_login boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_report_schedules TO authenticated;
GRANT ALL ON public.audit_report_schedules TO service_role;
ALTER TABLE public.audit_report_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage audit schedules" ON public.audit_report_schedules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
DROP TRIGGER IF EXISTS trg_audit_schedules_updated ON public.audit_report_schedules;
CREATE TRIGGER trg_audit_schedules_updated BEFORE UPDATE ON public.audit_report_schedules
  FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.audit_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.audit_report_schedules(id) ON DELETE CASCADE,
  range_from timestamptz NOT NULL,
  range_to   timestamptz NOT NULL,
  audit_count integer NOT NULL DEFAULT 0,
  login_count integer NOT NULL DEFAULT 0,
  first_hash text,
  last_hash text,
  hash_summary text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','failed')),
  storage_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.audit_report_runs TO authenticated;
GRANT ALL ON public.audit_report_runs TO service_role;
ALTER TABLE public.audit_report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins view audit runs" ON public.audit_report_runs
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins write audit runs" ON public.audit_report_runs
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "admins update audit runs" ON public.audit_report_runs
  FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_audit_runs_schedule ON public.audit_report_runs (schedule_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.advance_audit_schedule(p_schedule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cadence text;
BEGIN
  SELECT cadence INTO v_cadence FROM public.audit_report_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.audit_report_schedules
    SET last_run_at = now(),
        next_run_at = CASE v_cadence
          WHEN 'daily'   THEN now() + interval '1 day'
          WHEN 'weekly'  THEN now() + interval '7 days'
          WHEN 'monthly' THEN now() + interval '30 days'
        END
    WHERE id = p_schedule_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.advance_audit_schedule(uuid) TO authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'escalate-overdue-document-slas') THEN
    PERFORM cron.schedule(
      'escalate-overdue-document-slas',
      '*/5 * * * *',
      $cron$ SELECT public.escalate_overdue_document_slas(); $cron$
    );
  END IF;
END $$;
