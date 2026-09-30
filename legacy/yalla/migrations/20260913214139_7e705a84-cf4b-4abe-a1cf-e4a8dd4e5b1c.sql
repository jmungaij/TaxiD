GRANT SELECT ON public.security_claims TO anon, authenticated;
GRANT SELECT ON public.security_claim_controls TO authenticated;
GRANT SELECT ON public.security_claim_evidence TO authenticated;
GRANT ALL ON public.security_claims, public.security_claim_controls, public.security_claim_evidence TO service_role;
GRANT SELECT ON public.identity_controls, public.identity_control_evidence TO authenticated;
GRANT ALL ON public.identity_controls, public.identity_control_evidence TO service_role;
GRANT SELECT ON public.v_security_claims, public.v_identity_certification, public.v_identity_certification_summary TO authenticated;
GRANT SELECT ON public.v_security_claims, public.v_identity_certification, public.v_identity_certification_summary TO service_role;

-- Public-facing surface: approved wording only, for claims backed by a control and passing evidence.
CREATE OR REPLACE FUNCTION public.security_claims_public()
RETURNS TABLE (claim_code text, surface text, wording text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.claim_code, c.surface, c.wording
  FROM public.v_security_claims c
  WHERE c.safe_to_display
  ORDER BY c.claim_code
$$;
REVOKE ALL ON FUNCTION public.security_claims_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_claims_public() TO anon, authenticated, service_role;