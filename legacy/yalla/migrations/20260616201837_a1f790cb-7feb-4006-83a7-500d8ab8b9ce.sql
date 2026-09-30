-- Notification recipient settings (singleton)
CREATE TABLE public.notification_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_inbox TEXT,
  demo_inbox TEXT,
  support_inbox TEXT,
  send_user_confirmation BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage notification settings"
  ON public.notification_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.notification_settings (contact_inbox, demo_inbox, support_inbox)
VALUES (NULL, NULL, NULL);

-- Rate limiting per IP/window
CREATE TABLE public.contact_rate_limits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 1,
  last_submission_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_rate_limits TO authenticated;
GRANT ALL ON public.contact_rate_limits TO service_role;

ALTER TABLE public.contact_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read rate limits"
  ON public.contact_rate_limits FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_contact_rate_limits_ip ON public.contact_rate_limits(ip_address, window_start DESC);

-- Spam fields on contact_submissions
ALTER TABLE public.contact_submissions
  ADD COLUMN IF NOT EXISTS spam_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_spam BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handled_by UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_contact_submissions_is_spam ON public.contact_submissions(is_spam, created_at DESC);