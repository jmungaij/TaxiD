-- Phase 1 security gate: hardening fixes from forensic RLS audit

-- 1) trip_pickup_pins holds ride verification PINs. RLS is enabled with zero
--    policies and zero grants, so the Data API already cannot reach it.
--    Make the intended posture explicit: service-role only, documented.
GRANT ALL ON public.trip_pickup_pins TO service_role;
COMMENT ON TABLE public.trip_pickup_pins IS
  'Ride pickup verification PINs. Service-role only: no anon/authenticated access by design (RLS enabled, no client policies). Managed by private trip routines.';

-- 2) trip_bookings "Own bookings" policy was attached TO public. Its qual
--    already requires auth.uid(), so anon could never match a row, but narrow
--    it to authenticated to remove the ambiguity.
DROP POLICY "Own bookings" ON public.trip_bookings;
CREATE POLICY "Own bookings" ON public.trip_bookings
  FOR SELECT TO authenticated
  USING (
    rider_user_id = auth.uid()
    OR driver_id = auth.uid()
    OR private.has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'support'::app_role])
  );