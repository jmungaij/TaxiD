
-- Fix: delivery data injection — restrict INSERT on package_tracking, package_events,
-- and delivery_eta_predictions to the package sender, assigned driver, or ops/admin.
DROP POLICY IF EXISTS "Tracking insert auth" ON public.package_tracking;
CREATE POLICY "Tracking insert scoped"
ON public.package_tracking
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = package_tracking.package_id
      AND (
        p.sender_id = auth.uid()
        OR p.assigned_driver_id = auth.uid()
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
      )
  )
);

DROP POLICY IF EXISTS "Pkg events insert auth" ON public.package_events;
CREATE POLICY "Pkg events insert scoped"
ON public.package_events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = package_events.package_id
      AND (
        p.sender_id = auth.uid()
        OR p.assigned_driver_id = auth.uid()
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
      )
  )
);

DROP POLICY IF EXISTS "ETA insert auth" ON public.delivery_eta_predictions;
CREATE POLICY "ETA insert scoped"
ON public.delivery_eta_predictions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = delivery_eta_predictions.package_id
      AND (
        p.assigned_driver_id = auth.uid()
        OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
      )
  )
);

-- Fix: delivery_route_segments — INSERT/UPDATE restricted to assigned driver or admin.
-- Matches the existing scoped SELECT policy that joins job_id to packages.id.
DROP POLICY IF EXISTS "Segments write auth" ON public.delivery_route_segments;
CREATE POLICY "Segments insert scoped"
ON public.delivery_route_segments
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id::text = delivery_route_segments.job_id::text
      AND p.assigned_driver_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Segments update auth" ON public.delivery_route_segments;
CREATE POLICY "Segments update scoped"
ON public.delivery_route_segments
FOR UPDATE
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id::text = delivery_route_segments.job_id::text
      AND p.assigned_driver_id = auth.uid()
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  OR EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id::text = delivery_route_segments.job_id::text
      AND p.assigned_driver_id = auth.uid()
  )
);

-- Fix: finance_distribution_lists — restrict SELECT to admin/finance/super roles.
DROP POLICY IF EXISTS "Authenticated read distribution lists" ON public.finance_distribution_lists;
CREATE POLICY "Finance staff read distribution lists"
ON public.finance_distribution_lists
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'finance_admin'::app_role])
);

-- Fix: trip_share_links — remove public enumeration; owner-scoped reads only.
-- Public token resolution must happen server-side via an edge function using the
-- service role, which bypasses RLS and can verify the exact token requested.
DROP POLICY IF EXISTS "Public reads valid share" ON public.trip_share_links;
CREATE POLICY "Owner reads own share"
ON public.trip_share_links
FOR SELECT
TO authenticated
USING (user_id = auth.uid());
