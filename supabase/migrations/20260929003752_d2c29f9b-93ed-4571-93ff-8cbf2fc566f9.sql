REVOKE INSERT ON public.trip_quotes FROM authenticated;
DROP POLICY IF EXISTS "Insert quotes" ON public.trip_quotes;

REVOKE INSERT, UPDATE ON public.trip_bookings FROM authenticated;
DROP POLICY IF EXISTS "Rider creates booking" ON public.trip_bookings;
DROP POLICY IF EXISTS "Rider/driver update booking" ON public.trip_bookings;

CREATE OR REPLACE FUNCTION public.trip_confirm_booking(_quote_id uuid, _payment_method text DEFAULT 'wallet', _scheduled_for timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q public.trip_quotes%ROWTYPE;
  v_r public.trip_requests%ROWTYPE;
  v_rt public.ride_types%ROWTYPE;
  v_book_id uuid;
  v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF _payment_method NOT IN ('wallet', 'mpesa', 'cash', 'card') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  SELECT * INTO v_q
  FROM public.trip_quotes
  WHERE id = _quote_id;

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;

  SELECT * INTO v_r
  FROM public.trip_requests
  WHERE id = v_q.trip_request_id
    AND rider_user_id = auth.uid();

  IF v_r.id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_q.expires_at < now() THEN
    RAISE EXCEPTION 'Quote expired';
  END IF;

  SELECT * INTO v_rt
  FROM public.ride_types
  WHERE id = v_q.ride_type_id
    AND id = v_r.ride_type_id
    AND is_active = true;

  IF v_rt.id IS NULL OR v_q.distance_km IS NULL OR v_q.duration_min IS NULL
     OR v_q.distance_km < 0 OR v_q.duration_min < 0 THEN
    RAISE EXCEPTION 'Invalid quote';
  END IF;

  v_total := GREATEST(
    v_rt.minimum_fare,
    (v_rt.base_fare + (v_q.distance_km * v_rt.per_km_rate) + (v_q.duration_min * v_rt.per_minute_rate)) * 1.0
  );

  INSERT INTO public.trip_bookings(
    rider_user_id, trip_request_id, trip_quote_id, ride_type_id,
    pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
    passenger_count, intent, payment_method, total_fare, surge_multiplier, status, scheduled_for
  )
  VALUES(
    auth.uid(), v_r.id, v_q.id, v_q.ride_type_id,
    v_r.pickup_address, v_r.pickup_lat, v_r.pickup_lng, v_r.dropoff_address, v_r.dropoff_lat, v_r.dropoff_lng,
    v_r.passenger_count, v_r.intent, _payment_method, v_total, 1.0,
    CASE WHEN _scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END, _scheduled_for
  )
  RETURNING id INTO v_book_id;

  UPDATE public.trip_requests
  SET status = 'booked', estimated_fare = v_total
  WHERE id = v_r.id;

  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES(v_book_id, NULL, CASE WHEN _scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END, auth.uid(), 'Booking confirmed');

  RETURN v_book_id;
END;
$$;

REVOKE ALL ON FUNCTION public.trip_confirm_booking(uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_confirm_booking(uuid,text,timestamptz) TO authenticated;