-- =========================================================
-- 1. Domain-scoped staff permission model
-- =========================================================
CREATE TABLE IF NOT EXISTS public.staff_permissions (
  key text PRIMARY KEY,
  domain text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.staff_permissions TO authenticated;
GRANT ALL ON public.staff_permissions TO service_role;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.staff_role_permissions (
  role app_role NOT NULL,
  permission_key text NOT NULL REFERENCES public.staff_permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_key)
);
GRANT SELECT ON public.staff_role_permissions TO authenticated;
GRANT ALL ON public.staff_role_permissions TO service_role;
ALTER TABLE public.staff_role_permissions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.staff_permissions(key, domain, action, description) VALUES
  ('staff.pricing.read','pricing','read','View pricing engines, rate inputs and quote snapshots'),
  ('staff.pricing.manage','pricing','manage','Change pricing configuration and overrides'),
  ('staff.commercial.read','commercial','read','View commercial contracts, quotations and rate cards'),
  ('staff.commercial.manage','commercial','manage','Create and amend commercial documents'),
  ('staff.crm.read','crm','read','View CRM accounts, contacts, interactions and commitments'),
  ('staff.crm.manage','crm','manage','Maintain CRM records'),
  ('staff.people.read','people','read','View organisation, HR and staff performance records'),
  ('staff.people.manage','people','manage','Maintain organisation and staff records'),
  ('staff.partners.read','partners','read','View partner network, supply and settlement records'),
  ('staff.partners.manage','partners','manage','Manage partner onboarding, supply and settlements')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions(role, permission_key) VALUES
  ('admin','staff.pricing.read'),('admin','staff.commercial.read'),('admin','staff.crm.read'),
  ('admin','staff.people.read'),('admin','staff.partners.read'),
  ('admin','staff.commercial.manage'),('admin','staff.crm.manage'),
  ('admin','staff.people.manage'),('admin','staff.partners.manage'),
  ('director','staff.pricing.read'),('director','staff.commercial.read'),
  ('director','staff.crm.read'),('director','staff.people.read'),('director','staff.partners.read'),
  ('general_manager','staff.pricing.read'),('general_manager','staff.commercial.read'),
  ('general_manager','staff.crm.read'),('general_manager','staff.people.read'),
  ('general_manager','staff.partners.read'),
  ('finance_admin','staff.pricing.read'),('finance_admin','staff.commercial.read'),
  ('finance_admin','staff.crm.read'),('finance_admin','staff.partners.read'),
  ('compliance_admin','staff.people.read'),('compliance_admin','staff.partners.read'),
  ('compliance_admin','staff.crm.read'),
  ('operations_admin','staff.partners.read'),('operations_admin','staff.people.read'),
  ('operations_admin','staff.commercial.read'),('operations_admin','staff.partners.manage'),
  ('pricing_manager','staff.pricing.read'),('pricing_manager','staff.pricing.manage'),
  ('pricing_manager','staff.commercial.read'),
  ('fleet_owner','staff.partners.read'),
  ('dispatch_manager','staff.partners.read'),
  ('corporate_manager','staff.crm.read'),('corporate_manager','staff.commercial.read')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
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

DROP POLICY IF EXISTS "staff read staff permissions" ON public.staff_permissions;
CREATE POLICY "staff read staff permissions" ON public.staff_permissions
  FOR SELECT TO authenticated USING (public.is_staff_member());
DROP POLICY IF EXISTS "super_admin write staff permissions" ON public.staff_permissions;
CREATE POLICY "super_admin write staff permissions" ON public.staff_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "staff read role permissions" ON public.staff_role_permissions;
CREATE POLICY "staff read role permissions" ON public.staff_role_permissions
  FOR SELECT TO authenticated USING (public.is_staff_member());
DROP POLICY IF EXISTS "super_admin write role permissions" ON public.staff_role_permissions;
CREATE POLICY "super_admin write role permissions" ON public.staff_role_permissions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

-- =========================================================
-- 2. Re-scope broad staff SELECT policies to domain permissions
-- =========================================================
DO $do$
DECLARE
  r record;
  dom text;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
      AND qual = 'is_staff_portal_member(auth.uid())'
  LOOP
    dom := CASE
      WHEN r.tablename LIKE 'ap360\_%' OR r.tablename LIKE 'asset\_pricing\_%'
        OR r.tablename LIKE 'pricing%' THEN 'pricing'
      WHEN r.tablename LIKE 'commercial\_%' THEN 'commercial'
      WHEN r.tablename LIKE 'crm\_%' THEN 'crm'
      WHEN r.tablename LIKE 'org\_%' OR r.tablename LIKE 'staff\_%' THEN 'people'
      WHEN r.tablename LIKE 'partner%' OR r.tablename = 'capacity_requests' THEN 'partners'
      ELSE NULL
    END;
    IF dom IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_staff_permission(%L))',
      r.policyname, r.tablename, 'staff.' || dom || '.read');
  END LOOP;
END
$do$;

DROP POLICY IF EXISTS "staff read commitments" ON public.crm_customer_commitments;
CREATE POLICY "staff read commitments" ON public.crm_customer_commitments
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.crm.read') OR public.is_platform_admin());

-- =========================================================
-- 3. Internal authorization model is no longer world-readable
-- =========================================================
CREATE OR REPLACE FUNCTION public.my_effective_capabilities()
RETURNS TABLE(capability_key text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT c.key
  FROM public.role_capabilities rc
  JOIN public.capabilities c ON c.id = rc.capability_id
  JOIN public.user_roles ur ON ur.role = rc.role
  WHERE ur.user_id = auth.uid()
  UNION
  SELECT DISTINCT c.key
  FROM public.user_capabilities uc
  JOIN public.capabilities c ON c.id = uc.capability_id
  WHERE uc.user_id = auth.uid()
    AND uc.revoked_at IS NULL
    AND (uc.expires_at IS NULL OR uc.expires_at > now());
$$;
GRANT EXECUTE ON FUNCTION public.my_effective_capabilities() TO authenticated, service_role;

DROP POLICY IF EXISTS "capabilities read auth" ON public.capabilities;
CREATE POLICY "capabilities read staff" ON public.capabilities
  FOR SELECT TO authenticated USING (public.is_staff_member());

DROP POLICY IF EXISTS "rolecaps read auth" ON public.role_capabilities;
CREATE POLICY "rolecaps read staff" ON public.role_capabilities
  FOR SELECT TO authenticated USING (public.is_staff_member());

DROP POLICY IF EXISTS "policycaps read auth" ON public.policy_capabilities;
CREATE POLICY "policycaps read staff" ON public.policy_capabilities
  FOR SELECT TO authenticated USING (public.is_staff_member());