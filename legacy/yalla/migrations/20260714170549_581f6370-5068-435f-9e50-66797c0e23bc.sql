
-- Monitor settings (single-row config)
CREATE TABLE IF NOT EXISTS public.alert_monitor_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_minutes INTEGER NOT NULL DEFAULT 15 CHECK (cadence_minutes BETWEEN 1 AND 1440),
  spike_absolute_threshold INTEGER NOT NULL DEFAULT 10 CHECK (spike_absolute_threshold >= 1),
  spike_multiplier NUMERIC NOT NULL DEFAULT 3 CHECK (spike_multiplier >= 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.alert_monitor_settings TO authenticated;
GRANT ALL ON public.alert_monitor_settings TO service_role;

ALTER TABLE public.alert_monitor_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read monitor settings"
  ON public.alert_monitor_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upsert monitor settings"
  ON public.alert_monitor_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update monitor settings"
  ON public.alert_monitor_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default row
INSERT INTO public.alert_monitor_settings (cadence_minutes) VALUES (15)
ON CONFLICT DO NOTHING;

-- Dead-letter queue for failed dispatches
CREATE TABLE IF NOT EXISTS public.alert_dispatch_dlq (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID,
  rule_id TEXT,
  rule_name TEXT,
  severity TEXT,
  channel TEXT NOT NULL,
  payload JSONB NOT NULL,
  last_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_dlq_pending
  ON public.alert_dispatch_dlq (next_retry_at)
  WHERE resolved_at IS NULL;

GRANT SELECT ON public.alert_dispatch_dlq TO authenticated;
GRANT ALL ON public.alert_dispatch_dlq TO service_role;

ALTER TABLE public.alert_dispatch_dlq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read dispatch DLQ"
  ON public.alert_dispatch_dlq FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Updated-at triggers
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS tg_alert_monitor_settings_updated ON public.alert_monitor_settings;
CREATE TRIGGER tg_alert_monitor_settings_updated
  BEFORE UPDATE ON public.alert_monitor_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS tg_alert_dispatch_dlq_updated ON public.alert_dispatch_dlq;
CREATE TRIGGER tg_alert_dispatch_dlq_updated
  BEFORE UPDATE ON public.alert_dispatch_dlq
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
