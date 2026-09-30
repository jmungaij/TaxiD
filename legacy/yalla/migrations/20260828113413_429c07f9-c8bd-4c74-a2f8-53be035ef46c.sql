-- =====================================================================
-- PHASE 4 — PARTNER API AUTHORITATIVE OPERATIONS (service-role only)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.logistics_api_authenticate(_client_id text, _secret_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.partner_api_credentials; p public.partners;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.partner_api_credentials WHERE client_id = _client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_INVALID'); END IF;
  IF c.secret_hash IS DISTINCT FROM _secret_sha THEN RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_INVALID'); END IF;
  IF c.status = 'revoked' THEN RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_REVOKED'); END IF;
  IF c.status = 'rotating' AND c.grace_expires_at IS NOT NULL AND c.grace_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_REVOKED');
  END IF;
  SELECT * INTO p FROM public.partners WHERE id = c.partner_id;
  IF p.status IN ('suspended','terminated','rejected') THEN
    RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_REVOKED');
  END IF;
  UPDATE public.partner_api_credentials SET last_used_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'partner_id', c.partner_id, 'credential_id', c.id,
    'environment', c.environment, 'scopes', to_jsonb(c.scopes), 'tier', c.tier,
    'rate_limit_per_min', c.rate_limit_per_min, 'partner_code', p.partner_code);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_entitled_tenants(_partner_id uuid, _environment public.partner_api_environment)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(tenant_id), '{}'::uuid[]) FROM public.logistics_partner_tenants
   WHERE partner_id = _partner_id AND environment = _environment AND status = 'active';
$$;

-- Visibility predicate: the partner's own API-created record, or a record that
-- belongs to a tenant the partner is entitled to. Nothing else is reachable.
CREATE OR REPLACE FUNCTION public.logistics_api_can_see_order(_partner_id uuid, _environment public.partner_api_environment, _order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.delivery_orders o
     WHERE o.id = _order_id
       AND coalesce(o.metadata->>'environment','production') = _environment::text
       AND (
         o.metadata->>'partner_id' = _partner_id::text
         OR (o.metadata->>'tenant_id') IS NOT NULL
            AND (o.metadata->>'tenant_id')::uuid = ANY (public.logistics_api_entitled_tenants(_partner_id, _environment))
       ));
$$;

-- ---------------- READS (minimised projections) ----------------
CREATE OR REPLACE FUNCTION public.logistics_api_order(_partner_id uuid, _environment public.partner_api_environment, _order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  IF NOT public.logistics_api_can_see_order(_partner_id, _environment, _order_id) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'service', o.module, 'status', o.status,
    'payment_status', o.payment_status, 'total_amount', o.total_amount, 'currency', o.currency,
    'partner_reference', o.metadata->>'partner_reference', 'tenant_id', o.metadata->>'tenant_id',
    'pickup', jsonb_build_object('address', o.pickup_address, 'window_start', o.pickup_window_start),
    'sla_deadline', o.sla_deadline, 'created_at', o.created_at, 'updated_at', o.updated_at,
    'packages', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'tracking_number', p.tracking_number, 'status', p.status,
        'weight_kg', p.weight_kg, 'delivered_at', p.delivered_at) ORDER BY p.created_at)
      FROM public.packages p WHERE p.order_id = o.id), '[]'::jsonb))
  INTO v FROM public.delivery_orders o WHERE o.id = _order_id;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_package(_partner_id uuid, _environment public.partner_api_environment, _package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_order uuid;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT order_id INTO v_order FROM public.packages WHERE id = _package_id;
  IF v_order IS NULL OR NOT public.logistics_api_can_see_order(_partner_id, _environment, v_order) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', p.id, 'order_id', p.order_id, 'tracking_number', p.tracking_number, 'status', p.status,
    'service', p.module, 'weight_kg', p.weight_kg, 'declared_value', p.declared_value, 'currency', p.currency,
    'picked_up_at', p.picked_up_at, 'delivered_at', p.delivered_at, 'created_at', p.created_at,
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('event_type', e.event_type, 'occurred_at', e.created_at)
        ORDER BY e.created_at) FROM public.package_events e WHERE e.package_id = p.id), '[]'::jsonb))
  INTO v FROM public.packages p WHERE p.id = _package_id;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_tracking(_partner_id uuid, _environment public.partner_api_environment, _reference text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT id INTO v_id FROM public.packages WHERE upper(tracking_number) = upper(trim(_reference));
  IF v_id IS NULL THEN
    SELECT p.id INTO v_id FROM public.packages p JOIN public.delivery_orders o ON o.id = p.order_id
     WHERE o.metadata->>'partner_reference' = trim(_reference) LIMIT 1;
  END IF;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.logistics_api_package(_partner_id, _environment, v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_route(_partner_id uuid, _environment public.partner_api_environment, _route_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  -- A route is visible only through the partner's own packages on it.
  IF NOT EXISTS (
    SELECT 1 FROM public.logistics_stop_packages sp
      JOIN public.logistics_route_stops s ON s.id = sp.stop_id
      JOIN public.packages p ON p.id = sp.package_id
     WHERE s.route_id = _route_id
       AND public.logistics_api_can_see_order(_partner_id, _environment, p.order_id)) THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'id', r.id, 'route_code', r.route_code, 'status', r.status, 'planned_date', r.planned_date,
    'stop_count', (SELECT count(*) FROM public.logistics_route_stops s WHERE s.route_id = r.id),
    'my_stops', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'stop_id', s.id, 'sequence', s.sequence, 'status', s.status, 'eta', s.planned_arrival_at))
      FROM public.logistics_route_stops s
      JOIN public.logistics_stop_packages sp ON sp.stop_id = s.id
      JOIN public.packages p ON p.id = sp.package_id
     WHERE s.route_id = r.id AND public.logistics_api_can_see_order(_partner_id, _environment, p.order_id)), '[]'::jsonb))
  INTO v FROM public.logistics_routes r WHERE r.id = _route_id;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_delivery_attempt(_partner_id uuid, _environment public.partner_api_environment, _attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('id', a.id, 'package_id', a.package_id, 'attempt_number', a.attempt_number,
    'outcome', a.outcome, 'reason_code', a.reason_code, 'occurred_at', a.occurred_at, 'pod_id', a.pod_id)
    INTO v FROM public.logistics_delivery_attempts a
   WHERE a.id = _attempt_id AND public.logistics_api_can_see_order(_partner_id, _environment, a.order_id);
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_pod(_partner_id uuid, _environment public.partner_api_environment, _pod_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  -- Recipient identity references, coordinates and staff notes are never exposed.
  SELECT jsonb_build_object('id', r.id, 'package_id', r.package_id, 'attempt_id', r.attempt_id,
    'status', r.status, 'policy_version', r.policy_version, 'recipient_name', r.recipient_name,
    'signature_captured', r.signature_ref IS NOT NULL, 'otp_verified', r.otp_verified,
    'integrity_hash', r.integrity_hash, 'captured_at', r.captured_at,
    'evidence_files', coalesce((SELECT count(*) FROM public.logistics_pod_evidence_files f WHERE f.pod_id = r.id), 0))
    INTO v FROM public.logistics_pod_records r
   WHERE r.id = _pod_id AND public.logistics_api_can_see_order(_partner_id, _environment, r.order_id);
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_return(_partner_id uuid, _environment public.partner_api_environment, _return_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('id', r.id, 'return_number', r.return_number, 'package_id', r.package_id,
    'reason_code', r.reason_code, 'authorization_status', r.authorization_status,
    'movement_status', r.movement_status, 'disposition', r.disposition,
    'resolution_state', r.resolution_state, 'created_at', r.created_at, 'updated_at', r.updated_at)
    INTO v FROM public.package_returns r JOIN public.packages p ON p.id = r.package_id
   WHERE r.id = _return_id AND public.logistics_api_can_see_order(_partner_id, _environment, p.order_id);
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_exceptions(
  _partner_id uuid, _environment public.partner_api_environment, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('id', e.id, 'exception_number', e.exception_number, 'package_id', e.package_id,
      'kind', e.kind, 'severity', e.severity, 'status', e.status, 'reason_code', e.reason_code,
      'sla_due_at', e.sla_due_at, 'created_at', e.created_at, 'resolved_at', e.resolved_at) x
      FROM public.logistics_exceptions e
     WHERE e.order_id IS NOT NULL
       AND public.logistics_api_can_see_order(_partner_id, _environment, e.order_id)
     ORDER BY e.created_at DESC
     LIMIT greatest(1, least(coalesce(_limit,50), 200)) OFFSET greatest(0, coalesce(_offset,0))) s;
  RETURN v;
END; $$;

-- ---------------- WRITES ----------------
-- The price is supplied by the caller only as _priced_amount, which the edge
-- function computes from the in-force rate plan. A partner-supplied amount is
-- never persisted, and an order is always created unpaid: no API request can
-- produce a financial effect on its own.
CREATE OR REPLACE FUNCTION public.logistics_api_create_order(
  _partner_id uuid, _environment public.partner_api_environment, _tenant_id uuid,
  _offering_code text, _priced_amount numeric, _currency text, _rating jsonb,
  _pickup jsonb, _dropoff jsonb, _packages jsonb, _partner_reference text,
  _correlation_id text, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.delivery_orders;
  v_pkg jsonb;
  v_tracking text;
  v_ids jsonb := '[]'::jsonb;
  v_new_id uuid;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  IF _tenant_id IS NOT NULL
     AND NOT (_tenant_id = ANY (public.logistics_api_entitled_tenants(_partner_id, _environment))) THEN
    RETURN jsonb_build_object('ok', false, 'code','TENANT_FORBIDDEN');
  END IF;

  INSERT INTO public.delivery_orders (
    order_number, module, customer_id, pickup_address, pickup_lat, pickup_lng,
    pickup_contact_name, pickup_contact_phone, status, total_amount, currency,
    payment_status, notes, metadata)
  VALUES (
    'API-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10)),
    _offering_code, NULL,
    _pickup->>'address', (_pickup->>'lat')::numeric, (_pickup->>'lng')::numeric,
    _pickup->>'contact_name', _pickup->>'contact_phone',
    'pending_payment', _priced_amount, coalesce(_currency,'KES'),
    'pending', _notes,
    jsonb_build_object('source','partner_api','partner_id', _partner_id, 'tenant_id', _tenant_id,
      'environment', _environment, 'partner_reference', _partner_reference,
      'rating', _rating, 'correlation_id', _correlation_id,
      'dropoff', _dropoff))
  RETURNING * INTO v_order;

  FOR v_pkg IN SELECT * FROM jsonb_array_elements(coalesce(_packages,'[]'::jsonb)) LOOP
    v_tracking := 'YM' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));
    INSERT INTO public.packages (
      tracking_number, order_id, module, recipient_name, recipient_phone,
      pickup_address, dropoff_address, weight_kg, declared_value, currency, status, metadata)
    VALUES (
      v_tracking, v_order.id, _offering_code,
      _dropoff->>'contact_name', _dropoff->>'contact_phone',
      _pickup->>'address', _dropoff->>'address',
      (v_pkg->>'weight_kg')::numeric, (v_pkg->>'declared_value')::numeric,
      coalesce(_currency,'KES'), 'created',
      jsonb_build_object('source','partner_api','partner_id', _partner_id, 'environment', _environment))
    RETURNING id INTO v_new_id;
    v_ids := v_ids || jsonb_build_object('id', v_new_id, 'tracking_number', v_tracking);
  END LOOP;

  PERFORM public.logistics_event_emit('order.created','order', v_order.id,
    jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
      'module', _offering_code, 'status', v_order.status, 'total_amount', v_order.total_amount,
      'currency', v_order.currency, 'created_at', v_order.created_at),
    _tenant_id, _correlation_id, NULL, 'partner', NULL, _environment,
    _environment = 'sandbox', jsonb_build_object('table','delivery_orders','id', v_order.id), NULL, now());

  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'order_number', v_order.order_number,
    'status', v_order.status, 'payment_status', v_order.payment_status,
    'total_amount', v_order.total_amount, 'currency', v_order.currency, 'packages', v_ids);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_create_return(
  _partner_id uuid, _environment public.partner_api_environment,
  _package_id uuid, _reason_code text, _instructions text, _correlation_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order uuid; v_id uuid; v_number text;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT order_id INTO v_order FROM public.packages WHERE id = _package_id;
  IF v_order IS NULL OR NOT public.logistics_api_can_see_order(_partner_id, _environment, v_order) THEN
    RETURN jsonb_build_object('ok', false, 'code','NOT_FOUND');
  END IF;
  IF EXISTS (SELECT 1 FROM public.package_returns WHERE package_id = _package_id
              AND coalesce(resolution_state,'open') <> 'resolved') THEN
    RETURN jsonb_build_object('ok', false, 'code','CONFLICT','message','An open return already exists for this package.');
  END IF;
  v_number := 'RET-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8));
  INSERT INTO public.package_returns (package_id, reason, reason_code, return_number, status,
    authorization_status, movement_status, return_instructions, initiated_by)
  VALUES (_package_id, coalesce(_reason_code,'partner_request'), _reason_code, v_number,
    'requested', 'requested', 'not_started', _instructions, NULL)
  RETURNING id INTO v_id;

  PERFORM public.logistics_event_emit('package.return_initiated','package', _package_id,
    jsonb_build_object('package_id', _package_id, 'return_id', v_id, 'reason_code', _reason_code),
    NULL, _correlation_id, NULL, 'partner', NULL, _environment, _environment = 'sandbox',
    jsonb_build_object('table','package_returns','id', v_id), NULL, now());

  RETURN jsonb_build_object('ok', true, 'return_id', v_id, 'return_number', v_number,
    'authorization_status', 'requested');
END; $$;

-- Service-role only for every function above.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname LIKE 'logistics_api_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;