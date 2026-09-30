-- =============================================================================
-- PHASE 8 (part 2) — SYNCHRONISATION ENGINE
-- Every accepted command is applied through the EXISTING authoritative RPCs.
-- =============================================================================

-- ------------------------------------------------- supported command registry
CREATE TABLE IF NOT EXISTS public.logistics_offline_command_types (
  operation        text PRIMARY KEY,
  entity_type      text NOT NULL,
  target_rpc       text NOT NULL,
  required_keys    text[] NOT NULL DEFAULT '{}',
  requires_gps     boolean NOT NULL DEFAULT false,
  offline_allowed  boolean NOT NULL DEFAULT true,
  max_attempts     integer NOT NULL DEFAULT 6,
  description      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.logistics_offline_command_types TO authenticated;
GRANT ALL ON public.logistics_offline_command_types TO service_role;
ALTER TABLE public.logistics_offline_command_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_command_types_read ON public.logistics_offline_command_types;
CREATE POLICY offline_command_types_read ON public.logistics_offline_command_types
FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_offline_types_touch ON public.logistics_offline_command_types;
CREATE TRIGGER trg_offline_types_touch BEFORE UPDATE ON public.logistics_offline_command_types
FOR EACH ROW EXECUTE FUNCTION public._offline_touch();

-- ------------------------------------------------------------- RLS repair
-- Use the offline-specific permission keys (seeded with the matrix rows).
DROP POLICY IF EXISTS logistics_devices_self_read ON public.logistics_devices;
CREATE POLICY logistics_devices_self_read ON public.logistics_devices
FOR SELECT TO authenticated
USING (owner_user_id = auth.uid()
       OR public.has_staff_permission('staff.logistics.offline.read'));

DROP POLICY IF EXISTS offline_commands_self_read ON public.logistics_offline_commands;
CREATE POLICY offline_commands_self_read ON public.logistics_offline_commands
FOR SELECT TO authenticated
USING (actor_id = auth.uid()
       OR public.has_staff_permission('staff.logistics.offline.read'));

DROP POLICY IF EXISTS offline_command_events_read ON public.logistics_offline_command_events;
CREATE POLICY offline_command_events_read ON public.logistics_offline_command_events
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.logistics_offline_commands c
               WHERE c.id = command_row_id
                 AND (c.actor_id = auth.uid()
                      OR public.has_staff_permission('staff.logistics.offline.read'))));

DROP POLICY IF EXISTS sync_sessions_read ON public.logistics_sync_sessions;
CREATE POLICY sync_sessions_read ON public.logistics_sync_sessions
FOR SELECT TO authenticated
USING (actor_id = auth.uid()
       OR public.has_staff_permission('staff.logistics.offline.read'));

DROP POLICY IF EXISTS offline_attachments_self ON public.logistics_offline_attachments;
CREATE POLICY offline_attachments_self ON public.logistics_offline_attachments
FOR SELECT TO authenticated
USING (actor_id = auth.uid()
       OR public.has_staff_permission('staff.logistics.offline.read'));

-- ------------------------------------------------------- device registration
CREATE OR REPLACE FUNCTION public.lg_device_register(
  _device_id text,
  _platform text DEFAULT 'unknown',
  _app_version text DEFAULT 'unknown',
  _os_version text DEFAULT NULL,
  _model text DEFAULT NULL,
  _push_token text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.logistics_devices;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_REQUIRED',
      'category','authorization','retryable', false,
      'message','A signed-in driver session is required to register a device.');
  END IF;
  IF _device_id IS NULL OR length(trim(_device_id)) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_FAILED',
      'category','validation','retryable', false,
      'message','device_id must be at least 8 characters.');
  END IF;

  INSERT INTO public.logistics_devices(
    device_id, owner_user_id, platform, app_version, os_version, model, push_token, last_seen_at)
  VALUES (_device_id, v_uid, COALESCE(_platform,'unknown'), COALESCE(_app_version,'unknown'),
          _os_version, _model, _push_token, now())
  ON CONFLICT (device_id, owner_user_id) DO UPDATE
    SET platform = EXCLUDED.platform,
        app_version = EXCLUDED.app_version,
        os_version = COALESCE(EXCLUDED.os_version, public.logistics_devices.os_version),
        model = COALESCE(EXCLUDED.model, public.logistics_devices.model),
        push_token = COALESCE(EXCLUDED.push_token, public.logistics_devices.push_token),
        state = CASE WHEN public.logistics_devices.state = 'SUSPENDED'
                     THEN 'SUSPENDED'::public.offline_device_state ELSE 'ACTIVE' END,
        last_seen_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'device', jsonb_build_object(
      'id', v_row.id, 'device_id', v_row.device_id, 'state', v_row.state,
      'sync_cursor', v_row.sync_cursor, 'queued', v_row.queued_count,
      'conflicts', v_row.conflict_count, 'failed', v_row.failed_count),
    'server_time', now());
END $$;

-- --------------------------------------------------- conflict pre-inspection
CREATE OR REPLACE FUNCTION public._lg_offline_conflict(
  _operation text, _entity_id uuid, _payload jsonb, _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_txt text; v_uuid uuid; v_bool boolean;
BEGIN
  IF _operation = 'delivery.attempt' THEN
    SELECT p.status INTO v_txt FROM public.logistics_packages p WHERE p.id = _entity_id;
    IF v_txt IS NULL THEN RETURN jsonb_build_object('reason','ENTITY_NOT_FOUND','detail',
      jsonb_build_object('package_id', _entity_id)); END IF;
    IF v_txt IN ('DELIVERED','delivered') THEN
      RETURN jsonb_build_object('reason','PACKAGE_ALREADY_DELIVERED',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;

  ELSIF _operation = 'pod.capture' THEN
    SELECT a.pod_id INTO v_uuid FROM public.logistics_delivery_attempts a WHERE a.id = _entity_id;
    IF v_uuid IS NOT NULL THEN
      RETURN jsonb_build_object('reason','POD_ALREADY_ATTACHED',
        'detail', jsonb_build_object('pod_id', v_uuid));
    END IF;

  ELSIF _operation IN ('stop.arrive','stop.depart','stop.complete') THEN
    SELECT s.status INTO v_txt FROM public.logistics_route_stops s WHERE s.id = _entity_id;
    IF v_txt IS NULL THEN RETURN jsonb_build_object('reason','ENTITY_NOT_FOUND','detail',
      jsonb_build_object('stop_id', _entity_id)); END IF;
    IF v_txt IN ('COMPLETED','completed','SKIPPED','skipped') AND _operation <> 'stop.depart' THEN
      RETURN jsonb_build_object('reason','STOP_ALREADY_COMPLETED',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;
    -- route version supersession + driver assignment are authoritative
    IF _payload ? 'route_version_id' THEN
      SELECT (public.logistics_route_current_version(s.route_id)
              <> (_payload->>'route_version_id')::uuid)
        INTO v_bool
      FROM public.logistics_route_stops s WHERE s.id = _entity_id;
      IF COALESCE(v_bool, false) THEN
        RETURN jsonb_build_object('reason','ROUTE_VERSION_SUPERSEDED',
          'detail', jsonb_build_object('client_version', _payload->>'route_version_id'));
      END IF;
    END IF;
    SELECT r.driver_user_id INTO v_uuid
      FROM public.logistics_route_stops s
      JOIN public.logistics_routes r ON r.id = s.route_id
     WHERE s.id = _entity_id;
    IF v_uuid IS NOT NULL AND v_uuid <> _actor THEN
      RETURN jsonb_build_object('reason','DRIVER_NOT_ASSIGNED',
        'detail', jsonb_build_object('assigned_driver', v_uuid));
    END IF;

  ELSIF _operation = 'return.authorize' THEN
    SELECT r.id INTO v_uuid FROM public.logistics_returns r
     WHERE r.package_id = _entity_id
       AND r.status NOT IN ('RESOLVED','CANCELLED','resolved','cancelled')
     LIMIT 1;
    IF v_uuid IS NOT NULL THEN
      RETURN jsonb_build_object('reason','RETURN_ALREADY_OPEN',
        'detail', jsonb_build_object('return_id', v_uuid));
    END IF;

  ELSIF _operation = 'exception.transition' THEN
    SELECT e.status INTO v_txt FROM public.logistics_exceptions e WHERE e.id = _entity_id;
    IF v_txt IS NULL THEN RETURN jsonb_build_object('reason','ENTITY_NOT_FOUND','detail',
      jsonb_build_object('exception_id', _entity_id)); END IF;
    IF v_txt IN ('RESOLVED','resolved','CLOSED','closed') THEN
      RETURN jsonb_build_object('reason','EXCEPTION_ALREADY_RESOLVED',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;
  END IF;

  RETURN NULL;
END $$;

-- ------------------------------------------------------------- the applier
CREATE OR REPLACE FUNCTION public._lg_offline_apply(_command_row_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.logistics_offline_commands;
  t public.logistics_offline_command_types;
  v_conflict jsonb;
  v_result jsonb;
  v_missing text;
  v_attempt uuid;
  v_state public.offline_command_state;
  v_txid uuid;
  v_sqlstate text; v_msg text; v_retryable boolean; v_code text; v_category text;
  v_prior integer;
  v_stop public.logistics_route_stops;
  v_dev public.logistics_route_deviations;
BEGIN
  SELECT * INTO c FROM public.logistics_offline_commands WHERE id = _command_row_id FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','ENTITY_NOT_FOUND','category','validation',
      'retryable', false, 'message','Unknown offline command.');
  END IF;
  IF c.state IN ('ACCEPTED','ACKNOWLEDGED','REPLAYED') THEN
    RETURN jsonb_build_object('ok', true, 'code','DUPLICATE','category','idempotency',
      'state', c.state, 'transaction_id', c.transaction_id, 'result', c.server_result,
      'message','Command was already applied; no second mutation performed.');
  END IF;

  SELECT * INTO t FROM public.logistics_offline_command_types WHERE operation = c.operation;
  IF t.operation IS NULL OR NOT t.offline_allowed THEN
    UPDATE public.logistics_offline_commands SET
      state='REJECTED', attempts = attempts + 1, error_code='UNSUPPORTED_OPERATION',
      error_category='validation', retryable=false,
      error_message = format('Operation %s is not enabled for offline execution.', c.operation)
    WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'code','UNSUPPORTED_OPERATION','category','validation',
      'retryable', false, 'message', format('Operation %s is not enabled for offline execution.', c.operation));
  END IF;

  -- required payload keys
  SELECT string_agg(k, ', ') INTO v_missing
    FROM unnest(t.required_keys) k
   WHERE NOT (c.payload ? k) OR c.payload->>k IS NULL;
  IF v_missing IS NOT NULL THEN
    UPDATE public.logistics_offline_commands SET
      state='REJECTED', attempts = attempts + 1, error_code='VALIDATION_FAILED',
      error_category='validation', retryable=false,
      error_message = format('Missing payload fields: %s', v_missing)
    WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_FAILED','category','validation',
      'retryable', false, 'message', format('Missing payload fields: %s', v_missing));
  END IF;

  IF t.requires_gps AND (c.gps_lat IS NULL OR c.gps_lng IS NULL) THEN
    UPDATE public.logistics_offline_commands SET
      state='REJECTED', attempts = attempts + 1, error_code='VALIDATION_FAILED',
      error_category='validation', retryable=false,
      error_message='GPS coordinates are required for this operation.'
    WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_FAILED','category','validation',
      'retryable', false, 'message','GPS coordinates are required for this operation.');
  END IF;

  -- ordering guarantee: an unresolved conflict on the same entity blocks later work
  SELECT count(*) INTO v_prior FROM public.logistics_offline_commands p
   WHERE p.device_row_id = c.device_row_id
     AND p.entity_type = c.entity_type
     AND p.entity_id IS NOT DISTINCT FROM c.entity_id
     AND p.sequence_number < c.sequence_number
     AND p.state IN ('CONFLICT','PERMANENT_FAILURE');
  IF v_prior > 0 THEN
    UPDATE public.logistics_offline_commands SET
      state='RETRYABLE_FAILURE', attempts = attempts + 1,
      error_code='PRIOR_COMMAND_UNRESOLVED', error_category='ordering', retryable=true,
      error_message='An earlier command for this entity is unresolved; resolve it first.',
      next_attempt_at = now() + interval '15 minutes'
    WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'code','PRIOR_COMMAND_UNRESOLVED','category','ordering',
      'retryable', true, 'message','An earlier command for this entity is unresolved; resolve it first.');
  END IF;

  -- explicit conflict detection against authoritative state
  v_conflict := public._lg_offline_conflict(c.operation, c.entity_id, c.payload, c.actor_id);
  IF v_conflict IS NOT NULL THEN
    UPDATE public.logistics_offline_commands SET
      state='CONFLICT', attempts = attempts + 1,
      conflict_reason = v_conflict->>'reason', conflict_detail = v_conflict->'detail',
      error_code='CONFLICT', error_category='conflict', retryable=false,
      error_message = format('Server state has moved on: %s', v_conflict->>'reason')
    WHERE id = c.id;
    RETURN jsonb_build_object('ok', false, 'code','CONFLICT','category','conflict',
      'retryable', false, 'reason', v_conflict->>'reason', 'detail', v_conflict->'detail',
      'message', format('Server state has moved on: %s', v_conflict->>'reason'));
  END IF;

  UPDATE public.logistics_offline_commands
     SET state='SYNCING', attempts = attempts + 1 WHERE id = c.id;

  BEGIN
    IF c.operation = 'delivery.attempt' THEN
      v_result := public.logistics_record_delivery_attempt(
        c.entity_id, c.payload->>'outcome', c.idempotency_key,
        c.payload->>'reason_code', c.payload->>'narrative', c.payload->>'recipient_name',
        c.gps_lat, c.gps_lng, COALESCE(c.payload->'evidence', '{}'::jsonb));

    ELSIF c.operation = 'pod.capture' THEN
      v_attempt := c.entity_id;
      IF v_attempt IS NULL AND (c.payload ? 'attempt_command_id') THEN
        SELECT p.transaction_id INTO v_attempt
          FROM public.logistics_offline_commands p
         WHERE p.device_id = c.device_id
           AND p.command_id = c.payload->>'attempt_command_id';
      END IF;
      v_result := public.logistics_pod_capture(v_attempt, c.payload, c.idempotency_key);

    ELSIF c.operation = 'otp.verify' THEN
      v_result := public.logistics_otp_verify(
        c.entity_id, c.payload->>'code', NULLIF(c.payload->>'attempt_id','')::uuid);

    ELSIF c.operation IN ('stop.arrive','stop.depart','stop.complete') THEN
      v_stop := public.logistics_stop_transition(
        c.entity_id, c.payload->>'to_status', c.payload->>'reason', c.gps_lat, c.gps_lng);
      v_result := jsonb_build_object('ok', true, 'stop_id', v_stop.id, 'status', v_stop.status);

    ELSIF c.operation = 'return.authorize' THEN
      v_result := public.logistics_return_authorize(
        c.entity_id, c.payload->>'reason', c.payload->>'reason_code',
        NULLIF(c.payload->>'destination_hub_id','')::uuid,
        c.payload->>'service_level', c.payload->>'instructions',
        COALESCE((c.payload->>'merchant_approval_required')::boolean, false));

    ELSIF c.operation = 'exception.transition' THEN
      v_result := public.logistics_exception_transition(
        c.entity_id, c.payload->>'to_status', c.payload->>'note',
        c.payload->>'resolution', c.payload->>'severity');

    ELSIF c.operation = 'package.scan' THEN
      v_result := public.logistics_manifest_scan(
        c.entity_id, c.payload->>'identifier',
        COALESCE(c.payload->>'scan_state','SCANNED'), c.payload->>'note');

    ELSIF c.operation = 'hub.receive_scan' THEN
      v_result := public.wh_receive_scan(
        c.entity_id, c.payload->>'identifier', c.idempotency_key,
        c.payload->>'condition', c.device_id,
        NULLIF(c.payload->>'location_id','')::uuid, c.payload->>'note');

    ELSIF c.operation = 'hub.move' THEN
      v_result := public.wh_move(
        c.entity_id, NULLIF(c.payload->>'to_location_id','')::uuid,
        c.idempotency_key, c.payload->>'reason_code', c.payload->>'note');

    ELSIF c.operation = 'route.deviation' THEN
      v_dev := public.logistics_route_record_deviation(
        c.entity_id, NULLIF(c.payload->>'stop_id','')::uuid,
        c.payload->>'kind', COALESCE(c.payload->>'severity','MINOR'),
        c.payload->>'narrative', NULLIF(c.payload->>'distance_m','')::numeric);
      v_result := jsonb_build_object('ok', true, 'deviation_id', v_dev.id);

    ELSE
      UPDATE public.logistics_offline_commands SET
        state='REJECTED', error_code='UNSUPPORTED_OPERATION', error_category='validation',
        retryable=false, error_message=format('No applier for %s', c.operation)
      WHERE id = c.id;
      RETURN jsonb_build_object('ok', false, 'code','UNSUPPORTED_OPERATION','category','validation',
        'retryable', false, 'message', format('No applier for %s', c.operation));
    END IF;

  EXCEPTION WHEN OTHERS THEN
    v_sqlstate := SQLSTATE; v_msg := SQLERRM;
    IF v_sqlstate IN ('40001','40P01','55P03','57014','53300','08006','08003') THEN
      v_state := 'RETRYABLE_FAILURE'; v_retryable := true;
      v_code := 'RETRYABLE_FAILURE'; v_category := 'transient';
    ELSIF v_msg ILIKE '%not auth%' OR v_msg ILIKE '%permission%' OR v_msg ILIKE '%denied%' THEN
      v_state := 'REJECTED'; v_retryable := false;
      v_code := 'AUTHORIZATION_DENIED'; v_category := 'authorization';
    ELSIF v_msg ILIKE '%transition%' OR v_msg ILIKE '%invalid%' OR v_msg ILIKE '%not allowed%' THEN
      v_state := 'REJECTED'; v_retryable := false;
      v_code := 'INVALID_TRANSITION'; v_category := 'state';
    ELSE
      v_state := 'PERMANENT_FAILURE'; v_retryable := false;
      v_code := 'PERMANENT_FAILURE'; v_category := 'server';
    END IF;

    UPDATE public.logistics_offline_commands SET
      state = v_state, retryable = v_retryable, error_code = v_code,
      error_category = v_category, error_message = v_msg,
      next_attempt_at = CASE WHEN v_retryable
        THEN now() + (interval '30 seconds' * power(2, LEAST(attempts, 8)))
        ELSE NULL END
    WHERE id = c.id;

    RETURN jsonb_build_object('ok', false, 'code', v_code, 'category', v_category,
      'retryable', v_retryable, 'sqlstate', v_sqlstate, 'message', v_msg);
  END;

  -- server-issued transaction identity
  v_txid := COALESCE(
    NULLIF(v_result->>'attempt_id','')::uuid,
    NULLIF(v_result->>'pod_id','')::uuid,
    NULLIF(v_result->>'return_id','')::uuid,
    NULLIF(v_result->>'id','')::uuid,
    NULLIF(v_result->>'stop_id','')::uuid,
    NULLIF(v_result->>'deviation_id','')::uuid);

  UPDATE public.logistics_offline_commands SET
    state='ACCEPTED', server_result = v_result, transaction_id = v_txid,
    server_applied_at = now(), error_code=NULL, error_category=NULL,
    error_message=NULL, retryable=NULL, next_attempt_at=NULL
  WHERE id = c.id;

  RETURN jsonb_build_object('ok', true, 'code','ACCEPTED','transaction_id', v_txid,
    'result', v_result, 'server_time', now());
END $$;
