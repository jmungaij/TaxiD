-- Yalla Communications Engine: event taxonomy on the send log + recipient category preferences

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS event_key TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT,
  ADD COLUMN IF NOT EXISTS audience TEXT,
  ADD COLUMN IF NOT EXISTS environment TEXT,
  ADD COLUMN IF NOT EXISTS intended_recipient TEXT,
  ADD COLUMN IF NOT EXISTS redirected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS email_send_log_event_key_idx ON public.email_send_log (event_key, created_at DESC);
CREATE INDEX IF NOT EXISTS email_send_log_category_idx ON public.email_send_log (category, created_at DESC);
CREATE INDEX IF NOT EXISTS email_send_log_idempotency_idx ON public.email_send_log (idempotency_key);

CREATE TABLE IF NOT EXISTS public.email_category_prefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  category TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (email, category),
  CONSTRAINT email_category_prefs_optional_only
    CHECK (category IN ('operational','marketing','reports','internal'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_category_prefs TO authenticated;
GRANT ALL ON public.email_category_prefs TO service_role;

ALTER TABLE public.email_category_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own email category preferences"
  ON public.email_category_prefs FOR ALL TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')))
  WITH CHECK (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

CREATE POLICY "Admins manage all email category preferences"
  ON public.email_category_prefs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER email_category_prefs_touch
  BEFORE UPDATE ON public.email_category_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();