-- Internal emitter: same behaviour as logistics_event_emit but callable from
-- trigger/definer functions running in a staff session. Not granted to anyone.
CREATE OR REPLACE FUNCTION public.logistics_event_emit_internal(
  _event_type text, _aggregate_type text, _aggregate_id uuid, _payload jsonb,
  _tenant_id uuid DEFAULT NULL, _correlation_id text DEFAULT NULL, _causation_id text DEFAULT NULL,
  _actor_type text DEFAULT 'system', _actor_id uuid DEFAULT NULL,
  _environment public.partner_api_environment DEFAULT 'production',
  _is_synthetic boolean DEFAULT false, _internal_reference jsonb DEFAULT '{}'::jsonb,
  _dedupe_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cat public.logistics_event_catalogue;
  v_seq bigint; v_event_id uuid; v_corr text := coalesce(_correlation_id, gen_random_uuid()::text);
  v_ep record;
BEGIN
  SELECT * INTO v_cat FROM public.logistics_event_catalogue WHERE event_type = _event_type;
  IF NOT FOUND OR v_cat.aggregate_type <> _aggregate_type THEN RETURN NULL; END IF;

  IF _dedupe_key IS NOT NULL THEN
    SELECT event_id INTO v_event_id FROM public.logistics_integration_events WHERE dedupe_key = _dedupe_key;
    IF v_event_id IS NOT NULL THEN RETURN v_event_id; END IF;
  END IF;

  SELECT coalesce(max(sequence),0)+1 INTO v_seq FROM public.logistics_integration_events
   WHERE aggregate_type=_aggregate_type AND aggregate_id=_aggregate_id;

  INSERT INTO public.logistics_integration_events (
    event_type, event_version, schema_version, payload_version, aggregate_type, aggregate_id,
    sequence, tenant_id, environment, is_synthetic, occurred_at, correlation_id, causation_id,
    actor_type, actor_id, internal_reference, payload, dedupe_key)
  VALUES (
    _event_type, v_cat.event_version, v_cat.schema_version, v_cat.schema_version, _aggregate_type, _aggregate_id,
    v_seq, _tenant_id, _environment, _is_synthetic, now(), v_corr, _causation_id,
    _actor_type, _actor_id, coalesce(_internal_reference,'{}'::jsonb), coalesce(_payload,'{}'::jsonb), _dedupe_key)
  RETURNING event_id INTO v_event_id;

  FOR v_ep IN
    SELECT e.* FROM public.logistics_webhook_endpoints e
     WHERE e.status IN ('ACTIVE','DEGRADED') AND e.environment = _environment
       AND _event_type = ANY (e.subscribed_events)
       AND (
         (_tenant_id IS NULL AND e.tenant_id IS NULL)
         OR e.tenant_id = _tenant_id
         OR (e.tenant_id IS NULL AND EXISTS (
              SELECT 1 FROM public.logistics_partner_tenants t
               WHERE t.partner_id = e.partner_id AND t.tenant_id = _tenant_id
                 AND t.environment = _environment AND t.status='active')))
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
        'tenant_id', _tenant_id, 'environment', _environment,
        'test', _is_synthetic OR _environment='sandbox', 'occurred_at', now(),
        'correlation_id', v_corr, 'causation_id', _causation_id, 'data', coalesce(_payload,'{}'::jsonb)),
      v_ep.max_attempts, v_corr, now())
    ON CONFLICT (endpoint_id, idempotency_key) DO NOTHING;
  END LOOP;

  RETURN v_event_id;
END; $$;
REVOKE ALL ON FUNCTION public.logistics_event_emit_internal(text,text,uuid,jsonb,uuid,text,text,text,uuid,public.partner_api_environment,boolean,jsonb,text) FROM PUBLIC, anon, authenticated;

-- Helper: tenant + environment for an order.
CREATE OR REPLACE FUNCTION public.logistics_order_context(_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tenant_id', nullif(o.metadata->>'tenant_id','')::uuid,
    'environment', coalesce(nullif(o.metadata->>'environment',''), 'production'),
    'correlation_id', o.metadata->>'correlation_id')
  FROM public.delivery_orders o WHERE o.id = _order_id;
$$;
REVOKE ALL ON FUNCTION public.logistics_order_context(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------- PACKAGE MILESTONES ----------------
CREATE OR REPLACE FUNCTION public._logistics_emit_package_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type text; ctx jsonb;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_type := CASE NEW.status
    WHEN 'picked_up' THEN 'package.picked_up'
    WHEN 'in_transit' THEN 'package.in_transit'
    WHEN 'arrived' THEN 'package.scanned'
    WHEN 'out_for_delivery' THEN 'package.out_for_delivery'
    WHEN 'delivered' THEN 'package.delivered'
    WHEN 'delivery_failed' THEN 'package.delivery_failed'
    WHEN 'returned' THEN 'package.returned'
    ELSE NULL END;
  IF v_type IS NULL THEN RETURN NEW; END IF;
  ctx := coalesce(public.logistics_order_context(NEW.order_id), '{}'::jsonb);
  PERFORM public.logistics_event_emit_internal(v_type, 'package', NEW.id,
    jsonb_build_object('package_id', NEW.id, 'tracking_number', NEW.tracking_number,
      'order_id', NEW.order_id, 'status', NEW.status,
      'delivered_at', NEW.delivered_at, 'picked_up_at', NEW.picked_up_at),
    nullif(ctx->>'tenant_id','')::uuid, ctx->>'correlation_id', NULL, 'system', NULL,
    coalesce((ctx->>'environment')::public.partner_api_environment, 'production'),
    coalesce(ctx->>'environment','production') = 'sandbox',
    jsonb_build_object('table','packages','id', NEW.id),
    'package:' || NEW.id::text || ':' || NEW.status);
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_package_status AFTER UPDATE OF status ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_package_status();

-- ---------------- DELIVERY ATTEMPTS ----------------
CREATE OR REPLACE FUNCTION public._logistics_emit_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ctx jsonb; v_env public.partner_api_environment; v_tenant uuid;
BEGIN
  ctx := coalesce(public.logistics_order_context(NEW.order_id), '{}'::jsonb);
  v_env := coalesce((ctx->>'environment')::public.partner_api_environment, 'production');
  v_tenant := nullif(ctx->>'tenant_id','')::uuid;
  PERFORM public.logistics_event_emit_internal('delivery.attempted','delivery_attempt', NEW.id,
    jsonb_build_object('attempt_id', NEW.id, 'package_id', NEW.package_id,
      'attempt_number', NEW.attempt_number, 'outcome', NEW.outcome,
      'reason_code', NEW.reason_code, 'occurred_at', NEW.occurred_at),
    v_tenant, NULL, NULL, 'driver', NEW.driver_id, v_env, v_env='sandbox',
    jsonb_build_object('table','logistics_delivery_attempts','id', NEW.id),
    'attempt:' || NEW.id::text || ':attempted');
  PERFORM public.logistics_event_emit_internal(
    CASE WHEN NEW.outcome = 'delivered' THEN 'delivery.completed' ELSE 'delivery.failed' END,
    'delivery_attempt', NEW.id,
    jsonb_build_object('attempt_id', NEW.id, 'package_id', NEW.package_id,
      'attempt_number', NEW.attempt_number, 'reason_code', NEW.reason_code, 'occurred_at', NEW.occurred_at),
    v_tenant, NULL, NULL, 'driver', NEW.driver_id, v_env, v_env='sandbox',
    jsonb_build_object('table','logistics_delivery_attempts','id', NEW.id),
    'attempt:' || NEW.id::text || ':outcome');
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_attempt AFTER INSERT ON public.logistics_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_attempt();

-- ---------------- POD ----------------
CREATE OR REPLACE FUNCTION public._logistics_emit_pod()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ctx jsonb; v_env public.partner_api_environment;
BEGIN
  ctx := coalesce(public.logistics_order_context(NEW.order_id), '{}'::jsonb);
  v_env := coalesce((ctx->>'environment')::public.partner_api_environment, 'production');
  PERFORM public.logistics_event_emit_internal('pod.created','pod', NEW.id,
    jsonb_build_object('pod_id', NEW.id, 'package_id', NEW.package_id, 'attempt_id', NEW.attempt_id,
      'policy_version', NEW.policy_version, 'captured_at', NEW.captured_at),
    nullif(ctx->>'tenant_id','')::uuid, NULL, NULL, 'staff', NEW.captured_by, v_env, v_env='sandbox',
    jsonb_build_object('table','logistics_pod_records','id', NEW.id),
    'pod:' || NEW.id::text || ':created');
  IF NEW.integrity_hash IS NOT NULL THEN
    PERFORM public.logistics_event_emit_internal('pod.verified','pod', NEW.id,
      jsonb_build_object('pod_id', NEW.id, 'package_id', NEW.package_id,
        'integrity_hash', NEW.integrity_hash, 'verified_at', NEW.captured_at),
      nullif(ctx->>'tenant_id','')::uuid, NULL, NULL, 'system', NULL, v_env, v_env='sandbox',
      jsonb_build_object('table','logistics_pod_records','id', NEW.id),
      'pod:' || NEW.id::text || ':verified');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_pod AFTER INSERT ON public.logistics_pod_records
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_pod();

-- ---------------- EXCEPTIONS ----------------
CREATE OR REPLACE FUNCTION public._logistics_emit_exception()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ctx jsonb; v_type text; v_env public.partner_api_environment;
BEGIN
  ctx := coalesce(public.logistics_order_context(NEW.order_id), '{}'::jsonb);
  v_env := coalesce((ctx->>'environment')::public.partner_api_environment, 'production');
  IF TG_OP = 'INSERT' THEN v_type := 'exception.opened';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_type := CASE WHEN NEW.status = 'resolved' THEN 'exception.resolved' ELSE 'exception.updated' END;
  ELSE RETURN NEW; END IF;
  PERFORM public.logistics_event_emit_internal(v_type,'exception', NEW.id,
    jsonb_build_object('exception_id', NEW.id, 'exception_number', NEW.exception_number,
      'kind', NEW.kind, 'severity', NEW.severity, 'status', NEW.status,
      'reason_code', NEW.reason_code, 'sla_due_at', NEW.sla_due_at, 'resolved_at', NEW.resolved_at),
    nullif(ctx->>'tenant_id','')::uuid, NULL, NULL, 'staff', NULL, v_env, v_env='sandbox',
    jsonb_build_object('table','logistics_exceptions','id', NEW.id),
    'exception:' || NEW.id::text || ':' || NEW.status);
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_exception AFTER INSERT OR UPDATE OF status ON public.logistics_exceptions
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_exception();

-- ---------------- RETURNS ----------------
CREATE OR REPLACE FUNCTION public._logistics_emit_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order uuid; ctx jsonb; v_env public.partner_api_environment; v_tenant uuid;
BEGIN
  SELECT order_id INTO v_order FROM public.packages WHERE id = NEW.package_id;
  ctx := coalesce(public.logistics_order_context(v_order), '{}'::jsonb);
  v_env := coalesce((ctx->>'environment')::public.partner_api_environment, 'production');
  v_tenant := nullif(ctx->>'tenant_id','')::uuid;

  IF TG_OP = 'UPDATE' AND NEW.authorization_status = 'authorized'
     AND OLD.authorization_status IS DISTINCT FROM 'authorized' THEN
    PERFORM public.logistics_event_emit_internal('return.authorized','return', NEW.id,
      jsonb_build_object('return_id', NEW.id, 'return_number', NEW.return_number,
        'package_id', NEW.package_id, 'reason_code', NEW.reason_code),
      v_tenant, NULL, NULL, 'staff', NEW.authorized_by, v_env, v_env='sandbox',
      jsonb_build_object('table','package_returns','id', NEW.id), 'return:'||NEW.id::text||':authorized');
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.movement_status IS DISTINCT FROM OLD.movement_status THEN
    PERFORM public.logistics_event_emit_internal(
      CASE NEW.movement_status WHEN 'in_transit' THEN 'return.dispatched'
                               WHEN 'received' THEN 'return.received' ELSE NULL END,
      'return', NEW.id,
      jsonb_build_object('return_id', NEW.id, 'return_number', NEW.return_number,
        'movement_status', NEW.movement_status),
      v_tenant, NULL, NULL, 'staff', NEW.updated_by, v_env, v_env='sandbox',
      jsonb_build_object('table','package_returns','id', NEW.id),
      'return:'||NEW.id::text||':movement:'||NEW.movement_status);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.disposition IS DISTINCT FROM OLD.disposition AND NEW.disposition IS NOT NULL THEN
    PERFORM public.logistics_event_emit_internal('return.dispositioned','return', NEW.id,
      jsonb_build_object('return_id', NEW.id, 'return_number', NEW.return_number, 'disposition', NEW.disposition),
      v_tenant, NULL, NULL, 'staff', NEW.updated_by, v_env, v_env='sandbox',
      jsonb_build_object('table','package_returns','id', NEW.id), 'return:'||NEW.id::text||':disposition');
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.resolution_state IS DISTINCT FROM OLD.resolution_state
     AND NEW.resolution_state = 'resolved' THEN
    PERFORM public.logistics_event_emit_internal('return.resolved','return', NEW.id,
      jsonb_build_object('return_id', NEW.id, 'return_number', NEW.return_number,
        'resolution_state', NEW.resolution_state),
      v_tenant, NULL, NULL, 'staff', NEW.updated_by, v_env, v_env='sandbox',
      jsonb_build_object('table','package_returns','id', NEW.id), 'return:'||NEW.id::text||':resolved');
  END IF;

  RETURN NEW;
END; $$;
CREATE TRIGGER lie_return AFTER UPDATE ON public.package_returns
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_return();

CREATE OR REPLACE FUNCTION public._logistics_emit_return_inspection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ret public.package_returns; v_order uuid; ctx jsonb; v_env public.partner_api_environment;
BEGIN
  SELECT * INTO v_ret FROM public.package_returns WHERE id = NEW.return_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT order_id INTO v_order FROM public.packages WHERE id = v_ret.package_id;
  ctx := coalesce(public.logistics_order_context(v_order), '{}'::jsonb);
  v_env := coalesce((ctx->>'environment')::public.partner_api_environment, 'production');
  PERFORM public.logistics_event_emit_internal('return.inspected','return', v_ret.id,
    jsonb_build_object('return_id', v_ret.id, 'return_number', v_ret.return_number,
      'inspection_id', NEW.id, 'inspected_at', NEW.created_at),
    nullif(ctx->>'tenant_id','')::uuid, NULL, NULL, 'staff', NULL, v_env, v_env='sandbox',
    jsonb_build_object('table','logistics_return_inspections','id', NEW.id),
    'return:'||v_ret.id::text||':inspected:'||NEW.id::text);
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_return_inspection AFTER INSERT ON public.logistics_return_inspections
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_return_inspection();

-- ---------------- ROUTES ----------------
CREATE OR REPLACE FUNCTION public._logistics_emit_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN v_type := 'route.created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_type := CASE NEW.status
      WHEN 'dispatched' THEN 'route.dispatched'
      WHEN 'in_progress' THEN 'route.started'
      WHEN 'started' THEN 'route.started'
      WHEN 'completed' THEN 'route.completed'
      ELSE NULL END;
  END IF;
  IF v_type IS NULL THEN RETURN NEW; END IF;
  PERFORM public.logistics_event_emit_internal(v_type,'route', NEW.id,
    jsonb_build_object('route_id', NEW.id, 'route_number', NEW.route_number, 'status', NEW.status,
      'planned_start', NEW.planned_start, 'planned_end', NEW.planned_end),
    NULL, NULL, NULL, 'staff', NULL, 'production', false,
    jsonb_build_object('table','logistics_routes','id', NEW.id),
    'route:'||NEW.id::text||':'||NEW.status);
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_route AFTER INSERT OR UPDATE OF status ON public.logistics_routes
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_route();

CREATE OR REPLACE FUNCTION public._logistics_emit_route_deviation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.logistics_event_emit_internal('route.deviated','route', NEW.route_id,
    jsonb_build_object('route_id', NEW.route_id, 'deviation_id', NEW.id),
    NULL, NULL, NULL, 'system', NULL, 'production', false,
    jsonb_build_object('table','logistics_route_deviations','id', NEW.id),
    'route_deviation:'||NEW.id::text);
  RETURN NEW;
END; $$;
CREATE TRIGGER lie_route_deviation AFTER INSERT ON public.logistics_route_deviations
  FOR EACH ROW EXECUTE FUNCTION public._logistics_emit_route_deviation();

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname LIKE '\_logistics\_emit\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;