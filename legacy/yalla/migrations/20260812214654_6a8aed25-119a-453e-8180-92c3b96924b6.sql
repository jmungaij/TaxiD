REVOKE ALL ON FUNCTION public.enforce_rider_device_trust_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_rider_device_trust_fields() TO service_role;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, service_role;