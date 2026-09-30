-- ============================================================
-- PHASE 4 — LOGISTICS INTEGRATION PLATFORM (events, webhooks, partner API)
-- ============================================================

-- 1. EVENT CATALOGUE -----------------------------------------------------
CREATE TABLE public.logistics_event_catalogue (
  event_type      text PRIMARY KEY,
  aggregate_type  text NOT NULL,
  event_version   text NOT NULL DEFAULT 'v1',
  schema_version  text NOT NULL DEFAULT '1.0.0',
  description     text NOT NULL,
  payload_keys    text[] NOT NULL DEFAULT '{}',
  ordinal         integer NOT NULL DEFAULT 0,
  publishable     boolean NOT NULL DEFAULT true,
  deprecated_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.logistics_event_catalogue TO authenticated;
GRANT ALL ON public.logistics_event_catalogue TO service_role;
ALTER TABLE public.logistics_event_catalogue ENABLE ROW LEVEL SECURITY;
CREATE POLICY lec_staff_read ON public.logistics_event_catalogue FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY lec_service ON public.logistics_event_catalogue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. INTEGRATION EVENTS (append-only) -----------------------------------
CREATE TABLE public.logistics_integration_events (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL REFERENCES public.logistics_event_catalogue(event_type),
  event_version   text NOT NULL DEFAULT 'v1',
  schema_version  text NOT NULL DEFAULT '1.0.0',
  payload_version text NOT NULL DEFAULT '1.0.0',
  aggregate_type  text NOT NULL,
  aggregate_id    uuid NOT NULL,
  sequence        bigint NOT NULL,
  tenant_id       uuid,
  partner_id      uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  environment     public.partner_api_environment NOT NULL DEFAULT 'production',
  is_synthetic    boolean NOT NULL DEFAULT false,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  correlation_id  text NOT NULL,
  causation_id    text,
  actor_type      text NOT NULL DEFAULT 'system',
  actor_id        uuid,
  source          text NOT NULL DEFAULT 'logistics',
  internal_reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, sequence),
  UNIQUE (dedupe_key)
);
CREATE INDEX lie_type_time ON public.logistics_integration_events (event_type, occurred_at DESC);
CREATE INDEX lie_tenant ON public.logistics_integration_events (tenant_id, occurred_at DESC);
GRANT SELECT ON public.logistics_integration_events TO authenticated;
GRANT ALL ON public.logistics_integration_events TO service_role;
ALTER TABLE public.logistics_integration_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY lie_staff_read ON public.logistics_integration_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY lie_service ON public.logistics_integration_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._logistics_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'logistics_integration_events is append-only';
END; $$;
CREATE TRIGGER lie_append_only BEFORE UPDATE OR DELETE ON public.logistics_integration_events
  FOR EACH ROW EXECUTE FUNCTION public._logistics_events_append_only();

-- 3. PARTNER ↔ TENANT ENTITLEMENTS --------------------------------------
CREATE TABLE public.logistics_partner_tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  tenant_label text,
  environment public.partner_api_environment NOT NULL DEFAULT 'production',
  scopes      text[] NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  granted_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, tenant_id, environment)
);
GRANT SELECT ON public.logistics_partner_tenants TO authenticated;
GRANT ALL ON public.logistics_partner_tenants TO service_role;
ALTER TABLE public.logistics_partner_tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY lpt_staff_read ON public.logistics_partner_tenants FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY lpt_service ON public.logistics_partner_tenants FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. WEBHOOK ENDPOINTS --------------------------------------------------
CREATE TABLE public.logistics_webhook_endpoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  tenant_id     uuid,
  environment   public.partner_api_environment NOT NULL DEFAULT 'sandbox',
  label         text NOT NULL,
  url           text NOT NULL,
  api_version   text NOT NULL DEFAULT 'v1',
  signature_version text NOT NULL DEFAULT 'v2',
  secret        text NOT NULL,
  secret_fingerprint text NOT NULL,
  secret_rotated_at timestamptz NOT NULL DEFAULT now(),
  subscribed_events text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'CONFIGURED'
                CHECK (status IN ('CONFIGURED','ACTIVE','DEGRADED','FAILING','SUSPENDED','REVOKED')),
  status_reason text,
  max_attempts  integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
  timeout_ms    integer NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  backoff_base_ms integer NOT NULL DEFAULT 2000 CHECK (backoff_base_ms BETWEEN 500 AND 60000),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Deliberately NO grant to authenticated: the signing secret lives here.
GRANT ALL ON public.logistics_webhook_endpoints TO service_role;
ALTER TABLE public.logistics_webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY lwe_service ON public.logistics_webhook_endpoints FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Secret-free projection for consoles.
CREATE VIEW public.v_logistics_webhook_endpoints
WITH (security_invoker = true) AS
SELECT e.id, e.partner_id, p.partner_code, p.legal_name AS partner_name, e.tenant_id, e.environment,
       e.label, e.url, e.api_version, e.signature_version, e.secret_fingerprint, e.secret_rotated_at,
       e.subscribed_events, e.status, e.status_reason, e.max_attempts, e.timeout_ms, e.backoff_base_ms,
       e.last_success_at, e.last_failure_at, e.failure_count, e.consecutive_failures, e.delivered_count,
       e.created_at, e.updated_at
FROM public.logistics_webhook_endpoints e
JOIN public.partners p ON p.id = e.partner_id;
REVOKE ALL ON public.v_logistics_webhook_endpoints FROM authenticated;

-- 5. WEBHOOK DELIVERIES ------------------------------------------------
CREATE TABLE public.logistics_webhook_deliveries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id    uuid NOT NULL REFERENCES public.logistics_webhook_endpoints(id) ON DELETE CASCADE,
  event_id       uuid NOT NULL REFERENCES public.logistics_integration_events(event_id) ON DELETE CASCADE,
  partner_id     uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  event_type     text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  sequence       bigint NOT NULL,
  environment    public.partner_api_environment NOT NULL,
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','delivered','retrying','failed','dead_letter')),
  attempt        integer NOT NULL DEFAULT 0,
  max_attempts   integer NOT NULL DEFAULT 8,
  http_status    integer,
  response_class text,
  latency_ms     integer,
  failure_reason text,
  next_retry_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at     timestamptz,
  delivered_at   timestamptz,
  replay_of      uuid REFERENCES public.logistics_webhook_deliveries(id) ON DELETE SET NULL,
  replayed_by    uuid,
  correlation_id text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, idempotency_key)
);
CREATE INDEX lwd_due ON public.logistics_webhook_deliveries (status, next_retry_at);
CREATE INDEX lwd_endpoint ON public.logistics_webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX lwd_order ON public.logistics_webhook_deliveries (endpoint_id, aggregate_type, aggregate_id, sequence);
GRANT SELECT ON public.logistics_webhook_deliveries TO authenticated;
GRANT ALL ON public.logistics_webhook_deliveries TO service_role;
ALTER TABLE public.logistics_webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY lwd_staff_read ON public.logistics_webhook_deliveries FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY lwd_service ON public.logistics_webhook_deliveries FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. API OBSERVABILITY --------------------------------------------------
CREATE TABLE public.logistics_api_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     text NOT NULL,
  correlation_id text NOT NULL,
  partner_id     uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  credential_id  uuid REFERENCES public.partner_api_credentials(id) ON DELETE SET NULL,
  tenant_id      uuid,
  environment    public.partner_api_environment,
  method         text NOT NULL,
  path           text NOT NULL,
  operation      text NOT NULL,
  scope_required text,
  outcome        text NOT NULL,
  http_status    integer NOT NULL,
  error_code     text,
  latency_ms     integer NOT NULL DEFAULT 0,
  idempotent_replay boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lar_partner_time ON public.logistics_api_requests (partner_id, created_at DESC);
GRANT SELECT ON public.logistics_api_requests TO authenticated;
GRANT ALL ON public.logistics_api_requests TO service_role;
ALTER TABLE public.logistics_api_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY lar_staff_read ON public.logistics_api_requests FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY lar_service ON public.logistics_api_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. IDEMPOTENCY -------------------------------------------------------
CREATE TABLE public.logistics_api_idempotency (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  environment     public.partner_api_environment NOT NULL,
  idempotency_key text NOT NULL,
  operation       text NOT NULL,
  request_hash    text NOT NULL,
  state           text NOT NULL DEFAULT 'in_flight' CHECK (state IN ('in_flight','completed')),
  response_status integer,
  response_body   jsonb,
  resource_type   text,
  resource_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (partner_id, environment, idempotency_key)
);
GRANT ALL ON public.logistics_api_idempotency TO service_role;
ALTER TABLE public.logistics_api_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY lai_service ON public.logistics_api_idempotency FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. RATE LIMITS -------------------------------------------------------
CREATE TABLE public.logistics_api_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind    text NOT NULL CHECK (scope_kind IN ('partner','tenant','credential','endpoint','operation','default')),
  scope_value   text NOT NULL,
  environment   public.partner_api_environment NOT NULL DEFAULT 'production',
  limit_per_minute integer NOT NULL CHECK (limit_per_minute BETWEEN 1 AND 100000),
  burst         integer NOT NULL DEFAULT 0 CHECK (burst >= 0),
  updated_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_kind, scope_value, environment)
);
GRANT SELECT ON public.logistics_api_rate_limits TO authenticated;
GRANT ALL ON public.logistics_api_rate_limits TO service_role;
ALTER TABLE public.logistics_api_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY larl_staff_read ON public.logistics_api_rate_limits FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY larl_service ON public.logistics_api_rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.logistics_api_rate_counters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind   text NOT NULL,
  scope_value  text NOT NULL,
  environment  public.partner_api_environment NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  UNIQUE (scope_kind, scope_value, environment, window_start)
);
GRANT ALL ON public.logistics_api_rate_counters TO service_role;
ALTER TABLE public.logistics_api_rate_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY larc_service ON public.logistics_api_rate_counters FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Default platform limits.
INSERT INTO public.logistics_api_rate_limits (scope_kind, scope_value, environment, limit_per_minute, burst)
VALUES ('default','*','production',600,60), ('default','*','sandbox',120,20);

-- 9. SEED THE EVENT CATALOGUE -----------------------------------------
INSERT INTO public.logistics_event_catalogue (event_type, aggregate_type, description, payload_keys, ordinal) VALUES
 ('order.created','order','A logistics order was accepted.','{order_id,order_number,module,status,total_amount,currency,created_at}',10),
 ('order.cancelled','order','A logistics order was cancelled.','{order_id,order_number,status,reason_code,cancelled_at}',20),
 ('shipment.created','shipment','A shipment was created for an order.','{shipment_id,order_id,status,package_count,created_at}',30),
 ('shipment.confirmed','shipment','Shipment confirmed and ready for collection.','{shipment_id,order_id,status,confirmed_at}',40),
 ('shipment.in_transit','shipment','Shipment is moving.','{shipment_id,order_id,status,occurred_at}',50),
 ('shipment.delivered','shipment','All packages in the shipment were delivered.','{shipment_id,order_id,status,delivered_at}',60),
 ('shipment.partially_delivered','shipment','Some packages delivered, others outstanding.','{shipment_id,order_id,status,delivered_count,outstanding_count}',70),
 ('shipment.failed','shipment','Shipment failed.','{shipment_id,order_id,status,reason_code}',80),
 ('shipment.returned','shipment','Shipment returned to origin.','{shipment_id,order_id,status,returned_at}',90),
 ('package.created','package','A package was registered.','{package_id,tracking_number,order_id,status,weight_kg}',100),
 ('package.picked_up','package','Package collected from sender.','{package_id,tracking_number,status,picked_up_at}',110),
 ('package.scanned','package','Package scanned at a hub or handover.','{package_id,tracking_number,hub_code,stage,scanned_at}',120),
 ('package.in_transit','package','Package in transit.','{package_id,tracking_number,status,occurred_at}',130),
 ('package.out_for_delivery','package','Package out for final-mile delivery.','{package_id,tracking_number,status,route_id,occurred_at}',140),
 ('package.delivered','package','Package delivered.','{package_id,tracking_number,status,delivered_at,pod_id}',150),
 ('package.delivery_failed','package','Delivery attempt failed.','{package_id,tracking_number,attempt_id,reason_code,occurred_at}',160),
 ('package.return_initiated','package','A return was started for the package.','{package_id,tracking_number,return_id,reason_code}',170),
 ('package.returned','package','Package returned.','{package_id,tracking_number,status,returned_at}',180),
 ('route.created','route','A planned route was created.','{route_id,route_code,status,stop_count}',190),
 ('route.dispatched','route','Route dispatched to a driver.','{route_id,route_code,status,dispatched_at}',200),
 ('route.started','route','Driver started the route.','{route_id,route_code,status,started_at}',210),
 ('route.completed','route','Route completed.','{route_id,route_code,status,completed_at}',220),
 ('route.deviated','route','Route deviation recorded.','{route_id,route_code,deviation_type,reason_code}',230),
 ('delivery.attempted','delivery_attempt','A delivery attempt was recorded.','{attempt_id,package_id,attempt_number,outcome,occurred_at}',240),
 ('delivery.failed','delivery_attempt','A delivery attempt failed.','{attempt_id,package_id,attempt_number,reason_code,occurred_at}',250),
 ('delivery.completed','delivery_attempt','A delivery attempt succeeded.','{attempt_id,package_id,attempt_number,occurred_at}',260),
 ('pod.created','pod','Proof of delivery captured.','{pod_id,package_id,attempt_id,policy_version,captured_at}',270),
 ('pod.verified','pod','Proof of delivery verified.','{pod_id,package_id,integrity_hash,verified_at}',280),
 ('exception.opened','exception','An operational exception was opened.','{exception_id,exception_number,kind,severity,status}',290),
 ('exception.updated','exception','An exception was updated.','{exception_id,exception_number,status,severity}',300),
 ('exception.resolved','exception','An exception was resolved.','{exception_id,exception_number,status,resolved_at}',310),
 ('return.authorized','return','A return was authorized.','{return_id,return_number,package_id,reason_code}',320),
 ('return.dispatched','return','A return movement started.','{return_id,return_number,movement_status}',330),
 ('return.received','return','A return was received at a hub.','{return_id,return_number,hub_code,received_at}',340),
 ('return.inspected','return','A return was inspected.','{return_id,return_number,condition,inspected_at}',350),
 ('return.dispositioned','return','A return disposition was set.','{return_id,return_number,disposition}',360),
 ('return.resolved','return','A return was resolved.','{return_id,return_number,resolution_state}',370),
 ('payment.completed','payment','Payment for a logistics order completed.','{order_id,amount,currency,method,reference,completed_at}',380),
 ('settlement.completed','settlement','Settlement for a logistics order completed.','{order_id,settlement_reference,amount,currency,completed_at}',390);
