-- Replace the definer view with column-level privileges: signed-in users may read
-- only non-scoring columns of their own device rows; ip_address, risk_score and the
-- integrity flags remain admin/service-role only.
DROP VIEW IF EXISTS public.v_my_devices;

REVOKE SELECT ON public.device_fingerprints FROM authenticated;
GRANT SELECT (
  id, user_id, platform, os, os_version, app_version, screen, timezone, language,
  country, city, first_seen, last_seen, created_at, updated_at
) ON public.device_fingerprints TO authenticated;

CREATE POLICY "df_user_read_own_nonscoring" ON public.device_fingerprints
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE VIEW public.v_my_devices
WITH (security_invoker = true) AS
SELECT
  df.id, df.platform, df.os, df.os_version, df.app_version, df.screen,
  df.timezone, df.language, df.country, df.city, df.first_seen, df.last_seen
FROM public.device_fingerprints df
WHERE df.user_id = auth.uid();

REVOKE ALL ON public.v_my_devices FROM anon;
GRANT SELECT ON public.v_my_devices TO authenticated;
GRANT SELECT ON public.v_my_devices TO service_role;

COMMENT ON VIEW public.v_my_devices IS
  'Reduced self-service device list. Excludes ip_address, risk_score and integrity flags, which stay admin/service-role only via column-level privileges.';