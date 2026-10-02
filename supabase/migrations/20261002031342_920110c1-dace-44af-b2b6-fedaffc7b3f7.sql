CREATE TABLE public.trip_pickup_pins (
  trip_booking_id uuid PRIMARY KEY REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  pin text NOT NULL DEFAULT lpad((floor(random()*10000))::int::text, 4, '0'),
  failed_attempts int NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.trip_pickup_pins TO service_role;
ALTER TABLE public.trip_pickup_pins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.trip_pickup_pin(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trip_bookings WHERE id=_booking_id AND rider_user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO trip_pickup_pins(trip_booking_id) VALUES (_booking_id) ON CONFLICT DO NOTHING;
  SELECT jsonb_build_object('pin', pin, 'verified', verified_at IS NOT NULL) INTO v FROM trip_pickup_pins WHERE trip_booking_id=_booking_id;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION private.trip_pickup_pin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trip_pickup_pin(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.trip_pickup_pin(_booking_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.trip_pickup_pin(_booking_id) $$;
GRANT EXECUTE ON FUNCTION public.trip_pickup_pin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.driver_verify_pickup(_booking_id uuid, _pin text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_driver uuid; r trip_pickup_pins%ROWTYPE;
BEGIN
  SELECT id INTO v_driver FROM drivers WHERE user_id = auth.uid();
  IF v_driver IS NULL OR NOT EXISTS (SELECT 1 FROM trip_bookings WHERE id=_booking_id AND driver_id=v_driver AND status='arrived') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  INSERT INTO trip_pickup_pins(trip_booking_id) VALUES (_booking_id) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM trip_pickup_pins WHERE trip_booking_id=_booking_id FOR UPDATE;
  IF r.verified_at IS NOT NULL THEN RETURN true; END IF;
  IF r.failed_attempts >= 5 THEN RAISE EXCEPTION 'Too many wrong PINs. Contact TaxiD support.'; END IF;
  IF r.pin <> coalesce(trim(_pin),'') THEN
    UPDATE trip_pickup_pins SET failed_attempts = failed_attempts + 1 WHERE trip_booking_id=_booking_id;
    RETURN false;
  END IF;
  UPDATE trip_pickup_pins SET verified_at = now() WHERE trip_booking_id=_booking_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.driver_verify_pickup(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.driver_verify_pickup(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.driver_verify_pickup(_booking_id uuid, _pin text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.driver_verify_pickup(_booking_id, _pin) $$;
GRANT EXECUTE ON FUNCTION public.driver_verify_pickup(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.driver_update_trip_status(_booking_id uuid, _status text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_driver uuid; v_old text; v_fare numeric; v_vehicle uuid;
BEGIN
  IF _status NOT IN ('arrived','in_progress','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  SELECT status, total_fare, vehicle_id INTO v_old, v_fare, v_vehicle FROM public.trip_bookings WHERE id = _booking_id AND driver_id = v_driver FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_old IN ('completed','cancelled') THEN RAISE EXCEPTION 'Trip already %', v_old; END IF;
  IF _status = 'in_progress' AND NOT EXISTS (SELECT 1 FROM public.trip_pickup_pins WHERE trip_booking_id=_booking_id AND verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Enter the rider''s TaxiD PIN before starting the trip';
  END IF;
  UPDATE public.trip_bookings SET status = _status,
    started_at = CASE WHEN _status='in_progress' THEN now() ELSE started_at END,
    completed_at = CASE WHEN _status='completed' THEN now() ELSE completed_at END
  WHERE id = _booking_id;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by) VALUES (_booking_id, v_old, _status, auth.uid());
  IF _status = 'completed' THEN
    INSERT INTO public.driver_earnings(driver_id, trip_booking_id, amount) VALUES (v_driver, _booking_id, round(coalesce(v_fare,0) * 0.8, 2)) ON CONFLICT (trip_booking_id) DO NOTHING;
    IF v_vehicle IS NOT NULL THEN UPDATE public.vehicles SET status = 'available' WHERE id = v_vehicle; END IF;
    UPDATE public.business_requests SET status = 'completed', updated_at = now() WHERE id = (SELECT business_request_id FROM public.trip_bookings WHERE id = _booking_id);
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION private.trip_driver_card(_booking_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('driver_id', d.id, 'name', d.first_name || ' ' || left(d.last_name, 1) || '.',
    'phone', d.phone, 'rating', d.driver_rating, 'driver_code', d.driver_code, 'pickup_eta', b.pickup_eta,
    'vehicle_make', v.make, 'vehicle_model', v.model, 'vehicle_color', v.color, 'plate_number', v.plate_number)
  FROM public.trip_bookings b JOIN public.drivers d ON d.id = b.driver_id
  LEFT JOIN public.vehicles v ON v.id = b.vehicle_id
  WHERE b.id = _booking_id AND b.rider_user_id = auth.uid();
$function$;