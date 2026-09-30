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
  v_dist numeric;
  v_max_km numeric := 25;
BEGIN
  PERFORM set_config('app.trip_engine', 'on', true);

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

  SELECT * INTO v_cand FROM (
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
  ) c
  WHERE c.distance_km <= v_max_km
  ORDER BY c.distance_km ASC
  LIMIT 1;

  IF v_cand.id IS NULL THEN
    IF v_b.status <> 'searching' THEN
      UPDATE public.trip_bookings
         SET status = 'searching', updated_at = now()
       WHERE id = _booking_id;
      INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
      VALUES (_booking_id, v_b.status, 'searching', auth.uid(), 'No driver available within search radius');
    END IF;
    RETURN jsonb_build_object('assigned', false, 'reason', 'no_driver_available');
  END IF;

  v_dist := round(COALESCE(v_cand.distance_km, 0)::numeric, 2);
  v_eta_min := GREATEST(2, CEIL(v_dist / 0.4)::int);

  UPDATE public.driver_locations
     SET is_available = false, updated_at = now()
   WHERE driver_id = v_cand.id
     AND is_online
     AND is_available;

  IF NOT FOUND THEN
    -- Another dispatch took this driver first.
    RETURN jsonb_build_object('assigned', false, 'reason', 'driver_taken');
  END IF;

  UPDATE public.trip_bookings
     SET driver_id = v_cand.id,
         vehicle_id = COALESCE(v_cand.vehicle_id, vehicle_id),
         status = 'driver_assigned',
         pickup_eta = now() + make_interval(mins => v_eta_min),
         updated_at = now()
   WHERE id = _booking_id;

  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES (_booking_id, v_b.status, 'driver_assigned', auth.uid(),
          format('Driver assigned %s km away, ETA %s min', v_dist, v_eta_min));

  RETURN jsonb_build_object(
    'assigned', true,
    'driver_id', v_cand.id,
    'driver_name', concat_ws(' ', v_cand.first_name, v_cand.last_name),
    'driver_phone', v_cand.phone_number,
    'driver_rating', v_cand.driver_rating,
    'distance_km', v_dist,
    'eta_minutes', v_eta_min
  );
END $$;

REVOKE ALL ON FUNCTION public.trip_assign_driver(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trip_assign_driver(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.trip_assign_driver(uuid) TO authenticated, service_role;