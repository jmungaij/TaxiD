REVOKE EXECUTE ON FUNCTION public.add_business_owner_membership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_review_business_organisation(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_business_request(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_assign_role(uuid,public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_role(uuid,public.app_role) FROM PUBLIC, anon;

DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
CREATE POLICY "Super admins can manage roles"
ON public.user_roles
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));