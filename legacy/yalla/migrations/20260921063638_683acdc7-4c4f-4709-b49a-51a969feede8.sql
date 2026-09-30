-- WAVE 3 (RLS) batch 1 + pg_net exposure hardening.

-- 1. Provider invoices: the write-blocking policies used USING(true), which (being
-- permissive) also opened SELECT to every signed-in user. Replace with per-command
-- deny policies and remove client write privileges entirely.
DROP POLICY IF EXISTS provider_invoices_no_client_write ON public.provider_invoices;
DROP POLICY IF EXISTS provider_invoice_lines_no_client_write ON public.provider_invoice_lines;

REVOKE INSERT, UPDATE, DELETE ON public.provider_invoices FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.provider_invoice_lines FROM authenticated, anon;
GRANT ALL ON public.provider_invoices TO service_role;
GRANT ALL ON public.provider_invoice_lines TO service_role;

-- 2. Internal work-planning and analytics configuration: staff only.
DROP POLICY IF EXISTS work_capacity_profiles_read ON public.work_capacity_profiles;
CREATE POLICY work_capacity_profiles_read ON public.work_capacity_profiles
  FOR SELECT TO authenticated USING (public.is_staff_member());

DROP POLICY IF EXISTS work_triage_bands_read ON public.work_triage_bands;
CREATE POLICY work_triage_bands_read ON public.work_triage_bands
  FOR SELECT TO authenticated USING (public.is_staff_member());

DROP POLICY IF EXISTS work_triage_norms_read ON public.work_triage_norms;
CREATE POLICY work_triage_norms_read ON public.work_triage_norms
  FOR SELECT TO authenticated USING (public.is_staff_member());

DROP POLICY IF EXISTS "anly dim read" ON public.analytics_dimensions;
CREATE POLICY "anly dim read" ON public.analytics_dimensions
  FOR SELECT TO authenticated USING (public.is_staff_member());

-- 3. pg_net: the extension stays where the provider put it (non-relocatable, see
-- EXC-001), but its queue and response tables must not be reachable by app roles.
DO $$
BEGIN
  BEGIN
    REVOKE ALL ON net.http_request_queue FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON net._http_response FROM PUBLIC, anon, authenticated;
    REVOKE ALL ON SEQUENCE net.http_request_queue_id_seq FROM PUBLIC, anon, authenticated;
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    RAISE NOTICE 'pg_net object privileges are provider-owned; recorded as exception';
  END;
  BEGIN
    REVOKE ALL ON SCHEMA net FROM anon, authenticated;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'net schema privileges are provider-owned';
  END;
END $$;