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

  -- Anyone can sign up with any address; only a VERIFIED mailbox proves control.
  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'admin/super_admin roles require a verified email address (attempted: %)', v_email;
  END IF;

  v_domain := split_part(v_email, '@', 2);

  IF v_domain IN ('yallabeena.info', 'yalla.africa') OR v_email = 'jmungaij@gmail.com' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'admin/super_admin roles may only be granted to @yalla.africa or @yallabeena.info emails (attempted: %)', v_email;
END;
$function$;