CREATE OR REPLACE FUNCTION public.freight_route_instance_execute(_instance_id uuid, _event text, _reason text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_inst public.freight_route_instances;
  v_from text; v_to text; v_allowed text[];
  v_legs integer := 0;
  v_close jsonb;
  v_veh uuid; v_drv uuid;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage')
          OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  v_from := v_inst.status;

  v_to := CASE upper(_event)
    WHEN 'PICKUP'     THEN 'DISPATCHED'
    WHEN 'DEPART'     THEN 'DEPARTED'
    WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
    WHEN 'ARRIVE'     THEN 'ARRIVED'
    WHEN 'DELIVER'    THEN 'ARRIVED'
    WHEN 'COMPLETE'   THEN 'COMPLETED'
    ELSE NULL END;
  IF v_to IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_EVENT', 'detail', _event);
  END IF;

  -- Idempotent event stream: the same key never produces a second effect.
  IF NULLIF(_idempotency_key,'') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.freight_route_events
        WHERE route_instance_id = _instance_id
          AND metadata->>'idempotency_key' = _idempotency_key) THEN
    RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'replay', true,
      'status', v_inst.status);
  END IF;

  -- Adopt the truck and driver that dispatch actually reserved for this departure.
  IF v_inst.vehicle_id IS NULL OR v_inst.driver_id IS NULL THEN
    SELECT r.assigned_vehicle_id, r.assigned_driver_id INTO v_veh, v_drv
      FROM public.logistics_dispatch_requests r
     WHERE r.id = v_inst.dispatch_request_id
       AND r.status NOT IN ('CANCELLED')
       AND r.assigned_vehicle_id IS NOT NULL AND r.assigned_driver_id IS NOT NULL;
    IF v_veh IS NOT NULL THEN
      UPDATE public.freight_route_instances
         SET vehicle_id = COALESCE(vehicle_id, v_veh),
             driver_id = COALESCE(driver_id, v_drv), updated_at = now()
       WHERE id = _instance_id RETURNING * INTO v_inst;
    END IF;
  END IF;

  -- Ordered physical progression: no step may skip the one before it.
  v_allowed := CASE upper(_event)
    WHEN 'PICKUP'     THEN ARRAY['MANIFEST_LOCKED','MANIFEST_CLOSING','CAPACITY_RESERVED','DISPATCHED','DELAYED']
    WHEN 'DEPART'     THEN ARRAY['DISPATCHED','DELAYED']
    WHEN 'IN_TRANSIT' THEN ARRAY['DEPARTED','IN_TRANSIT','DELAYED']
    WHEN 'ARRIVE'     THEN ARRAY['IN_TRANSIT','DEPARTED','DELAYED']
    WHEN 'DELIVER'    THEN ARRAY['IN_TRANSIT','DEPARTED','ARRIVED','DELAYED']
    WHEN 'COMPLETE'   THEN ARRAY['ARRIVED']
    END;
  IF NOT (v_from = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('error', true, 'code', 'ILLEGAL_TRANSITION',
      'from_status', v_from, 'event', upper(_event), 'allowed_from', v_allowed);
  END IF;

  -- Capacity, locked manifest, and a real departure must exist before movement is recorded.
  IF upper(_event) IN ('PICKUP','DEPART') AND v_inst.vehicle_id IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_ASSIGNED_CAPACITY',
      'detail', 'No truck and driver are assigned to this departure.');
  END IF;
  IF upper(_event) IN ('DEPART','PICKUP') AND v_inst.manifest_locked_at IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'MANIFEST_NOT_LOCKED',
      'detail', 'The manifest must be locked before the truck moves.');
  END IF;
  IF upper(_event) IN ('IN_TRANSIT','ARRIVE','DELIVER') AND v_inst.actual_departure IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_DEPARTED',
      'detail', 'This departure has no recorded departure event.');
  END IF;
  IF upper(_event) = 'COMPLETE' AND v_inst.actual_arrival IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_ARRIVED',
      'detail', 'A departure cannot be completed before it has arrived.');
  END IF;

  UPDATE public.freight_route_instances SET
    status = v_to,
    actual_departure = CASE WHEN upper(_event) = 'DEPART' THEN COALESCE(actual_departure, now()) ELSE actual_departure END,
    actual_arrival   = CASE WHEN upper(_event) IN ('ARRIVE','DELIVER') THEN COALESCE(actual_arrival, now()) ELSE actual_arrival END,
    completed_at     = CASE WHEN upper(_event) = 'COMPLETE' THEN COALESCE(completed_at, now()) ELSE completed_at END,
    updated_at = now()
  WHERE id = _instance_id RETURNING * INTO v_inst;

  WITH touched AS (
    UPDATE public.logistics_order_legs l SET
      status = CASE upper(_event)
        WHEN 'PICKUP' THEN 'AT_PICKUP'
        WHEN 'DEPART' THEN 'DEPARTED'
        WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
        WHEN 'ARRIVE' THEN 'ARRIVED'
        WHEN 'DELIVER' THEN 'ARRIVED'
        WHEN 'COMPLETE' THEN 'COMPLETED'
        ELSE l.status END,
      vehicle_id = COALESCE(v_inst.vehicle_id, l.vehicle_id),
      driver_id = COALESCE(v_inst.driver_id, l.driver_id),
      actual_departure = CASE WHEN upper(_event) = 'DEPART' THEN COALESCE(l.actual_departure, now()) ELSE l.actual_departure END,
      actual_arrival = CASE WHEN upper(_event) IN ('ARRIVE','DELIVER','COMPLETE') THEN COALESCE(l.actual_arrival, now()) ELSE l.actual_arrival END,
      updated_at = now()
     WHERE l.id IN (
       SELECT DISTINCT ll.id
         FROM public.freight_route_allocations a
         JOIN public.logistics_order_legs ll ON ll.order_id = a.order_id
        WHERE a.route_instance_id = _instance_id AND a.status NOT IN ('RELEASED','CANCELLED'))
    RETURNING 1)
  SELECT count(*) INTO v_legs FROM touched;

  INSERT INTO public.freight_route_events (
    route_instance_id, route_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_instance_id, v_inst.route_id, 'EXECUTION_' || upper(_event), v_from, v_to, auth.uid(),
          'operations', _reason,
          jsonb_build_object('legs_synced', v_legs, 'vehicle_id', v_inst.vehicle_id,
                             'driver_id', v_inst.driver_id,
                             'idempotency_key', NULLIF(_idempotency_key,'')));

  IF upper(_event) = 'COMPLETE' THEN
    v_close := public.freight_route_revenue_close(_instance_id);
  END IF;

  RETURN jsonb_build_object('error', false, 'code', 'EXECUTED', 'event', upper(_event),
    'instance_code', v_inst.instance_code, 'from_status', v_from, 'status', v_inst.status,
    'legs_synced', v_legs, 'financial_closure', v_close);
END $function$;

REVOKE ALL ON FUNCTION public.freight_route_instance_execute(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_instance_execute(uuid, text, text, text) TO authenticated, service_role;