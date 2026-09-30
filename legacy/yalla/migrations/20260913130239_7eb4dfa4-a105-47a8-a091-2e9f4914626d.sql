CREATE OR REPLACE FUNCTION public._rental_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'RENTAL_BOOKING_EVENTS_ARE_APPEND_ONLY';
END; $$;

REVOKE ALL ON FUNCTION public._rental_events_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rental_commitment_no_overlap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rental_booking_reference() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_events_append_only() TO service_role;
GRANT EXECUTE ON FUNCTION public._rental_commitment_no_overlap() TO service_role;
GRANT EXECUTE ON FUNCTION public._rental_booking_reference() TO service_role;
