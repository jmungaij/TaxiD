-- Forensic email domain migration: yallabeena.info -> yalla.africa
-- ACTIVE CONFIGURATION ONLY. Historical / audit rows are preserved verbatim.
BEGIN;

CREATE TABLE IF NOT EXISTS public.email_domain_migration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migrated_at timestamptz NOT NULL DEFAULT now(),
  target_table text NOT NULL,
  target_column text NOT NULL,
  old_value text NOT NULL,
  new_value text NOT NULL,
  classification text NOT NULL,
  reason text NOT NULL DEFAULT 'Retire yallabeena.info; authoritative domain is yalla.africa'
);

GRANT SELECT ON public.email_domain_migration_log TO authenticated;
GRANT ALL ON public.email_domain_migration_log TO service_role;
ALTER TABLE public.email_domain_migration_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'email_domain_migration_log'
      AND policyname = 'email_domain_migration_log_admin_read'
  ) THEN
    CREATE POLICY email_domain_migration_log_admin_read
      ON public.email_domain_migration_log FOR SELECT TO authenticated
      USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
  END IF;
END $$;

-- Helper: rewrite the domain only, keeping the local part.
CREATE OR REPLACE FUNCTION public.rewrite_legacy_mail_domain(_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT replace(_value, 'yallabeena.info', 'yalla.africa')
$$;

-- 1. Finance distribution lists (ACTIVE notification recipients)
WITH upd AS (
  UPDATE public.finance_distribution_lists
     SET email = public.rewrite_legacy_mail_domain(email)
   WHERE email ILIKE '%@yallabeena.info'
  RETURNING email AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'finance_distribution_lists', 'email', replace(new_value, 'yalla.africa', 'yallabeena.info'), new_value, 'A_ACTIVE_CONFIGURATION' FROM upd;

-- 2. Charter notification preferences (ACTIVE notification recipients)
WITH upd AS (
  UPDATE public.charter_notification_prefs
     SET contact_email = public.rewrite_legacy_mail_domain(contact_email)
   WHERE contact_email ILIKE '%@yallabeena.info'
  RETURNING contact_email AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'charter_notification_prefs', 'contact_email', replace(new_value, 'yalla.africa', 'yallabeena.info'), new_value, 'A_ACTIVE_CONFIGURATION' FROM upd;

-- 3. Charter PDF template branding block (ACTIVE document template configuration)
WITH upd AS (
  UPDATE public.charter_pdf_templates
     SET brand = jsonb_set(
                   jsonb_set(brand, '{email}', to_jsonb('admin@yalla.africa'::text), true),
                   '{web}', to_jsonb('www.yalla.africa'::text), true)
   WHERE brand::text ILIKE '%yallabeena.info%'
  RETURNING brand::text AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'charter_pdf_templates', 'brand', 'hello@yallabeena.info / yallabeena.info', new_value, 'C_ACTIVE_TEMPLATE' FROM upd;

-- 4. Corporate billing contact (ACTIVE configuration)
WITH upd AS (
  UPDATE public.corporate_accounts
     SET billing_email = public.rewrite_legacy_mail_domain(billing_email)
   WHERE billing_email ILIKE '%@yallabeena.info'
  RETURNING billing_email AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'corporate_accounts', 'billing_email', replace(new_value, 'yalla.africa', 'yallabeena.info'), new_value, 'B_ACTIVE_DATA' FROM upd;

-- 5. Org entity contact (ACTIVE configuration)
WITH upd AS (
  UPDATE public.org_entities
     SET contact_email = public.rewrite_legacy_mail_domain(contact_email)
   WHERE contact_email ILIKE '%@yallabeena.info'
  RETURNING contact_email AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'org_entities', 'contact_email', replace(new_value, 'yalla.africa', 'yallabeena.info'), new_value, 'B_ACTIVE_DATA' FROM upd;

-- 6. Staff work emails — only when the yalla.africa address is not already used.
WITH candidates AS (
  SELECT s.id, s.work_email AS old_value, public.rewrite_legacy_mail_domain(s.work_email) AS new_value
    FROM public.staff_members s
   WHERE s.work_email ILIKE '%@yallabeena.info'
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_members t
        WHERE lower(t.work_email) = lower(public.rewrite_legacy_mail_domain(s.work_email))
     )
), upd AS (
  UPDATE public.staff_members s
     SET work_email = c.new_value
    FROM candidates c
   WHERE s.id = c.id
  RETURNING c.old_value, c.new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'staff_members', 'work_email', old_value, new_value, 'B_ACTIVE_DATA' FROM upd;

-- 7. Pending corporate invitations (ACTIVE outbound recipients)
WITH upd AS (
  UPDATE public.corporate_invitations
     SET email = public.rewrite_legacy_mail_domain(email)
   WHERE email ILIKE '%@yallabeena.info'
  RETURNING email AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'corporate_invitations', 'email', replace(new_value, 'yalla.africa', 'yallabeena.info'), new_value, 'B_ACTIVE_DATA' FROM upd;

-- 8. Recruitment privacy notice body (ACTIVE published content)
WITH upd AS (
  UPDATE public.rec_privacy_notices
     SET body_markdown = replace(body_markdown, 'admin@yallabeena.info', 'admin@yalla.africa')
   WHERE body_markdown ILIKE '%admin@yallabeena.info%'
  RETURNING 'rec_privacy_notices'::text AS t
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification)
SELECT 'rec_privacy_notices', 'body_markdown', 'admin@yallabeena.info', 'admin@yalla.africa', 'C_ACTIVE_TEMPLATE' FROM upd;

COMMIT;