
CREATE OR REPLACE FUNCTION public.enforce_admin_email_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_domain text;
BEGIN
  IF NEW.role NOT IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = NEW.user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'admin roles require a confirmed user email';
  END IF;

  v_domain := split_part(v_email, '@', 2);

  IF v_domain = 'yallabeena.info' OR v_email = 'jmungaij@gmail.com' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'admin/super_admin roles may only be granted to @yallabeena.info emails or jmungaij@gmail.com (attempted: %)', v_email;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_admin_email_allowlist ON public.user_roles;
CREATE TRIGGER user_roles_admin_email_allowlist
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_email_allowlist();
