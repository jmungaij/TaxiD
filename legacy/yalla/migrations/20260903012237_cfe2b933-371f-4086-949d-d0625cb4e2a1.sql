CREATE OR REPLACE FUNCTION public.ai_action_request_open(_recommendation_id uuid, _payload jsonb, _idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE r public.ai_recommendations; v_pol jsonb; v_id uuid; v_state public.ai_action_state; v_actor uuid := auth.uid();
BEGIN
  IF NOT (public.ai_ops_is_governor(v_actor)
          OR current_setting('role', true) = 'service_role'
          OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorised to open an AI action request';
  END IF;

  SELECT * INTO r FROM public.ai_recommendations WHERE id = _recommendation_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Unknown recommendation'; END IF;
  IF r.status <> 'OPEN' THEN RAISE EXCEPTION 'Recommendation is % and can no longer be actioned', r.status; END IF;
  IF NOT coalesce(r.grounded, false) OR r.context_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'Recommendation is not grounded in an evidence snapshot and cannot be actioned';
  END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at < now() THEN
    UPDATE public.ai_recommendations SET status = 'EXPIRED' WHERE id = r.id;
    RAISE EXCEPTION 'Recommendation has expired; regenerate it against current data';
  END IF;

  SELECT id INTO v_id FROM public.ai_action_requests WHERE idempotency_key = _idempotency_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('action_request_id', v_id, 'duplicate', true);
  END IF;

  v_pol := public.ai_policy_evaluate(r.recommendation_type);
  IF NOT (v_pol->>'allowed')::boolean THEN
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, actor_id, actor_kind, policy_result, detail)
    VALUES ('ACTION_BLOCKED', r.id, v_actor, 'OPERATOR', v_pol, jsonb_build_object('reason', v_pol->>'reason'));
    RAISE EXCEPTION 'Policy blocks this action: %', coalesce(v_pol->>'reason', v_pol->>'rationale');
  END IF;

  v_state := CASE WHEN (v_pol->>'requires_approval')::boolean THEN 'APPROVAL_PENDING' ELSE 'APPROVED' END;

  INSERT INTO public.ai_action_requests (recommendation_id, action_type, classification, policy_id,
    policy_result, target_service, payload, entity_type, entity_id, requested_by, requested_by_kind,
    state, idempotency_key, expires_at, context_snapshot_id, context_hash)
  VALUES (r.id, r.recommendation_type, (v_pol->>'classification')::public.ai_action_class,
    nullif(v_pol->>'policy_id','')::uuid, v_pol, v_pol->>'target_service', coalesce(_payload,'{}'::jsonb),
    r.entity_type, r.entity_id, v_actor,
    CASE WHEN v_actor IS NULL THEN 'AGENT' ELSE 'OPERATOR' END,
    v_state, _idempotency_key, coalesce(r.expires_at, now() + interval '12 hours'),
    r.context_snapshot_id, r.context_hash)
  RETURNING id INTO v_id;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id,
    actor_kind, policy_result, detail)
  VALUES ('ACTION_REQUESTED', r.id, v_id, v_actor,
          CASE WHEN v_actor IS NULL THEN 'AGENT' ELSE 'OPERATOR' END, v_pol,
          jsonb_build_object('state', v_state, 'context_hash', r.context_hash));

  RETURN jsonb_build_object('action_request_id', v_id, 'duplicate', false,
    'state', v_state, 'classification', v_pol->>'classification', 'policy', v_pol);
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_action_request_open(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_action_request_open(uuid, jsonb, text) TO authenticated, service_role;