-- Driver duty layer. Nothing in the product ever wrote driver_locations, so the
-- dispatch supply pool was permanently empty and no booking could be matched.

CREATE OR REPLACE FUNCTION public.driver_set_availability(
  _online boolean,
  _available boolean DEFAULT true,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _accuracy_m numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_lat numeric;
  v_lng numeric;
  v_trip uuid;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver.id IS NULL THEN RAISE EXCEPTION 'No driver profile for this account'; END IF;
  IF v_driver.status <> 'active' AND _online THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'driver_not_active', 'status', v_driver.status);
  END IF;

  SELECT COALESCE(_lat, dl.lat), COALESCE(_lng, dl.lng)
    INTO v_lat, v_lng
    FROM public.driver_locations dl
   WHERE dl.driver_id = v_driver.id;

  v_lat := COALESCE(v_lat, _lat);
  v_lng := COALESCE(v_lng, _lng);

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'location_required');
  END IF;

  INSERT INTO public.driver_locations(driver_id, lat, lng, accuracy_m, is_online, is_available, updated_at)
  VALUES (v_driver.id, v_lat, v_lng, _accuracy_m, _online, _online AND _available, now())
  ON CONFLICT (driver_id) DO UPDATE
     SET lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         accuracy_m = COALESCE(EXCLUDED.accuracy_m, public.driver_locations.accuracy_m),
         is_online = EXCLUDED.is_online,
         is_available = EXCLUDED.is_available,
         updated_at = now();

  -- Feed the rider's live map while a trip is running.
  SELECT id INTO v_trip
    FROM public.trip_bookings
   WHERE driver_id = v_driver.id
     AND status IN ('driver_assigned', 'driver_arriving', 'in_progress')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_trip IS NOT NULL AND _lat IS NOT NULL AND _lng IS NOT NULL THEN
    INSERT INTO public.trip_tracking(trip_booking_id, lat, lng) VALUES (v_trip, _lat, _lng);
  END IF;

  RETURN jsonb_build_object('ok', true, 'is_online', _online, 'is_available', _online AND _available, 'active_trip_id', v_trip);
END $$;

REVOKE ALL ON FUNCTION public.driver_set_availability(boolean, boolean, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_set_availability(boolean, boolean, numeric, numeric, numeric) TO authenticated, service_role;

-- Driver-side trip state machine.
CREATE OR REPLACE FUNCTION public.driver_advance_trip(_booking_id uuid, _to_status text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_b public.trip_bookings%ROWTYPE;
  v_allowed text[];
BEGIN
  SELECT id INTO v_driver_id FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver_id IS NULL THEN RAISE EXCEPTION 'No driver profile for this account'; END IF;

  SELECT * INTO v_b FROM public.trip_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_b.id IS NULL THEN RAISE EXCEPTION 'Trip not found'; END IF;
  IF v_b.driver_id IS DISTINCT FROM v_driver_id THEN RAISE EXCEPTION 'Trip not assigned to you'; END IF;

  v_allowed := CASE v_b.status
    WHEN 'driver_assigned' THEN ARRAY['driver_arriving', 'cancelled']
    WHEN 'driver_arriving' THEN ARRAY['in_progress', 'cancelled']
    WHEN 'in_progress' THEN ARRAY['completed']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (_to_status = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'illegal_transition', 'from', v_b.status, 'to', _to_status);
  END IF;

  UPDATE public.trip_bookings
     SET status = _to_status,
         started_at = CASE WHEN _to_status = 'in_progress' THEN now() ELSE started_at END,
         completed_at = CASE WHEN _to_status = 'completed' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN _to_status = 'cancelled' THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN _to_status = 'cancelled' THEN 'driver' ELSE cancelled_by END,
         cancellation_reason = CASE WHEN _to_status = 'cancelled' THEN _reason ELSE cancellation_reason END,
         updated_at = now()
   WHERE id = _booking_id;

  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES (_booking_id, v_b.status, _to_status, auth.uid(), _reason);

  -- Release the driver back into the supply pool when the trip ends.
  IF _to_status IN ('completed', 'cancelled') THEN
    UPDATE public.driver_locations
       SET is_available = true, updated_at = now()
     WHERE driver_id = v_driver_id AND is_online;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', _to_status);
END $$;

REVOKE ALL ON FUNCTION public.driver_advance_trip(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_advance_trip(uuid, text, text) TO authenticated, service_role;

-- Duty state + current job for the signed-in driver.
CREATE OR REPLACE FUNCTION public.driver_duty_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers%ROWTYPE;
  v_loc public.driver_locations%ROWTYPE;
  v_trip jsonb;
BEGIN
  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_loc FROM public.driver_locations WHERE driver_id = v_driver.id;

  SELECT to_jsonb(t) INTO v_trip FROM (
    SELECT id, booking_number, status, pickup_address, dropoff_address,
           pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, total_fare, pickup_eta, passenger_count
      FROM public.trip_bookings
     WHERE driver_id = v_driver.id
       AND status IN ('driver_assigned', 'driver_arriving', 'in_progress')
     ORDER BY created_at DESC
     LIMIT 1
  ) t;

  RETURN jsonb_build_object(
    'driver_id', v_driver.id,
    'driver_status', v_driver.status,
    'is_online', COALESCE(v_loc.is_online, false),
    'is_available', COALESCE(v_loc.is_available, false),
    'last_ping', v_loc.updated_at,
    'active_trip', v_trip
  );
END $$;

REVOKE ALL ON FUNCTION public.driver_duty_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_duty_state() TO authenticated, service_role;