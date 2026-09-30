-- The DI-00 orchestrator edge function performs its own caller authorisation
-- (requireInternalOrStaff) and then calls the guarded RPCs with the service
-- role, where auth.uid() is NULL. has_staff_permission() therefore denied
-- fixtures/backup/restore/certify for every operator. service_role already
-- bypasses RLS entirely, so recognising it here grants no new privilege.
CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
  ) OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.staff_role_permissions srp ON srp.role = ur.role
    WHERE ur.user_id = auth.uid() AND srp.permission_key = _perm
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(text) TO authenticated, service_role;