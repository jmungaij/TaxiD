CREATE OR REPLACE FUNCTION public.wh_receiving_reconcile(
  _session_id uuid, _variance_note text DEFAULT NULL, _close boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s public.logistics_receiving_sessions; v_expected integer; v_received integer;
  v_sorted integer; v_staged integer; v_dispatched integer; v_missing integer;
  v_man_status text;
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

    -- the inbound manifest is the authority: closing the receipt reconciles it,
    -- which releases its packages for outbound manifesting.
    IF v_s.manifest_id IS NOT NULL THEN
      SELECT status INTO v_man_status FROM public.logistics_manifests WHERE id = v_s.manifest_id;
      IF v_man_status = 'dispatched' THEN
        PERFORM public.logistics_manifest_transition(v_s.manifest_id, 'received', NULL,
                                                    'hub receipt completed');
        v_man_status := 'received';
      END IF;
      IF v_man_status = 'received' THEN
        PERFORM public.logistics_manifest_transition(v_s.manifest_id, 'reconciled', NULL,
                                                    coalesce(_variance_note, 'receipt reconciled'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('session_id', _session_id, 'expected', v_expected,
    'received', v_received, 'sorted', v_sorted, 'staged', v_staged,
    'dispatched', v_dispatched, 'missing', v_missing,
    'damaged', v_s.damaged_count, 'variance_explained', v_s.variance_explained,
    'inbound_manifest_status', (SELECT status FROM public.logistics_manifests WHERE id = v_s.manifest_id),
    'status', CASE WHEN _close THEN 'RECONCILED' ELSE v_s.status END);
END; $$;

REVOKE ALL ON FUNCTION public.wh_receiving_reconcile(uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_receiving_reconcile(uuid,text,boolean) TO authenticated, service_role;