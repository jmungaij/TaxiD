
-- =========================================================
-- 1. platform_settings (singleton)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name text NOT NULL DEFAULT 'Yalla Ride',
  support_email text,
  support_phone text,
  default_currency text NOT NULL DEFAULT 'KES',
  default_timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  default_locale text NOT NULL DEFAULT 'en',
  maintenance_mode boolean NOT NULL DEFAULT false,
  maintenance_message text,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_from_name text,
  email_from_address text,
  email_reply_to text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_settings TO authenticated;
GRANT SELECT ON public.platform_settings TO anon;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_settings_read_all"
  ON public.platform_settings FOR SELECT
  USING (true);

CREATE POLICY "platform_settings_admin_write"
  ON public.platform_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed singleton
INSERT INTO public.platform_settings (brand_name) VALUES ('Yalla Ride')
  ON CONFLICT DO NOTHING;

-- =========================================================
-- 2. Extend notification_settings with anti-spam thresholds
-- =========================================================
ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS spam_cutoff integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS honeypot_weight integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS min_elapsed_ms integer NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS rate_limit_per_10min integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour integer NOT NULL DEFAULT 10;

-- =========================================================
-- 3. contact_audit_log
-- =========================================================
CREATE TABLE IF NOT EXISTS public.contact_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid,
  action text NOT NULL,
  old_status text,
  new_status text,
  old_is_spam boolean,
  new_is_spam boolean,
  actor_id uuid,
  actor_email text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.contact_audit_log TO authenticated;
GRANT ALL ON public.contact_audit_log TO service_role;
ALTER TABLE public.contact_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_audit_admin_read"
  ON public.contact_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "contact_audit_admin_insert"
  ON public.contact_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS contact_audit_log_submission_idx
  ON public.contact_audit_log (submission_id, created_at DESC);

-- =========================================================
-- 4. Auto audit trigger on contact_submissions
-- =========================================================
CREATE OR REPLACE FUNCTION public.log_contact_submission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_em text;
BEGIN
  IF actor IS NOT NULL THEN
    SELECT email INTO actor_em FROM auth.users WHERE id = actor;
  END IF;

  IF (TG_OP = 'DELETE') THEN
    INSERT INTO public.contact_audit_log
      (submission_id, action, old_status, old_is_spam, actor_id, actor_email, detail)
    VALUES
      (OLD.id, 'delete', OLD.status, OLD.is_spam, actor, actor_em,
       jsonb_build_object('email', OLD.email, 'name', OLD.name));
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.contact_audit_log
        (submission_id, action, old_status, new_status, actor_id, actor_email)
      VALUES (NEW.id, 'status_change', OLD.status, NEW.status, actor, actor_em);
    END IF;
    IF NEW.is_spam IS DISTINCT FROM OLD.is_spam THEN
      INSERT INTO public.contact_audit_log
        (submission_id, action, old_is_spam, new_is_spam, actor_id, actor_email)
      VALUES (NEW.id, 'spam_flag', OLD.is_spam, NEW.is_spam, actor, actor_em);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_submissions_audit ON public.contact_submissions;
CREATE TRIGGER trg_contact_submissions_audit
AFTER UPDATE OR DELETE ON public.contact_submissions
FOR EACH ROW EXECUTE FUNCTION public.log_contact_submission_change();

-- updated_at trigger for platform_settings
DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
BEFORE UPDATE ON public.platform_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
