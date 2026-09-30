REVOKE EXECUTE ON FUNCTION public.trip_assign_driver(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.trip_driver_card(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.driver_set_availability(boolean, boolean, numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.driver_advance_trip(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.driver_duty_state() FROM anon;