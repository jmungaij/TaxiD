-- app_pages: anonymous users only see public pages; signed-in users see the rest
DROP POLICY IF EXISTS "app_pages readable to all" ON public.app_pages;

CREATE POLICY "app_pages public rows readable by anon"
ON public.app_pages
FOR SELECT
TO anon
USING (is_public = true AND is_active = true);

CREATE POLICY "app_pages readable by authenticated"
ON public.app_pages
FOR SELECT
TO authenticated
USING (true);

-- nav_integrity_thresholds: staff only
DROP POLICY IF EXISTS "nav_thresholds read" ON public.nav_integrity_thresholds;

CREATE POLICY "nav_thresholds staff read"
ON public.nav_integrity_thresholds
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

REVOKE SELECT ON public.nav_integrity_thresholds FROM anon;
GRANT SELECT ON public.app_pages TO anon, authenticated;
GRANT SELECT ON public.nav_integrity_thresholds TO authenticated;
GRANT ALL ON public.nav_integrity_thresholds TO service_role;
GRANT ALL ON public.app_pages TO service_role;