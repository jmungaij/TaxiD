-- ==========================================================
-- PHASE 4 — INTEGRATION PLATFORM SERVER OPERATIONS
-- ==========================================================

CREATE OR REPLACE FUNCTION public.logistics_integration_authorised(_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_service_context()
      OR CASE WHEN _action = 'read'
              THEN public.has_staff_permission('staff.logistics.read')
              ELSE public.has_staff_permission('staff.logistics.manage') END;
$$;

-- URL safety (SSRF): https only, no credentials, no internal destinations.
CREATE OR REPLACE FUNCTION public.logistics_webhook_url_valid(_url text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE h text;
BEGIN
  IF _url IS NULL OR _url !~* '^https://' THEN RETURN false; END IF;
  IF length(_url) > 2000 THEN RETURN false; END IF;
  IF _url ~ '@' THEN RETURN false; END IF;                       -- userinfo / credential smuggling
  h := lower(split_part(split_part(regexp_replace(_url, '^https://', ''), '/', 1), ':', 1));
  IF h = '' THEN RETURN false; END IF;
  IF h IN ('localhost','metadata.google.internal','169.254.169.254') THEN RETURN false; END IF;
  IF h ~ '\.(local|internal|localdomain)$' THEN RETURN false; END IF;
  IF h ~ '^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.6[4-9]\.|100\.[7-9][0-9]\.|100\.1[0-1][0-9]\.|100\.12[0-7]\.)' THEN RETURN false; END IF;
  IF h ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.' THEN RETURN false; END IF;
  IF h ~ '^\[' THEN RETURN false; END IF;                        -- raw IPv6 literals
  RETURN true;
END; $$;

-- ---------- EVENT EMISSION (service-role only) ----------
CREATE OR REPLACE FUNCTION public.logistics_event_emit(
  _event_type text, _aggregate_type text, _aggregate_id uuid, _payload jsonb,
  _tenant_id uuid DEFAULT NULL, _correlation_id text DEFAULT NULL, _causation_id text DEFAULT NULL,
  _actor_type text DEFAULT 'system', _actor_id uuid DEFAULT NULL,
  _environment public.partner_api_environment DEFAULT 'production',
  _is_synthetic boolean DEFAULT false, _internal_reference jsonb DEFAULT '{}'::jsonb,
  _dedupe_key text DEFAULT NULL, _occurred_at timestamptz DEFAULT now()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat public.logistics_event_catalogue;
  v_seq bigint;
  v_event_id uuid;
  v_corr text := coalesce(_correlation_id, gen_random_uuid()::text);
  v_fanned int := 0;
  v_ep record;
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cat FROM public.logistics_event_catalogue WHERE event_type = _event_type;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EVENT_NOT_IN_CATALOGUE', 'event_type', _event_type);
  END IF;
  IF v_cat.aggregate_type <> _aggregate_type THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AGGREGATE_MISMATCH',
      'expected', v_cat.aggregate_type, 'received', _aggregate_type);
  END IF;

  IF _dedupe_key IS NOT NULL THEN
    SELECT event_id INTO v_event_id FROM public.logistics_integration_events WHERE dedupe_key = _dedupe_key;
    IF v_event_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'event_id', v_event_id);
    END IF;
  END IF;

  SELECT coalesce(max(sequence), 0) + 1 INTO v_seq
    FROM public.logistics_integration_events
   WHERE aggregate_type = _aggregate_type AND aggregate_id = _aggregate_id;

  INSERT INTO public.logistics_integration_events (
    event_type, event_version, schema_version, payload_version, aggregate_type, aggregate_id,
    sequence, tenant_id, environment, is_synthetic, occurred_at, correlation_id, causation_id,
    actor_type, actor_id, internal_reference, payload, dedupe_key)
  VALUES (
    _event_type, v_cat.event_version, v_cat.schema_version, v_cat.schema_version, _aggregate_type, _aggregate_id,
    v_seq, _tenant_id, _environment, _is_synthetic, _occurred_at, v_corr, _causation_id,
    _actor_type, _actor_id, coalesce(_internal_reference,'{}'::jsonb), coalesce(_payload,'{}'::jsonb), _dedupe_key)
  RETURNING event_id INTO v_event_id;

  -- Fan out only to ACTIVE/DEGRADED endpoints in the same environment that are
  -- subscribed to this event AND entitled to the tenant.
  FOR v_ep IN
    SELECT e.* FROM public.logistics_webhook_endpoints e
     WHERE e.status IN ('ACTIVE','DEGRADED')
       AND e.environment = _environment
       AND _event_type = ANY (e.subscribed_events)
       AND (
         _tenant_id IS NULL AND e.tenant_id IS NULL
         OR e.tenant_id = _tenant_id
         OR (e.tenant_id IS NULL AND EXISTS (
              SELECT 1 FROM public.logistics_partner_tenants t
               WHERE t.partner_id = e.partner_id AND t.tenant_id = _tenant_id
                 AND t.environment = _environment AND t.status = 'active'))
       )
  LOOP
    INSERT INTO public.logistics_webhook_deliveries (
      endpoint_id, event_id, partner_id, event_type, aggregate_type, aggregate_id, sequence,
      environment, idempotency_key, request_payload, max_attempts, correlation_id, next_retry_at)
    VALUES (
      v_ep.id, v_event_id, v_ep.partner_id, _event_type, _aggregate_type, _aggregate_id, v_seq,
      _environment, v_event_id::text,
      jsonb_build_object(
        'event_id', v_event_id, 'event_type', _event_type, 'event_version', v_cat.event_version,
        'schema_version', v_cat.schema_version, 'payload_version', v_cat.schema_version,
        'aggregate_type', _aggregate_type, 'aggregate_id', _aggregate_id, 'sequence', v_seq,
        'tenant_id', _tenant_id, 'environment', _environment, 'test', _is_synthetic OR _environment = 'sandbox',
        'occurred_at', _occurred_at, 'correlation_id', v_corr, 'causation_id', _causation_id,
        'data', coalesce(_payload,'{}'::jsonb)),
      v_ep.max_attempts, v_corr, now())
    ON CONFLICT (endpoint_id, idempotency_key) DO NOTHING;
    v_fanned := v_fanned + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id, 'sequence', v_seq,
                            'correlation_id', v_corr, 'deliveries_queued', v_fanned);
END; $$;
REVOKE ALL ON FUNCTION public.logistics_event_emit(text,text,uuid,jsonb,uuid,text,text,text,uuid,public.partner_api_environment,boolean,jsonb,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_event_emit(text,text,uuid,jsonb,uuid,text,text,text,uuid,public.partner_api_environment,boolean,jsonb,text,timestamptz) TO service_role;

-- ---------- ENDPOINT MANAGEMENT (staff) ----------
CREATE OR REPLACE FUNCTION public.logistics_webhook_endpoint_upsert(
  _id uuid, _partner_id uuid, _label text, _url text,
  _environment public.partner_api_environment, _subscribed_events text[],
  _tenant_id uuid DEFAULT NULL, _max_attempts integer DEFAULT 8,
  _timeout_ms integer DEFAULT 10000, _backoff_base_ms integer DEFAULT 2000
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text; v_id uuid; v_unknown text[];
BEGIN
  IF NOT public.logistics_integration_authorised('manage') THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_ERROR','message','Not permitted to manage webhook endpoints');
  END IF;
  IF NOT public.logistics_webhook_url_valid(_url) THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_ENDPOINT_URL',
      'message','Endpoint must be a public https URL. Internal, loopback and credential-bearing URLs are refused.');
  END IF;
  SELECT array_agg(x) INTO v_unknown FROM unnest(coalesce(_subscribed_events,'{}')) x
   WHERE x NOT IN (SELECT event_type FROM public.logistics_event_catalogue WHERE publishable);
  IF v_unknown IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','UNKNOWN_EVENT_TYPE','unknown', to_jsonb(v_unknown));
  END IF;

  IF _id IS NULL THEN
    v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.logistics_webhook_endpoints (
      partner_id, tenant_id, environment, label, url, secret, secret_fingerprint,
      subscribed_events, max_attempts, timeout_ms, backoff_base_ms, created_by, status)
    VALUES (_partner_id, _tenant_id, _environment, _label, _url, v_secret,
      left(encode(extensions.digest(v_secret,'sha256'),'hex'), 16),
      coalesce(_subscribed_events,'{}'), _max_attempts, _timeout_ms, _backoff_base_ms, auth.uid(), 'CONFIGURED')
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'endpoint_id', v_id, 'secret', v_secret,
      'message','Store this signing secret now — it is shown once.');
  END IF;

  UPDATE public.logistics_webhook_endpoints
     SET label=_label, url=_url, tenant_id=_tenant_id, environment=_environment,
         subscribed_events=coalesce(_subscribed_events,'{}'),
         max_attempts=_max_attempts, timeout_ms=_timeout_ms, backoff_base_ms=_backoff_base_ms,
         updated_at=now()
   WHERE id=_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Endpoint not found'); END IF;
  RETURN jsonb_build_object('ok', true, 'endpoint_id', v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_webhook_endpoint_set_status(_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.logistics_integration_authorised('manage') THEN
    RETURN jsonb_build_object('ok', false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  IF _status NOT IN ('CONFIGURED','ACTIVE','SUSPENDED','REVOKED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION',
      'message','DEGRADED and FAILING are derived from telemetry and cannot be set by hand.');
  END IF;
  UPDATE public.logistics_webhook_endpoints
     SET status=_status, status_reason=_reason,
         consecutive_failures = CASE WHEN _status='ACTIVE' THEN 0 ELSE consecutive_failures END,
         updated_at=now()
   WHERE id=_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'endpoint_id', _id, 'status', _status);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_webhook_endpoint_rotate_secret(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  IF NOT public.logistics_integration_authorised('manage') THEN
    RETURN jsonb_build_object('ok', false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE public.logistics_webhook_endpoints
     SET secret=v_secret, secret_fingerprint=left(encode(extensions.digest(v_secret,'sha256'),'hex'),16),
         secret_rotated_at=now(), updated_at=now()
   WHERE id=_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'endpoint_id', _id, 'secret', v_secret,
    'message','Shown once. Update the partner endpoint before the next delivery.');
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_partner_tenant_grant(
  _partner_id uuid, _tenant_id uuid, _environment public.partner_api_environment,
  _scopes text[], _tenant_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.logistics_integration_authorised('manage') THEN
    RETURN jsonb_build_object('ok', false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  INSERT INTO public.logistics_partner_tenants (partner_id, tenant_id, tenant_label, environment, scopes, granted_by)
  VALUES (_partner_id, _tenant_id, _tenant_label, _environment, coalesce(_scopes,'{}'), auth.uid())
  ON CONFLICT (partner_id, tenant_id, environment)
  DO UPDATE SET scopes=excluded.scopes, tenant_label=coalesce(excluded.tenant_label, logistics_partner_tenants.tenant_label),
                status='active', updated_at=now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'grant_id', v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_partner_tenant_revoke(_grant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.logistics_integration_authorised('manage') THEN
    RETURN jsonb_build_object('ok', false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  UPDATE public.logistics_partner_tenants SET status='revoked', updated_at=now() WHERE id=_grant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'grant_id', _grant_id);
END; $$;

-- ---------- DELIVERY ENGINE (service-role only) ----------
CREATE OR REPLACE FUNCTION public.logistics_webhook_claim_deliveries(_limit integer DEFAULT 20)
RETURNS TABLE (
  delivery_id uuid, endpoint_id uuid, url text, secret text, signature_version text,
  timeout_ms integer, attempt integer, max_attempts integer, payload jsonb, correlation_id text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT d.id
      FROM public.logistics_webhook_deliveries d
      JOIN public.logistics_webhook_endpoints e ON e.id = d.endpoint_id
     WHERE d.status IN ('pending','retrying')
       AND d.next_retry_at <= now()
       AND e.status IN ('ACTIVE','DEGRADED')
       -- ordering guarantee: never deliver a later event for the same aggregate
       -- while an earlier one is still outstanding on this endpoint.
       AND NOT EXISTS (
         SELECT 1 FROM public.logistics_webhook_deliveries p
          WHERE p.endpoint_id = d.endpoint_id
            AND p.aggregate_type = d.aggregate_type
            AND p.aggregate_id = d.aggregate_id
            AND p.sequence < d.sequence
            AND p.status IN ('pending','processing','retrying'))
     ORDER BY d.next_retry_at
     LIMIT greatest(1, least(coalesce(_limit,20), 100))
     FOR UPDATE OF d SKIP LOCKED
  )
  UPDATE public.logistics_webhook_deliveries d
     SET status='processing', claimed_at=now(), attempt=d.attempt+1, updated_at=now()
    FROM due, public.logistics_webhook_endpoints e
   WHERE d.id = due.id AND e.id = d.endpoint_id
  RETURNING d.id, e.id, e.url, e.secret, e.signature_version, e.timeout_ms,
            d.attempt, d.max_attempts, d.request_payload, d.correlation_id;
END; $$;
REVOKE ALL ON FUNCTION public.logistics_webhook_claim_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_webhook_claim_deliveries(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.logistics_webhook_record_attempt(
  _delivery_id uuid, _success boolean, _http_status integer DEFAULT NULL,
  _latency_ms integer DEFAULT NULL, _failure_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.logistics_webhook_deliveries; v_next timestamptz; v_status text; v_base int; v_ep uuid;
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.logistics_webhook_deliveries WHERE id=_delivery_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  SELECT backoff_base_ms, id INTO v_base, v_ep FROM public.logistics_webhook_endpoints WHERE id=d.endpoint_id;

  IF _success THEN
    UPDATE public.logistics_webhook_deliveries
       SET status='delivered', http_status=_http_status, response_class='2xx',
           latency_ms=_latency_ms, delivered_at=now(), failure_reason=NULL, updated_at=now()
     WHERE id=_delivery_id;
    UPDATE public.logistics_webhook_endpoints
       SET last_success_at=now(), consecutive_failures=0, delivered_count=delivered_count+1,
           status = CASE WHEN status IN ('DEGRADED','FAILING') THEN 'ACTIVE' ELSE status END,
           updated_at=now()
     WHERE id=v_ep;
    RETURN jsonb_build_object('ok',true,'status','delivered');
  END IF;

  IF d.attempt >= d.max_attempts THEN
    v_status := 'dead_letter'; v_next := NULL;
  ELSE
    v_status := 'retrying';
    v_next := now() + make_interval(secs => least(3600, (coalesce(v_base,2000) / 1000.0) * power(2, greatest(0, d.attempt - 1))));
  END IF;

  UPDATE public.logistics_webhook_deliveries
     SET status=v_status, http_status=_http_status,
         response_class = CASE WHEN _http_status IS NULL THEN 'network'
                               WHEN _http_status BETWEEN 400 AND 499 THEN '4xx'
                               WHEN _http_status >= 500 THEN '5xx' ELSE 'other' END,
         latency_ms=_latency_ms, failure_reason=left(coalesce(_failure_reason,'unknown'), 500),
         next_retry_at=coalesce(v_next, d.next_retry_at), updated_at=now()
   WHERE id=_delivery_id;

  UPDATE public.logistics_webhook_endpoints
     SET last_failure_at=now(), failure_count=failure_count+1, consecutive_failures=consecutive_failures+1,
         status = CASE
           WHEN status IN ('SUSPENDED','REVOKED') THEN status
           WHEN consecutive_failures + 1 >= 10 THEN 'FAILING'
           WHEN consecutive_failures + 1 >= 3 THEN 'DEGRADED'
           ELSE status END,
         updated_at=now()
   WHERE id=v_ep;

  RETURN jsonb_build_object('ok',true,'status',v_status,'next_retry_at',v_next);
END; $$;
REVOKE ALL ON FUNCTION public.logistics_webhook_record_attempt(uuid,boolean,integer,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_webhook_record_attempt(uuid,boolean,integer,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.logistics_webhook_replay(_delivery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.logistics_webhook_deliveries; v_new uuid;
BEGIN
  IF NOT public.logistics_integration_authorised('manage') THEN
    RETURN jsonb_build_object('ok', false,'code','AUTHORIZATION_ERROR','message','Not permitted to replay deliveries');
  END IF;
  SELECT * INTO d FROM public.logistics_webhook_deliveries WHERE id=_delivery_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;

  INSERT INTO public.logistics_webhook_deliveries (
    endpoint_id, event_id, partner_id, event_type, aggregate_type, aggregate_id, sequence,
    environment, idempotency_key, request_payload, max_attempts, correlation_id,
    next_retry_at, replay_of, replayed_by)
  VALUES (
    d.endpoint_id, d.event_id, d.partner_id, d.event_type, d.aggregate_type, d.aggregate_id, d.sequence,
    d.environment, d.idempotency_key || ':replay:' || extract(epoch from now())::bigint,
    d.request_payload, d.max_attempts, d.correlation_id, now(), d.id, auth.uid())
  RETURNING id INTO v_new;

  RETURN jsonb_build_object('ok', true, 'delivery_id', v_new, 'replay_of', d.id,
                            'event_id', d.event_id, 'correlation_id', d.correlation_id);
END; $$;

-- ---------- PARTNER API SUPPORT (service-role only) ----------
CREATE OR REPLACE FUNCTION public.logistics_api_rate_check(
  _scope_kind text, _scope_value text, _environment public.partner_api_environment)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit int; v_burst int; v_window timestamptz := date_trunc('minute', now()); v_hits int;
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;
  SELECT limit_per_minute, burst INTO v_limit, v_burst FROM public.logistics_api_rate_limits
   WHERE scope_kind=_scope_kind AND scope_value=_scope_value AND environment=_environment;
  IF v_limit IS NULL THEN
    SELECT limit_per_minute, burst INTO v_limit, v_burst FROM public.logistics_api_rate_limits
     WHERE scope_kind='default' AND scope_value='*' AND environment=_environment;
  END IF;
  v_limit := coalesce(v_limit, 120); v_burst := coalesce(v_burst, 0);

  INSERT INTO public.logistics_api_rate_counters (scope_kind, scope_value, environment, window_start, hits)
  VALUES (_scope_kind, _scope_value, _environment, v_window, 1)
  ON CONFLICT (scope_kind, scope_value, environment, window_start)
  DO UPDATE SET hits = logistics_api_rate_counters.hits + 1
  RETURNING hits INTO v_hits;

  RETURN jsonb_build_object(
    'allowed', v_hits <= v_limit + v_burst,
    'limit', v_limit, 'remaining', greatest(0, v_limit + v_burst - v_hits),
    'reset_at', v_window + interval '1 minute');
END; $$;
REVOKE ALL ON FUNCTION public.logistics_api_rate_check(text,text,public.partner_api_environment) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_api_rate_check(text,text,public.partner_api_environment) TO service_role;

CREATE OR REPLACE FUNCTION public.logistics_api_idempotency_begin(
  _partner_id uuid, _environment public.partner_api_environment, _key text,
  _operation text, _request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.logistics_api_idempotency;
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.logistics_api_idempotency
   WHERE partner_id=_partner_id AND environment=_environment AND idempotency_key=_key;
  IF FOUND THEN
    IF r.request_hash <> _request_hash OR r.operation <> _operation THEN
      RETURN jsonb_build_object('state','conflict','code','IDEMPOTENCY_KEY_REUSED');
    END IF;
    IF r.state='completed' THEN
      RETURN jsonb_build_object('state','replay','response_status',r.response_status,'response_body',r.response_body);
    END IF;
    RETURN jsonb_build_object('state','in_flight','code','REQUEST_IN_FLIGHT');
  END IF;
  INSERT INTO public.logistics_api_idempotency (partner_id, environment, idempotency_key, operation, request_hash)
  VALUES (_partner_id, _environment, _key, _operation, _request_hash);
  RETURN jsonb_build_object('state','new');
END; $$;
REVOKE ALL ON FUNCTION public.logistics_api_idempotency_begin(uuid,public.partner_api_environment,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_api_idempotency_begin(uuid,public.partner_api_environment,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.logistics_api_idempotency_complete(
  _partner_id uuid, _environment public.partner_api_environment, _key text,
  _status integer, _body jsonb, _resource_type text DEFAULT NULL, _resource_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.logistics_api_idempotency
     SET state='completed', response_status=_status, response_body=_body,
         resource_type=_resource_type, resource_id=_resource_id, completed_at=now()
   WHERE partner_id=_partner_id AND environment=_environment AND idempotency_key=_key;
END; $$;
REVOKE ALL ON FUNCTION public.logistics_api_idempotency_complete(uuid,public.partner_api_environment,text,integer,jsonb,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_api_idempotency_complete(uuid,public.partner_api_environment,text,integer,jsonb,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.logistics_api_log_request(
  _request_id text, _correlation_id text, _partner_id uuid, _credential_id uuid, _tenant_id uuid,
  _environment public.partner_api_environment, _method text, _path text, _operation text,
  _scope_required text, _outcome text, _http_status integer, _error_code text,
  _latency_ms integer, _idempotent_replay boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'service_context_required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.logistics_api_requests (
    request_id, correlation_id, partner_id, credential_id, tenant_id, environment, method, path,
    operation, scope_required, outcome, http_status, error_code, latency_ms, idempotent_replay)
  VALUES (_request_id, _correlation_id, _partner_id, _credential_id, _tenant_id, _environment,
    _method, left(_path, 300), _operation, _scope_required, _outcome, _http_status, _error_code,
    coalesce(_latency_ms,0), coalesce(_idempotent_replay,false));
END; $$;
REVOKE ALL ON FUNCTION public.logistics_api_log_request(text,text,uuid,uuid,uuid,public.partner_api_environment,text,text,text,text,text,integer,text,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_api_log_request(text,text,uuid,uuid,uuid,public.partner_api_environment,text,text,text,text,text,integer,text,integer,boolean) TO service_role;

-- ---------- STAFF READ SURFACES ----------
CREATE OR REPLACE FUNCTION public.logistics_integration_endpoints()
RETURNS SETOF public.v_logistics_webhook_endpoints
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.logistics_integration_authorised('read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT * FROM public.v_logistics_webhook_endpoints ORDER BY created_at DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_integration_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.logistics_integration_authorised('read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'events_24h', (SELECT count(*) FROM public.logistics_integration_events WHERE created_at > now() - interval '24 hours'),
    'events_total', (SELECT count(*) FROM public.logistics_integration_events),
    'endpoints', (SELECT jsonb_object_agg(status, n) FROM (
        SELECT status, count(*) n FROM public.logistics_webhook_endpoints GROUP BY status) s),
    'deliveries', (SELECT jsonb_object_agg(status, n) FROM (
        SELECT status, count(*) n FROM public.logistics_webhook_deliveries GROUP BY status) s),
    'dead_letters', (SELECT count(*) FROM public.logistics_webhook_deliveries WHERE status='dead_letter'),
    'delivery_success_rate_24h', (
        SELECT CASE WHEN count(*)=0 THEN NULL
               ELSE round(100.0 * count(*) FILTER (WHERE status='delivered') / count(*), 1) END
          FROM public.logistics_webhook_deliveries WHERE created_at > now() - interval '24 hours'),
    'api_requests_24h', (SELECT count(*) FROM public.logistics_api_requests WHERE created_at > now() - interval '24 hours'),
    'api_error_rate_24h', (
        SELECT CASE WHEN count(*)=0 THEN NULL
               ELSE round(100.0 * count(*) FILTER (WHERE http_status >= 400) / count(*), 1) END
          FROM public.logistics_api_requests WHERE created_at > now() - interval '24 hours'),
    'api_p95_latency_ms', (
        SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)
          FROM public.logistics_api_requests WHERE created_at > now() - interval '24 hours')
  ) INTO v;
  RETURN v;
END; $$;
