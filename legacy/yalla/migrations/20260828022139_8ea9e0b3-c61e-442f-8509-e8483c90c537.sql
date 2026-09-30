-- Driver eligibility for logistics manifest assignment
CREATE OR REPLACE FUNCTION public.logistics_driver_eligible(_driver_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.drivers d
     WHERE d.user_id = _driver_user_id
       AND d.status::text = 'active'
       AND d.verification_status::text IN ('verified','approved')
  );
$$;

REVOKE ALL ON FUNCTION public.logistics_driver_eligible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_driver_eligible(uuid) TO authenticated, service_role;

-- Eligible drivers the dispatcher may actually pick (no PII beyond name).
CREATE OR REPLACE FUNCTION public.logistics_eligible_drivers(_search text DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, full_name text, driver_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.read') THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT d.user_id,
         coalesce(p.full_name, 'Driver ' || left(d.user_id::text, 8)) AS full_name,
         d.driver_type::text
    FROM public.drivers d
    LEFT JOIN public.profiles p ON p.id = d.user_id
   WHERE d.status::text = 'active'
     AND d.verification_status::text IN ('verified','approved')
     AND d.user_id IS NOT NULL
     AND (_search IS NULL OR _search = ''
          OR coalesce(p.full_name, '') ILIKE '%' || _search || '%')
   ORDER BY full_name
   LIMIT greatest(1, least(coalesce(_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_eligible_drivers(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_eligible_drivers(text, integer) TO authenticated, service_role;

-- Enforce eligibility inside the manifest lifecycle
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

  IF _to_status = 'assigned' THEN
    IF _driver_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A driver is required to assign a manifest');
    END IF;
    IF NOT public.logistics_driver_eligible(_driver_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR',
                                'message', 'That driver is not an active, verified driver and cannot be assigned');
    END IF;
  END IF;

  IF _to_status = 'dispatched' THEN
    IF v_man.assigned_driver_id IS NULL OR NOT public.logistics_driver_eligible(v_man.assigned_driver_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR',
                                'message', 'The assigned driver is no longer eligible — reassign the manifest before dispatch');
    END IF;
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