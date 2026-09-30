CREATE OR REPLACE FUNCTION public.trip_assign_driver(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b public.trip_bookings%ROWTYPE; v_driver uuid; v_vehicle uuid;
BEGIN
  SELECT * INTO v_b FROM public.trip_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_b.id IS NULL OR v_b.rider_user_id <> auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_b.driver_id IS NOT NULL THEN RETURN jsonb_build_object('assigned', true, 'driver_id', v_b.driver_id); END IF;
  IF v_b.status NOT IN ('pending','scheduled') THEN RETURN jsonb_build_object('assigned', false, 'reason', v_b.status); END IF;
  SELECT d.id, v.id INTO v_driver, v_vehicle
  FROM public.drivers d JOIN public.vehicles v ON v.driver_id = d.id AND v.status = 'available'
  WHERE d.verification_status IN ('verified','approved')
    AND d.user_id <> v_b.rider_user_id
    AND (v_b.ride_type_id IS NULL OR v.ride_type_id IS NULL OR v.ride_type_id = v_b.ride_type_id)
    AND NOT EXISTS (SELECT 1 FROM public.trip_bookings t WHERE t.driver_id = d.id AND t.status IN ('accepted','arrived','in_progress'))
  ORDER BY d.driver_rating DESC NULLS LAST, random() LIMIT 1;
  IF v_driver IS NULL THEN RETURN jsonb_build_object('assigned', false, 'reason', 'no_driver'); END IF;
  UPDATE public.trip_bookings SET driver_id = v_driver, vehicle_id = v_vehicle, status = 'accepted', pickup_eta = now() + interval '8 minutes' WHERE id = _booking_id;
  UPDATE public.vehicles SET status = 'on_trip' WHERE id = v_vehicle;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason) VALUES (_booking_id, v_b.status, 'accepted', auth.uid(), 'Auto-dispatch');
  RETURN jsonb_build_object('assigned', true, 'driver_id', v_driver);
END $$;