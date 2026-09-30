CREATE OR REPLACE FUNCTION public.logistics_dispatch_cancel(
  _request_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.logistics_dispatch_requests;
  v_released integer := 0;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage')
          OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN
    RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'REQUEST_NOT_FOUND'); END IF;
  IF v_req.status IN ('CANCELLED','COMPLETED') THEN
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_CLOSED', 'idempotent', true,
      'status', v_req.status);
  END IF;
  IF v_req.status IN ('LOADING','LOADED','IN_TRANSIT') THEN
    RETURN jsonb_build_object('error', true, 'code', 'MOVEMENT_IN_PROGRESS',
      'detail', 'This movement is already under way — resolve it operationally instead.');
  END IF;

  WITH freed AS (
    UPDATE public.logistics_capacity_reservations
       SET status = 'RELEASED', released_at = now(), release_reason = _reason
     WHERE dispatch_request_id = _request_id AND status = 'ACTIVE'
    RETURNING vehicle_id)
  SELECT count(*) INTO v_released FROM freed;

  UPDATE public.logistics_fleet_capacity SET capability_status = 'AVAILABLE', updated_at = now()
   WHERE vehicle_id = v_req.assigned_vehicle_id
     AND NOT EXISTS (SELECT 1 FROM public.logistics_capacity_reservations r
                      WHERE r.vehicle_id = v_req.assigned_vehicle_id AND r.status = 'ACTIVE');

  UPDATE public.logistics_dispatch_requests SET
    status = 'CANCELLED', matching_status = 'CANCELLED',
    assigned_vehicle_id = NULL, assigned_driver_id = NULL, reservation_id = NULL,
    last_failure_code = 'CANCELLED', last_failure_message = _reason, updated_at = now()
  WHERE id = _request_id;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_request_id, 'DISPATCH_CANCELLED', v_req.status, 'CANCELLED', auth.uid(), 'operations',
          _reason, jsonb_build_object('reservations_released', v_released));

  RETURN jsonb_build_object('error', false, 'code', 'CANCELLED',
    'request_number', v_req.request_number, 'reservations_released', v_released);
END $$;

REVOKE ALL ON FUNCTION public.logistics_dispatch_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_dispatch_cancel(uuid, text) TO authenticated, service_role;