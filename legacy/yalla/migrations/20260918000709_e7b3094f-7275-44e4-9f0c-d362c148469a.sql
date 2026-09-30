-- 1. Register every permission key the platform actually checks, so authority is explicit.
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
  ('staff.commercial.approve', 'commercial', 'approve', 'Approve commercial documents, quotations and contracts'),
  ('staff.commercial.write', 'commercial', 'write', 'Create and amend commercial records'),
  ('staff.compliance.read', 'compliance', 'read', 'View compliance registers and findings'),
  ('staff.finance.manage', 'finance', 'manage', 'Manage finance records, ledgers and configuration'),
  ('staff.finance.write', 'finance', 'write', 'Create and amend finance records'),
  ('staff.finance.settlement.view', 'finance', 'settlement.view', 'View carrier and partner settlement records'),
  ('staff.finance.settlement.manage', 'finance', 'settlement.manage', 'Prepare and maintain carrier and partner settlements'),
  ('staff.logistics.compliance.view', 'logistics', 'compliance.view', 'View carrier compliance items and evidence'),
  ('staff.logistics.compliance.manage', 'logistics', 'compliance.manage', 'Maintain carrier compliance items and evidence'),
  ('staff.recruitment.read', 'recruitment', 'read', 'View recruitment candidates, applications and documents'),
  ('staff.recruitment.write', 'recruitment', 'write', 'Create and amend recruitment records'),
  ('staff.recruitment.manage', 'recruitment', 'manage', 'Manage recruitment requirements, offers and onboarding'),
  ('staff.logistics.delivery.read', 'logistics', 'delivery.read', 'View final-mile delivery attempts, proof of delivery and returns'),
  ('staff.logistics.delivery.policy', 'logistics', 'delivery.policy', 'Maintain proof-of-delivery and returns policy versions'),
  ('staff.logistics.delivery.execute', 'logistics', 'delivery.execute', 'Execute final-mile delivery operations'),
  ('staff.logistics.delivery.returns', 'logistics', 'delivery.returns', 'Authorise and process returns'),
  ('staff.logistics.delivery.disposition', 'logistics', 'delivery.disposition', 'Decide return dispositions'),
  ('staff.logistics.hubs.operate', 'logistics', 'hubs.operate', 'Operate hub floor activity: gate, receiving, placement, pick and pack'),
  ('staff.logistics.hubs.manage', 'logistics', 'hubs.manage', 'Manage hub structure, zones, locations and docks')
ON CONFLICT (key) DO NOTHING;

-- 2. Write the top role's authority into the register BEFORE removing the blanket bypass,
--    so effective access is unchanged by this migration.
INSERT INTO public.staff_role_permissions (role, permission_key)
SELECT 'super_admin'::app_role, sp.key FROM public.staff_permissions sp
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3. has_staff_permission: no role is a master key. Authority is the register only.
CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.staff_role_permissions srp ON srp.role = ur.role
      WHERE ur.user_id = auth.uid() AND srp.permission_key = _perm
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.has_staff_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(text) TO anon, authenticated, service_role;

-- 4. No self-escalation: the register rows that define the two administrator roles'
--    own authority are backend-managed only. Other roles stay editable in the portal.
DROP POLICY IF EXISTS "super_admin write role permissions" ON public.staff_role_permissions;

CREATE POLICY "super_admin writes non-administrator role permissions"
ON public.staff_role_permissions
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  AND role NOT IN ('super_admin'::app_role, 'admin'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  AND role NOT IN ('super_admin'::app_role, 'admin'::app_role)
);

GRANT SELECT ON public.staff_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_role_permissions TO authenticated;
GRANT ALL ON public.staff_role_permissions TO service_role;
GRANT ALL ON public.staff_permissions TO service_role;