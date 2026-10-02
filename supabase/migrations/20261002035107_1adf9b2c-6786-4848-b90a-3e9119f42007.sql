REVOKE ALL ON public.trip_pickup_pins FROM anon, authenticated;
COMMENT ON TABLE public.trip_pickup_pins IS 'Verify My Ride pickup PINs. Intentionally no RLS policies: accessed only via SECURITY DEFINER rider/driver PIN routines.';

CREATE OR REPLACE FUNCTION private.safety_is_trip_driver(_driver_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = _driver_id AND d.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION private.safety_is_trip_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.safety_is_trip_driver(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.safety_is_trip_driver(_driver_id uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT private.safety_is_trip_driver($1) $$;
REVOKE ALL ON FUNCTION public.safety_is_trip_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_is_trip_driver(uuid) TO authenticated;

CREATE POLICY "Trip driver sees incidents on their trip" ON public.safety_incidents FOR SELECT TO authenticated
  USING (reporter_role = 'rider' AND public.safety_is_trip_driver(driver_id));