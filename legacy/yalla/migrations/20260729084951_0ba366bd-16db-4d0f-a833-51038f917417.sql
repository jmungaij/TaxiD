ALTER TABLE public.charter_bookings DROP CONSTRAINT IF EXISTS charter_bookings_flight_status_check;
ALTER TABLE public.charter_bookings ADD CONSTRAINT charter_bookings_flight_status_check
  CHECK (flight_status = ANY (ARRAY['requested','scheduled','crew_assigned','boarding','departed','en_route','landed','arrived','completed','cancelled']));