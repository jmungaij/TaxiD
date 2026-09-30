-- =========================================================
-- PHASE 6 PART 2 — WAREHOUSE EXECUTION WORKFLOWS
-- Every workflow writes to the EXISTING authorities:
--   packages / logistics_manifests(+lines,+events) / logistics_hubs /
--   package_chain_of_custody (via logistics_hub_process_package and
--   _logistics_record_custody) / logistics_routes(+stops,+stop_packages) /
--   logistics_returns / logistics_event_catalogue stream.
-- =========================================================

CREATE SEQUENCE IF NOT EXISTS public.logistics_pick_list_seq;

-- ---------- internal helper: authorisation ----------
CREATE OR REPLACE FUNCTION public._wh_require(_perm text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN; END IF;
  IF NOT public.logistics_ops_actor_authorised(_perm) THEN
    RAISE EXCEPTION 'not_authorised:%', _perm USING ERRCODE = '42501';
  END IF;
END; $$;

-- ---------- internal helper: idempotent operation ledger write ----------
CREATE OR REPLACE FUNCTION public._wh_log(
  _operation_key text, _operation_type text, _hub_id uuid, _package_id uuid,
  _payload jsonb DEFAULT '{}'::jsonb, _manifest_id uuid DEFAULT NULL,
  _route_id uuid DEFAULT NULL, _stop_id uuid DEFAULT NULL,
  _custody_event_id uuid DEFAULT NULL, _from_location uuid DEFAULT NULL,
  _to_location uuid DEFAULT NULL, _from_stage text DEFAULT NULL,
  _to_stage text DEFAULT NULL, _reason_code text DEFAULT NULL,
  _narrative text DEFAULT NULL, _device_id text DEFAULT NULL,
  _billable_code text DEFAULT NULL, _order_id uuid DEFAULT NULL,
  _return_id uuid DEFAULT NULL)
RETURNS public.logistics_wh_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_wh_operations;
BEGIN
  INSERT INTO public.logistics_wh_operations (
    operation_key, operation_type, hub_id, package_id, order_id, manifest_id,
    route_id, stop_id, return_id, from_location_id, to_location_id,
    custody_event_id, from_stage, to_stage, reason_code, narrative,
    device_id, billable_code, actor_id, payload)
  VALUES (_operation_key, _operation_type, _hub_id, _package_id, _order_id, _manifest_id,
    _route_id, _stop_id, _return_id, _from_location, _to_location,
    _custody_event_id, _from_stage, _to_stage, _reason_code, _narrative,
    _device_id, _billable_code, auth.uid(), coalesce(_payload,'{}'::jsonb))
  ON CONFLICT (operation_key) DO NOTHING
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    SELECT * INTO v FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
  END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public._wh_seen(_operation_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.logistics_wh_operations WHERE operation_key = _operation_key);
$$;

CREATE OR REPLACE FUNCTION public._wh_emit(_event_type text, _package_id uuid, _payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.logistics_event_emit_internal(
    _event_type := _event_type, _aggregate_type := 'package',
    _aggregate_id := _package_id, _payload := coalesce(_payload,'{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  NULL; -- event fan-out must never break a physical operation
END; $$;

-- helper: last custody event for a package
CREATE OR REPLACE FUNCTION public._wh_last_custody(_package_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.package_chain_of_custody
   WHERE package_id = _package_id ORDER BY occurred_at DESC, created_at DESC LIMIT 1;
$$;

-- =========================================================
-- CONFIGURATION
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_zone_upsert(
  _id uuid, _hub_id uuid, _code text, _name text, _zone_type text,
  _status text DEFAULT 'ACTIVE', _temperature_min_c numeric DEFAULT NULL,
  _temperature_max_c numeric DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS public.logistics_hub_zones
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_hub_zones;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _id IS NULL THEN
    INSERT INTO public.logistics_hub_zones (hub_id, code, name, zone_type, status,
      temperature_min_c, temperature_max_c, notes, created_by)
    VALUES (_hub_id, upper(trim(_code)), _name, _zone_type, coalesce(_status,'ACTIVE'),
      _temperature_min_c, _temperature_max_c, _notes, auth.uid())
    RETURNING * INTO v;
  ELSE
    UPDATE public.logistics_hub_zones SET
      code = upper(trim(_code)), name = _name, zone_type = _zone_type,
      status = coalesce(_status, status), temperature_min_c = _temperature_min_c,
      temperature_max_c = _temperature_max_c, notes = _notes
    WHERE id = _id RETURNING * INTO v;
    IF v.id IS NULL THEN RAISE EXCEPTION 'zone_not_found'; END IF;
  END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.wh_location_upsert(
  _id uuid, _hub_id uuid, _zone_id uuid, _code text, _location_type text,
  _aisle text DEFAULT NULL, _rack text DEFAULT NULL, _shelf text DEFAULT NULL,
  _bin text DEFAULT NULL, _status text DEFAULT 'ACTIVE',
  _max_units integer DEFAULT NULL, _max_weight_kg numeric DEFAULT NULL)
RETURNS public.logistics_hub_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_hub_locations;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _zone_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.logistics_hub_zones z WHERE z.id = _zone_id AND z.hub_id = _hub_id) THEN
    RAISE EXCEPTION 'zone_hub_mismatch';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.logistics_hub_locations (hub_id, zone_id, code, location_type,
      aisle, rack, shelf, bin, status, max_units, max_weight_kg, created_by)
    VALUES (_hub_id, _zone_id, upper(trim(_code)), _location_type, _aisle, _rack, _shelf, _bin,
      coalesce(_status,'ACTIVE'), _max_units, _max_weight_kg, auth.uid())
    RETURNING * INTO v;
  ELSE
    UPDATE public.logistics_hub_locations SET
      zone_id = _zone_id, code = upper(trim(_code)), location_type = _location_type,
      aisle = _aisle, rack = _rack, shelf = _shelf, bin = _bin,
      status = coalesce(_status, status), max_units = _max_units, max_weight_kg = _max_weight_kg
    WHERE id = _id RETURNING * INTO v;
    IF v.id IS NULL THEN RAISE EXCEPTION 'location_not_found'; END IF;
  END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.wh_location_set_status(_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS public.logistics_hub_locations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_hub_locations;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  UPDATE public.logistics_hub_locations
     SET status = _status, notes = coalesce(_reason, notes)
   WHERE id = _id RETURNING * INTO v;
  IF v.id IS NULL THEN RAISE EXCEPTION 'location_not_found'; END IF;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.wh_dock_upsert(
  _id uuid, _hub_id uuid, _code text, _dock_type text DEFAULT 'BOTH',
  _status text DEFAULT 'AVAILABLE', _max_vehicle_length_m numeric DEFAULT NULL)
RETURNS public.logistics_hub_docks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_hub_docks;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _id IS NULL THEN
    INSERT INTO public.logistics_hub_docks (hub_id, code, dock_type, status, max_vehicle_length_m)
    VALUES (_hub_id, upper(trim(_code)), coalesce(_dock_type,'BOTH'), coalesce(_status,'AVAILABLE'), _max_vehicle_length_m)
    RETURNING * INTO v;
  ELSE
    UPDATE public.logistics_hub_docks SET code = upper(trim(_code)),
      dock_type = coalesce(_dock_type, dock_type), status = coalesce(_status, status),
      max_vehicle_length_m = _max_vehicle_length_m
    WHERE id = _id RETURNING * INTO v;
    IF v.id IS NULL THEN RAISE EXCEPTION 'dock_not_found'; END IF;
  END IF;
  RETURN v;
END; $$;

-- =========================================================
-- GATE  →  RECEIVING SESSION
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_gate_event(
  _hub_id uuid, _direction text, _operation_key text,
  _manifest_id uuid DEFAULT NULL, _carrier_id uuid DEFAULT NULL,
  _vehicle_id uuid DEFAULT NULL, _driver_id uuid DEFAULT NULL,
  _vehicle_registration text DEFAULT NULL, _dock_id uuid DEFAULT NULL,
  _seal_id text DEFAULT NULL, _seal_intact boolean DEFAULT NULL,
  _declared_package_count integer DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_gate public.logistics_gate_events;
  v_session public.logistics_receiving_sessions;
  v_expected integer := 0;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _direction NOT IN ('ARRIVAL','DEPARTURE') THEN RAISE EXCEPTION 'invalid_direction'; END IF;
  IF _operation_key IS NULL THEN RAISE EXCEPTION 'operation_key_required'; END IF;

  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF v_hub.id IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;
  IF v_hub.status <> 'active' THEN RAISE EXCEPTION 'hub_not_active'; END IF;
  IF _direction = 'ARRIVAL' AND NOT ('gate' = ANY (v_hub.capabilities) OR 'receiving' = ANY (v_hub.capabilities)) THEN
    RAISE EXCEPTION 'hub_lacks_capability_receiving';
  END IF;

  SELECT * INTO v_gate FROM public.logistics_gate_events WHERE operation_key = _operation_key;
  IF v_gate.id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.logistics_receiving_sessions WHERE gate_event_id = v_gate.id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'gate_event_id', v_gate.id,
                              'session_id', v_session.id);
  END IF;

  IF _manifest_id IS NOT NULL THEN
    SELECT count(*) INTO v_expected FROM public.logistics_manifest_lines WHERE manifest_id = _manifest_id;
  END IF;

  INSERT INTO public.logistics_gate_events (
    hub_id, direction, manifest_id, carrier_id, vehicle_id, driver_id,
    vehicle_registration, dock_id, seal_id, seal_intact,
    expected_package_count, declared_package_count, operation_key, actor_id, notes)
  VALUES (_hub_id, _direction, _manifest_id, _carrier_id, _vehicle_id, _driver_id,
    _vehicle_registration, _dock_id, _seal_id, _seal_intact,
    v_expected, _declared_package_count, _operation_key, auth.uid(), _notes)
  RETURNING * INTO v_gate;

  IF _dock_id IS NOT NULL THEN
    UPDATE public.logistics_hub_docks
       SET status = CASE WHEN _direction = 'ARRIVAL' THEN 'OCCUPIED' ELSE 'AVAILABLE' END
     WHERE id = _dock_id AND hub_id = _hub_id;
  END IF;

  IF _direction = 'ARRIVAL' AND _manifest_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.logistics_receiving_sessions
     WHERE manifest_id = _manifest_id AND status = 'OPEN';
    IF v_session.id IS NULL THEN
      INSERT INTO public.logistics_receiving_sessions (hub_id, manifest_id, gate_event_id,
        expected_count, operator_id)
      VALUES (_hub_id, _manifest_id, v_gate.id, v_expected, auth.uid())
      RETURNING * INTO v_session;
    END IF;
    IF _seal_intact IS FALSE THEN
      UPDATE public.logistics_receiving_sessions
         SET variance_note = concat_ws(' | ', variance_note, 'SEAL_BROKEN at gate')
       WHERE id = v_session.id;
    END IF;
  END IF;

  PERFORM public._wh_log(_operation_key,
    CASE WHEN _direction = 'ARRIVAL' THEN 'GATE_ARRIVAL' ELSE 'GATE_DEPARTURE' END,
    _hub_id, NULL,
    jsonb_build_object('gate_event_id', v_gate.id, 'carrier_id', _carrier_id,
                       'vehicle_id', _vehicle_id, 'driver_id', _driver_id,
                       'seal_id', _seal_id, 'seal_intact', _seal_intact,
                       'dock_id', _dock_id),
    _manifest_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, _notes, NULL, NULL, NULL, NULL);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'gate_event_id', v_gate.id,
                            'session_id', v_session.id, 'expected_count', v_expected);
END; $$;

-- =========================================================
-- RECEIVE SCAN
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_receive_scan(
  _session_id uuid, _identifier text, _operation_key text,
  _condition text DEFAULT 'GOOD', _device_id text DEFAULT NULL,
  _location_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session public.logistics_receiving_sessions;
  v_pkg public.packages;
  v_scan jsonb;
  v_custody uuid;
  v_op public.logistics_wh_operations;
  v_scan_state text;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _operation_key IS NULL THEN RAISE EXCEPTION 'operation_key_required'; END IF;
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'package_id', v_op.package_id,
                              'operation_id', v_op.id);
  END IF;

  SELECT * INTO v_session FROM public.logistics_receiving_sessions WHERE id = _session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'receiving_session_not_found'; END IF;
  IF v_session.status <> 'OPEN' THEN RAISE EXCEPTION 'receiving_session_closed'; END IF;

  SELECT * INTO v_pkg FROM public.packages
   WHERE id::text = trim(_identifier) OR upper(tracking_number) = upper(trim(_identifier)) LIMIT 1;
  IF v_pkg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNKNOWN_PACKAGE',
                              'message', 'No package matches that identifier');
  END IF;

  v_scan_state := CASE WHEN _condition = 'DAMAGED' THEN 'damaged' ELSE 'received' END;

  IF v_session.manifest_id IS NOT NULL THEN
    v_scan := public.logistics_manifest_scan(v_session.manifest_id, v_pkg.tracking_number, v_scan_state, _note);
    IF NOT coalesce((v_scan->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', coalesce(v_scan->>'code','SCAN_FAILURE'),
                                'message', v_scan->>'message', 'package_id', v_pkg.id);
    END IF;
  END IF;

  -- authoritative hub stage + custody (existing spine)
  PERFORM public.logistics_hub_process_package(v_session.hub_id, v_pkg.id, 'received',
                                               v_session.manifest_id, _note);
  v_custody := public._wh_last_custody(v_pkg.id);

  INSERT INTO public.logistics_package_placement (package_id, hub_id, location_id, inventory_state)
  VALUES (v_pkg.id, v_session.hub_id, _location_id, 'on_hand')
  ON CONFLICT (package_id) DO UPDATE SET hub_id = EXCLUDED.hub_id,
    location_id = coalesce(EXCLUDED.location_id, public.logistics_package_placement.location_id),
    inventory_state = 'on_hand';

  UPDATE public.logistics_receiving_sessions
     SET received_count = received_count + 1,
         damaged_count = damaged_count + CASE WHEN _condition = 'DAMAGED' THEN 1 ELSE 0 END
   WHERE id = _session_id;

  v_op := public._wh_log(_operation_key, 'RECEIVE', v_session.hub_id, v_pkg.id,
    jsonb_build_object('session_id', _session_id, 'condition', _condition,
                       'tracking_number', v_pkg.tracking_number),
    v_session.manifest_id, NULL, NULL, v_custody, NULL, _location_id, NULL, 'received',
    CASE WHEN _condition = 'DAMAGED' THEN 'DAMAGED' ELSE NULL END, _note, _device_id, 'HANDLING_IN');

  PERFORM public._wh_emit('package.received', v_pkg.id,
    jsonb_build_object('package_id', v_pkg.id, 'hub_id', v_session.hub_id,
                       'manifest_id', v_session.manifest_id, 'custody_event_id', v_custody));

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'package_id', v_pkg.id,
                            'tracking_number', v_pkg.tracking_number,
                            'custody_event_id', v_custody, 'operation_id', v_op.id);
END; $$;

-- =========================================================
-- SORT
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_sort(
  _package_id uuid, _hub_id uuid, _operation_key text,
  _destination_hub_id uuid DEFAULT NULL, _route_id uuid DEFAULT NULL,
  _stop_id uuid DEFAULT NULL, _carrier_id uuid DEFAULT NULL,
  _service_level text DEFAULT NULL, _device_id text DEFAULT NULL,
  _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_custody uuid; v_op public.logistics_wh_operations;
  v_stop public.logistics_route_stops; v_prev record;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;
  IF _destination_hub_id IS NULL AND _route_id IS NULL AND _stop_id IS NULL AND _carrier_id IS NULL THEN
    RAISE EXCEPTION 'sort_destination_required';
  END IF;

  IF _stop_id IS NOT NULL THEN
    SELECT * INTO v_stop FROM public.logistics_route_stops WHERE id = _stop_id;
    IF v_stop.id IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
    IF _route_id IS NOT NULL AND v_stop.route_id <> _route_id THEN
      RAISE EXCEPTION 'stop_route_mismatch';
    END IF;
    _route_id := v_stop.route_id;
  END IF;

  -- a package may not be sorted into two incompatible outbound flows
  SELECT o.route_id, o.payload->>'destination_hub_id' AS dest INTO v_prev
    FROM public.logistics_wh_operations o
   WHERE o.package_id = _package_id AND o.operation_type = 'SORT'
   ORDER BY o.occurred_at DESC LIMIT 1;
  IF FOUND AND v_prev.route_id IS NOT NULL AND _route_id IS NOT NULL
     AND v_prev.route_id <> _route_id THEN
    RAISE EXCEPTION 'conflicting_outbound_flow:already_sorted_to_route_%', v_prev.route_id;
  END IF;

  PERFORM public.logistics_hub_process_package(_hub_id, _package_id, 'sorted', NULL, _note);
  v_custody := public._wh_last_custody(_package_id);

  v_op := public._wh_log(_operation_key, 'SORT', _hub_id, _package_id,
    jsonb_build_object('destination_hub_id', _destination_hub_id, 'carrier_id', _carrier_id,
                       'service_level', _service_level),
    NULL, _route_id, _stop_id, v_custody, NULL, NULL, 'received', 'sorted', NULL, _note,
    _device_id, 'HANDLING_SORT');

  PERFORM public._wh_emit('package.sorted', _package_id,
    jsonb_build_object('package_id', _package_id, 'hub_id', _hub_id,
                       'destination_hub_id', _destination_hub_id,
                       'route_id', _route_id, 'stop_id', _stop_id));

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id,
                            'custody_event_id', v_custody, 'route_id', _route_id);
END; $$;

-- =========================================================
-- PUT-AWAY / MOVE
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_put_away(
  _package_id uuid, _hub_id uuid, _location_id uuid, _operation_key text,
  _device_id text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loc public.logistics_hub_locations; v_custody uuid; v_from uuid;
  v_op public.logistics_wh_operations; v_used integer;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;

  SELECT * INTO v_loc FROM public.logistics_hub_locations WHERE id = _location_id FOR UPDATE;
  IF v_loc.id IS NULL THEN RAISE EXCEPTION 'location_not_found'; END IF;
  IF v_loc.hub_id <> _hub_id THEN RAISE EXCEPTION 'location_hub_mismatch'; END IF;
  IF v_loc.status <> 'ACTIVE' THEN RAISE EXCEPTION 'location_not_available:%', v_loc.status; END IF;
  IF v_loc.max_units IS NOT NULL THEN
    SELECT count(*) INTO v_used FROM public.logistics_package_placement
      WHERE location_id = _location_id AND package_id <> _package_id;
    IF v_used >= v_loc.max_units THEN
      UPDATE public.logistics_hub_locations SET status = 'FULL' WHERE id = _location_id;
      RAISE EXCEPTION 'location_full';
    END IF;
  END IF;

  SELECT location_id INTO v_from FROM public.logistics_package_placement WHERE package_id = _package_id;

  PERFORM public._logistics_record_custody(_package_id, 'handover'::custody_event_type,
    concat('Location ', v_loc.code), coalesce(_note, 'put_away'));
  v_custody := public._wh_last_custody(_package_id);

  INSERT INTO public.logistics_package_placement (package_id, hub_id, location_id, inventory_state)
  VALUES (_package_id, _hub_id, _location_id, 'on_hand')
  ON CONFLICT (package_id) DO UPDATE SET hub_id = EXCLUDED.hub_id,
    location_id = EXCLUDED.location_id, inventory_state = 'on_hand', placed_at = now();

  v_op := public._wh_log(_operation_key, 'PUT_AWAY', _hub_id, _package_id,
    jsonb_build_object('location_code', v_loc.code), NULL, NULL, NULL, v_custody,
    v_from, _location_id, NULL, 'stored', NULL, _note, _device_id, 'STORAGE');

  PERFORM public._wh_emit('package.put_away', _package_id,
    jsonb_build_object('package_id', _package_id, 'hub_id', _hub_id, 'location_id', _location_id));
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id,
                            'location_id', _location_id, 'custody_event_id', v_custody);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_move(
  _package_id uuid, _to_location_id uuid, _operation_key text,
  _reason_code text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc public.logistics_hub_locations; v_from uuid; v_op public.logistics_wh_operations;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;
  SELECT * INTO v_loc FROM public.logistics_hub_locations WHERE id = _to_location_id;
  IF v_loc.id IS NULL THEN RAISE EXCEPTION 'location_not_found'; END IF;
  IF v_loc.status NOT IN ('ACTIVE','QUARANTINED') THEN RAISE EXCEPTION 'location_not_available:%', v_loc.status; END IF;
  SELECT location_id INTO v_from FROM public.logistics_package_placement WHERE package_id = _package_id;
  UPDATE public.logistics_package_placement
     SET location_id = _to_location_id, hub_id = v_loc.hub_id,
         inventory_state = CASE WHEN v_loc.status = 'QUARANTINED' THEN 'quarantined' ELSE inventory_state END
   WHERE package_id = _package_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_placed'; END IF;
  v_op := public._wh_log(_operation_key, 'MOVE', v_loc.hub_id, _package_id,
    jsonb_build_object('location_code', v_loc.code), NULL, NULL, NULL, NULL,
    v_from, _to_location_id, NULL, NULL, _reason_code, _note, NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id);
END; $$;

-- =========================================================
-- PICK / PACK
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_pick_list_create(
  _hub_id uuid, _package_ids uuid[], _order_id uuid DEFAULT NULL, _picker_id uuid DEFAULT NULL)
RETURNS public.logistics_pick_lists
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_pick_lists; p uuid;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _package_ids IS NULL OR array_length(_package_ids,1) IS NULL THEN
    RAISE EXCEPTION 'packages_required';
  END IF;
  INSERT INTO public.logistics_pick_lists (pick_list_number, hub_id, order_id, picker_id, created_by)
  VALUES ('PL-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.logistics_pick_list_seq')::text, 5, '0'),
          _hub_id, _order_id, _picker_id, auth.uid())
  RETURNING * INTO v;
  FOREACH p IN ARRAY _package_ids LOOP
    INSERT INTO public.logistics_pick_list_lines (pick_list_id, package_id, location_id)
    VALUES (v.id, p, (SELECT location_id FROM public.logistics_package_placement WHERE package_id = p))
    ON CONFLICT (pick_list_id, package_id) DO NOTHING;
    UPDATE public.logistics_package_placement SET inventory_state = 'allocated'
     WHERE package_id = p AND inventory_state IN ('on_hand','reserved');
  END LOOP;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.wh_pick(
  _line_id uuid, _operation_key text, _quantity numeric DEFAULT 1,
  _reason_code text DEFAULT NULL, _narrative text DEFAULT NULL,
  _device_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line public.logistics_pick_list_lines; v_list public.logistics_pick_lists;
  v_custody uuid; v_op public.logistics_wh_operations; v_state text; v_open integer;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;
  SELECT * INTO v_line FROM public.logistics_pick_list_lines WHERE id = _line_id FOR UPDATE;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'pick_line_not_found'; END IF;
  IF v_line.status <> 'PENDING' THEN RAISE EXCEPTION 'pick_line_already_processed'; END IF;
  SELECT * INTO v_list FROM public.logistics_pick_lists WHERE id = v_line.pick_list_id;

  v_state := CASE WHEN _quantity >= v_line.quantity_expected THEN 'PICKED' ELSE 'SHORT' END;
  IF v_state = 'SHORT' AND _reason_code IS NULL THEN RAISE EXCEPTION 'short_pick_requires_reason'; END IF;

  UPDATE public.logistics_pick_list_lines
     SET quantity_picked = _quantity, status = v_state, reason_code = _reason_code,
         narrative = _narrative, picked_by = auth.uid(), picked_at = now()
   WHERE id = _line_id;

  PERFORM public._logistics_record_custody(v_line.package_id, 'handover'::custody_event_type,
    concat('Pick ', v_list.pick_list_number), coalesce(_narrative, 'picked'));
  v_custody := public._wh_last_custody(v_line.package_id);

  UPDATE public.logistics_package_placement SET inventory_state = 'picked', location_id = NULL
   WHERE package_id = v_line.package_id;

  UPDATE public.logistics_pick_lists SET status = 'IN_PROGRESS' WHERE id = v_list.id AND status = 'OPEN';
  SELECT count(*) INTO v_open FROM public.logistics_pick_list_lines
    WHERE pick_list_id = v_list.id AND status = 'PENDING';
  IF v_open = 0 THEN
    UPDATE public.logistics_pick_lists
       SET status = CASE WHEN EXISTS (SELECT 1 FROM public.logistics_pick_list_lines
                                       WHERE pick_list_id = v_list.id AND status = 'SHORT')
                    THEN 'SHORT' ELSE 'COMPLETE' END,
           completed_at = now()
     WHERE id = v_list.id;
  END IF;

  v_op := public._wh_log(_operation_key, 'PICK', v_list.hub_id, v_line.package_id,
    jsonb_build_object('pick_list_id', v_list.id, 'pick_list_number', v_list.pick_list_number,
                       'quantity', _quantity, 'state', v_state),
    NULL, NULL, NULL, v_custody, v_line.location_id, NULL, 'stored', 'picked',
    _reason_code, _narrative, _device_id, 'PICK', v_list.order_id);

  PERFORM public._wh_emit('package.picked', v_line.package_id,
    jsonb_build_object('package_id', v_line.package_id, 'hub_id', v_list.hub_id,
                       'location_id', v_line.location_id, 'pick_list_id', v_list.id));
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id, 'state', v_state);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_pack(
  _package_id uuid, _hub_id uuid, _operation_key text,
  _station_code text DEFAULT NULL, _packaging_type text DEFAULT NULL,
  _weight_kg numeric DEFAULT NULL, _length_cm integer DEFAULT NULL,
  _width_cm integer DEFAULT NULL, _height_cm integer DEFAULT NULL,
  _label_reference text DEFAULT NULL, _label_kind text DEFAULT 'SHIPPING',
  _source_package_id uuid DEFAULT NULL, _device_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_unit public.logistics_pack_units; v_custody uuid; v_op public.logistics_wh_operations;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.packages WHERE id = _package_id) THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  INSERT INTO public.logistics_pack_units (hub_id, package_id, source_package_id, station_code,
    packer_id, packaging_type, weight_kg, length_cm, width_cm, height_cm, label_reference, label_kind)
  VALUES (_hub_id, _package_id, _source_package_id, _station_code, auth.uid(), _packaging_type,
    _weight_kg, _length_cm, _width_cm, _height_cm, _label_reference, _label_kind)
  RETURNING * INTO v_unit;

  -- the package remains the single identity authority; measurements are updated on it
  UPDATE public.packages SET
    weight_kg = coalesce(_weight_kg, weight_kg),
    length_cm = coalesce(_length_cm, length_cm),
    width_cm = coalesce(_width_cm, width_cm),
    height_cm = coalesce(_height_cm, height_cm)
  WHERE id = _package_id;

  PERFORM public._logistics_record_custody(_package_id, 'handover'::custody_event_type,
    concat('Pack station ', coalesce(_station_code,'-')), 'packed');
  v_custody := public._wh_last_custody(_package_id);

  UPDATE public.logistics_package_placement SET inventory_state = 'packed' WHERE package_id = _package_id;

  v_op := public._wh_log(_operation_key, 'PACK', _hub_id, _package_id,
    jsonb_build_object('pack_unit_id', v_unit.id, 'weight_kg', _weight_kg,
                       'label_reference', _label_reference, 'label_kind', _label_kind,
                       'source_package_id', _source_package_id),
    NULL, NULL, NULL, v_custody, NULL, NULL, 'picked', 'packed', NULL, NULL, _device_id, 'PACK');

  PERFORM public._wh_emit('package.packed', _package_id,
    jsonb_build_object('package_id', _package_id, 'hub_id', _hub_id,
                       'pack_unit_id', v_unit.id, 'weight_kg', _weight_kg));
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id,
                            'pack_unit_id', v_unit.id);
END; $$;

-- =========================================================
-- OUTBOUND STAGE / CONSOLIDATE / DECONSOLIDATE
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_stage_outbound(
  _package_id uuid, _hub_id uuid, _operation_key text,
  _location_id uuid DEFAULT NULL, _manifest_id uuid DEFAULT NULL,
  _stop_id uuid DEFAULT NULL, _device_id text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_custody uuid; v_op public.logistics_wh_operations;
  v_stop public.logistics_route_stops; v_route uuid;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;

  IF _stop_id IS NOT NULL THEN
    SELECT * INTO v_stop FROM public.logistics_route_stops WHERE id = _stop_id;
    IF v_stop.id IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
    v_route := v_stop.route_id;
    -- attach to the AUTHORITATIVE stop/package structure
    PERFORM public.logistics_stop_attach_package(_stop_id, _package_id, 'delivery');
  END IF;

  PERFORM public.logistics_hub_process_package(_hub_id, _package_id, 'staged', _manifest_id, _note);
  v_custody := public._wh_last_custody(_package_id);

  UPDATE public.logistics_package_placement
     SET inventory_state = 'staged', location_id = coalesce(_location_id, location_id)
   WHERE package_id = _package_id;

  v_op := public._wh_log(_operation_key, 'OUTBOUND_STAGE', _hub_id, _package_id,
    jsonb_build_object('location_id', _location_id),
    _manifest_id, v_route, _stop_id, v_custody, NULL, _location_id, 'sorted', 'staged',
    NULL, _note, _device_id, 'HANDLING_STAGE');

  PERFORM public._wh_emit('package.staged', _package_id,
    jsonb_build_object('package_id', _package_id, 'hub_id', _hub_id,
                       'location_id', _location_id, 'manifest_id', _manifest_id));
  PERFORM public._wh_emit('package.outbound_staged', _package_id,
    jsonb_build_object('package_id', _package_id, 'hub_id', _hub_id,
                       'route_id', v_route, 'stop_id', _stop_id));
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id,
                            'route_id', v_route, 'stop_id', _stop_id, 'custody_event_id', v_custody);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_consolidate(
  _package_id uuid, _hub_id uuid, _manifest_id uuid, _operation_key text,
  _device_id text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scan jsonb; v_custody uuid; v_op public.logistics_wh_operations;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;

  v_scan := public.logistics_manifest_scan(_manifest_id,
              (SELECT tracking_number FROM public.packages WHERE id = _package_id), 'loaded', _note);
  IF NOT coalesce((v_scan->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', v_scan->>'code', 'message', v_scan->>'message');
  END IF;

  -- requires the cross_dock hub capability (enforced inside the hub authority)
  PERFORM public.logistics_hub_process_package(_hub_id, _package_id, 'consolidated', _manifest_id, _note);
  v_custody := public._wh_last_custody(_package_id);

  v_op := public._wh_log(_operation_key, 'CONSOLIDATE', _hub_id, _package_id,
    jsonb_build_object('manifest_id', _manifest_id), _manifest_id, NULL, NULL, v_custody,
    NULL, NULL, 'sorted', 'consolidated', NULL, _note, _device_id, 'CROSS_DOCK');

  PERFORM public._wh_emit('package.cross_docked', _package_id,
    jsonb_build_object('package_id', _package_id, 'hub_id', _hub_id, 'manifest_id', _manifest_id));
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id,
                            'custody_event_id', v_custody);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_deconsolidate(
  _package_id uuid, _manifest_id uuid, _reason_code text, _operation_key text,
  _narrative text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op public.logistics_wh_operations; v_res jsonb;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF _reason_code IS NULL OR length(trim(_reason_code)) = 0 THEN
    RAISE EXCEPTION 'deconsolidation_requires_reason';
  END IF;
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;
  v_res := public.logistics_manifest_remove_package(_manifest_id, _package_id,
                                                    concat(_reason_code, ': ', coalesce(_narrative,'')));
  v_op := public._wh_log(_operation_key, 'DECONSOLIDATE', NULL, _package_id,
    coalesce(v_res, '{}'::jsonb), _manifest_id, NULL, NULL, NULL, NULL, NULL,
    'consolidated', 'sorted', _reason_code, _narrative, NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id, 'result', v_res);
END; $$;

-- =========================================================
-- DISPATCH  (manifest → route → driver/vehicle → custody)
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_dispatch(
  _manifest_id uuid, _hub_id uuid, _operation_key text,
  _route_id uuid DEFAULT NULL, _driver_id uuid DEFAULT NULL,
  _vehicle_id uuid DEFAULT NULL, _dock_id uuid DEFAULT NULL,
  _seal_id text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_man public.logistics_manifests; v_hub public.logistics_hubs;
  v_line record; v_custody uuid; v_count integer := 0;
  v_op public.logistics_wh_operations; v_unloaded integer; v_open_session integer;
  v_elig jsonb;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;

  SELECT * INTO v_man FROM public.logistics_manifests WHERE id = _manifest_id FOR UPDATE;
  IF v_man.id IS NULL THEN RAISE EXCEPTION 'manifest_not_found'; END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF v_hub.id IS NULL OR v_hub.status <> 'active' THEN RAISE EXCEPTION 'hub_not_active'; END IF;

  SELECT count(*) INTO v_count FROM public.logistics_manifest_lines WHERE manifest_id = _manifest_id;
  IF v_count = 0 THEN RAISE EXCEPTION 'manifest_empty'; END IF;

  SELECT count(*) INTO v_unloaded FROM public.logistics_manifest_lines
   WHERE manifest_id = _manifest_id AND scan_state NOT IN ('loaded','received');
  IF v_unloaded > 0 THEN RAISE EXCEPTION 'manifest_has_unloaded_lines:%', v_unloaded; END IF;

  -- a package may not be dispatched while its inbound receipt is still open
  SELECT count(*) INTO v_open_session FROM public.logistics_receiving_sessions s
   WHERE s.status = 'OPEN' AND s.manifest_id = _manifest_id;
  IF v_open_session > 0 THEN RAISE EXCEPTION 'inbound_receipt_still_open'; END IF;

  IF _route_id IS NOT NULL AND (_driver_id IS NOT NULL OR _vehicle_id IS NOT NULL) THEN
    v_elig := public.logistics_route_eligibility(_route_id, _driver_id, _vehicle_id);
    IF v_elig IS NOT NULL AND coalesce((v_elig->>'eligible')::boolean, true) = false THEN
      RAISE EXCEPTION 'route_not_eligible:%', coalesce(v_elig->>'reason', 'unspecified');
    END IF;
  END IF;

  IF v_man.status <> 'dispatched' THEN
    PERFORM public.logistics_manifest_transition(_manifest_id, 'dispatched', _driver_id, _note);
  END IF;

  FOR v_line IN SELECT package_id FROM public.logistics_manifest_lines WHERE manifest_id = _manifest_id LOOP
    PERFORM public.logistics_hub_process_package(_hub_id, v_line.package_id, 'dispatched', _manifest_id, _note);
    v_custody := public._wh_last_custody(v_line.package_id);
    UPDATE public.logistics_package_placement
       SET inventory_state = 'dispatched', location_id = NULL WHERE package_id = v_line.package_id;
    PERFORM public._wh_log(_operation_key || ':' || v_line.package_id::text, 'DISPATCH',
      _hub_id, v_line.package_id,
      jsonb_build_object('driver_id', _driver_id, 'vehicle_id', _vehicle_id),
      _manifest_id, _route_id, NULL, v_custody, NULL, NULL, 'staged', 'dispatched',
      NULL, _note, NULL, 'DISPATCH');
    PERFORM public._wh_emit('package.dispatched', v_line.package_id,
      jsonb_build_object('package_id', v_line.package_id, 'hub_id', _hub_id,
                         'manifest_id', _manifest_id, 'route_id', _route_id,
                         'driver_id', _driver_id, 'vehicle_id', _vehicle_id));
  END LOOP;

  PERFORM public.wh_gate_event(_hub_id, 'DEPARTURE', _operation_key || ':gate', _manifest_id,
    NULL, _vehicle_id, _driver_id, NULL, _dock_id, _seal_id, true, v_count, _note);

  v_op := public._wh_log(_operation_key, 'GATE_DEPARTURE', _hub_id, NULL,
    jsonb_build_object('manifest_id', _manifest_id, 'package_count', v_count,
                       'route_id', _route_id, 'driver_id', _driver_id, 'vehicle_id', _vehicle_id),
    _manifest_id, _route_id, NULL, NULL, NULL, NULL, NULL, 'dispatched', NULL, _note, NULL, 'DISPATCH');

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'manifest_id', _manifest_id,
                            'dispatched_packages', v_count, 'operation_id', v_op.id);
END; $$;

-- =========================================================
-- RETURNS (existing lifecycle) + TEMPERATURE
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_return_receive(
  _return_id uuid, _hub_id uuid, _operation_key text,
  _condition text DEFAULT 'good', _seal_state text DEFAULT NULL,
  _seal_id text DEFAULT NULL, _scanned_reference text DEFAULT NULL,
  _notes text DEFAULT NULL, _evidence jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb; v_op public.logistics_wh_operations; v_pkg uuid;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  IF public._wh_seen(_operation_key) THEN
    SELECT * INTO v_op FROM public.logistics_wh_operations WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'operation_id', v_op.id);
  END IF;
  v_res := public.logistics_return_receive(_return_id, _hub_id, _condition, _seal_state,
                                           _seal_id, _scanned_reference, _notes, _evidence);
  SELECT package_id INTO v_pkg FROM public.logistics_returns WHERE id = _return_id;
  v_op := public._wh_log(_operation_key, 'RETURN_RECEIVE', _hub_id, v_pkg,
    coalesce(v_res,'{}'::jsonb), NULL, NULL, NULL, public._wh_last_custody(v_pkg), NULL, NULL,
    NULL, 'returned', NULL, _notes, NULL, 'RETURNS', NULL, _return_id);
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id, 'result', v_res);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_temperature_record(
  _hub_id uuid, _reading_c numeric, _zone_id uuid DEFAULT NULL,
  _package_id uuid DEFAULT NULL, _evidence jsonb DEFAULT NULL)
RETURNS public.logistics_temperature_readings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_temperature_readings; v_min numeric; v_max numeric; v_exc boolean;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  SELECT temperature_min_c, temperature_max_c INTO v_min, v_max
    FROM public.logistics_hub_zones WHERE id = _zone_id;
  v_exc := (v_min IS NOT NULL AND _reading_c < v_min) OR (v_max IS NOT NULL AND _reading_c > v_max);
  INSERT INTO public.logistics_temperature_readings (hub_id, zone_id, package_id, reading_c,
    requirement_min_c, requirement_max_c, excursion, evidence, actor_id)
  VALUES (_hub_id, _zone_id, _package_id, _reading_c, v_min, v_max, coalesce(v_exc,false), _evidence, auth.uid())
  RETURNING * INTO v;
  RETURN v;
END; $$;

-- =========================================================
-- RECONCILIATION + TRACE
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_receiving_reconcile(
  _session_id uuid, _variance_note text DEFAULT NULL, _close boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s public.logistics_receiving_sessions; v_expected integer; v_received integer;
  v_sorted integer; v_staged integer; v_dispatched integer; v_missing integer;
BEGIN
  PERFORM public._wh_require('staff.logistics.read');
  SELECT * INTO v_s FROM public.logistics_receiving_sessions WHERE id = _session_id FOR UPDATE;
  IF v_s.id IS NULL THEN RAISE EXCEPTION 'receiving_session_not_found'; END IF;

  SELECT count(*) INTO v_expected FROM public.logistics_manifest_lines WHERE manifest_id = v_s.manifest_id;
  SELECT count(*) INTO v_received FROM public.logistics_wh_operations
    WHERE manifest_id = v_s.manifest_id AND operation_type = 'RECEIVE';
  SELECT count(DISTINCT package_id) INTO v_sorted FROM public.logistics_wh_operations o
    WHERE o.operation_type = 'SORT' AND o.package_id IN (
      SELECT package_id FROM public.logistics_manifest_lines WHERE manifest_id = v_s.manifest_id);
  SELECT count(DISTINCT package_id) INTO v_staged FROM public.logistics_wh_operations o
    WHERE o.operation_type IN ('OUTBOUND_STAGE','CONSOLIDATE') AND o.package_id IN (
      SELECT package_id FROM public.logistics_manifest_lines WHERE manifest_id = v_s.manifest_id);
  SELECT count(DISTINCT package_id) INTO v_dispatched FROM public.logistics_wh_operations o
    WHERE o.operation_type = 'DISPATCH' AND o.package_id IN (
      SELECT package_id FROM public.logistics_manifest_lines WHERE manifest_id = v_s.manifest_id);
  v_missing := greatest(v_expected - v_received, 0);

  IF _variance_note IS NOT NULL THEN
    UPDATE public.logistics_receiving_sessions
       SET variance_note = _variance_note, variance_explained = true,
           expected_count = v_expected, received_count = v_received
     WHERE id = _session_id RETURNING * INTO v_s;
  ELSE
    UPDATE public.logistics_receiving_sessions
       SET expected_count = v_expected, received_count = v_received
     WHERE id = _session_id RETURNING * INTO v_s;
  END IF;

  IF _close THEN
    PERFORM public._wh_require('staff.logistics.manage');
    IF v_missing > 0 AND NOT v_s.variance_explained THEN
      RAISE EXCEPTION 'unexplained_variance:%', v_missing;
    END IF;
    UPDATE public.logistics_receiving_sessions
       SET status = 'RECONCILED', closed_at = now() WHERE id = _session_id;
  END IF;

  RETURN jsonb_build_object('session_id', _session_id, 'expected', v_expected,
    'received', v_received, 'sorted', v_sorted, 'staged', v_staged,
    'dispatched', v_dispatched, 'missing', v_missing,
    'damaged', v_s.damaged_count, 'variance_explained', v_s.variance_explained,
    'status', CASE WHEN _close THEN 'RECONCILED' ELSE v_s.status END);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_package_trace(_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._wh_require('staff.logistics.read');
  SELECT jsonb_build_object(
    'package', (SELECT to_jsonb(p) FROM public.packages p WHERE p.id = _package_id),
    'placement', (SELECT to_jsonb(pl) FROM public.logistics_package_placement pl WHERE pl.package_id = _package_id),
    'hub_stage', (SELECT to_jsonb(s) FROM public.logistics_hub_package_stage s WHERE s.package_id = _package_id),
    'custody', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.occurred_at), '[]'::jsonb)
                  FROM public.package_chain_of_custody c WHERE c.package_id = _package_id),
    'warehouse_operations', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.occurred_at), '[]'::jsonb)
                  FROM public.logistics_wh_operations o WHERE o.package_id = _package_id),
    'manifests', (SELECT coalesce(jsonb_agg(jsonb_build_object('manifest_id', l.manifest_id,
                                    'manifest_number', m.manifest_number, 'scan_state', l.scan_state)), '[]'::jsonb)
                  FROM public.logistics_manifest_lines l JOIN public.logistics_manifests m ON m.id = l.manifest_id
                  WHERE l.package_id = _package_id),
    'stops', (SELECT coalesce(jsonb_agg(jsonb_build_object('stop_id', sp.stop_id, 'route_id', sp.route_id)), '[]'::jsonb)
                  FROM public.logistics_stop_packages sp WHERE sp.package_id = _package_id)
  ) INTO v;
  RETURN v;
END; $$;

-- =========================================================
-- OFFLINE QUEUE
-- =========================================================
CREATE OR REPLACE FUNCTION public.wh_offline_enqueue(
  _device_id text, _operation_key text, _operation_type text,
  _captured_at timestamptz, _payload jsonb, _hub_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.logistics_wh_offline_queue;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  INSERT INTO public.logistics_wh_offline_queue (operation_key, device_id, actor_id, hub_id,
    operation_type, captured_at, payload)
  VALUES (_operation_key, _device_id, auth.uid(), _hub_id, _operation_type, _captured_at,
          coalesce(_payload,'{}'::jsonb))
  ON CONFLICT (operation_key) DO NOTHING
  RETURNING * INTO v;
  IF v.id IS NULL THEN
    SELECT * INTO v FROM public.logistics_wh_offline_queue WHERE operation_key = _operation_key;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'id', v.id, 'state', v.state);
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v.id, 'state', v.state);
END; $$;

CREATE OR REPLACE FUNCTION public.wh_offline_reconcile(_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.logistics_wh_offline_queue; v_res jsonb;
  v_applied integer := 0; v_dupe integer := 0; v_conflict integer := 0; v_rejected integer := 0;
BEGIN
  PERFORM public._wh_require('staff.logistics.manage');
  FOR r IN SELECT * FROM public.logistics_wh_offline_queue
            WHERE state = 'PENDING' ORDER BY captured_at LIMIT coalesce(_limit,50) LOOP
    BEGIN
      IF public._wh_seen(r.operation_key) THEN
        UPDATE public.logistics_wh_offline_queue SET state = 'DUPLICATE', applied_at = now()
         WHERE id = r.id;
        v_dupe := v_dupe + 1;
        CONTINUE;
      END IF;

      IF r.operation_type = 'RECEIVE' THEN
        v_res := public.wh_receive_scan(
          (r.payload->>'session_id')::uuid, r.payload->>'identifier', r.operation_key,
          coalesce(r.payload->>'condition','GOOD'), r.device_id,
          nullif(r.payload->>'location_id','')::uuid, r.payload->>'note');
      ELSIF r.operation_type = 'SORT' THEN
        v_res := public.wh_sort((r.payload->>'package_id')::uuid, r.hub_id, r.operation_key,
          nullif(r.payload->>'destination_hub_id','')::uuid,
          nullif(r.payload->>'route_id','')::uuid, nullif(r.payload->>'stop_id','')::uuid,
          NULL, r.payload->>'service_level', r.device_id, r.payload->>'note');
      ELSIF r.operation_type = 'PUT_AWAY' THEN
        v_res := public.wh_put_away((r.payload->>'package_id')::uuid, r.hub_id,
          (r.payload->>'location_id')::uuid, r.operation_key, r.device_id, r.payload->>'note');
      ELSIF r.operation_type = 'OUTBOUND_STAGE' THEN
        v_res := public.wh_stage_outbound((r.payload->>'package_id')::uuid, r.hub_id, r.operation_key,
          nullif(r.payload->>'location_id','')::uuid, nullif(r.payload->>'manifest_id','')::uuid,
          nullif(r.payload->>'stop_id','')::uuid, r.device_id, r.payload->>'note');
      ELSE
        UPDATE public.logistics_wh_offline_queue
           SET state = 'REJECTED', conflict_reason = 'unsupported_operation_type', applied_at = now()
         WHERE id = r.id;
        v_rejected := v_rejected + 1;
        CONTINUE;
      END IF;

      IF coalesce((v_res->>'ok')::boolean, false) THEN
        UPDATE public.logistics_wh_offline_queue
           SET state = 'APPLIED', server_result = v_res, applied_at = now() WHERE id = r.id;
        v_applied := v_applied + 1;
      ELSE
        UPDATE public.logistics_wh_offline_queue
           SET state = 'CONFLICT', server_result = v_res,
               conflict_reason = coalesce(v_res->>'code','server_rejected'), applied_at = now()
         WHERE id = r.id;
        v_conflict := v_conflict + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.logistics_wh_offline_queue
         SET state = 'CONFLICT', conflict_reason = SQLERRM, applied_at = now() WHERE id = r.id;
      v_conflict := v_conflict + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('applied', v_applied, 'duplicate', v_dupe,
                            'conflict', v_conflict, 'rejected', v_rejected);
END; $$;

-- =========================================================
-- EXECUTE GRANTS — deny by default
-- =========================================================
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname LIKE 'wh\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
  FOR fn IN SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname LIKE '\_wh\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;