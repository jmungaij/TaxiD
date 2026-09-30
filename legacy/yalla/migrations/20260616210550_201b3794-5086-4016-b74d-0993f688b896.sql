
-- ============================================
-- PHASE 3: CTA Events tracking
-- ============================================
CREATE TABLE IF NOT EXISTS public.cta_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  button_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target TEXT,
  page_source TEXT,
  campaign_source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_role TEXT,
  session_id TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted BOOLEAN NOT NULL DEFAULT false,
  converted_at TIMESTAMPTZ,
  conversion_value NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cta_events TO anon, authenticated;
GRANT ALL ON public.cta_events TO service_role;

ALTER TABLE public.cta_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert CTA events"
  ON public.cta_events FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view CTA events"
  ON public.cta_events FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_cta_events_button ON public.cta_events(button_name, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_cta_events_page ON public.cta_events(page_source, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_cta_events_user ON public.cta_events(user_id, clicked_at DESC);

-- ============================================
-- PHASE 6: Extend app_pages with governance metadata
-- ============================================
ALTER TABLE public.app_pages
  ADD COLUMN IF NOT EXISTS is_discoverable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_searchable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS parent_page TEXT,
  ADD COLUMN IF NOT EXISTS page_owner TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS criticality TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS section TEXT,
  ADD COLUMN IF NOT EXISTS analytics_key TEXT;

-- ============================================
-- PHASE 7: Navigation Integrity audit results
-- ============================================
CREATE TABLE IF NOT EXISTS public.navigation_integrity_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger TEXT NOT NULL DEFAULT 'manual',
  dead_routes INTEGER NOT NULL DEFAULT 0,
  orphan_routes INTEGER NOT NULL DEFAULT 0,
  unbound_buttons INTEGER NOT NULL DEFAULT 0,
  missing_analytics INTEGER NOT NULL DEFAULT 0,
  permission_violations INTEGER NOT NULL DEFAULT 0,
  registry_mismatch INTEGER NOT NULL DEFAULT 0,
  passed BOOLEAN NOT NULL DEFAULT true,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.navigation_integrity_runs TO authenticated;
GRANT ALL ON public.navigation_integrity_runs TO service_role;

ALTER TABLE public.navigation_integrity_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view nav integrity"
  ON public.navigation_integrity_runs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Admins insert nav integrity"
  ON public.navigation_integrity_runs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );
