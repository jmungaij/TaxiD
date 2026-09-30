
-- Server-side gate used by edge functions AND the Forensics UI tab.
CREATE OR REPLACE FUNCTION public.payment_has_forensic_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN (
        'super_admin'::app_role,
        'admin'::app_role,
        'operations_admin'::app_role,
        'finance_admin'::app_role,
        'compliance_admin'::app_role
      )
  );
$$;

REVOKE ALL ON FUNCTION public.payment_has_forensic_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_has_forensic_access(uuid) TO authenticated, service_role;

-- Convenience wrapper for the SPA — no argument, uses auth.uid().
CREATE OR REPLACE FUNCTION public.payment_current_user_forensic_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.payment_has_forensic_access(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.payment_current_user_forensic_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_current_user_forensic_access() TO authenticated, service_role;
