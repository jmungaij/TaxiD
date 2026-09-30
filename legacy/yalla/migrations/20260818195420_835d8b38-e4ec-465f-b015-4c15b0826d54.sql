BEGIN;

-- Retire yallabeena.info from the privileged-role allowlist.
CREATE OR REPLACE FUNCTION public.enforce_admin_email_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_confirmed timestamptz;
  v_domain text;
BEGIN
  IF NEW.role NOT IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  SELECT lower(email), email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users WHERE id = NEW.user_id;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'admin roles require a confirmed user email';
  END IF;

  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'admin/super_admin roles require a verified email address (attempted: %)', v_email;
  END IF;

  v_domain := split_part(v_email, '@', 2);

  -- Authoritative domain only. yallabeena.info was retired 2026-08-18.
  IF v_domain = 'yalla.africa' OR v_email = 'jmungaij@gmail.com' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'admin/super_admin roles may only be granted to verified @yalla.africa emails (attempted: %)', v_email;
END;
$function$;

-- Approved public phone number in the charter document branding block.
WITH upd AS (
  UPDATE public.charter_pdf_templates
     SET brand = jsonb_set(brand, '{phone}', to_jsonb('+254 142 970050'::text), true)
   WHERE brand->>'phone' = '+254 710 100 090'
  RETURNING brand::text AS new_value
)
INSERT INTO public.email_domain_migration_log (target_table, target_column, old_value, new_value, classification, reason)
SELECT 'charter_pdf_templates', 'brand.phone', '+254 710 100 090', '+254 142 970050', 'C_ACTIVE_TEMPLATE',
       'Align document branding with the authoritative Yalla Mobility phone number'
FROM upd;

COMMIT;