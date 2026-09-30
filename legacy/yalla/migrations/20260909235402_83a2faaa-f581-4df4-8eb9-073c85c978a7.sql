CREATE OR REPLACE FUNCTION public.assign_corporate_booking(
  _booking_id uuid,
  _driver_id uuid,
  _vehicle_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _b public.trip_bookings;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(_caller, 'admin') OR public.has_role(_caller, 'super_admin')) THEN
    RAISE EXCEPTION 'not authorised to dispatch corporate rides' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _b FROM public.trip_bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = '02000';
  END IF;
  IF coalesce(_b.intent,'') <> 'corporate' THEN
    RAISE EXCEPTION 'not a corporate booking' USING ERRCODE = '22023';
  END IF;
  IF _b.status NOT IN ('pending','scheduled','assigned') THEN
    RAISE EXCEPTION 'booking cannot be assigned in status %', _b.status USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id) THEN
    RAISE EXCEPTION 'driver not found' USING ERRCODE = '02000';
  END IF;

  UPDATE public.trip_bookings
     SET driver_id = _driver_id,
         vehicle_id = COALESCE(_vehicle_id, vehicle_id),
         status = 'assigned',
         updated_at = now()
   WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
  VALUES (_caller, 'admin', 'trip_booking', _booking_id, 'corporate_ride_assigned',
          jsonb_build_object('driver_id', _driver_id, 'vehicle_id', _vehicle_id));

  RETURN jsonb_build_object('booking_id', _booking_id, 'status', 'assigned', 'driver_id', _driver_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_corporate_booking_progress(
  _booking_id uuid,
  _status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _b public.trip_bookings;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(_caller, 'admin') OR public.has_role(_caller, 'super_admin')) THEN
    RAISE EXCEPTION 'not authorised to update corporate rides' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('in_progress','completed','cancelled') THEN
    RAISE EXCEPTION 'unsupported status %', _status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _b FROM public.trip_bookings WHERE id = _booking_id FOR UPDATE;
  IF _b.id IS NULL OR coalesce(_b.intent,'') <> 'corporate' THEN
    RAISE EXCEPTION 'corporate booking not found' USING ERRCODE = '02000';
  END IF;
  IF _b.status IN ('completed','cancelled') THEN
    RAISE EXCEPTION 'booking is already %', _b.status USING ERRCODE = '22023';
  END IF;
  IF _status = 'in_progress' AND _b.driver_id IS NULL THEN
    RAISE EXCEPTION 'assign a driver before starting the trip' USING ERRCODE = '22023';
  END IF;
  IF _status = 'completed' AND _b.driver_id IS NULL THEN
    RAISE EXCEPTION 'assign a driver before completing the trip' USING ERRCODE = '22023';
  END IF;

  UPDATE public.trip_bookings
     SET status = _status,
         started_at = CASE WHEN _status = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
         completed_at = CASE WHEN _status = 'completed' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN _status = 'cancelled' THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN _status = 'cancelled' THEN _caller ELSE cancelled_by END,
         updated_at = now()
   WHERE id = _booking_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
  VALUES (_caller, 'admin', 'trip_booking', _booking_id, 'corporate_ride_' || _status,
          jsonb_build_object('status', _status));

  RETURN jsonb_build_object('booking_id', _booking_id, 'status', _status);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_corporate_booking(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_corporate_booking_progress(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_corporate_booking(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_corporate_booking_progress(uuid, text) TO authenticated;