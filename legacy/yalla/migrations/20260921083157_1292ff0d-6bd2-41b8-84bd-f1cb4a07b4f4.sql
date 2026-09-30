-- Close the anonymous read on app_pages: ownership/criticality metadata is internal.
DROP POLICY IF EXISTS "app_pages public rows readable by anon" ON public.app_pages;
REVOKE SELECT ON public.app_pages FROM anon;

-- Public navigation surface: only navigation-safe columns for live public pages.
CREATE OR REPLACE VIEW public.app_pages_public
WITH (security_invoker = false) AS
SELECT
  route,
  title,
  page_group,
  icon,
  section,
  parent_page,
  description,
  sort_order,
  is_discoverable,
  is_searchable
FROM public.app_pages
WHERE is_public = true AND is_active = true AND status = 'active';

GRANT SELECT ON public.app_pages_public TO anon;
GRANT SELECT ON public.app_pages_public TO authenticated;