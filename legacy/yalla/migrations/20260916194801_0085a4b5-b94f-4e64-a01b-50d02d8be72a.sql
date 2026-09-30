
DROP POLICY IF EXISTS social_caps_public_read ON public.social_provider_capabilities;

REVOKE SELECT ON public.social_provider_capabilities FROM anon;
GRANT SELECT ON public.social_provider_capabilities TO authenticated;
GRANT ALL ON public.social_provider_capabilities TO service_role;

CREATE POLICY social_caps_staff_read
  ON public.social_provider_capabilities
  FOR SELECT
  TO authenticated
  USING (public.social_can_edit());
