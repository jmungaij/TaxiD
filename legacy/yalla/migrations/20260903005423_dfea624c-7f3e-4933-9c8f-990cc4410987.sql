CREATE OR REPLACE FUNCTION public.ai_action_decide(
  _action_request_id uuid, _decision text, _reason text, _evidence_reviewed boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.ai_action_requests; v_actor uuid := auth.uid(); v_state public.ai_action_state;
        v_reval jsonb; v_blocking text[];
BEGIN
  IF NOT public.ai_ops_is_governor(v_actor) THEN
    RAISE EXCEPTION 'Not authorised to decide AI action approvals';
  END IF;
  IF _decision NOT IN ('APPROVED','REJECTED','DEFERRED','ESCALATED') THEN
    RAISE EXCEPTION 'Invalid decision %', _decision;
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN
    RAISE EXCEPTION 'Record a reason for the decision';
  END IF;
  IF NOT _evidence_reviewed THEN
    RAISE EXCEPTION 'The evidence must be reviewed before a decision is recorded';
  END IF;

  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  IF a.state <> 'APPROVAL_PENDING' THEN
    RAISE EXCEPTION 'Action request is % and is not awaiting a decision', a.state;
  END IF;
  IF a.requested_by IS NOT NULL AND a.requested_by = v_actor THEN
    RAISE EXCEPTION 'The requester may not approve their own action';
  END IF;

  -- expiry: refusal evidence must survive, so record and return instead of aborting
  IF a.expires_at IS NOT NULL AND a.expires_at < now() THEN
    UPDATE public.ai_action_requests SET state = 'EXPIRED', updated_at = now() WHERE id = a.id;
    PERFORM public.ai_non_action_record('ACTION_EXPIRED',
      'The approval window closed before a decision was recorded',
      jsonb_build_object('expired_at', a.expires_at), NULL, a.recommendation_id, a.id, '[]'::jsonb,
      'Regenerate the recommendation against current data');
    RETURN jsonb_build_object('action_request_id', a.id, 'state','EXPIRED',
      'decision','REFUSED', 'code','ACTION_EXPIRED',
      'message','The approval window has expired; regenerate the recommendation');
  END IF;

  IF _decision = 'APPROVED' THEN
    v_reval := public.ai_context_revalidate(a.id);
    SELECT array_agg(x) INTO v_blocking
      FROM jsonb_array_elements_text(v_reval->'reasons') AS t(x)
     WHERE x <> 'APPROVAL_STALE_OR_MISSING';
    IF v_blocking IS NOT NULL AND cardinality(v_blocking) > 0 THEN
      PERFORM public.ai_non_action_record('STALE_CONTEXT',
        format('Approval refused: %s', array_to_string(v_blocking, ', ')),
        v_reval, NULL, a.recommendation_id, a.id, '[]'::jsonb,
        'Regenerate the recommendation from current authoritative state');
      INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
      VALUES ('APPROVAL_REFUSED_STALE', a.recommendation_id, a.id, v_actor, 'OPERATOR', v_reval);
      RETURN jsonb_build_object('action_request_id', a.id, 'state', a.state,
        'decision','REFUSED', 'code','STALE_CONTEXT',
        'reasons', to_jsonb(v_blocking),
        'message', format('Cannot approve: %s', array_to_string(v_blocking, ', ')));
    END IF;
  END IF;

  INSERT INTO public.ai_action_approvals (action_request_id, decision, approver_id, reason,
    evidence_reviewed, bound_context_hash, bound_policy_version, bound_entity_id, expires_at)
  VALUES (a.id, _decision, v_actor, _reason, _evidence_reviewed,
    a.context_hash, a.policy_version, a.entity_id,
    least(coalesce(a.expires_at, now() + interval '2 hours'), now() + interval '2 hours'));

  v_state := CASE _decision
    WHEN 'APPROVED' THEN 'APPROVED'::public.ai_action_state
    WHEN 'REJECTED' THEN 'REJECTED'::public.ai_action_state
    ELSE 'APPROVAL_PENDING'::public.ai_action_state END;

  UPDATE public.ai_action_requests SET state = v_state, updated_at = now() WHERE id = a.id;
  IF _decision = 'REJECTED' THEN
    UPDATE public.ai_recommendations SET status = 'DISMISSED' WHERE id = a.recommendation_id;
  END IF;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
  VALUES ('APPROVAL_DECIDED', a.recommendation_id, a.id, v_actor, 'OPERATOR',
          jsonb_build_object('decision', _decision, 'reason', _reason,
            'bound_context_hash', a.context_hash, 'bound_policy_version', a.policy_version));

  RETURN jsonb_build_object('action_request_id', a.id, 'state', v_state, 'decision', _decision,
    'bound_context_hash', a.context_hash);
END $$;

UPDATE public.ai_security_ledger
   SET finding_count = 939, updated_at = now(),
       evidence = evidence || jsonb_build_object('note',
         'Baseline unchanged by Stage 10B except two governor-gated functions (ai_non_action_record, ai_context_revalidate) intentionally callable by signed-in operations governors.')
 WHERE finding_key = 'linter.security_definer_authenticated_executable';