ALTER TABLE public.corporate_guest_bookings ADD COLUMN IF NOT EXISTS trip_booking_id uuid REFERENCES public.trip_bookings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS corporate_guest_bookings_trip_uq ON public.corporate_guest_bookings(trip_booking_id) WHERE trip_booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.corporate_guest_dispatch(_guest_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE g corporate_guest_bookings%ROWTYPE; v_rider uuid; v_trip uuid;
BEGIN
  SELECT * INTO g FROM corporate_guest_bookings WHERE id=_guest_id FOR UPDATE;
  IF NOT FOUND OR g.status <> 'confirmed' THEN RETURN NULL; END IF;
  IF g.trip_booking_id IS NOT NULL THEN RETURN g.trip_booking_id; END IF;
  IF g.employee_id IS NOT NULL THEN SELECT user_id INTO v_rider FROM corporate_employees WHERE id=g.employee_id; END IF;
  v_rider := coalesce(v_rider, g.booked_by);
  INSERT INTO trip_bookings(rider_user_id, ride_type_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
      passenger_count, intent, payment_method, total_fare, status, scheduled_for, booking_context, corporate_id, corporate_employee_id, trip_purpose, cost_center_code)
  VALUES (v_rider, g.ride_type_id, g.pickup_address, g.pickup_lat, g.pickup_lng, g.dropoff_address, g.dropoff_lat, g.dropoff_lng,
      g.passengers, 'business', 'corporate', round(g.estimated_fare_cents/100.0, 2),
      CASE WHEN g.scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END, g.scheduled_for, 'business', g.corporate_id, g.employee_id,
      left(coalesce(g.purpose, initcap(replace(g.booking_kind,'_',' '))||' — '||g.passenger_name),200), g.cost_center_code)
  RETURNING id INTO v_trip;
  INSERT INTO trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
    VALUES (v_trip, NULL, CASE WHEN g.scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END, auth.uid(), 'TravelDesk '||g.reference);
  UPDATE corporate_guest_bookings SET trip_booking_id=v_trip WHERE id=_guest_id;
  RETURN v_trip;
END $$;
REVOKE ALL ON FUNCTION private.corporate_guest_dispatch(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.trg_guest_booking_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status='confirmed' AND NEW.trip_booking_id IS NULL THEN PERFORM private.corporate_guest_dispatch(NEW.id); END IF;
  IF NEW.status IN ('cancelled','rejected') AND OLD.status IS DISTINCT FROM NEW.status AND NEW.trip_booking_id IS NOT NULL THEN
    UPDATE trip_bookings SET status='cancelled', cancelled_at=now(), cancelled_by='company', cancellation_reason='Cancelled on TravelDesk'
      WHERE id=NEW.trip_booking_id AND status IN ('pending','scheduled','accepted');
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_guest_booking_dispatch ON public.corporate_guest_bookings;
CREATE TRIGGER trg_guest_booking_dispatch AFTER INSERT OR UPDATE OF status ON public.corporate_guest_bookings
  FOR EACH ROW EXECUTE FUNCTION private.trg_guest_booking_dispatch();

CREATE OR REPLACE FUNCTION private.trg_trip_sync_guest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed','cancelled') THEN
    UPDATE corporate_guest_bookings SET status = NEW.status
      WHERE trip_booking_id = NEW.id AND status = 'confirmed';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_trip_sync_guest ON public.trip_bookings;
CREATE TRIGGER trg_trip_sync_guest AFTER UPDATE OF status ON public.trip_bookings
  FOR EACH ROW EXECUTE FUNCTION private.trg_trip_sync_guest();

-- Backfill: already-confirmed TravelDesk bookings that never reached drivers
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.corporate_guest_bookings WHERE status='confirmed' AND trip_booking_id IS NULL
    AND (scheduled_for IS NULL OR scheduled_for > now()) AND created_at > now() - interval '1 day' LOOP
    PERFORM private.corporate_guest_dispatch(r.id);
  END LOOP; END $$;