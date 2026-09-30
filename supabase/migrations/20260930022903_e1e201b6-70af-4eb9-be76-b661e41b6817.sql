-- Role helpers: callers may only check their own roles (staff and backend services may check anyone).
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
     AND (auth.uid() IS NULL OR _user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.user_roles s WHERE s.user_id = auth.uid() AND s.role IN ('admin','super_admin','support')))
$$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
     AND (auth.uid() IS NULL OR _user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.user_roles s WHERE s.user_id = auth.uid() AND s.role IN ('admin','super_admin','support')))
$$;

-- SOS: only for the caller's own trip (as rider or driver), or no trip.
CREATE OR REPLACE FUNCTION public.safety_raise_sos(_booking_id uuid, _lat numeric, _lng numeric, _message text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.trip_bookings b LEFT JOIN public.drivers d ON d.id = b.driver_id
    WHERE b.id = _booking_id AND (b.rider_user_id = auth.uid() OR d.user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF _message IS NOT NULL AND char_length(_message) > 2000 THEN RAISE EXCEPTION 'Message too long'; END IF;
  INSERT INTO public.safety_alerts(user_id, trip_booking_id, alert_type, lat, lng, message, status)
  VALUES(auth.uid(), _booking_id, 'sos', _lat, _lng, _message, 'active') RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Drivers must be verified before accepting trips.
CREATE OR REPLACE FUNCTION public.driver_accept_trip(_booking_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_driver uuid; v_vehicle uuid; v_status text; v_rider uuid;
BEGIN
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid() AND verification_status IN ('verified','approved');
  IF v_driver IS NULL THEN RAISE EXCEPTION 'Only verified drivers can accept trips'; END IF;
  SELECT id INTO v_vehicle FROM public.vehicles WHERE driver_id = v_driver ORDER BY (status='available') DESC, created_at LIMIT 1;
  SELECT status, rider_user_id INTO v_status, v_rider FROM public.trip_bookings WHERE id = _booking_id AND driver_id IS NULL FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('pending','scheduled') THEN RAISE EXCEPTION 'Trip is no longer available'; END IF;
  IF v_rider = auth.uid() THEN RAISE EXCEPTION 'Drivers cannot accept their own trips'; END IF;
  UPDATE public.trip_bookings SET driver_id = v_driver, vehicle_id = v_vehicle, status = 'accepted' WHERE id = _booking_id;
  IF v_vehicle IS NOT NULL THEN UPDATE public.vehicles SET status = 'on_trip' WHERE id = v_vehicle; END IF;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason) VALUES (_booking_id, v_status, 'accepted', auth.uid(), 'Driver accepted');
END $$;

-- Fare quotes: reject implausible client-supplied distances/durations.
CREATE OR REPLACE FUNCTION public.trip_quote_fare(_request_id uuid, _distance_km numeric, _duration_min integer)
 RETURNS TABLE(quote_id uuid, total numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_rt public.ride_types%ROWTYPE; v_req public.trip_requests%ROWTYPE;
  v_base numeric; v_dist numeric; v_time numeric; v_surge numeric := 1.0; v_total numeric; v_quote_id uuid;
BEGIN
  IF _distance_km IS NULL OR _duration_min IS NULL OR _distance_km < 0 OR _distance_km > 2000 OR _duration_min < 0 OR _duration_min > 2880 THEN
    RAISE EXCEPTION 'Invalid distance or duration';
  END IF;
  SELECT * INTO v_req FROM public.trip_requests WHERE id = _request_id AND rider_user_id = auth.uid();
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Trip request not found'; END IF;
  SELECT * INTO v_rt FROM public.ride_types WHERE id = v_req.ride_type_id AND is_active = true;
  IF v_rt.id IS NULL THEN RAISE EXCEPTION 'Invalid ride type'; END IF;
  v_base := v_rt.base_fare; v_dist := _distance_km * v_rt.per_km_rate; v_time := _duration_min * v_rt.per_minute_rate;
  v_total := GREATEST(v_rt.minimum_fare, (v_base + v_dist + v_time) * v_surge);
  INSERT INTO public.trip_quotes(trip_request_id, ride_type_id, distance_km, duration_min, base_fare, distance_fare, time_fare, surge_multiplier, total_fare)
  VALUES(_request_id, v_rt.id, _distance_km, _duration_min, v_base, v_dist, v_time, v_surge, v_total) RETURNING id INTO v_quote_id;
  UPDATE public.trip_requests SET estimated_fare = v_total, estimated_distance_km = _distance_km, estimated_duration_min = _duration_min WHERE id = _request_id;
  RETURN QUERY SELECT v_quote_id, v_total;
END $$;

-- Defence in depth: nobody signed-out, and no default PUBLIC access, on any protected routine.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;
-- Internal-only routines (triggers, wallet balance changes): not callable by signed-in users.
REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid,bigint), public.debit_wallet(uuid,bigint),
  public.add_business_owner_membership(), public.auto_assign_support_thread(), public.guard_rider_support_insert(),
  public.guard_rider_thread_update(), public.log_support_assignment(), public.touch_support_thread() FROM authenticated;
-- App actions signed-in users are meant to call (each checks identity and role inside).
GRANT EXECUTE ON FUNCTION public.has_role(uuid,app_role), public.has_any_role(uuid,app_role[]),
  public.admin_assign_business_request(uuid,uuid,numeric), public.admin_assign_role(uuid,app_role),
  public.admin_review_business_organisation(uuid,text), public.admin_revoke_role(uuid,app_role),
  public.admin_update_business_request(uuid,text,text), public.driver_accept_trip(uuid),
  public.driver_set_vehicle_status(uuid,text), public.driver_update_trip_status(uuid,text),
  public.ensure_rider_account(), public.list_support_agents(), public.safety_raise_sos(uuid,numeric,numeric,text),
  public.trip_assign_driver(uuid), public.trip_cancel_booking(uuid,text),
  public.trip_confirm_booking(uuid,text,timestamptz), public.trip_driver_card(uuid),
  public.trip_quote_fare(uuid,numeric,integer) TO authenticated;