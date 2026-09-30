-- Generation failures are a first-class outcome: park the letter with a reason
-- instead of letting the worker retry an unfixable data defect forever.
CREATE OR REPLACE FUNCTION public.rec_comm_mark_generation_failed(
  p_request_id uuid, p_reason text, p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.rec_comm_requests;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_req FROM public.rec_comm_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.state NOT IN ('generating','approved') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'state', v_req.state);
  END IF;

  UPDATE public.rec_comm_requests
     SET state = 'failed', failed_at = now(), state_reason = p_reason,
         last_error = p_reason, claimed_at = NULL, updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, previous_state, new_state, context)
  VALUES ('comm_generation_failed', 'rec_comm_request', p_request_id,
          jsonb_build_object('state', v_req.state), jsonb_build_object('state', 'failed'),
          jsonb_build_object('reason', p_reason) || COALESCE(p_detail, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'state', 'failed');
END $$;

REVOKE ALL ON FUNCTION public.rec_comm_mark_generation_failed(uuid, text, jsonb) FROM anon;