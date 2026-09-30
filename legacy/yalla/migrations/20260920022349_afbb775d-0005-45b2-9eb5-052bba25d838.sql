DROP POLICY IF EXISTS security_claims_public_read ON public.security_claims;
CREATE POLICY security_claims_public_read ON public.security_claims
  FOR SELECT TO anon USING (withheld_reason IS NULL);

DROP POLICY IF EXISTS security_claim_controls_read ON public.security_claim_controls;
CREATE POLICY security_claim_controls_read ON public.security_claim_controls
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.security_claims c WHERE c.claim_code = security_claim_controls.claim_code));