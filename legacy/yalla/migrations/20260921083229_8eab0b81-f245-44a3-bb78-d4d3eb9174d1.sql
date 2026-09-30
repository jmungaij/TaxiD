-- Replace the definer view with column-level grants on the table (no new security warnings).
DROP VIEW IF EXISTS public.app_pages_public;

-- Anonymous visitors may read only navigation-safe columns, and only for live public pages.
GRANT SELECT (route, title, page_group, icon, section, parent_page, description, sort_order, is_discoverable, is_searchable, is_public, is_active, status)
  ON public.app_pages TO anon;

CREATE POLICY "app_pages public rows readable by anon"
  ON public.app_pages
  FOR SELECT
  TO anon
  USING (is_public = true AND is_active = true);