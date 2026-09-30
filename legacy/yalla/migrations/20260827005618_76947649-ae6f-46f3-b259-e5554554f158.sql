-- Rides vertical repair: real driver assignment.
-- Bookings previously stayed 'pending' forever because nothing ever selected a
-- driver. This adds an atomic, ownership-checked assignment RPC that draws on
-- the live driver_locations supply feed.

CREATE OR REPLACE FUNCTION public.trip_assign_driver(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.trip_bookings%ROWTYPE;
  v_cand record;
  v_eta_min int;
BEGIN
  SELECT * INTO v_b FROM public.trip_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'booking_not_found');
  END IF;

  IF v_b.rider_user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'dispatch_manager') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_b.driver_id IS NOT NULL THEN
    RETURN jsonb_build_object('assigned', true, 'reason', 'already_assigned', 'driver_id', v_b.driver_id);
  END IF;

  IF v_b.status NOT IN ('pending', 'searching', 'scheduled') THEN
    RETURN jsonb_build_object('assigned', false, 'reason', 'not_assignable', 'status', v_b.status);
  END IF;

  -- Nearest online + available driver with a fresh location ping who is not
  -- already committed to a live trip. SKIP LOCKED keeps concurrent dispatch
  -- from handing the same driver to two riders.
  SELECT d.id,
         d.first_name,
         d.last_name,
         d.phone_number,
         d.driver_rating,
         dl.vehicle_id,
         (6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians(v_b.pickup_lat)) * cos(radians(dl.lat))
              * cos(radians(dl.lng) - radians(v_b.pickup_lng))
              + sin(radians(v_b.pickup_lat)) * sin(radians(dl.lat))
            ))
         ))::numeric AS distance_km
    INTO v_cand
    FROM public.driver_locations dl
    JOIN public.drivers d ON d.id = dl.driver_id
   WHERE dl.is_online
     AND dl.is_available
     AND dl.updated_at > now() - interval '10 minutes'
     AND d.status = 'active'
     AND NOT EXISTS (
       SELECT 1 FROM public.trip_bookings tb
        WHERE tb.driver_id = d.id
          AND tb.status IN ('driver_assigned', 'driver_arriving', 'in_progress')
     )
   ORDER BY distance_km ASC
   LIMIT 1
     FOR UPDATE OF dl SKIP LOCKED;

  IF v_cand.id IS NULL THEN
    IF v_b.status <> 'searching' THEN
      UPDATE public.trip_bookings
         SET status = 'searching', updated_at = now()
       WHERE id = _booking_id;
      INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
      VALUES (_booking_id, v_b.status, 'searching', auth.uid(), 'No driver available yet');
    END IF;
    RETURN jsonb_build_object('assigned', false, 'reason', 'no_driver_available');
  END IF;

  -- ~24 km/h effective city speed, floored at 2 minutes.
  v_eta_min := GREATEST(2, CEIL(COALESCE(v_cand.distance_km, 0) / 0.4)::int);

  UPDATE public.driver_locations
     SET is_available = false, updated_at = now()
   WHERE driver_id = v_cand.id;

  UPDATE public.trip_bookings
     SET driver_id = v_cand.id,
         vehicle_id = COALESCE(v_cand.vehicle_id, vehicle_id),
         status = 'driver_assigned',
         pickup_eta = now() + make_interval(mins => v_eta_min),
         updated_at = now()
   WHERE id = _booking_id;

  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES (_booking_id, v_b.status, 'driver_assigned', auth.uid(),
          format('Driver assigned %.1f km away, ETA %s min', COALESCE(v_cand.distance_km, 0), v_eta_min));

  RETURN jsonb_build_object(
    'assigned', true,
    'driver_id', v_cand.id,
    'driver_name', concat_ws(' ', v_cand.first_name, v_cand.last_name),
    'driver_phone', v_cand.phone_number,
    'driver_rating', v_cand.driver_rating,
    'distance_km', round(COALESCE(v_cand.distance_km, 0)::numeric, 2),
    'eta_minutes', v_eta_min
  );
END $$;

REVOKE ALL ON FUNCTION public.trip_assign_driver(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_assign_driver(uuid) TO authenticated, service_role;

-- Read-only driver card for an assigned booking. trip_bookings.driver_id points
-- at public.drivers, which riders cannot select directly, so the rider UI could
-- never show who is coming.
CREATE OR REPLACE FUNCTION public.trip_driver_card(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b public.trip_bookings%ROWTYPE;
  v_d public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO v_b FROM public.trip_bookings WHERE id = _booking_id;
  IF v_b.id IS NULL THEN RETURN NULL; END IF;
  IF v_b.rider_user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'dispatch_manager') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF v_b.driver_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_d FROM public.drivers WHERE id = v_b.driver_id;
  IF v_d.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'driver_id', v_d.id,
    'name', concat_ws(' ', v_d.first_name, v_d.last_name),
    'phone', v_d.phone_number,
    'rating', v_d.driver_rating,
    'driver_code', v_d.driver_code,
    'pickup_eta', v_b.pickup_eta
  );
END $$;

REVOKE ALL ON FUNCTION public.trip_driver_card(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_driver_card(uuid) TO authenticated, service_role;