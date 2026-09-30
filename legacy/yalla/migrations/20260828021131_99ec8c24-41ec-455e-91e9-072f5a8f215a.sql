-- ============================================================================
-- Logistics manifest + hub custody engine
-- ============================================================================

/* --------------------------------- hubs ---------------------------------- */
CREATE TABLE public.logistics_hubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  hub_type text NOT NULL DEFAULT 'depot' CHECK (hub_type IN ('depot','warehouse','cross_dock','locker','partner_site')),
  city text,
  address text,
  lat numeric,
  lng numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logistics_hubs TO authenticated;
GRANT ALL ON public.logistics_hubs TO service_role;
ALTER TABLE public.logistics_hubs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hubs_staff_read" ON public.logistics_hubs
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE POLICY "hubs_admin_write" ON public.logistics_hubs
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TRIGGER trg_logistics_hubs_touch BEFORE UPDATE ON public.logistics_hubs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* ------------------------------- manifests -------------------------------- */
CREATE SEQUENCE IF NOT EXISTS public.logistics_manifest_seq;

CREATE TABLE public.logistics_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_number text NOT NULL UNIQUE
    DEFAULT 'MAN-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.logistics_manifest_seq')::text, 6, '0'),
  manifest_type text NOT NULL DEFAULT 'delivery_run'
    CHECK (manifest_type IN ('pickup_run','line_haul','delivery_run','hub_inbound','hub_outbound','return_run')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','assigned','dispatched','received','reconciled','cancelled')),
  origin_hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE SET NULL,
  destination_hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE SET NULL,
  assigned_driver_id uuid,
  vehicle_id uuid,
  notes text,
  planned_departure timestamptz,
  closed_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  reconciled_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_manifests_status ON public.logistics_manifests(status, created_at DESC);
CREATE INDEX idx_logistics_manifests_driver ON public.logistics_manifests(assigned_driver_id);

GRANT SELECT ON public.logistics_manifests TO authenticated;
GRANT ALL ON public.logistics_manifests TO service_role;
ALTER TABLE public.logistics_manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manifests_staff_read" ON public.logistics_manifests
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read')
         OR assigned_driver_id = auth.uid());

CREATE TRIGGER trg_logistics_manifests_touch BEFORE UPDATE ON public.logistics_manifests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.logistics_manifest_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES public.logistics_manifests(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  tracking_number text NOT NULL,
  scan_state text NOT NULL DEFAULT 'expected'
    CHECK (scan_state IN ('expected','loaded','received','missing','damaged','rejected')),
  loaded_at timestamptz,
  received_at timestamptz,
  exception_note text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, package_id)
);

CREATE INDEX idx_manifest_lines_manifest ON public.logistics_manifest_lines(manifest_id);
CREATE INDEX idx_manifest_lines_package ON public.logistics_manifest_lines(package_id);

GRANT SELECT ON public.logistics_manifest_lines TO authenticated;
GRANT ALL ON public.logistics_manifest_lines TO service_role;
ALTER TABLE public.logistics_manifest_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manifest_lines_staff_read" ON public.logistics_manifest_lines
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read')
         OR EXISTS (SELECT 1 FROM public.logistics_manifests m
                     WHERE m.id = manifest_id AND m.assigned_driver_id = auth.uid()));

CREATE TRIGGER trg_manifest_lines_touch BEFORE UPDATE ON public.logistics_manifest_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.logistics_manifest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES public.logistics_manifests(id) ON DELETE CASCADE,
  package_id uuid,
  event_name text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manifest_events_manifest ON public.logistics_manifest_events(manifest_id, created_at);

GRANT SELECT ON public.logistics_manifest_events TO authenticated;
GRANT ALL ON public.logistics_manifest_events TO service_role;
ALTER TABLE public.logistics_manifest_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manifest_events_staff_read" ON public.logistics_manifest_events
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._logistics_manifest_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'logistics_manifest_events is append-only';
END;
$$;

CREATE TRIGGER trg_manifest_events_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_manifest_events
  FOR EACH ROW EXECUTE FUNCTION public._logistics_manifest_events_append_only();

/* ------------------------- custody helper (internal) ---------------------- */
CREATE OR REPLACE FUNCTION public._logistics_record_custody(
  _package_id uuid,
  _event_type custody_event_type,
  _label text,
  _notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.package_chain_of_custody (package_id, event_type, actor_id, actor_label, location_label, notes)
  VALUES (_package_id, _event_type, auth.uid(), _label, _label, _notes);
END;
$$;

REVOKE ALL ON FUNCTION public._logistics_record_custody(uuid, custody_event_type, text, text) FROM PUBLIC, anon, authenticated;

/* ---------------------------- manifest RPCs ------------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_manifest_create(
  _manifest_type text,
  _origin_hub_id uuid DEFAULT NULL,
  _destination_hub_id uuid DEFAULT NULL,
  _planned_departure timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_number text;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted to create manifests');
  END IF;
  IF _manifest_type NOT IN ('pickup_run','line_haul','delivery_run','hub_inbound','hub_outbound','return_run') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'Unknown manifest type');
  END IF;

  INSERT INTO public.logistics_manifests (manifest_type, origin_hub_id, destination_hub_id, planned_departure, notes, created_by)
  VALUES (_manifest_type, _origin_hub_id, _destination_hub_id, _planned_departure, _notes, auth.uid())
  RETURNING id, manifest_number INTO v_id, v_number;

  INSERT INTO public.logistics_manifest_events (manifest_id, event_name, to_status, actor_id)
  VALUES (v_id, 'logistics.manifest.created', 'open', auth.uid());

  INSERT INTO public.audit_logs (actor_user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'logistics_manifest', v_id, 'logistics.manifest.created',
          jsonb_build_object('manifest_number', v_number, 'type', _manifest_type));

  RETURN jsonb_build_object('ok', true, 'manifest_id', v_id, 'manifest_number', v_number, 'status', 'open');
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_manifest_create(text, uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_manifest_create(text, uuid, uuid, timestamptz, text) TO authenticated, service_role;

-- Add / scan a package onto a manifest by id or tracking number.
CREATE OR REPLACE FUNCTION public.logistics_manifest_scan(
  _manifest_id uuid,
  _identifier text,
  _scan_state text DEFAULT 'loaded',
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_man public.logistics_manifests;
  v_pkg public.packages;
  v_line public.logistics_manifest_lines;
  v_is_staff boolean;
  v_other text;
BEGIN
  IF _scan_state NOT IN ('loaded','received','damaged','rejected','missing') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'Unknown scan state');
  END IF;
  IF _identifier IS NULL OR length(trim(_identifier)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A package identifier is required');
  END IF;

  SELECT * INTO v_man FROM public.logistics_manifests WHERE id = _manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Manifest not found');
  END IF;

  v_is_staff := public.logistics_ops_actor_authorised('staff.logistics.manage');
  IF NOT v_is_staff AND v_man.assigned_driver_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted to scan this manifest');
  END IF;

  IF v_man.status IN ('reconciled','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'message', 'This manifest is closed for scanning');
  END IF;
  IF _scan_state = 'loaded' AND v_man.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION',
                              'message', 'Packages can only be loaded while the manifest is open');
  END IF;
  IF _scan_state = 'received' AND v_man.status NOT IN ('dispatched','received') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION',
                              'message', 'Receiving scans are only valid after dispatch');
  END IF;

  SELECT * INTO v_pkg FROM public.packages
   WHERE id::text = trim(_identifier) OR upper(tracking_number) = upper(trim(_identifier))
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'No package matches that identifier');
  END IF;

  SELECT * INTO v_line FROM public.logistics_manifest_lines
   WHERE manifest_id = _manifest_id AND package_id = v_pkg.id;

  IF FOUND AND v_line.scan_state = _scan_state THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'package_id', v_pkg.id,
                              'tracking_number', v_pkg.tracking_number, 'scan_state', v_line.scan_state);
  END IF;

  IF NOT FOUND THEN
    -- a package may only sit on one non-terminal manifest at a time
    SELECT m.manifest_number INTO v_other
      FROM public.logistics_manifest_lines l
      JOIN public.logistics_manifests m ON m.id = l.manifest_id
     WHERE l.package_id = v_pkg.id
       AND m.id <> _manifest_id
       AND m.status NOT IN ('reconciled','cancelled')
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
                                'message', format('Package is already on active manifest %s', v_other));
    END IF;

    INSERT INTO public.logistics_manifest_lines (manifest_id, package_id, tracking_number, scan_state, added_by,
                                                 loaded_at, received_at, exception_note)
    VALUES (_manifest_id, v_pkg.id, v_pkg.tracking_number, _scan_state, auth.uid(),
            CASE WHEN _scan_state = 'loaded' THEN now() END,
            CASE WHEN _scan_state = 'received' THEN now() END,
            _note)
    RETURNING * INTO v_line;
  ELSE
    UPDATE public.logistics_manifest_lines
       SET scan_state = _scan_state,
           loaded_at = CASE WHEN _scan_state = 'loaded' THEN now() ELSE loaded_at END,
           received_at = CASE WHEN _scan_state = 'received' THEN now() ELSE received_at END,
           exception_note = coalesce(_note, exception_note)
     WHERE id = v_line.id
    RETURNING * INTO v_line;
  END IF;

  PERFORM public._logistics_record_custody(
    v_pkg.id,
    CASE _scan_state
      WHEN 'loaded' THEN 'handover'::custody_event_type
      WHEN 'received' THEN 'warehouse_in'::custody_event_type
      ELSE 'transit'::custody_event_type END,
    format('Manifest %s', v_man.manifest_number),
    coalesce(_note, format('scan=%s', _scan_state)));

  INSERT INTO public.logistics_manifest_events (manifest_id, package_id, event_name, note, actor_id)
  VALUES (_manifest_id, v_pkg.id, 'logistics.manifest.scan.' || _scan_state, _note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'package_id', v_pkg.id,
                            'tracking_number', v_pkg.tracking_number, 'scan_state', _scan_state,
                            'line_id', v_line.id);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_manifest_scan(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_manifest_scan(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistics_manifest_remove_package(
  _manifest_id uuid,
  _package_id uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_man public.logistics_manifests; v_deleted integer;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted');
  END IF;
  SELECT * INTO v_man FROM public.logistics_manifests WHERE id = _manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Manifest not found');
  END IF;
  IF v_man.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION',
                              'message', 'Packages can only be removed while the manifest is open');
  END IF;

  DELETE FROM public.logistics_manifest_lines WHERE manifest_id = _manifest_id AND package_id = _package_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Package is not on this manifest');
  END IF;

  INSERT INTO public.logistics_manifest_events (manifest_id, package_id, event_name, note, actor_id)
  VALUES (_manifest_id, _package_id, 'logistics.manifest.package_removed', _reason, auth.uid());

  RETURN jsonb_build_object('ok', true, 'manifest_id', _manifest_id, 'package_id', _package_id);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_manifest_remove_package(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_manifest_remove_package(uuid, uuid, text) TO authenticated, service_role;

-- Lifecycle: close / assign / dispatch / receive / reconcile / cancel
CREATE OR REPLACE FUNCTION public.logistics_manifest_transition(
  _manifest_id uuid,
  _to_status text,
  _driver_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_man public.logistics_manifests;
  v_lines integer;
  v_unaccounted integer;
  v_allowed boolean;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted to manage manifests');
  END IF;
  IF _to_status NOT IN ('closed','assigned','dispatched','received','reconciled','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'Unknown manifest status');
  END IF;

  SELECT * INTO v_man FROM public.logistics_manifests WHERE id = _manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Manifest not found');
  END IF;
  IF v_man.status = _to_status THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_IN_TARGET_STATE', 'message', 'Manifest is already in that status');
  END IF;
  IF v_man.status IN ('reconciled','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'message', 'Manifest is already final');
  END IF;

  v_allowed := CASE
    WHEN _to_status = 'cancelled' THEN v_man.status IN ('open','closed','assigned')
    WHEN _to_status = 'closed' THEN v_man.status = 'open'
    WHEN _to_status = 'assigned' THEN v_man.status IN ('closed','assigned')
    WHEN _to_status = 'dispatched' THEN v_man.status = 'assigned'
    WHEN _to_status = 'received' THEN v_man.status = 'dispatched'
    WHEN _to_status = 'reconciled' THEN v_man.status = 'received'
    ELSE false END;
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION',
                              'message', format('Cannot move a %s manifest to %s', v_man.status, _to_status));
  END IF;

  SELECT count(*) INTO v_lines FROM public.logistics_manifest_lines WHERE manifest_id = _manifest_id;

  IF _to_status = 'closed' AND v_lines = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'An empty manifest cannot be closed');
  END IF;
  IF _to_status = 'assigned' AND _driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A driver is required to assign a manifest');
  END IF;
  IF _to_status = 'reconciled' THEN
    SELECT count(*) INTO v_unaccounted FROM public.logistics_manifest_lines
     WHERE manifest_id = _manifest_id AND scan_state IN ('expected','loaded');
    IF v_unaccounted > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR',
                                'message', format('%s package(s) are still unaccounted for', v_unaccounted));
    END IF;
  END IF;

  UPDATE public.logistics_manifests
     SET status = _to_status,
         assigned_driver_id = CASE WHEN _to_status = 'assigned' THEN _driver_id ELSE assigned_driver_id END,
         closed_at = CASE WHEN _to_status = 'closed' THEN now() ELSE closed_at END,
         dispatched_at = CASE WHEN _to_status = 'dispatched' THEN now() ELSE dispatched_at END,
         received_at = CASE WHEN _to_status = 'received' THEN now() ELSE received_at END,
         reconciled_at = CASE WHEN _to_status = 'reconciled' THEN now() ELSE reconciled_at END,
         notes = coalesce(_note, notes)
   WHERE id = _manifest_id;

  IF _to_status = 'dispatched' THEN
    UPDATE public.packages p
       SET status = CASE WHEN p.status IN ('created','ready_for_pickup','picked_up') THEN 'in_transit' ELSE p.status END,
           assigned_driver_id = coalesce(v_man.assigned_driver_id, p.assigned_driver_id),
           updated_at = now()
     WHERE p.id IN (SELECT package_id FROM public.logistics_manifest_lines
                     WHERE manifest_id = _manifest_id AND scan_state = 'loaded')
       AND p.status NOT IN ('delivered','cancelled','returned');
  END IF;

  INSERT INTO public.logistics_manifest_events (manifest_id, event_name, from_status, to_status, note, actor_id)
  VALUES (_manifest_id, 'logistics.manifest.' || _to_status, v_man.status, _to_status, _note, auth.uid());

  INSERT INTO public.audit_logs (actor_user_id, entity_type, entity_id, action, before_data, after_data)
  VALUES (auth.uid(), 'logistics_manifest', _manifest_id, 'logistics.manifest.transition',
          jsonb_build_object('status', v_man.status),
          jsonb_build_object('status', _to_status, 'driver_id', _driver_id, 'lines', v_lines));

  RETURN jsonb_build_object('ok', true, 'manifest_id', _manifest_id, 'status', _to_status, 'lines', v_lines);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_manifest_transition(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_manifest_transition(uuid, text, uuid, text) TO authenticated, service_role;

-- Reconciliation view of one manifest: expected vs actual, per line.
CREATE OR REPLACE FUNCTION public.logistics_manifest_reconciliation(_manifest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_result jsonb; v_man public.logistics_manifests;
BEGIN
  SELECT * INTO v_man FROM public.logistics_manifests WHERE id = _manifest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Manifest not found');
  END IF;
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.read')
     AND v_man.assigned_driver_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted');
  END IF;

  SELECT jsonb_build_object(
           'ok', true,
           'manifest_id', _manifest_id,
           'status', v_man.status,
           'total', count(*),
           'expected', count(*) FILTER (WHERE scan_state = 'expected'),
           'loaded', count(*) FILTER (WHERE scan_state = 'loaded'),
           'received', count(*) FILTER (WHERE scan_state = 'received'),
           'missing', count(*) FILTER (WHERE scan_state = 'missing'),
           'damaged', count(*) FILTER (WHERE scan_state = 'damaged'),
           'rejected', count(*) FILTER (WHERE scan_state = 'rejected'),
           'lines', coalesce(jsonb_agg(jsonb_build_object(
             'package_id', package_id, 'tracking_number', tracking_number,
             'scan_state', scan_state, 'exception_note', exception_note
           ) ORDER BY tracking_number), '[]'::jsonb))
    INTO v_result
    FROM public.logistics_manifest_lines
   WHERE manifest_id = _manifest_id;

  RETURN coalesce(v_result, jsonb_build_object('ok', true, 'manifest_id', _manifest_id, 'total', 0, 'lines', '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_manifest_reconciliation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_manifest_reconciliation(uuid) TO authenticated, service_role;