CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER TABLE public.trip_pickup_pins ALTER COLUMN pin SET DEFAULT lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint) % 10000)::text, 4, '0');
CREATE OR REPLACE FUNCTION private.trip_pickup_pin(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb; st text;
BEGIN
  SELECT status INTO st FROM trip_bookings WHERE id=_booking_id AND rider_user_id=auth.uid();
  IF st IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF st IN ('completed','cancelled') THEN RETURN NULL; END IF;
  INSERT INTO trip_pickup_pins(trip_booking_id) VALUES (_booking_id) ON CONFLICT DO NOTHING;
  SELECT jsonb_build_object('pin', pin, 'verified', verified_at IS NOT NULL) INTO v FROM trip_pickup_pins WHERE trip_booking_id=_booking_id;
  RETURN v;
END $$;