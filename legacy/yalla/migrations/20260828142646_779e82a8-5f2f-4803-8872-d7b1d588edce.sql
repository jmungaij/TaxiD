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
  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', v_res->>'code', 'message', v_res->>'message');
  END IF;
  SELECT package_id INTO v_pkg FROM public.package_returns WHERE id = _return_id;
  v_op := public._wh_log(_operation_key, 'RETURN_RECEIVE', _hub_id, v_pkg,
    coalesce(v_res,'{}'::jsonb), NULL, NULL, NULL, public._wh_last_custody(v_pkg), NULL, NULL,
    NULL, 'returned', NULL, _notes, NULL, 'RETURNS', NULL, _return_id);
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'operation_id', v_op.id, 'result', v_res);
END; $$;

REVOKE ALL ON FUNCTION public.wh_return_receive(uuid,uuid,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wh_return_receive(uuid,uuid,text,text,text,text,text,text,jsonb) TO authenticated, service_role;