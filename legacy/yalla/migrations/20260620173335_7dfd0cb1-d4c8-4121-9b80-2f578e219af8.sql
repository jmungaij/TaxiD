
-- ============================================================
-- 1) PACKAGES: remove anon full-read
-- ============================================================
DROP POLICY IF EXISTS "Packages anon track by number" ON public.packages;
REVOKE SELECT ON public.packages FROM anon;

-- ============================================================
-- 2) PACKAGE_TRACKING: anon off, authenticated scoped
-- ============================================================
DROP POLICY IF EXISTS "Tracking anon read" ON public.package_tracking;
DROP POLICY IF EXISTS "Tracking read auth" ON public.package_tracking;
REVOKE SELECT ON public.package_tracking FROM anon;

CREATE POLICY "Tracking read scoped"
ON public.package_tracking
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = package_tracking.package_id
      AND (
        p.sender_id = auth.uid()
        OR p.assigned_driver_id = auth.uid()
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'operations_admin'::app_role])
      )
  )
);

-- ============================================================
-- 3) PACKAGE_EVENTS: anon off, authenticated scoped
-- ============================================================
DROP POLICY IF EXISTS "Pkg events anon read" ON public.package_events;
DROP POLICY IF EXISTS "Pkg events read auth" ON public.package_events;
REVOKE SELECT ON public.package_events FROM anon;

CREATE POLICY "Pkg events read scoped"
ON public.package_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = package_events.package_id
      AND (
        p.sender_id = auth.uid()
        OR p.assigned_driver_id = auth.uid()
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'operations_admin'::app_role])
      )
  )
);

-- ============================================================
-- 4) DELIVERY_ETA_PREDICTIONS: anon off, authenticated scoped
-- ============================================================
DROP POLICY IF EXISTS "ETA anon read" ON public.delivery_eta_predictions;
DROP POLICY IF EXISTS "ETA read auth" ON public.delivery_eta_predictions;
REVOKE SELECT ON public.delivery_eta_predictions FROM anon;

CREATE POLICY "ETA read scoped"
ON public.delivery_eta_predictions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = delivery_eta_predictions.package_id
      AND (
        p.sender_id = auth.uid()
        OR p.assigned_driver_id = auth.uid()
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'operations_admin'::app_role])
      )
  )
);

-- ============================================================
-- 5) DELIVERY_ROUTE_SEGMENTS: authenticated scoped (no anon present)
-- ============================================================
DROP POLICY IF EXISTS "Segments read auth" ON public.delivery_route_segments;

CREATE POLICY "Segments read scoped"
ON public.delivery_route_segments
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'operations_admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id::text = delivery_route_segments.job_id::text
      AND (p.sender_id = auth.uid() OR p.assigned_driver_id = auth.uid())
  )
);

-- ============================================================
-- 6) Public tracking RPC (minimal fields, by tracking number only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.track_package_public(_tracking_number text)
RETURNS TABLE (
  tracking_number text,
  status text,
  module text,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tracking_number, p.status, p.module, p.picked_up_at, p.delivered_at, p.updated_at
  FROM public.packages p
  WHERE p.tracking_number = _tracking_number
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.track_package_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_package_public(text) TO anon, authenticated;

-- ============================================================
-- 7) EVENT_STORE partitions: enable RLS + admin-only SELECT
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'event_store_202606','event_store_202607','event_store_202608','event_store_202609','event_store_default'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "event_store_part_read_admins" ON public.%I', t);
      EXECUTE format($p$CREATE POLICY "event_store_part_read_admins" ON public.%I FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'compliance_admin'::app_role) OR has_role(auth.uid(), 'operations_admin'::app_role))$p$, t);
      EXECUTE format('DROP POLICY IF EXISTS "event_store_part_insert_auth" ON public.%I', t);
      EXECUTE format($p$CREATE POLICY "event_store_part_insert_auth" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)$p$, t);
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
