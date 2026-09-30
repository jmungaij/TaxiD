-- Booking stays open until the cut-off or the manifest lock; a matched truck no
-- longer freezes the departure.
CREATE OR REPLACE FUNCTION public.freight_route_instance_dispatch(_instance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  v_route public.freight_repeat_routes;
  v_req public.logistics_dispatch_requests;
  v_num text;
  v_match jsonb;
  v_cap numeric;
BEGIN
  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  SELECT * INTO v_route FROM public.freight_repeat_routes WHERE id = v_inst.route_id;

  IF v_inst.dispatch_request_id IS NOT NULL THEN
    -- Keep the truck requirement aligned with the consolidated load.
    UPDATE public.logistics_dispatch_requests
       SET required_payload_kg = GREATEST(v_inst.reserved_capacity_kg, 1),
           required_volume_cbm = v_inst.reserved_volume_cbm
     WHERE id = v_inst.dispatch_request_id;
    SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_inst.dispatch_request_id;

    IF v_req.assigned_vehicle_id IS NOT NULL THEN
      SELECT payload_capacity_kg INTO v_cap FROM public.logistics_fleet_capacity
       WHERE vehicle_id = v_req.assigned_vehicle_id;
      IF COALESCE(v_cap, 0) < v_inst.reserved_capacity_kg THEN
        INSERT INTO public.freight_route_exceptions (
          route_instance_id, route_id, exception_type, severity, detail, metadata, raised_by)
        SELECT _instance_id, v_inst.route_id, 'CAPACITY_SHORTFALL', 'HIGH',
               format('Assigned vehicle carries %s kg but %s kg is now allocated on %s; substitution required.',
                      v_cap, v_inst.reserved_capacity_kg, v_inst.instance_code),
               jsonb_build_object('vehicle_id', v_req.assigned_vehicle_id,
                                  'vehicle_capacity_kg', v_cap,
                                  'reserved_kg', v_inst.reserved_capacity_kg), auth.uid()
         WHERE NOT EXISTS (SELECT 1 FROM public.freight_route_exceptions e
                            WHERE e.route_instance_id = _instance_id
                              AND e.exception_type = 'CAPACITY_SHORTFALL'
                              AND e.status IN ('OPEN','ACKNOWLEDGED'));
      END IF;
    END IF;

    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_DISPATCHED',
      'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
      'status', v_req.status, 'matching_status', v_req.matching_status,
      'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id);
  END IF;

  v_num := 'DSP-' || to_char(now(), 'YYYYMM') || '-' ||
           upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.logistics_dispatch_requests (
    request_number, request_kind, route_instance_id, order_id, customer_id,
    origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
    pickup_window_start, pickup_window_end, vehicle_class,
    required_payload_kg, required_volume_cbm, priority, created_by)
  VALUES (
    v_num, 'ROUTE_INSTANCE', _instance_id, NULL,
    COALESCE(v_route.dedicated_customer_id, auth.uid()),
    v_route.origin_label, v_route.origin_lat, v_route.origin_lng,
    v_route.destination_label, v_route.destination_lat, v_route.destination_lng,
    v_inst.scheduled_departure, v_inst.scheduled_arrival,
    v_inst.vehicle_class,
    GREATEST(v_inst.reserved_capacity_kg, 1), v_inst.reserved_volume_cbm, 4, auth.uid())
  RETURNING * INTO v_req;

  UPDATE public.freight_route_instances SET dispatch_request_id = v_req.id WHERE id = _instance_id;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_req.id, 'DISPATCH_REQUESTED', 'REQUESTED', auth.uid(), 'system',
          'Dedicated route departure', jsonb_build_object('route_instance_id', _instance_id,
          'instance_code', v_inst.instance_code, 'route_code', v_route.route_code));

  IF v_route.vehicle_assignment_mode = 'DEDICATED' AND v_route.dedicated_vehicle_id IS NOT NULL THEN
    v_match := public.logistics_dispatch_override(
      v_req.id, v_route.dedicated_vehicle_id, v_route.dedicated_driver_id,
      format('Dedicated route %s committed vehicle assignment', v_route.route_code));
  ELSE
    v_match := public.logistics_dispatch_match(v_req.id, true);
  END IF;

  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_req.id;

  -- Record the assignment but LEAVE the departure open for consolidation.
  UPDATE public.freight_route_instances SET
    vehicle_id = v_req.assigned_vehicle_id,
    driver_id = v_req.assigned_driver_id
  WHERE id = _instance_id;

  IF v_req.assigned_vehicle_id IS NULL THEN
    INSERT INTO public.freight_route_exceptions (
      route_instance_id, route_id, exception_type, severity, detail, raised_by)
    VALUES (_instance_id, v_route.id, 'NO_CAPACITY_MATCHED', 'HIGH',
      format('No compliant %s capacity matched for departure %s.',
             v_inst.vehicle_class, v_inst.instance_code), auth.uid());
  END IF;

  RETURN jsonb_build_object('error', false, 'code',
    CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'CAPACITY_ASSIGNED' ELSE 'AWAITING_CAPACITY' END,
    'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
    'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id,
    'match', v_match);
END $$;

-- Manifest lock is what marks the departure dispatched.
CREATE OR REPLACE FUNCTION public.freight_route_manifest_close(
  _instance_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  v_lines jsonb;
  v_count integer;
  v_version integer;
  v_prev jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage')
     AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  IF v_inst.status IN ('CANCELLED','COMPLETED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_STATE', 'status', v_inst.status);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'allocation_code', a.allocation_code,
           'consignment_number', c.consignment_number,
           'order_number', o.order_number,
           'customer_id', a.customer_id,
           'weight_kg', a.allocated_weight_kg,
           'volume_cbm', a.allocated_volume_cbm,
           'pieces', a.pieces,
           'status', a.status) ORDER BY a.created_at), '[]'::jsonb), count(*)
    INTO v_lines, v_count
    FROM public.freight_route_allocations a
    JOIN public.delivery_orders o ON o.id = a.order_id
    LEFT JOIN public.freight_consignments c ON c.id = a.consignment_id
   WHERE a.route_instance_id = _instance_id AND a.status NOT IN ('RELEASED','CANCELLED');

  v_version := v_inst.manifest_version + 1;
  SELECT lines INTO v_prev FROM public.freight_route_manifests
   WHERE route_instance_id = _instance_id ORDER BY version DESC LIMIT 1;

  INSERT INTO public.freight_route_manifests (
    route_instance_id, version, reason, vehicle_id, driver_id,
    capacity_kg, booked_kg, available_kg, line_count, lines, changes, actor_id)
  VALUES (_instance_id, v_version,
          COALESCE(NULLIF(trim(_reason), ''),
                   CASE WHEN v_version = 1 THEN 'Booking cut-off reached; manifest locked'
                        ELSE 'Operational change after manifest lock' END),
          v_inst.vehicle_id, v_inst.driver_id,
          v_inst.planned_capacity_kg, v_inst.reserved_capacity_kg, v_inst.available_capacity_kg,
          v_count, v_lines,
          jsonb_build_object('previous_version', v_inst.manifest_version,
                             'previous_lines', COALESCE(v_prev, '[]'::jsonb)),
          auth.uid());

  UPDATE public.freight_route_instances SET
    manifest_version = v_version,
    manifest_locked_at = now(),
    status = CASE
      WHEN status IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED','MANIFEST_CLOSING')
        THEN CASE WHEN vehicle_id IS NOT NULL THEN 'DISPATCHED' ELSE 'MANIFEST_LOCKED' END
      ELSE status END
  WHERE id = _instance_id;

  UPDATE public.freight_route_allocations SET status = 'MANIFESTED'
   WHERE route_instance_id = _instance_id AND status = 'RESERVED';

  INSERT INTO public.freight_route_events (
    route_id, route_instance_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_inst.route_id, _instance_id, 'MANIFEST_LOCKED', v_inst.status, 'MANIFEST_LOCKED',
          auth.uid(), 'staff', _reason,
          jsonb_build_object('version', v_version, 'lines', v_count,
                             'booked_kg', v_inst.reserved_capacity_kg));

  RETURN jsonb_build_object('error', false, 'code', 'MANIFEST_LOCKED',
    'version', v_version, 'line_count', v_count,
    'booked_kg', v_inst.reserved_capacity_kg, 'available_kg', v_inst.available_capacity_kg);
END $$;