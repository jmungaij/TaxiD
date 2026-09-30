CREATE OR REPLACE FUNCTION public.ai_action_execute(_action_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ai_action_requests; ad public.ai_adapters; v_attempt integer; v_exec uuid; v_result jsonb;
  v_verified boolean := false; v_verification jsonb := '{}'::jsonb; v_actor uuid := auth.uid();
  v_req_id uuid; v_reval jsonb; v_cmd_key text; v_cmd_id uuid; v_prior jsonb;
  v_pre jsonb := '{}'::jsonb; v_engine_error boolean := false;
BEGIN
  IF NOT public._ai_is_worker() THEN
    RAISE EXCEPTION 'AI actions are executed only by the orchestration worker';
  END IF;

  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  IF a.state = 'EXECUTED' THEN
    RETURN jsonb_build_object('action_request_id', a.id, 'state','EXECUTED','duplicate', true);
  END IF;
  IF a.state <> 'APPROVED' THEN
    RAISE EXCEPTION 'Action request is % — only an APPROVED action may execute', a.state;
  END IF;
  IF a.classification IN ('HUMAN_ONLY','BLOCKED') THEN
    RAISE EXCEPTION 'Action class % may never be executed by the AI layer', a.classification;
  END IF;

  SELECT * INTO ad FROM public.ai_adapters WHERE action_type = a.action_type AND active;
  IF ad.id IS NULL OR NOT ad.automation_allowed THEN
    PERFORM public.ai_non_action_record('ACTION_NOT_POSSIBLE',
      coalesce(ad.refusal_reason, format('No approved execution adapter exists for %s', a.action_type)),
      jsonb_build_object('action_type', a.action_type, 'adapter_code', ad.adapter_code),
      NULL, a.recommendation_id, a.id, '[]'::jsonb,
      'Route this action to the owning domain team for a human decision');
    UPDATE public.ai_action_requests SET state = 'CANCELLED', updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('action_request_id', a.id, 'state','CANCELLED',
      'executed', false, 'code','ACTION_NOT_POSSIBLE');
  END IF;

  v_reval := public.ai_context_revalidate(a.id);
  IF NOT (v_reval->>'valid')::boolean THEN
    PERFORM public.ai_non_action_record(
      CASE WHEN v_reval->'reasons' ? 'ACTION_EXPIRED' THEN 'ACTION_EXPIRED' ELSE 'STALE_CONTEXT' END,
      'Execution refused: authoritative state, approval binding or policy changed after approval',
      v_reval, NULL, a.recommendation_id, a.id, '[]'::jsonb,
      'Regenerate the recommendation from current authoritative state');
    UPDATE public.ai_action_requests SET state = 'CANCELLED', updated_at = now() WHERE id = a.id;
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_kind, detail)
    VALUES ('STALE_ACTION_CONTEXT', a.recommendation_id, a.id, 'AGENT', v_reval);
    RETURN jsonb_build_object('action_request_id', a.id, 'state','CANCELLED',
      'executed', false, 'code','STALE_ACTION_CONTEXT', 'reasons', v_reval->'reasons');
  END IF;

  v_pre := coalesce(v_reval->'live_state','{}'::jsonb);

  v_cmd_key := ad.adapter_code || ':' || a.action_type || ':' ||
               coalesce(a.payload->>'dispatch_request_id', coalesce(a.entity_id::text,'-')) || ':' ||
               coalesce(a.context_hash,'-');
  SELECT id, result INTO v_cmd_id, v_prior FROM public.ai_domain_commands WHERE command_key = v_cmd_key;
  IF v_cmd_id IS NOT NULL THEN
    RETURN jsonb_build_object('action_request_id', a.id, 'state', a.state,
      'duplicate_domain_command', true, 'result', v_prior);
  END IF;

  SELECT coalesce(max(attempt),0) + 1 INTO v_attempt
    FROM public.ai_action_executions WHERE action_request_id = a.id;

  UPDATE public.ai_action_requests SET state = 'EXECUTING', adapter_id = ad.id, updated_at = now() WHERE id = a.id;
  INSERT INTO public.ai_action_executions (action_request_id, attempt, invoked_service, executed_by)
  VALUES (a.id, v_attempt, ad.target_service, v_actor) RETURNING id INTO v_exec;

  BEGIN
    IF ad.target_function = 'logistics_dispatch_match' THEN
      v_req_id := (a.payload->>'dispatch_request_id')::uuid;
      v_result := public.logistics_dispatch_match(v_req_id, true);
      SELECT jsonb_build_object('status', d.status, 'assigned_vehicle_id', d.assigned_vehicle_id,
               'assigned_driver_id', d.assigned_driver_id)
        INTO v_verification FROM public.logistics_dispatch_requests d WHERE d.id = v_req_id;
      v_engine_error := coalesce((v_result->>'error')::boolean, false);
      -- verified only when the engine accepted AND the assignment actually changed
      v_verified := NOT v_engine_error
                    AND (v_verification->>'assigned_vehicle_id') IS NOT NULL
                    AND v_verification <> v_pre;
    ELSIF ad.target_function = 'logistics_dispatch_override' THEN
      v_req_id := (a.payload->>'dispatch_request_id')::uuid;
      v_result := public.logistics_dispatch_override(
        v_req_id, nullif(a.payload->>'vehicle_id','')::uuid,
        nullif(a.payload->>'driver_id','')::uuid,
        coalesce(a.payload->>'reason','AI-assisted substitution, approved by operations'));
      SELECT jsonb_build_object('status', d.status, 'assigned_vehicle_id', d.assigned_vehicle_id,
               'assigned_driver_id', d.assigned_driver_id)
        INTO v_verification FROM public.logistics_dispatch_requests d WHERE d.id = v_req_id;
      v_engine_error := coalesce((v_result->>'error')::boolean, false);
      v_verified := NOT v_engine_error
        AND ( (a.payload->>'vehicle_id') IS NULL
              OR (v_verification->>'assigned_vehicle_id') = (a.payload->>'vehicle_id') )
        AND ( (a.payload->>'driver_id') IS NULL
              OR (v_verification->>'assigned_driver_id') = (a.payload->>'driver_id') );
    ELSE
      RAISE EXCEPTION 'Adapter % declares target function %, which is not an approved AI entry point',
        ad.adapter_code, coalesce(ad.target_function,'(none)');
    END IF;

    UPDATE public.ai_action_executions
       SET service_result = coalesce(v_result,'{}'::jsonb), succeeded = NOT v_engine_error,
           verified = v_verified, verification = coalesce(v_verification,'{}'::jsonb),
           error_code = CASE WHEN v_engine_error THEN v_result->>'code' END,
           error_message = CASE WHEN v_engine_error THEN coalesce(v_result->>'message', v_result->>'code') END,
           finished_at = now()
     WHERE id = v_exec;

    IF v_verified THEN
      -- a verified command is recorded once, so the business operation cannot repeat
      INSERT INTO public.ai_domain_commands (command_key, action_request_id, adapter_code,
        target_function, result)
      VALUES (v_cmd_key, a.id, ad.adapter_code, ad.target_function, coalesce(v_result,'{}'::jsonb));
      UPDATE public.ai_action_requests SET state = 'EXECUTED', updated_at = now() WHERE id = a.id;
      UPDATE public.ai_recommendations SET status = 'ACTIONED' WHERE id = a.recommendation_id;
    ELSE
      UPDATE public.ai_action_requests SET state = 'FAILED', updated_at = now() WHERE id = a.id;
      PERFORM public.ai_non_action_record('ACTION_NOT_POSSIBLE',
        CASE WHEN v_engine_error
          THEN format('The %s engine refused the command: %s', ad.target_service,
                      coalesce(v_result->>'code', v_result->>'message','refused'))
          ELSE 'The command produced no verifiable change in authoritative state' END,
        jsonb_build_object('engine_result', v_result, 'pre_state', v_pre, 'post_state', v_verification),
        NULL, a.recommendation_id, a.id, '[]'::jsonb,
        'Review the engine refusal with operations before proposing this action again');
    END IF;

    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
    VALUES (CASE WHEN v_verified THEN 'ACTION_EXECUTED' ELSE 'ACTION_UNVERIFIED' END,
            a.recommendation_id, a.id, v_actor, 'AGENT',
            jsonb_build_object('attempt', v_attempt, 'adapter', ad.adapter_code,
              'service', ad.target_service, 'verified', v_verified,
              'engine_error', v_engine_error, 'command_key', v_cmd_key));

    RETURN jsonb_build_object('action_request_id', a.id,
      'state', CASE WHEN v_verified THEN 'EXECUTED' ELSE 'FAILED' END,
      'verified', v_verified, 'engine_error', v_engine_error, 'attempt', v_attempt,
      'adapter', ad.adapter_code, 'result', v_result);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.ai_action_executions
       SET succeeded = false, verified = false, error_code = SQLSTATE,
           error_message = SQLERRM, finished_at = now()
     WHERE id = v_exec;
    UPDATE public.ai_action_requests SET state = 'FAILED', updated_at = now() WHERE id = a.id;
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
    VALUES ('ACTION_FAILED', a.recommendation_id, a.id, v_actor, 'AGENT',
            jsonb_build_object('attempt', v_attempt, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    RETURN jsonb_build_object('action_request_id', a.id, 'state','FAILED',
      'verified', false, 'error', SQLERRM);
  END;
END $$;