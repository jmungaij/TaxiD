DELETE FROM public.logistics_event_catalogue
 WHERE event_type = 'logistics.control_tower.command_executed'
   AND aggregate_type <> 'control_tower';

CREATE OR REPLACE FUNCTION public.ct_command_execute(_operation text, _entity_type text, _entity_id uuid,
                                                     _payload jsonb DEFAULT '{}'::jsonb,
                                                     _request_id text DEFAULT NULL, _correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op text := upper(coalesce(_operation,'')); v_perm text := 'staff.logistics.control_tower.manage';
        v_req text := coalesce(_request_id, gen_random_uuid()::text);
        v_corr text := coalesce(_correlation_id, gen_random_uuid()::text);
        v_started timestamptz := clock_timestamp(); v_result jsonb; v_ok boolean; v_payload jsonb := coalesce(_payload,'{}'::jsonb);
BEGIN
  IF NOT public.has_staff_permission(v_perm) THEN
    INSERT INTO public.control_tower_commands (request_id, correlation_id, operation, entity_type, entity_id,
      actor_id, permission_required, outcome, error_code, error_message, latency_ms, payload)
    VALUES (v_req, v_corr, v_op, _entity_type, _entity_id, auth.uid(), v_perm, 'REJECTED',
            'AUTHORIZATION_DENIED','Missing permission '||v_perm, 0, v_payload);
    RETURN public.ct_denied(v_perm, v_op) || jsonb_build_object('request_id', v_req, 'correlation_id', v_corr);
  END IF;

  BEGIN
    CASE v_op
      WHEN 'ASSIGN_DRIVER', 'REASSIGN_DRIVER', 'ASSIGN_VEHICLE', 'REASSIGN_VEHICLE' THEN
        v_result := public.logistics_route_assign(_entity_id,
                      nullif(v_payload->>'driver_user_id','')::uuid,
                      nullif(v_payload->>'vehicle_id','')::uuid,
                      coalesce(v_payload->>'reason', v_op),
                      coalesce((v_payload->>'force')::boolean, false));
      WHEN 'REORDER_STOPS' THEN
        v_result := public.logistics_route_reorder_stops(_entity_id,
                      ARRAY(SELECT jsonb_array_elements_text(v_payload->'stop_ids'))::uuid[],
                      coalesce(v_payload->>'reason','Control Tower reorder'));
      WHEN 'RECALCULATE_ROUTE', 'REROUTE' THEN
        v_result := public.logistics_route_optimize(_entity_id, v_payload->>'provider_key', v_payload);
      WHEN 'HOLD_DISPATCH' THEN
        v_result := public.logistics_route_transition(_entity_id, coalesce(v_payload->>'to_status','ON_HOLD'),
                      coalesce(v_payload->>'reason','Held from Control Tower'));
      WHEN 'RELEASE_DISPATCH' THEN
        v_result := public.logistics_route_transition(_entity_id, coalesce(v_payload->>'to_status','DISPATCHED'),
                      coalesce(v_payload->>'reason','Released from Control Tower'));
      WHEN 'ESCALATE_EXCEPTION' THEN
        v_result := public.logistics_exception_transition(_entity_id, coalesce(v_payload->>'to_status','ESCALATED'),
                      v_payload->>'note', NULL, coalesce(v_payload->>'severity','critical'));
      WHEN 'RESOLVE_EXCEPTION' THEN
        v_result := public.logistics_exception_transition(_entity_id, 'RESOLVED', v_payload->>'note',
                      v_payload->>'resolution', NULL);
      WHEN 'ASSIGN_EXCEPTION' THEN
        v_result := public.logistics_exception_transition(_entity_id, coalesce(v_payload->>'to_status','IN_PROGRESS'),
                      v_payload->>'note', NULL, NULL);
      WHEN 'CREATE_RETURN' THEN
        v_result := public.logistics_return_authorize(_entity_id, coalesce(v_payload->>'reason','Control Tower return'),
                      v_payload->>'reason_code', nullif(v_payload->>'destination_hub_id','')::uuid,
                      v_payload->>'service_level', v_payload->>'instructions',
                      coalesce((v_payload->>'merchant_approval_required')::boolean, false));
      WHEN 'REATTEMPT_DELIVERY' THEN
        v_result := public.logistics_record_delivery_attempt(_entity_id, 'rescheduled',
                      coalesce(v_payload->>'idempotency_key', v_req), coalesce(v_payload->>'reason_code','ops_reattempt'),
                      coalesce(v_payload->>'narrative','Re-attempt scheduled from Control Tower'),
                      NULL, NULL, NULL, jsonb_build_object('source','control_tower'));
      WHEN 'RESOLVE_DEVIATION' THEN
        v_result := public.logistics_route_resolve_deviation(_entity_id, coalesce(v_payload->>'status','RESOLVED'),
                      v_payload->>'note');
      WHEN 'STOP_TRANSITION' THEN
        v_result := public.logistics_stop_transition(_entity_id, v_payload->>'to_status',
                      coalesce(v_payload->>'reason','Control Tower'), NULL, NULL);
      ELSE
        v_result := jsonb_build_object('ok', false, 'code','UNSUPPORTED_COMMAND','category','validation',
                      'retryable', false, 'message','That command is not available from the Control Tower.',
                      'reason', v_op);
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.control_tower_commands (request_id, correlation_id, operation, entity_type, entity_id,
      actor_id, permission_required, outcome, error_code, error_message, latency_ms, payload)
    VALUES (v_req, v_corr, v_op, _entity_type, _entity_id, auth.uid(), v_perm, 'FAILED', SQLSTATE,
            'Command could not be completed.', (extract(epoch FROM clock_timestamp()-v_started)*1000)::int, v_payload);
    RETURN jsonb_build_object('ok', false, 'code','COMMAND_FAILED','category','system','retryable', true,
      'severity','error','message','The command could not be completed. Operations has been notified.',
      'reason','execution_error','operation', v_op, 'request_id', v_req, 'correlation_id', v_corr, 'timestamp', now());
  END;

  v_ok := coalesce((v_result->>'ok')::boolean, true);

  INSERT INTO public.control_tower_commands (request_id, correlation_id, operation, entity_type, entity_id,
    actor_id, permission_required, outcome, error_code, error_message, latency_ms, payload, result)
  VALUES (v_req, v_corr, v_op, _entity_type, _entity_id, auth.uid(), v_perm,
          CASE WHEN v_ok THEN 'APPLIED' ELSE 'REJECTED' END,
          v_result->>'code', v_result->>'message',
          (extract(epoch FROM clock_timestamp()-v_started)*1000)::int, v_payload, coalesce(v_result,'{}'::jsonb));

  IF v_ok THEN
    -- The command itself is a Control Tower aggregate event; the affected
    -- operational record travels in the payload.
    BEGIN
      PERFORM public.logistics_event_emit_internal(
        'logistics.control_tower.command_executed', 'control_tower', _entity_id,
        jsonb_build_object('operation', v_op, 'entity_type', _entity_type, 'entity_id', _entity_id, 'result', v_result),
        NULL, v_corr, NULL, 'staff', auth.uid(), NULL, false,
        jsonb_build_object('request_id', v_req), 'ct:'||v_req);
    EXCEPTION WHEN OTHERS THEN
      -- Never lose an applied command because publication failed.
      NULL;
    END;
  END IF;

  RETURN coalesce(v_result,'{}'::jsonb) || jsonb_build_object('request_id', v_req, 'correlation_id', v_corr,
                                                              'operation', v_op, 'timestamp', now());
END; $$;

DO $$
DECLARE s text := (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='ct_command_execute');
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', s);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', s);
END $$;