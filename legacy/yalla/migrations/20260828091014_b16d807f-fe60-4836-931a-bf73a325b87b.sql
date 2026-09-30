-- ============================================================================
-- Logistics Phase 1: hub administration actions (server-authoritative)
-- Domain: logistics
-- ============================================================================

ALTER TABLE public.logistics_hub_audit DROP CONSTRAINT IF EXISTS logistics_hub_audit_action_check;
ALTER TABLE public.logistics_hub_audit ADD CONSTRAINT logistics_hub_audit_action_check
  CHECK (action IN ('created','updated','activated','deactivated','status_changed','capacity_changed',
                    'capabilities_changed','operator_assigned','area_changed','hours_changed',
                    'closure_changed','contact_changed','crossdock_movement'));

/** Internal audit writer — every hub action funnels through here. */
CREATE OR REPLACE FUNCTION public._logistics_hub_audit(
  _hub_id uuid, _action text, _before jsonb, _after jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.logistics_hub_audit (hub_id, action, actor_id, before_state, after_state)
  VALUES (_hub_id, _action, auth.uid(), _before, _after);
$$;
REVOKE ALL ON FUNCTION public._logistics_hub_audit(uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._logistics_hub_audit(uuid, text, jsonb, jsonb) TO service_role;

/* --------------------------------- upsert --------------------------------- */
DROP FUNCTION IF EXISTS public.logistics_hub_upsert(uuid, text, text, text, text, text, numeric, numeric, text, text, jsonb, jsonb, text[], jsonb, text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.logistics_hub_upsert(
  _id uuid,
  _code text,
  _name text,
  _hub_type text,
  _city text DEFAULT NULL,
  _address text DEFAULT NULL,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _region text DEFAULT NULL,
  _country_code text DEFAULT 'KE',
  _timezone text DEFAULT 'Africa/Nairobi',
  _capabilities text[] DEFAULT '{}'::text[],
  _capacity_unit text DEFAULT 'parcels',
  _max_capacity numeric DEFAULT NULL,
  _contact_name text DEFAULT NULL,
  _contact_phone text DEFAULT NULL,
  _contact_email text DEFAULT NULL,
  _responsible_operator_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF _id IS NULL THEN
    IF NOT public.logistics_hub_authorised('create') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  ELSE
    IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  END IF;

  IF coalesce(trim(_code), '') = '' OR coalesce(trim(_name), '') = '' THEN
    RAISE EXCEPTION 'code_and_name_required';
  END IF;
  IF _responsible_operator_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _responsible_operator_id) THEN
    RAISE EXCEPTION 'operator_not_staff_identity';
  END IF;

  IF _id IS NOT NULL THEN
    SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
    IF v_before IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.logistics_hubs (
      code, name, hub_type, city, address, lat, lng, region, country_code, timezone,
      capabilities, capacity_unit, max_capacity,
      contact_name, contact_phone, contact_email, responsible_operator_id, notes, created_by, status
    ) VALUES (
      upper(trim(_code)), trim(_name), _hub_type, _city, _address, _lat, _lng, _region,
      coalesce(_country_code, 'KE'), coalesce(_timezone, 'Africa/Nairobi'),
      coalesce(_capabilities, '{}'::text[]), coalesce(_capacity_unit, 'parcels'), _max_capacity,
      _contact_name, _contact_phone, _contact_email, _responsible_operator_id, _notes, auth.uid(), 'draft'
    ) RETURNING * INTO v_row;
  ELSE
    UPDATE public.logistics_hubs SET
      code = upper(trim(_code)),
      name = trim(_name),
      hub_type = _hub_type,
      city = _city,
      address = _address,
      lat = _lat,
      lng = _lng,
      region = _region,
      country_code = coalesce(_country_code, 'KE'),
      timezone = coalesce(_timezone, 'Africa/Nairobi'),
      capabilities = coalesce(_capabilities, '{}'::text[]),
      capacity_unit = coalesce(_capacity_unit, 'parcels'),
      max_capacity = _max_capacity,
      contact_name = _contact_name,
      contact_phone = _contact_phone,
      contact_email = _contact_email,
      responsible_operator_id = _responsible_operator_id,
      notes = _notes
    WHERE id = _id RETURNING * INTO v_row;
  END IF;

  PERFORM public._logistics_hub_audit(
    v_row.id, CASE WHEN _id IS NULL THEN 'created' ELSE 'updated' END, v_before, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

/* ------------------------------ lifecycle --------------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_set_status(_id uuid, _status text)
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF _status NOT IN ('draft','active','suspended','inactive') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF _status = 'active' THEN
    IF NOT public.logistics_hub_authorised('activate') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  ELSE
    IF NOT public.logistics_hub_authorised('deactivate') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  END IF;

  SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;

  IF _status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.logistics_hubs
     WHERE id = _id AND array_length(capabilities, 1) >= 1
  ) THEN
    RAISE EXCEPTION 'hub_requires_capability_before_activation';
  END IF;

  UPDATE public.logistics_hubs SET status = _status WHERE id = _id RETURNING * INTO v_row;

  PERFORM public._logistics_hub_audit(
    _id,
    CASE WHEN _status = 'active' THEN 'activated'
         WHEN _status = 'inactive' THEN 'deactivated'
         ELSE 'status_changed' END,
    v_before, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_hub_set_active(_id uuid, _active boolean)
RETURNS public.logistics_hubs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.logistics_hub_set_status(_id, CASE WHEN _active THEN 'active' ELSE 'inactive' END);
$$;

/* ------------------------------- capacity --------------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_set_capacity(
  _id uuid, _max_capacity numeric, _current_capacity numeric, _capacity_unit text DEFAULT NULL
)
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF NOT public.logistics_hub_authorised('manage_capacity') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF _current_capacity < 0 OR (_max_capacity IS NOT NULL AND _max_capacity < 0) THEN
    RAISE EXCEPTION 'invalid_capacity';
  END IF;
  IF _max_capacity IS NOT NULL AND _current_capacity > _max_capacity THEN
    RAISE EXCEPTION 'current_capacity_exceeds_maximum';
  END IF;

  SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;

  UPDATE public.logistics_hubs
     SET max_capacity = _max_capacity,
         current_capacity = _current_capacity,
         capacity_unit = coalesce(_capacity_unit, capacity_unit)
   WHERE id = _id RETURNING * INTO v_row;

  PERFORM public._logistics_hub_audit(_id, 'capacity_changed', v_before, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

/* ----------------------------- capabilities ------------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_set_capabilities(_id uuid, _capabilities text[])
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF NOT public.logistics_hub_authorised('manage_capabilities') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;

  UPDATE public.logistics_hubs SET capabilities = coalesce(_capabilities, '{}'::text[])
   WHERE id = _id RETURNING * INTO v_row;

  PERFORM public._logistics_hub_audit(_id, 'capabilities_changed', v_before, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

/* -------------------------- responsible operator -------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_assign_operator(_id uuid, _operator_id uuid)
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF _operator_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _operator_id) THEN
    RAISE EXCEPTION 'operator_not_staff_identity';
  END IF;

  SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;

  UPDATE public.logistics_hubs SET responsible_operator_id = _operator_id
   WHERE id = _id RETURNING * INTO v_row;

  PERFORM public._logistics_hub_audit(_id, 'operator_assigned', v_before, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

/* ------------------------------ service areas ----------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_area_upsert(
  _id uuid,
  _hub_id uuid,
  _area_type text,
  _label text DEFAULT NULL,
  _city text DEFAULT NULL,
  _region text DEFAULT NULL,
  _corridor_code text DEFAULT NULL,
  _center_lat numeric DEFAULT NULL,
  _center_lng numeric DEFAULT NULL,
  _radius_km numeric DEFAULT NULL,
  _polygon jsonb DEFAULT NULL,
  _active boolean DEFAULT true
)
RETURNS public.logistics_hub_service_areas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.logistics_hub_service_areas;
BEGIN
  IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.logistics_hub_service_areas (
      hub_id, area_type, label, city, region, corridor_code,
      center_lat, center_lng, radius_km, polygon, active)
    VALUES (_hub_id, _area_type, _label, _city, _region, _corridor_code,
            _center_lat, _center_lng, _radius_km, _polygon, coalesce(_active, true))
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.logistics_hub_service_areas SET
      area_type = _area_type, label = _label, city = _city, region = _region,
      corridor_code = _corridor_code, center_lat = _center_lat, center_lng = _center_lng,
      radius_km = _radius_km, polygon = _polygon, active = coalesce(_active, true)
    WHERE id = _id RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'area_not_found'; END IF;
  END IF;

  PERFORM public._logistics_hub_audit(v_row.hub_id, 'area_changed', NULL, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_hub_area_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.logistics_hub_service_areas;
BEGIN
  IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  DELETE FROM public.logistics_hub_service_areas WHERE id = _id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'area_not_found'; END IF;
  PERFORM public._logistics_hub_audit(v_row.hub_id, 'area_changed', to_jsonb(v_row), NULL);
  RETURN true;
END;
$$;

/* ----------------------------- operating hours ---------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_hours_set(_hub_id uuid, _hours jsonb)
RETURNS SETOF public.logistics_hub_operating_hours
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  item jsonb;
BEGIN
  IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF jsonb_typeof(_hours) <> 'array' THEN RAISE EXCEPTION 'hours_must_be_array'; END IF;

  SELECT jsonb_agg(to_jsonb(h)) INTO v_before
    FROM public.logistics_hub_operating_hours h WHERE h.hub_id = _hub_id;

  FOR item IN SELECT * FROM jsonb_array_elements(_hours) LOOP
    INSERT INTO public.logistics_hub_operating_hours (hub_id, weekday, opens, closes, closed)
    VALUES (
      _hub_id,
      (item ->> 'weekday')::smallint,
      NULLIF(item ->> 'opens', '')::time,
      NULLIF(item ->> 'closes', '')::time,
      coalesce((item ->> 'closed')::boolean, false)
    )
    ON CONFLICT (hub_id, weekday) DO UPDATE
      SET opens = EXCLUDED.opens, closes = EXCLUDED.closes, closed = EXCLUDED.closed;
  END LOOP;

  PERFORM public._logistics_hub_audit(_hub_id, 'hours_changed', v_before, _hours);

  RETURN QUERY SELECT * FROM public.logistics_hub_operating_hours
    WHERE hub_id = _hub_id ORDER BY weekday;
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_hub_closure_upsert(
  _hub_id uuid, _closure_date date, _reason text DEFAULT NULL,
  _closed boolean DEFAULT true, _opens time DEFAULT NULL, _closes time DEFAULT NULL
)
RETURNS public.logistics_hub_closures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.logistics_hub_closures;
BEGIN
  IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;

  INSERT INTO public.logistics_hub_closures (hub_id, closure_date, reason, closed, opens, closes, created_by)
  VALUES (_hub_id, _closure_date, _reason, coalesce(_closed, true), _opens, _closes, auth.uid())
  ON CONFLICT (hub_id, closure_date) DO UPDATE
    SET reason = EXCLUDED.reason, closed = EXCLUDED.closed,
        opens = EXCLUDED.opens, closes = EXCLUDED.closes
  RETURNING * INTO v_row;

  PERFORM public._logistics_hub_audit(_hub_id, 'closure_changed', NULL, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_hub_closure_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.logistics_hub_closures;
BEGIN
  IF NOT public.logistics_hub_authorised('update') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  DELETE FROM public.logistics_hub_closures WHERE id = _id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'closure_not_found'; END IF;
  PERFORM public._logistics_hub_audit(v_row.hub_id, 'closure_changed', to_jsonb(v_row), NULL);
  RETURN true;
END;
$$;

/* -------------------------------- contacts -------------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_contact_upsert(
  _id uuid, _hub_id uuid, _name text, _contact_role text DEFAULT NULL,
  _phone text DEFAULT NULL, _email text DEFAULT NULL,
  _is_primary boolean DEFAULT false, _active boolean DEFAULT true
)
RETURNS public.logistics_hub_contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.logistics_hub_contacts;
BEGIN
  IF NOT public.logistics_hub_authorised('manage_contacts') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF coalesce(trim(_name), '') = '' THEN RAISE EXCEPTION 'contact_name_required'; END IF;
  IF coalesce(_phone, _email) IS NULL THEN RAISE EXCEPTION 'contact_needs_phone_or_email'; END IF;

  IF coalesce(_is_primary, false) THEN
    UPDATE public.logistics_hub_contacts SET is_primary = false
     WHERE hub_id = _hub_id AND is_primary AND (_id IS NULL OR id <> _id);
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.logistics_hub_contacts (hub_id, name, contact_role, phone, email, is_primary, active)
    VALUES (_hub_id, trim(_name), _contact_role, _phone, _email,
            coalesce(_is_primary, false), coalesce(_active, true))
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.logistics_hub_contacts SET
      name = trim(_name), contact_role = _contact_role, phone = _phone, email = _email,
      is_primary = coalesce(_is_primary, false), active = coalesce(_active, true)
    WHERE id = _id RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'contact_not_found'; END IF;
  END IF;

  PERFORM public._logistics_hub_audit(v_row.hub_id, 'contact_changed', NULL, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_hub_contact_retire(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.logistics_hub_contacts;
BEGIN
  IF NOT public.logistics_hub_authorised('manage_contacts') THEN RAISE EXCEPTION 'not_authorised'; END IF;
  UPDATE public.logistics_hub_contacts SET active = false, is_primary = false
   WHERE id = _id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'contact_not_found'; END IF;
  PERFORM public._logistics_hub_audit(v_row.hub_id, 'contact_changed', NULL, to_jsonb(v_row));
  RETURN true;
END;
$$;

/* ------------------------- cross-dock movement ---------------------------- */
/** Hub receipt → sort → staging → consolidation → outbound. Every movement
 *  writes to the existing package_chain_of_custody; the stage table is only a
 *  projection of where the package currently sits. Idempotent per stage. */
CREATE OR REPLACE FUNCTION public.logistics_hub_process_package(
  _hub_id uuid,
  _package_id uuid,
  _stage text,
  _manifest_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.logistics_hub_package_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_row public.logistics_hub_package_stage;
  v_custody uuid;
  v_event custody_event_type;
  v_required text;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  IF _stage NOT IN ('received','sorted','staged','consolidated','dispatched') THEN
    RAISE EXCEPTION 'invalid_stage';
  END IF;

  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF v_hub.id IS NULL THEN RAISE EXCEPTION 'hub_not_found'; END IF;
  IF v_hub.status <> 'active' THEN RAISE EXCEPTION 'hub_not_active'; END IF;

  v_required := CASE _stage
    WHEN 'received' THEN 'receiving'
    WHEN 'sorted' THEN 'sorting'
    WHEN 'staged' THEN 'staging'
    WHEN 'consolidated' THEN 'cross_dock'
    ELSE 'dispatch' END;
  IF NOT (v_required = ANY (v_hub.capabilities)) THEN
    RAISE EXCEPTION 'hub_lacks_capability_%', v_required;
  END IF;

  -- idempotent: same package already at this stage in this hub
  SELECT * INTO v_row FROM public.logistics_hub_package_stage
   WHERE package_id = _package_id;
  IF v_row.id IS NOT NULL AND v_row.hub_id = _hub_id AND v_row.stage = _stage THEN
    RETURN v_row;
  END IF;

  v_event := CASE _stage
    WHEN 'received' THEN 'warehouse_in'::custody_event_type
    WHEN 'dispatched' THEN 'warehouse_out'::custody_event_type
    ELSE 'handover'::custody_event_type END;

  INSERT INTO public.package_chain_of_custody (
    package_id, event_type, actor_type, actor_id, actor_label,
    location_lat, location_lng, location_label, notes, metadata)
  VALUES (
    _package_id, v_event, 'staff'::trust_subject_type, auth.uid(), v_hub.name,
    v_hub.lat, v_hub.lng, v_hub.code, _notes,
    jsonb_build_object('hub_id', _hub_id, 'hub_code', v_hub.code,
                       'crossdock_stage', _stage, 'manifest_id', _manifest_id))
  RETURNING id INTO v_custody;

  INSERT INTO public.logistics_hub_package_stage (
    hub_id, package_id, stage, inbound_manifest_id, outbound_manifest_id,
    custody_event_id, actor_id, notes)
  VALUES (
    _hub_id, _package_id, _stage,
    CASE WHEN _stage = 'received' THEN _manifest_id ELSE NULL END,
    CASE WHEN _stage IN ('consolidated','dispatched') THEN _manifest_id ELSE NULL END,
    v_custody, auth.uid(), _notes)
  ON CONFLICT (package_id) DO UPDATE SET
    hub_id = EXCLUDED.hub_id,
    stage = EXCLUDED.stage,
    inbound_manifest_id = coalesce(EXCLUDED.inbound_manifest_id, public.logistics_hub_package_stage.inbound_manifest_id),
    outbound_manifest_id = coalesce(EXCLUDED.outbound_manifest_id, public.logistics_hub_package_stage.outbound_manifest_id),
    custody_event_id = EXCLUDED.custody_event_id,
    actor_id = EXCLUDED.actor_id,
    notes = EXCLUDED.notes
  RETURNING * INTO v_row;

  PERFORM public._logistics_hub_audit(_hub_id, 'crossdock_movement', NULL, to_jsonb(v_row));
  RETURN v_row;
END;
$$;

/* ------------------------------ grant contract ---------------------------- */
DO $$
DECLARE
  fn text;
BEGIN
  FOR fn IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'logistics_hub_authorised','logistics_hub_serves_location','logistics_hub_open_at',
         'logistics_hub_upsert','logistics_hub_set_status','logistics_hub_set_active',
         'logistics_hub_set_capacity','logistics_hub_set_capabilities','logistics_hub_assign_operator',
         'logistics_hub_area_upsert','logistics_hub_area_delete','logistics_hub_hours_set',
         'logistics_hub_closure_upsert','logistics_hub_closure_delete',
         'logistics_hub_contact_upsert','logistics_hub_contact_retire','logistics_hub_process_package')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;