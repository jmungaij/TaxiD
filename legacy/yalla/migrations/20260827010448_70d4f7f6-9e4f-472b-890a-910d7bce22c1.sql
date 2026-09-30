-- The guard referenced trip_bookings.base_fare, which does not exist, so every
-- non-privileged UPDATE on trip_bookings raised 42703 — the driver trip
-- lifecycle could never advance. It also blanket-blocked status/driver_id
-- changes, including the ones made by the vetted trip engine RPCs.
CREATE OR REPLACE FUNCTION public.trip_bookings_guard_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
  v_engine boolean;
  v_cols text[] := ARRAY[]::text[];
BEGIN
  is_privileged := (
    auth.uid() IS NULL
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'finance_admin'::app_role)
  );
  IF is_privileged THEN
    RETURN NEW;
  END IF;

  -- Set transaction-locally by the vetted trip engine RPCs, which perform
  -- their own ownership and legal-transition checks.
  v_engine := COALESCE(current_setting('app.trip_engine', true), '') = 'on';

  IF NEW.total_fare IS DISTINCT FROM OLD.total_fare THEN v_cols := array_append(v_cols,'total_fare'); END IF;
  IF NEW.surge_multiplier IS DISTINCT FROM OLD.surge_multiplier THEN v_cols := array_append(v_cols,'surge_multiplier'); END IF;
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN v_cols := array_append(v_cols,'payment_method'); END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN v_cols := array_append(v_cols,'currency'); END IF;
  IF NEW.rider_user_id IS DISTINCT FROM OLD.rider_user_id THEN v_cols := array_append(v_cols,'rider_user_id'); END IF;
  IF NOT v_engine AND NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NOT v_engine AND NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN v_cols := array_append(v_cols,'driver_id'); END IF;

  IF array_length(v_cols,1) IS NOT NULL THEN
    INSERT INTO public.forbidden_update_attempts(actor_user_id, target_table, target_row_id, attempted_columns, reason)
    VALUES (auth.uid(), 'trip_bookings', NEW.id::text, v_cols, 'protected_field_modification');
    RAISE EXCEPTION 'Not allowed to modify financial or ownership fields on trip_bookings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

-- Mark the vetted engine RPCs.
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

  v_dist := round(COALESCE(v_cand.distance_km, 0)::numeric, 2);
  v_eta_min := GREATEST(2, CEIL(v_dist / 0.4)::int);

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
  PERFORM set_config('app.trip_engine', 'on', true);

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

  IF _to_status IN ('completed', 'cancelled') THEN
    UPDATE public.driver_locations
       SET is_available = true, updated_at = now()
     WHERE driver_id = v_driver_id AND is_online;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', _to_status);
END $$;

CREATE OR REPLACE FUNCTION public.trip_cancel_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text; v_owner uuid; v_driver uuid;
BEGIN
  PERFORM set_config('app.trip_engine', 'on', true);
  SELECT status, rider_user_id, driver_id INTO v_status, v_owner, v_driver
    FROM public.trip_bookings WHERE id = _booking_id;
  IF v_owner <> auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_status IN ('completed','cancelled') THEN RAISE EXCEPTION 'Cannot cancel %', v_status; END IF;
  UPDATE public.trip_bookings
     SET status='cancelled', cancelled_at = now(), cancellation_reason=_reason, cancelled_by='rider'
   WHERE id=_booking_id;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES (_booking_id, v_status, 'cancelled', auth.uid(), _reason);
  IF v_driver IS NOT NULL THEN
    UPDATE public.driver_locations SET is_available = true, updated_at = now()
     WHERE driver_id = v_driver AND is_online;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.trip_cancel_booking(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trip_cancel_booking(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.trip_cancel_booking(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.trip_assign_driver(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trip_assign_driver(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.trip_assign_driver(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.driver_advance_trip(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.driver_advance_trip(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_advance_trip(uuid, text, text) TO authenticated, service_role;