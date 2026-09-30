-- =====================================================================
-- Stage 1b — authoritative freight operations
-- =====================================================================

CREATE OR REPLACE FUNCTION public._freight_consignment_number()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'CNS-' || to_char(now(), 'YYYYMM') || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;
REVOKE ALL ON FUNCTION public._freight_consignment_number() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freight_consignment_create(
  _order_id uuid,
  _profile jsonb,
  _items jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_item jsonb;
  v_no integer := 0;
  v_weight numeric;
  v_volume numeric;
  v_chargeable numeric;
  v_existing uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF _order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.delivery_orders WHERE id = _order_id) THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;

  SELECT id INTO v_existing FROM public.freight_consignments WHERE order_id = _order_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'consignment_id', v_existing);
  END IF;

  v_weight := NULLIF(_profile->>'gross_weight_kg', '')::numeric;
  v_volume := NULLIF(_profile->>'volume_cbm', '')::numeric;

  -- Financial-integrity guard: never accept NaN / non-finite / non-positive weight.
  IF v_weight IS NULL OR v_weight <= 0 OR v_weight <> v_weight OR v_weight = 'Infinity'::numeric THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'gross_weight_kg');
  END IF;
  IF v_volume IS NOT NULL AND (v_volume < 0 OR v_volume <> v_volume) THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'volume_cbm');
  END IF;
  IF COALESCE(_profile->>'cargo_type', '') = '' THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'cargo_type');
  END IF;

  -- Chargeable weight = greater of gross and volumetric (1 cbm = 333 kg road freight).
  v_chargeable := GREATEST(v_weight, COALESCE(v_volume, 0) * 333);
  v_number := public._freight_consignment_number();

  INSERT INTO public.freight_consignments (
    order_id, consignment_number, service_level, cargo_type, commodity, package_type, pieces,
    gross_weight_kg, volume_cbm, chargeable_weight_kg, declared_value, currency,
    fragile, hazardous, hazard_class, temp_min_c, temp_max_c,
    loading_requirements, special_handling,
    shipper_name, shipper_phone, consignee_name, consignee_phone,
    origin_hub_id, destination_hub_id, delivery_address, delivery_lat, delivery_lng,
    delivery_window_start, delivery_window_end, notes, created_by
  ) VALUES (
    _order_id, v_number,
    COALESCE(NULLIF(_profile->>'service_level',''), 'STANDARD'),
    _profile->>'cargo_type',
    NULLIF(_profile->>'commodity',''),
    NULLIF(_profile->>'package_type',''),
    COALESCE(NULLIF(_profile->>'pieces','')::integer, 1),
    v_weight, v_volume, v_chargeable,
    NULLIF(_profile->>'declared_value','')::numeric,
    COALESCE(NULLIF(_profile->>'currency',''), 'KES'),
    COALESCE((_profile->>'fragile')::boolean, false),
    COALESCE((_profile->>'hazardous')::boolean, false),
    NULLIF(_profile->>'hazard_class',''),
    NULLIF(_profile->>'temp_min_c','')::numeric,
    NULLIF(_profile->>'temp_max_c','')::numeric,
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(_profile->'loading_requirements')), '{}'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(_profile->'special_handling')), '{}'),
    NULLIF(_profile->>'shipper_name',''), NULLIF(_profile->>'shipper_phone',''),
    NULLIF(_profile->>'consignee_name',''), NULLIF(_profile->>'consignee_phone',''),
    NULLIF(_profile->>'origin_hub_id','')::uuid, NULLIF(_profile->>'destination_hub_id','')::uuid,
    NULLIF(_profile->>'delivery_address',''),
    NULLIF(_profile->>'delivery_lat','')::numeric, NULLIF(_profile->>'delivery_lng','')::numeric,
    NULLIF(_profile->>'delivery_window_start','')::timestamptz,
    NULLIF(_profile->>'delivery_window_end','')::timestamptz,
    NULLIF(_profile->>'notes',''), auth.uid()
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    v_no := v_no + 1;
    INSERT INTO public.freight_consignment_items (
      consignment_id, item_no, description, handling_unit, quantity, unit_weight_kg,
      length_cm, width_cm, height_cm, volume_cbm, declared_value, hazardous,
      temperature_controlled, marks_and_numbers
    ) VALUES (
      v_id, v_no,
      COALESCE(NULLIF(v_item->>'description',''), 'Item ' || v_no),
      COALESCE(NULLIF(v_item->>'handling_unit',''), 'CARTON'),
      COALESCE(NULLIF(v_item->>'quantity','')::integer, 1),
      NULLIF(v_item->>'unit_weight_kg','')::numeric,
      NULLIF(v_item->>'length_cm','')::numeric,
      NULLIF(v_item->>'width_cm','')::numeric,
      NULLIF(v_item->>'height_cm','')::numeric,
      NULLIF(v_item->>'volume_cbm','')::numeric,
      NULLIF(v_item->>'declared_value','')::numeric,
      COALESCE((v_item->>'hazardous')::boolean, false),
      COALESCE((v_item->>'temperature_controlled')::boolean, false),
      NULLIF(v_item->>'marks_and_numbers','')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'error', false, 'code', 'CREATED',
    'consignment_id', v_id, 'consignment_number', v_number,
    'chargeable_weight_kg', v_chargeable, 'items', v_no
  );
END;
$$;

REVOKE ALL ON FUNCTION public.freight_consignment_create(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_consignment_create(uuid, jsonb, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freight_plan_legs(
  _order_id uuid,
  _legs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leg jsonb;
  v_no integer := 0;
  v_created integer := 0;
  v_id uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF _order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.delivery_orders WHERE id = _order_id) THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;
  IF _legs IS NULL OR jsonb_typeof(_legs) <> 'array' OR jsonb_array_length(_legs) = 0 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'legs');
  END IF;

  PERFORM 1 FROM public.delivery_orders WHERE id = _order_id FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.logistics_order_legs
    WHERE order_id = _order_id AND status NOT IN ('PLANNED','AWAITING_CAPACITY','CANCELLED')
  ) THEN
    RETURN jsonb_build_object('error', true, 'code', 'CONFLICT',
      'message', 'Legs already in execution cannot be replanned');
  END IF;

  DELETE FROM public.logistics_order_legs
  WHERE order_id = _order_id AND status IN ('PLANNED','AWAITING_CAPACITY');

  FOR v_leg IN SELECT * FROM jsonb_array_elements(_legs) LOOP
    v_no := v_no + 1;
    IF COALESCE(v_leg->>'origin_label','') = '' OR COALESCE(v_leg->>'destination_label','') = '' THEN
      RAISE EXCEPTION 'VALIDATION_ERROR: leg % missing origin or destination label', v_no;
    END IF;
    INSERT INTO public.logistics_order_legs (
      order_id, leg_no, leg_type, origin_kind, origin_hub_id, origin_label, origin_lat, origin_lng,
      destination_kind, destination_hub_id, destination_label, destination_lat, destination_lng,
      route_id, planned_departure, planned_arrival, planned_distance_km, correlation_id, created_by
    ) VALUES (
      _order_id, v_no,
      COALESCE(NULLIF(v_leg->>'leg_type',''), 'LINE_HAUL'),
      COALESCE(NULLIF(v_leg->>'origin_kind',''), 'ADDRESS'),
      NULLIF(v_leg->>'origin_hub_id','')::uuid,
      v_leg->>'origin_label',
      NULLIF(v_leg->>'origin_lat','')::numeric, NULLIF(v_leg->>'origin_lng','')::numeric,
      COALESCE(NULLIF(v_leg->>'destination_kind',''), 'ADDRESS'),
      NULLIF(v_leg->>'destination_hub_id','')::uuid,
      v_leg->>'destination_label',
      NULLIF(v_leg->>'destination_lat','')::numeric, NULLIF(v_leg->>'destination_lng','')::numeric,
      NULLIF(v_leg->>'route_id','')::uuid,
      NULLIF(v_leg->>'planned_departure','')::timestamptz,
      NULLIF(v_leg->>'planned_arrival','')::timestamptz,
      NULLIF(v_leg->>'planned_distance_km','')::numeric,
      NULLIF(v_leg->>'correlation_id',''), auth.uid()
    )
    RETURNING id INTO v_id;
    v_created := v_created + 1;

    INSERT INTO public.logistics_leg_events (
      leg_id, order_id, event_type, new_status, actor_id, actor_role, reason, metadata
    ) VALUES (
      v_id, _order_id, 'LEG_PLANNED', 'PLANNED', auth.uid(), 'staff', NULL,
      jsonb_build_object('leg_no', v_no, 'leg_type', COALESCE(NULLIF(v_leg->>'leg_type',''), 'LINE_HAUL'))
    );
  END LOOP;

  RETURN jsonb_build_object('error', false, 'code', 'PLANNED', 'legs', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.freight_plan_legs(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_plan_legs(uuid, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freight_leg_transition(
  _leg_id uuid,
  _to_status text,
  _reason text DEFAULT NULL,
  _hub_id uuid DEFAULT NULL,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leg public.logistics_order_legs;
  v_t public.logistics_leg_transitions;
  v_dedupe text;
  v_event uuid;
  v_all_done boolean;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = _leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;

  v_dedupe := COALESCE(NULLIF(_idempotency_key, ''), NULL);
  IF v_dedupe IS NOT NULL THEN
    SELECT id INTO v_event FROM public.logistics_leg_events WHERE dedupe_key = v_dedupe;
    IF v_event IS NOT NULL THEN
      RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'replay', true,
        'leg_id', v_leg.id, 'status', v_leg.status, 'event_id', v_event);
    END IF;
  END IF;

  IF v_leg.status = _to_status THEN
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_IN_TARGET_STATE',
      'leg_id', v_leg.id, 'status', v_leg.status);
  END IF;

  SELECT * INTO v_t FROM public.logistics_leg_transitions
  WHERE from_status = v_leg.status AND to_status = _to_status;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_TRANSITION',
      'from', v_leg.status, 'to', _to_status);
  END IF;
  IF v_t.requires_reason AND COALESCE(length(trim(_reason)), 0) < 5 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'reason');
  END IF;

  UPDATE public.logistics_order_legs SET
    status = _to_status,
    actual_departure = CASE WHEN _to_status = 'DEPARTED' AND actual_departure IS NULL THEN now() ELSE actual_departure END,
    actual_arrival   = CASE WHEN _to_status = 'ARRIVED' AND actual_arrival IS NULL THEN now() ELSE actual_arrival END,
    exception_open    = CASE WHEN _to_status = 'FAILED' THEN true
                             WHEN _to_status IN ('ASSIGNED','PLANNED','COMPLETED') THEN false
                             ELSE exception_open END
  WHERE id = _leg_id;

  INSERT INTO public.logistics_leg_events (
    leg_id, order_id, event_type, previous_status, new_status, actor_id, actor_role,
    hub_id, lat, lng, reason, dedupe_key
  ) VALUES (
    _leg_id, v_leg.order_id, v_t.event_name, v_leg.status, _to_status, auth.uid(), 'staff',
    _hub_id, _lat, _lng, NULLIF(trim(COALESCE(_reason, '')), ''), v_dedupe
  )
  RETURNING id INTO v_event;

  -- Project order-level operational status. Delivery/closure stays owned by the POD chain.
  IF _to_status IN ('DEPARTED','IN_TRANSIT') THEN
    UPDATE public.delivery_orders
    SET status = 'in_transit'
    WHERE id = v_leg.order_id AND status IN ('confirmed','dispatched');
  ELSIF _to_status = 'ASSIGNED' THEN
    UPDATE public.delivery_orders
    SET status = 'dispatched'
    WHERE id = v_leg.order_id AND status = 'confirmed';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.logistics_order_legs
    WHERE order_id = v_leg.order_id AND status NOT IN ('COMPLETED','CANCELLED')
  ) INTO v_all_done;

  RETURN jsonb_build_object(
    'error', false, 'code', 'TRANSITIONED',
    'leg_id', _leg_id, 'from', v_leg.status, 'to', _to_status,
    'event_id', v_event, 'event_type', v_t.event_name,
    'all_legs_complete', v_all_done
  );
END;
$$;

REVOKE ALL ON FUNCTION public.freight_leg_transition(uuid, text, text, uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_leg_transition(uuid, text, text, uuid, numeric, numeric, text) TO authenticated, service_role;