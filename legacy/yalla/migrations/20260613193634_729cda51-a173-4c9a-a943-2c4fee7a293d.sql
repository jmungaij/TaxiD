
-- corporate_accounts: writes restricted to platform admins/finance
DROP POLICY IF EXISTS corp_accounts_insert ON public.corporate_accounts;
DROP POLICY IF EXISTS corp_accounts_update ON public.corporate_accounts;
DROP POLICY IF EXISTS corp_accounts_delete ON public.corporate_accounts;

CREATE POLICY corp_accounts_insert ON public.corporate_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY corp_accounts_update ON public.corporate_accounts
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY corp_accounts_delete ON public.corporate_accounts
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]));

-- driver_etims_profiles
DROP POLICY IF EXISTS driver_etims_profiles_insert ON public.driver_etims_profiles;
DROP POLICY IF EXISTS driver_etims_profiles_update ON public.driver_etims_profiles;
DROP POLICY IF EXISTS driver_etims_profiles_delete ON public.driver_etims_profiles;

CREATE POLICY driver_etims_profiles_insert ON public.driver_etims_profiles
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY driver_etims_profiles_update ON public.driver_etims_profiles
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]))
  WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY driver_etims_profiles_delete ON public.driver_etims_profiles
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]));

-- driver_tax_profiles
DROP POLICY IF EXISTS driver_tax_profiles_insert ON public.driver_tax_profiles;
DROP POLICY IF EXISTS driver_tax_profiles_update ON public.driver_tax_profiles;
DROP POLICY IF EXISTS driver_tax_profiles_delete ON public.driver_tax_profiles;

CREATE POLICY driver_tax_profiles_insert ON public.driver_tax_profiles
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY driver_tax_profiles_update ON public.driver_tax_profiles
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]))
  WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY driver_tax_profiles_delete ON public.driver_tax_profiles
  FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]));

-- etims_invoices (append-only; no delete policy)
DROP POLICY IF EXISTS etims_invoices_insert ON public.etims_invoices;
DROP POLICY IF EXISTS etims_invoices_update ON public.etims_invoices;

CREATE POLICY etims_invoices_insert ON public.etims_invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE POLICY etims_invoices_update ON public.etims_invoices
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

-- profiles: admin support read access
DROP POLICY IF EXISTS profiles_admin_read ON public.profiles;
CREATE POLICY profiles_admin_read ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
