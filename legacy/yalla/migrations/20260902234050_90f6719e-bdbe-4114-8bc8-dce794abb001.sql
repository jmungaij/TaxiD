CREATE OR REPLACE FUNCTION public.freight_hub_outbound_prepare(
  _hub_id uuid, _next_leg_id uuid, _route_instance_id uuid DEFAULT NULL,
  _vehicle_class text DEFAULT 'TRUCK_7T')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_leg public.logistics_order_legs;
  v_man public.freight_outbound_manifests;
  v_units integer; v_weight numeric; v_volume numeric;
  v_req public.logistics_dispatch_requests;
  v_num text;
  v_match jsonb;
  v_dispatch jsonb;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF NOT FOUND OR upper(v_hub.status) <> 'ACTIVE' THEN
    RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_ACTIVE');
  END IF;
  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = _next_leg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NEXT_LEG_NOT_FOUND'); END IF;
  IF v_leg.origin_hub_id IS DISTINCT FROM _hub_id THEN
    RETURN jsonb_build_object('error', true, 'code', 'WRONG_DESTINATION',
      'detail', 'The outbound leg does not originate at this hub.');
  END IF;

  SELECT * INTO v_man FROM public.freight_outbound_manifests
   WHERE next_leg_id = _next_leg_id AND status NOT IN ('CANCELLED','DEPARTED')
   ORDER BY created_at DESC LIMIT 1;

  SELECT count(*), COALESCE(sum(u.weight_kg),0), COALESCE(sum(u.volume_cbm),0)
    INTO v_units, v_weight, v_volume
    FROM public.freight_hub_allocations a
    JOIN public.freight_handling_units u ON u.id = a.handling_unit_id
   WHERE a.next_leg_id = _next_leg_id AND a.status IN ('ALLOCATED','STAGED','MANIFESTED');

  IF v_units = 0 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_ALLOCATED_CARGO');
  END IF;

  IF v_man.id IS NULL THEN
    INSERT INTO public.freight_outbound_manifests (
      manifest_number, hub_id, next_leg_id, route_instance_id, destination_label,
      planned_units, planned_weight_kg, planned_volume_cbm, created_by)
    VALUES (
      'OMF-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
      _hub_id, _next_leg_id, _route_instance_id, v_leg.destination_label,
      v_units, v_weight, v_volume, auth.uid())
    RETURNING * INTO v_man;
  ELSE
    UPDATE public.freight_outbound_manifests SET
      planned_units = v_units, planned_weight_kg = v_weight, planned_volume_cbm = v_volume,
      route_instance_id = COALESCE(_route_instance_id, route_instance_id)
    WHERE id = v_man.id RETURNING * INTO v_man;
  END IF;

  INSERT INTO public.freight_outbound_manifest_lines (
    manifest_id, handling_unit_id, allocation_id, consignment_id, planned)
  SELECT v_man.id, a.handling_unit_id, a.id, a.consignment_id, true
    FROM public.freight_hub_allocations a
   WHERE a.next_leg_id = _next_leg_id AND a.status IN ('ALLOCATED','STAGED','MANIFESTED')
  ON CONFLICT (manifest_id, handling_unit_id) DO NOTHING;

  UPDATE public.freight_hub_allocations SET status = 'MANIFESTED', manifest_id = v_man.id
   WHERE next_leg_id = _next_leg_id AND status IN ('ALLOCATED','STAGED');

  IF _route_instance_id IS NOT NULL THEN
    v_dispatch := public.freight_route_instance_dispatch(_route_instance_id);
    SELECT * INTO v_req FROM public.logistics_dispatch_requests
     WHERE id = (v_dispatch->>'dispatch_request_id')::uuid;
  ELSE
    SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE leg_id = _next_leg_id
     AND status NOT IN ('CANCELLED','COMPLETED') ORDER BY created_at DESC LIMIT 1;

    IF v_req.id IS NULL THEN
      v_num := 'DSP-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
      INSERT INTO public.logistics_dispatch_requests (
        request_number, request_kind, order_id, leg_id, customer_id,
        origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
        pickup_window_start, pickup_window_end, vehicle_class,
        required_payload_kg, required_volume_cbm, priority, created_by)
      SELECT v_num, 'AD_HOC', v_leg.order_id, _next_leg_id,
             COALESCE((SELECT o.customer_id FROM public.delivery_orders o WHERE o.id = v_leg.order_id), auth.uid()),
             COALESCE(v_leg.origin_label, v_hub.name), COALESCE(v_leg.origin_lat, v_hub.lat),
             COALESCE(v_leg.origin_lng, v_hub.lng),
             v_leg.destination_label, v_leg.destination_lat, v_leg.destination_lng,
             COALESCE(v_leg.planned_departure, now()), v_leg.planned_arrival,
             COALESCE(_vehicle_class, 'TRUCK_7T'),
             GREATEST(v_weight, 1), v_volume, 4, auth.uid()
      RETURNING * INTO v_req;

      INSERT INTO public.logistics_dispatch_events (
        dispatch_request_id, event_type, new_status, actor_id, actor_role, reason, metadata)
      VALUES (v_req.id, 'DISPATCH_REQUESTED', 'REQUESTED', auth.uid(), 'hub_operator',
        'Hub outbound connection', jsonb_build_object('hub_id', _hub_id, 'manifest_id', v_man.id));
    ELSE
      -- Align an existing request with the CURRENT manifested load and hub origin.
      UPDATE public.logistics_dispatch_requests SET
        vehicle_class = COALESCE(_vehicle_class, vehicle_class),
        required_payload_kg = GREATEST(v_weight, 1),
        required_volume_cbm = v_volume,
        origin_label = COALESCE(v_leg.origin_label, v_hub.name),
        origin_lat = COALESCE(v_leg.origin_lat, v_hub.lat),
        origin_lng = COALESCE(v_leg.origin_lng, v_hub.lng),
        destination_label = v_leg.destination_label,
        destination_lat = COALESCE(v_leg.destination_lat, destination_lat),
        destination_lng = COALESCE(v_leg.destination_lng, destination_lng),
        pickup_window_start = COALESCE(v_leg.planned_departure, pickup_window_start, now()),
        pickup_window_end = COALESCE(v_leg.planned_arrival, pickup_window_end),
        updated_at = now()
      WHERE id = v_req.id RETURNING * INTO v_req;

      INSERT INTO public.logistics_dispatch_events (
        dispatch_request_id, event_type, new_status, actor_id, actor_role, reason, metadata)
      VALUES (v_req.id, 'REQUIREMENT_UPDATED', v_req.status, auth.uid(), 'hub_operator',
        'Outbound requirement aligned to hub manifest',
        jsonb_build_object('hub_id', _hub_id, 'manifest_id', v_man.id,
                           'required_payload_kg', GREATEST(v_weight,1),
                           'vehicle_class', COALESCE(_vehicle_class, v_req.vehicle_class)));
    END IF;

    v_match := public.logistics_dispatch_match(v_req.id, true);
    SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_req.id;
    v_dispatch := jsonb_build_object('match', v_match);
  END IF;

  UPDATE public.freight_outbound_manifests SET
    dispatch_request_id = v_req.id, vehicle_id = v_req.assigned_vehicle_id,
    driver_id = v_req.assigned_driver_id,
    status = CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'VERIFYING' ELSE 'DRAFT' END
  WHERE id = v_man.id RETURNING * INTO v_man;

  IF v_req.assigned_vehicle_id IS NULL THEN
    PERFORM public.freight_hub_exception_raise(_hub_id, 'NO_OUTBOUND_CAPACITY', 'P1',
      format('No compliant outbound capacity matched for manifest %s.', v_man.manifest_number),
      NULL, NULL, _next_leg_id, v_man.id, COALESCE(v_dispatch, '{}'::jsonb));
  ELSE
    UPDATE public.logistics_order_legs SET
      status = CASE WHEN status IN ('PLANNED','AWAITING_CAPACITY') THEN 'ASSIGNED' ELSE status END,
      vehicle_id = v_req.assigned_vehicle_id, driver_id = v_req.assigned_driver_id,
      updated_at = now()
    WHERE id = _next_leg_id;
  END IF;

  RETURN jsonb_build_object('error', false,
    'code', CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'MANIFEST_READY' ELSE 'AWAITING_CAPACITY' END,
    'manifest_id', v_man.id, 'manifest_number', v_man.manifest_number,
    'planned_units', v_units, 'planned_weight_kg', v_weight, 'planned_volume_cbm', v_volume,
    'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
    'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id,
    'capacity_source', CASE WHEN _route_instance_id IS NOT NULL THEN 'REPEAT_ROUTE' ELSE 'AD_HOC_MATCH' END,
    'dispatch', v_dispatch);
END $$;