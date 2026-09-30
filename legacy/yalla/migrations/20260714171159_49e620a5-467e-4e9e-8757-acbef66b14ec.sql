
-- Idempotency for alerts_events
ALTER TABLE public.alerts_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_events_idempotency
  ON public.alerts_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Mute windows (temporarily suppress specific alert types)
CREATE TABLE IF NOT EXISTS public.alert_mute_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  rule_id TEXT,
  metric_key TEXT,
  severity TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_alert_mute_active
  ON public.alert_mute_windows (starts_at, ends_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_mute_windows TO authenticated;
GRANT ALL ON public.alert_mute_windows TO service_role;

ALTER TABLE public.alert_mute_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read mute windows"
  ON public.alert_mute_windows FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert mute windows"
  ON public.alert_mute_windows FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update mute windows"
  ON public.alert_mute_windows FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete mute windows"
  ON public.alert_mute_windows FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Escalation routes (severity-based fan-out)
CREATE TABLE IF NOT EXISTS public.alert_escalation_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  match_rule_id TEXT,
  match_metric_key TEXT,
  email_recipients TEXT[] NOT NULL DEFAULT '{}',
  slack_webhook_urls TEXT[] NOT NULL DEFAULT '{}',
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_severity
  ON public.alert_escalation_routes (severity, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_escalation_routes TO authenticated;
GRANT ALL ON public.alert_escalation_routes TO service_role;

ALTER TABLE public.alert_escalation_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read escalation routes"
  ON public.alert_escalation_routes FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage escalation routes"
  ON public.alert_escalation_routes FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Helper: is a specific rule currently muted?
CREATE OR REPLACE FUNCTION public.is_alert_muted(
  _rule_id TEXT, _metric_key TEXT, _severity TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.alert_mute_windows
    WHERE now() BETWEEN starts_at AND ends_at
      AND (rule_id IS NULL OR rule_id = _rule_id)
      AND (metric_key IS NULL OR metric_key = _metric_key)
      AND (severity IS NULL OR severity = _severity)
  )
$$;

-- Reuse existing touch_updated_at trigger fn
DROP TRIGGER IF EXISTS tg_alert_mute_updated ON public.alert_mute_windows;
CREATE TRIGGER tg_alert_mute_updated
  BEFORE UPDATE ON public.alert_mute_windows
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS tg_alert_escalation_updated ON public.alert_escalation_routes;
CREATE TRIGGER tg_alert_escalation_updated
  BEFORE UPDATE ON public.alert_escalation_routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
