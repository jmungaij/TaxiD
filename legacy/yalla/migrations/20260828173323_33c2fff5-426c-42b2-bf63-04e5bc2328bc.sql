-- =============================================================================
-- PHASE 8 (part 3) — PUSH / PULL / RESOLVE / REPLAY / WORKER / HEALTH
-- =============================================================================

-- --------------- conflict engine: point at the authoritative package tables
CREATE OR REPLACE FUNCTION public._lg_offline_conflict(
  _operation text, _entity_id uuid, _payload jsonb, _actor uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_txt text; v_uuid uuid; v_bool boolean;
BEGIN
  IF _operation = 'delivery.attempt' THEN
    SELECT p.status INTO v_txt FROM public.packages p WHERE p.id = _entity_id;
    IF v_txt IS NULL THEN
      RETURN jsonb_build_object('reason','ENTITY_NOT_FOUND',
        'detail', jsonb_build_object('package_id', _entity_id));
    END IF;
    IF upper(v_txt) = 'DELIVERED' THEN
      RETURN jsonb_build_object('reason','PACKAGE_ALREADY_DELIVERED',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;
    IF upper(v_txt) IN ('CANCELLED','RETURNED') THEN
      RETURN jsonb_build_object('reason','PACKAGE_NOT_DELIVERABLE',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;
    SELECT p.assigned_driver_id INTO v_uuid FROM public.packages p WHERE p.id = _entity_id;
    IF v_uuid IS NOT NULL AND _actor IS NOT NULL AND v_uuid <> _actor THEN
      RETURN jsonb_build_object('reason','DRIVER_NOT_ASSIGNED',
        'detail', jsonb_build_object('assigned_driver', v_uuid));
    END IF;

  ELSIF _operation = 'pod.capture' THEN
    SELECT a.pod_id INTO v_uuid FROM public.logistics_delivery_attempts a WHERE a.id = _entity_id;
    IF v_uuid IS NOT NULL THEN
      RETURN jsonb_build_object('reason','POD_ALREADY_ATTACHED',
        'detail', jsonb_build_object('pod_id', v_uuid));
    END IF;

  ELSIF _operation IN ('stop.arrive','stop.depart','stop.complete') THEN
    SELECT s.status INTO v_txt FROM public.logistics_route_stops s WHERE s.id = _entity_id;
    IF v_txt IS NULL THEN
      RETURN jsonb_build_object('reason','ENTITY_NOT_FOUND',
        'detail', jsonb_build_object('stop_id', _entity_id));
    END IF;
    IF upper(v_txt) IN ('COMPLETED','SKIPPED') AND _operation <> 'stop.depart' THEN
      RETURN jsonb_build_object('reason','STOP_ALREADY_COMPLETED',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;
    IF _payload ? 'route_version_id' THEN
      SELECT (public.logistics_route_current_version(s.route_id)
              IS DISTINCT FROM (_payload->>'route_version_id')::uuid)
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
    IF v_uuid IS NOT NULL AND _actor IS NOT NULL AND v_uuid <> _actor THEN
      RETURN jsonb_build_object('reason','DRIVER_NOT_ASSIGNED',
        'detail', jsonb_build_object('assigned_driver', v_uuid));
    END IF;

  ELSIF _operation = 'return.authorize' THEN
    SELECT r.id INTO v_uuid FROM public.package_returns r
     WHERE r.package_id = _entity_id
       AND upper(COALESCE(r.status,'')) NOT IN ('RESOLVED','CANCELLED','CLOSED')
     LIMIT 1;
    IF v_uuid IS NOT NULL THEN
      RETURN jsonb_build_object('reason','RETURN_ALREADY_OPEN',
        'detail', jsonb_build_object('return_id', v_uuid));
    END IF;

  ELSIF _operation = 'exception.transition' THEN
    SELECT e.status INTO v_txt FROM public.logistics_exceptions e WHERE e.id = _entity_id;
    IF v_txt IS NULL THEN
      RETURN jsonb_build_object('reason','ENTITY_NOT_FOUND',
        'detail', jsonb_build_object('exception_id', _entity_id));
    END IF;
    IF upper(v_txt) IN ('RESOLVED','CLOSED') THEN
      RETURN jsonb_build_object('reason','EXCEPTION_ALREADY_RESOLVED',
        'detail', jsonb_build_object('server_status', v_txt));
    END IF;
  END IF;

  RETURN NULL;
END $$;

-- ----------------------------------------------------------------- PUSH
CREATE OR REPLACE FUNCTION public.lg_sync_push(
  _device_id text,
  _commands jsonb,
  _client_time timestamptz DEFAULT NULL,
  _app_version text DEFAULT 'unknown',
  _correlation_id text DEFAULT NULL,
  _connectivity text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev public.logistics_devices;
  v_session uuid;
  v_corr text := COALESCE(NULLIF(_correlation_id,''), gen_random_uuid()::text);
  v_skew integer;
  v_item jsonb;
  v_existing public.logistics_offline_commands;
  v_row_id uuid;
  v_apply jsonb;
  v_results jsonb := '[]'::jsonb;
  v_accepted int := 0; v_rejected int := 0; v_conflict int := 0;
  v_deferred int := 0; v_dupes int := 0;
  v_seq bigint;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_REQUIRED',
      'category','authorization','retryable', false,
      'message','Sign in as the driver that captured this work.');
  END IF;

  SELECT * INTO v_dev FROM public.logistics_devices
   WHERE device_id = _device_id AND owner_user_id = v_uid;
  IF v_dev.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','DEVICE_NOT_REGISTERED',
      'category','configuration','retryable', false,
      'message','Register this device before synchronising.');
  END IF;
  IF v_dev.state = 'SUSPENDED' THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_DENIED',
      'category','authorization','retryable', false,
      'message','This device is suspended. Contact delivery operations.');
  END IF;
  IF _commands IS NULL OR jsonb_typeof(_commands) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_FAILED',
      'category','validation','retryable', false,
      'message','commands must be a JSON array.');
  END IF;

  v_skew := CASE WHEN _client_time IS NULL THEN NULL
                 ELSE (EXTRACT(EPOCH FROM (_client_time - now())) * 1000)::integer END;

  INSERT INTO public.logistics_sync_sessions(
    device_row_id, actor_id, direction, cursor_before, commands_submitted,
    clock_skew_ms, connectivity, app_version, correlation_id)
  VALUES (v_dev.id, v_uid, 'push', v_dev.sync_cursor,
          jsonb_array_length(_commands), v_skew, _connectivity, _app_version, v_corr)
  RETURNING id INTO v_session;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(_commands) t(value)
    ORDER BY COALESCE((value->>'sequence')::bigint, 0)
  LOOP
    -- duplicate suppression: same command, or same idempotency key
    SELECT * INTO v_existing FROM public.logistics_offline_commands
     WHERE (device_id = _device_id AND command_id = v_item->>'command_id')
        OR (actor_id = v_uid AND idempotency_key = v_item->>'idempotency_key')
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      v_dupes := v_dupes + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'command_id', v_item->>'command_id',
        'ok', v_existing.state IN ('ACCEPTED','ACKNOWLEDGED','REPLAYED'),
        'state', v_existing.state,
        'code','DUPLICATE','category','idempotency','retryable', false,
        'duplicate', true,
        'transaction_id', v_existing.transaction_id,
        'result', v_existing.server_result,
        'conflict_reason', v_existing.conflict_reason,
        'message','Already recorded by the server; no second mutation performed.'));
      CONTINUE;
    END IF;

    v_seq := COALESCE((v_item->>'sequence')::bigint,
                      (SELECT COALESCE(max(sequence_number),0)+1
                         FROM public.logistics_offline_commands
                        WHERE device_row_id = v_dev.id));
    v_hash := encode(digest(COALESCE(v_item->'payload','{}'::jsonb)::text, 'sha256'), 'hex');

    BEGIN
      INSERT INTO public.logistics_offline_commands(
        command_id, idempotency_key, device_row_id, device_id, tenant_id, actor_id,
        app_version, operation, entity_type, entity_id, entity_version, sequence_number,
        payload, payload_hash, gps_lat, gps_lng, gps_accuracy_m,
        client_captured_at, client_clock_skew_ms, correlation_id, causation_id,
        request_id, sync_session_id)
      VALUES (
        v_item->>'command_id',
        COALESCE(NULLIF(v_item->>'idempotency_key',''),
                 v_item->>'command_id'),
        v_dev.id, _device_id, v_dev.tenant_id, v_uid,
        COALESCE(_app_version,'unknown'),
        v_item->>'operation',
        COALESCE(v_item->>'entity_type','unknown'),
        NULLIF(v_item->>'entity_id','')::uuid,
        NULLIF(v_item->>'entity_version','')::integer,
        v_seq,
        COALESCE(v_item->'payload','{}'::jsonb),
        v_hash,
        NULLIF(v_item->>'gps_lat','')::numeric,
        NULLIF(v_item->>'gps_lng','')::numeric,
        NULLIF(v_item->>'gps_accuracy_m','')::numeric,
        COALESCE(NULLIF(v_item->>'client_captured_at','')::timestamptz, now()),
        v_skew, v_corr, v_item->>'causation_id',
        v_item->>'request_id', v_session)
      RETURNING id INTO v_row_id;
    EXCEPTION WHEN unique_violation THEN
      v_dupes := v_dupes + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'command_id', v_item->>'command_id', 'ok', true, 'duplicate', true,
        'code','DUPLICATE','category','idempotency','retryable', false,
        'message','Concurrent push already recorded this command.'));
      CONTINUE;
    WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'command_id', v_item->>'command_id', 'ok', false,
        'code','VALIDATION_FAILED','category','validation','retryable', false,
        'message', SQLERRM));
      v_rejected := v_rejected + 1;
      CONTINUE;
    END;

    v_apply := public._lg_offline_apply(v_row_id);

    IF (v_apply->>'ok')::boolean THEN v_accepted := v_accepted + 1;
    ELSIF v_apply->>'code' = 'CONFLICT' THEN v_conflict := v_conflict + 1;
    ELSIF COALESCE((v_apply->>'retryable')::boolean, false) THEN v_deferred := v_deferred + 1;
    ELSE v_rejected := v_rejected + 1;
    END IF;

    v_results := v_results || jsonb_build_array(
      v_apply || jsonb_build_object('command_id', v_item->>'command_id',
                                    'sequence', v_seq, 'duplicate', false));
  END LOOP;

  UPDATE public.logistics_sync_sessions SET
    state='COMPLETED', finished_at = now(),
    cursor_after = (SELECT COALESCE(max(sequence_number), v_dev.sync_cursor)
                      FROM public.logistics_offline_commands WHERE device_row_id = v_dev.id),
    commands_accepted = v_accepted, commands_rejected = v_rejected,
    commands_conflict = v_conflict, commands_deferred = v_deferred,
    duplicates_suppressed = v_dupes
  WHERE id = v_session;

  UPDATE public.logistics_devices SET
    sync_cursor = (SELECT COALESCE(max(sequence_number), sync_cursor)
                     FROM public.logistics_offline_commands WHERE device_row_id = v_dev.id),
    last_sync_at = now(), last_seen_at = now(),
    last_clock_skew_ms = v_skew, app_version = COALESCE(_app_version, app_version)
  WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'ok', true, 'session_id', v_session, 'correlation_id', v_corr,
    'server_time', now(), 'clock_skew_ms', v_skew,
    'summary', jsonb_build_object('submitted', jsonb_array_length(_commands),
      'accepted', v_accepted, 'rejected', v_rejected, 'conflict', v_conflict,
      'deferred', v_deferred, 'duplicates', v_dupes),
    'results', v_results);
END $$;

-- ----------------------------------------------------------------- PULL
CREATE OR REPLACE FUNCTION public.lg_sync_pull(
  _device_id text,
  _since timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev public.logistics_devices;
  v_routes jsonb; v_stops jsonb; v_packages jsonb; v_pending jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_REQUIRED',
      'category','authorization','retryable', false,
      'message','Sign in to download assigned work.');
  END IF;

  SELECT * INTO v_dev FROM public.logistics_devices
   WHERE device_id = _device_id AND owner_user_id = v_uid;
  IF v_dev.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','DEVICE_NOT_REGISTERED',
      'category','configuration','retryable', false,
      'message','Register this device before synchronising.');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'route_id', r.id, 'route_number', r.route_number, 'status', r.status,
           'route_type', r.route_type, 'current_version', r.current_version,
           'route_version_id', public.logistics_route_current_version(r.id),
           'planned_start', r.planned_start, 'planned_end', r.planned_end,
           'origin_label', r.origin_label, 'destination_label', r.destination_label,
           'vehicle_id', r.vehicle_id, 'updated_at', r.updated_at) ORDER BY r.planned_start), '[]'::jsonb)
    INTO v_routes
    FROM public.logistics_routes r
   WHERE r.driver_user_id = v_uid
     AND upper(COALESCE(r.status,'')) NOT IN ('COMPLETED','CANCELLED','CLOSED')
     AND (_since IS NULL OR r.updated_at > _since);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'stop_id', s.id, 'route_id', s.route_id, 'route_version_id', s.route_version_id,
           'sequence', s.sequence, 'stop_type', s.stop_type, 'status', s.status,
           'address', s.address, 'lat', s.lat, 'lng', s.lng,
           'contact_name', s.contact_name, 'contact_phone', s.contact_phone,
           'instructions', s.instructions, 'eta', s.eta,
           'service_window_start', s.service_window_start,
           'service_window_end', s.service_window_end,
           'updated_at', s.updated_at) ORDER BY s.route_id, s.sequence), '[]'::jsonb)
    INTO v_stops
    FROM public.logistics_route_stops s
    JOIN public.logistics_routes r ON r.id = s.route_id
   WHERE r.driver_user_id = v_uid
     AND s.route_version_id = public.logistics_route_current_version(r.id)
     AND (_since IS NULL OR s.updated_at > _since);

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
           'package_id', p.id, 'tracking_number', p.tracking_number,
           'status', p.status, 'recipient_name', p.recipient_name,
           'recipient_phone', p.recipient_phone, 'dropoff_address', p.dropoff_address,
           'dropoff_lat', p.dropoff_lat, 'dropoff_lng', p.dropoff_lng,
           'cold_chain', p.cold_chain, 'fragile', p.fragile,
           'updated_at', p.updated_at)), '[]'::jsonb)
    INTO v_packages
    FROM public.packages p
   WHERE (p.assigned_driver_id = v_uid
          OR EXISTS (SELECT 1 FROM public.logistics_stop_packages sp
                       JOIN public.logistics_routes r2 ON r2.id = sp.route_id
                      WHERE sp.package_id = p.id AND r2.driver_user_id = v_uid))
     AND upper(COALESCE(p.status,'')) NOT IN ('DELIVERED','CANCELLED','RETURNED')
     AND (_since IS NULL OR p.updated_at > _since);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'command_row_id', c.id, 'command_id', c.command_id, 'operation', c.operation,
           'state', c.state, 'conflict_reason', c.conflict_reason,
           'conflict_detail', c.conflict_detail, 'error_code', c.error_code,
           'error_message', c.error_message, 'retryable', c.retryable,
           'next_attempt_at', c.next_attempt_at) ORDER BY c.sequence_number), '[]'::jsonb)
    INTO v_pending
    FROM public.logistics_offline_commands c
   WHERE c.device_row_id = v_dev.id
     AND c.state IN ('QUEUED','SYNCING','CONFLICT','RETRYABLE_FAILURE','PERMANENT_FAILURE','REJECTED');

  UPDATE public.logistics_devices SET last_seen_at = now() WHERE id = v_dev.id;

  RETURN jsonb_build_object(
    'ok', true, 'server_time', now(), 'since', _since,
    'device', jsonb_build_object('device_id', v_dev.device_id, 'state', v_dev.state,
      'sync_cursor', v_dev.sync_cursor, 'last_sync_at', v_dev.last_sync_at),
    'routes', v_routes, 'stops', v_stops, 'packages', v_packages,
    'unresolved_commands', v_pending,
    'command_types', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'operation', operation, 'entity_type', entity_type,
        'required_keys', required_keys, 'requires_gps', requires_gps,
        'max_attempts', max_attempts) ORDER BY operation), '[]'::jsonb)
      FROM public.logistics_offline_command_types WHERE offline_allowed));
END $$;

-- ------------------------------------------------------- evidence queue
CREATE OR REPLACE FUNCTION public.lg_offline_attachment_register(
  _device_id text, _attachment_key text, _kind text,
  _captured_at timestamptz, _command_id text DEFAULT NULL,
  _content_type text DEFAULT NULL, _byte_size integer DEFAULT NULL,
  _sha256 text DEFAULT NULL, _storage_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_cmd uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_REQUIRED',
      'category','authorization','retryable', false, 'message','Sign in first.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.logistics_devices
                  WHERE device_id = _device_id AND owner_user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code','DEVICE_NOT_REGISTERED',
      'category','configuration','retryable', false, 'message','Register this device first.');
  END IF;

  IF _command_id IS NOT NULL THEN
    SELECT id INTO v_cmd FROM public.logistics_offline_commands
     WHERE device_id = _device_id AND command_id = _command_id;
  END IF;

  INSERT INTO public.logistics_offline_attachments(
    command_row_id, device_id, actor_id, attachment_key, kind, content_type,
    byte_size, sha256, storage_path, captured_at,
    state, uploaded_at)
  VALUES (v_cmd, _device_id, v_uid, _attachment_key, _kind, _content_type,
          _byte_size, _sha256, _storage_path, COALESCE(_captured_at, now()),
          CASE WHEN _storage_path IS NULL THEN 'QUEUED' ELSE 'UPLOADED' END,
          CASE WHEN _storage_path IS NULL THEN NULL ELSE now() END)
  ON CONFLICT (device_id, attachment_key) DO UPDATE
    SET storage_path = COALESCE(EXCLUDED.storage_path, public.logistics_offline_attachments.storage_path),
        sha256 = COALESCE(EXCLUDED.sha256, public.logistics_offline_attachments.sha256),
        byte_size = COALESCE(EXCLUDED.byte_size, public.logistics_offline_attachments.byte_size),
        state = CASE WHEN COALESCE(EXCLUDED.storage_path,
                                   public.logistics_offline_attachments.storage_path) IS NULL
                     THEN 'QUEUED' ELSE 'UPLOADED' END,
        uploaded_at = CASE WHEN COALESCE(EXCLUDED.storage_path,
                                         public.logistics_offline_attachments.storage_path) IS NULL
                           THEN NULL ELSE now() END,
        command_row_id = COALESCE(public.logistics_offline_attachments.command_row_id, EXCLUDED.command_row_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'attachment_id', v_id, 'server_time', now());
END $$;

-- --------------------------------------------- operator resolution + replay
CREATE OR REPLACE FUNCTION public.lg_offline_resolve(
  _command_row_id uuid,
  _resolution text,            -- REPLAY | DISCARD | MANUALLY_APPLIED
  _notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_cmd public.logistics_offline_commands; v_apply jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.offline.resolve') THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_DENIED',
      'category','authorization','retryable', false,
      'message','Resolving offline commands requires staff.logistics.offline.resolve.');
  END IF;
  IF _resolution NOT IN ('REPLAY','DISCARD','MANUALLY_APPLIED') THEN
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_FAILED',
      'category','validation','retryable', false,
      'message','resolution must be REPLAY, DISCARD or MANUALLY_APPLIED.');
  END IF;
  IF _notes IS NULL OR length(trim(_notes)) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_FAILED',
      'category','validation','retryable', false,
      'message','A resolution note of at least 6 characters is required.');
  END IF;

  SELECT * INTO v_cmd FROM public.logistics_offline_commands WHERE id = _command_row_id;
  IF v_cmd.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','ENTITY_NOT_FOUND',
      'category','validation','retryable', false, 'message','Unknown offline command.');
  END IF;
  IF v_cmd.state IN ('ACCEPTED','ACKNOWLEDGED') THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_TRANSITION',
      'category','state','retryable', false,
      'message','This command was already applied; nothing to resolve.');
  END IF;

  IF _resolution = 'REPLAY' THEN
    UPDATE public.logistics_offline_commands SET
      state='QUEUED', conflict_reason=NULL, conflict_detail=NULL,
      error_code=NULL, error_category=NULL, error_message=NULL, retryable=NULL,
      next_attempt_at=NULL, resolution='REPLAY', resolved_by=v_uid,
      resolved_at=now(), resolution_notes=_notes
    WHERE id = _command_row_id;

    v_apply := public._lg_offline_apply(_command_row_id);
    IF (v_apply->>'ok')::boolean THEN
      UPDATE public.logistics_offline_commands
         SET state='REPLAYED', acknowledged_at = now() WHERE id = _command_row_id;
    END IF;
    RETURN jsonb_build_object('ok', COALESCE((v_apply->>'ok')::boolean, false),
      'resolution','REPLAY', 'apply', v_apply);
  END IF;

  UPDATE public.logistics_offline_commands SET
    state = CASE WHEN _resolution = 'DISCARD' THEN 'PERMANENT_FAILURE'::public.offline_command_state
                 ELSE 'ACKNOWLEDGED'::public.offline_command_state END,
    resolution = _resolution, resolved_by = v_uid, resolved_at = now(),
    resolution_notes = _notes, next_attempt_at = NULL,
    acknowledged_at = CASE WHEN _resolution = 'MANUALLY_APPLIED' THEN now() ELSE NULL END
  WHERE id = _command_row_id;

  RETURN jsonb_build_object('ok', true, 'resolution', _resolution, 'server_time', now());
END $$;

-- ------------------------------------------------------------ retry worker
CREATE OR REPLACE FUNCTION public.lg_offline_worker_tick(_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_apply jsonb; v_ok int := 0; v_fail int := 0; v_total int := 0;
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_DENIED',
      'category','authorization','retryable', false,
      'message','The offline retry worker runs as a background job only.');
  END IF;

  FOR r IN
    SELECT c.id, t.max_attempts
      FROM public.logistics_offline_commands c
      JOIN public.logistics_offline_command_types t ON t.operation = c.operation
     WHERE c.state IN ('QUEUED','RETRYABLE_FAILURE')
       AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= now())
     ORDER BY c.device_row_id, c.sequence_number
     LIMIT GREATEST(COALESCE(_limit, 50), 1)
  LOOP
    v_total := v_total + 1;
    v_apply := public._lg_offline_apply(r.id);
    IF (v_apply->>'ok')::boolean THEN v_ok := v_ok + 1; ELSE v_fail := v_fail + 1; END IF;

    -- exhausted retries become a permanent failure awaiting an operator
    UPDATE public.logistics_offline_commands
       SET state='PERMANENT_FAILURE', retryable=false,
           error_code = COALESCE(error_code,'RETRY_BUDGET_EXHAUSTED')
     WHERE id = r.id AND state='RETRYABLE_FAILURE' AND attempts >= r.max_attempts;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'processed', v_total,
    'applied', v_ok, 'failed', v_fail, 'server_time', now());
END $$;

-- ------------------------------------------------------------- sync health
CREATE OR REPLACE FUNCTION public.lg_sync_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_devices jsonb; v_queue jsonb; v_sessions jsonb; v_oldest timestamptz;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.offline.read') THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_DENIED',
      'category','authorization','retryable', false,
      'message','Viewing synchronisation health requires staff.logistics.offline.read.');
  END IF;

  SELECT jsonb_build_object(
      'total', count(*),
      'active', count(*) FILTER (WHERE state='ACTIVE'),
      'stale', count(*) FILTER (WHERE state='ACTIVE'
                                  AND (last_seen_at IS NULL OR last_seen_at < now() - interval '2 hours')),
      'suspended', count(*) FILTER (WHERE state='SUSPENDED'),
      'retired', count(*) FILTER (WHERE state='RETIRED'),
      'max_clock_skew_ms', max(abs(COALESCE(last_clock_skew_ms,0))))
    INTO v_devices FROM public.logistics_devices;

  SELECT jsonb_build_object(
      'queued', count(*) FILTER (WHERE state IN ('QUEUED','SYNCING')),
      'retryable', count(*) FILTER (WHERE state='RETRYABLE_FAILURE'),
      'conflict', count(*) FILTER (WHERE state='CONFLICT'),
      'rejected', count(*) FILTER (WHERE state='REJECTED'),
      'permanent_failure', count(*) FILTER (WHERE state='PERMANENT_FAILURE'),
      'accepted_24h', count(*) FILTER (WHERE state IN ('ACCEPTED','ACKNOWLEDGED','REPLAYED')
                                         AND server_applied_at > now() - interval '24 hours'),
      'total', count(*))
    INTO v_queue FROM public.logistics_offline_commands;

  SELECT min(created_at) INTO v_oldest FROM public.logistics_offline_commands
   WHERE state IN ('QUEUED','SYNCING','RETRYABLE_FAILURE','CONFLICT');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'session_id', id, 'device_row_id', device_row_id, 'state', state,
      'submitted', commands_submitted, 'accepted', commands_accepted,
      'rejected', commands_rejected, 'conflict', commands_conflict,
      'deferred', commands_deferred, 'duplicates', duplicates_suppressed,
      'clock_skew_ms', clock_skew_ms, 'started_at', started_at,
      'finished_at', finished_at) ORDER BY started_at DESC), '[]'::jsonb)
    INTO v_sessions
    FROM (SELECT * FROM public.logistics_sync_sessions
           ORDER BY started_at DESC LIMIT 20) s;

  RETURN jsonb_build_object(
    'ok', true, 'server_time', now(),
    'devices', v_devices, 'queue', v_queue,
    'oldest_pending_at', v_oldest,
    'oldest_pending_age_minutes',
      CASE WHEN v_oldest IS NULL THEN NULL
           ELSE (EXTRACT(EPOCH FROM (now() - v_oldest))/60)::integer END,
    'recent_sessions', v_sessions,
    'data_available', (v_queue->>'total')::int > 0 OR (v_devices->>'total')::int > 0);
END $$;

-- -------------------------------------------------------- grant hardening
REVOKE ALL ON FUNCTION public._lg_offline_conflict(text, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lg_offline_apply(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lg_offline_worker_tick(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lg_device_register(text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lg_sync_push(text, jsonb, timestamptz, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lg_sync_pull(text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lg_offline_attachment_register(text, text, text, timestamptz, text, text, integer, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lg_offline_resolve(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lg_sync_health() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._lg_offline_conflict(text, uuid, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._lg_offline_apply(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lg_offline_worker_tick(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lg_device_register(text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lg_sync_push(text, jsonb, timestamptz, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lg_sync_pull(text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lg_offline_attachment_register(text, text, text, timestamptz, text, text, integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lg_offline_resolve(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lg_sync_health() TO authenticated, service_role;
