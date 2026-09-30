CREATE TABLE public.charter_notification_prefs (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_email TEXT,
  quote_emails BOOLEAN NOT NULL DEFAULT true,
  booking_emails BOOLEAN NOT NULL DEFAULT true,
  status_emails BOOLEAN NOT NULL DEFAULT true,
  downloadable_summaries BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.charter_notification_prefs TO authenticated;
GRANT ALL ON public.charter_notification_prefs TO service_role;

ALTER TABLE public.charter_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own charter notification prefs"
ON public.charter_notification_prefs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_charter_notification_prefs_updated_at
BEFORE UPDATE ON public.charter_notification_prefs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();