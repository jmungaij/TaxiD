
DROP POLICY IF EXISTS security_claims_public_read ON public.security_claims;
DROP POLICY IF EXISTS security_claim_evidence_read ON public.security_claim_evidence;

REVOKE ALL ON public.security_claims FROM anon;
REVOKE ALL ON public.security_claim_evidence FROM anon;
REVOKE ALL ON public.v_security_claims FROM anon;

GRANT SELECT ON public.security_claims TO authenticated;
GRANT SELECT ON public.security_claim_evidence TO authenticated;
GRANT SELECT ON public.v_security_claims TO authenticated;
GRANT ALL ON public.security_claims TO service_role;
GRANT ALL ON public.security_claim_evidence TO service_role;
GRANT SELECT ON public.v_security_claims TO service_role;

CREATE POLICY security_claims_staff_read
  ON public.security_claims
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])
    OR public.has_staff_permission('staff.security.read')
  );

CREATE POLICY security_claim_evidence_staff_read
  ON public.security_claim_evidence
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])
    OR public.has_staff_permission('staff.security.read')
  );
