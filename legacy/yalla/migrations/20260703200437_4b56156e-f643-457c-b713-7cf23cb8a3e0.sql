
-- Thresholds table (singleton row per source)
CREATE TABLE public.rename_alert_thresholds (
  source TEXT PRIMARY KEY CHECK (source IN ('rename-audit','phase3-backfill','scheduled-verify')),
  critical_threshold INTEGER NOT NULL DEFAULT 0,
  warning_threshold INTEGER NOT NULL DEFAULT 0,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);
GRANT SELECT ON public.rename_alert_thresholds TO authenticated;
GRANT ALL ON public.rename_alert_thresholds TO service_role;
ALTER TABLE public.rename_alert_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read thresholds" ON public.rename_alert_thresholds
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "super_admin writes thresholds" ON public.rename_alert_thresholds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rename_alert_thresholds (source, critical_threshold, warning_threshold, cooldown_minutes)
VALUES
  ('rename-audit', 0, 0, 30),
  ('phase3-backfill', 0, 100, 30),
  ('scheduled-verify', 0, 100, 30)
ON CONFLICT (source) DO NOTHING;

-- Alert dedup / cooldown ledger
CREATE TABLE public.rename_alert_dispatch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  slack_sent BOOLEAN NOT NULL DEFAULT false,
  email_sent BOOLEAN NOT NULL DEFAULT false,
  cooldown_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rename_alert_dispatch_log_dedup_idx
  ON public.rename_alert_dispatch_log (dedup_key, created_at DESC);
GRANT SELECT ON public.rename_alert_dispatch_log TO authenticated;
GRANT ALL ON public.rename_alert_dispatch_log TO service_role;
ALTER TABLE public.rename_alert_dispatch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispatch log" ON public.rename_alert_dispatch_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
