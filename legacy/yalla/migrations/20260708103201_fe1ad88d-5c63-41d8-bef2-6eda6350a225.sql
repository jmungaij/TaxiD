
CREATE TABLE IF NOT EXISTS public.corporate_document_notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT true,
  expiry_window_days integer NOT NULL DEFAULT 30 CHECK (expiry_window_days BETWEEN 1 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_document_notification_prefs TO authenticated;
GRANT ALL ON public.corporate_document_notification_prefs TO service_role;

ALTER TABLE public.corporate_document_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own prefs read"
  ON public.corporate_document_notification_prefs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "own prefs write"
  ON public.corporate_document_notification_prefs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own prefs update"
  ON public.corporate_document_notification_prefs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own prefs delete"
  ON public.corporate_document_notification_prefs FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_cdnp_updated_at ON public.corporate_document_notification_prefs;
CREATE TRIGGER trg_cdnp_updated_at BEFORE UPDATE ON public.corporate_document_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Realtime for notifications
ALTER TABLE public.corporate_document_notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.corporate_document_notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
