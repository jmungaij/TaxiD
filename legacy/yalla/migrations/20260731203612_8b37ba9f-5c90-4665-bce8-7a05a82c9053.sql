CREATE OR REPLACE FUNCTION public.self_assign_signup_role(_role app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _role NOT IN ('rider'::app_role, 'driver'::app_role, 'corporate_admin'::app_role, 'corporate_employee'::app_role, 'fleet_owner'::app_role) THEN
    RAISE EXCEPTION 'role % is not self-assignable', _role;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.self_assign_signup_role(app_role) FROM public;
GRANT EXECUTE ON FUNCTION public.self_assign_signup_role(app_role) TO authenticated;