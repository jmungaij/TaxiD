-- device_fingerprints is a fraud/security signal store. End users must not be able
-- to read risk_score or device-integrity flags for their own device: that teaches
-- them exactly which signals raise their score. Self-visibility is reduced to a
-- non-scoring device list served by a definer view.

DROP POLICY IF EXISTS "df_user_read_own" ON public.device_fingerprints;

-- Users may not write to the fraud store either; it is populated server-side.
REVOKE INSERT, UPDATE, DELETE ON public.device_fingerprints FROM authenticated;

CREATE OR REPLACE VIEW public.v_my_devices
WITH (security_invoker = false) AS
SELECT
  df.id,
  df.platform,
  df.os,
  df.os_version,
  df.app_version,
  df.screen,
  df.timezone,
  df.language,
  df.country,
  df.city,
  df.first_seen,
  df.last_seen
FROM public.device_fingerprints df
WHERE df.user_id = auth.uid()
  AND auth.uid() IS NOT NULL;

REVOKE ALL ON public.v_my_devices FROM anon;
GRANT SELECT ON public.v_my_devices TO authenticated;
GRANT SELECT ON public.v_my_devices TO service_role;

COMMENT ON VIEW public.v_my_devices IS
  'Reduced self-service device list for the signed-in user. Deliberately excludes ip_address, risk_score and integrity flags (emulator/rooted/jailbroken/mock location), which stay admin/service-role only.';