-- =====================================================================
-- STAGE 4 — DEDICATED REPEAT ROUTES
-- Consumes the Stage 3 dispatch/matching/reservation engine. No second
-- booking engine, no second matching engine, no second dispatch engine.
-- =====================================================================

-- Stage 3 dispatch requests gain a route-instance kind so ONE engine serves
-- ad-hoc movements and dedicated route departures.
ALTER TABLE public.logistics_dispatch_requests
  ADD COLUMN request_kind text NOT NULL DEFAULT 'AD_HOC',
  ADD COLUMN route_instance_id uuid,
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE public.logistics_dispatch_requests
  ADD CONSTRAINT dr_kind CHECK (request_kind = ANY (ARRAY['AD_HOC','ROUTE_INSTANCE'])),
  ADD CONSTRAINT dr_kind_shape CHECK (
    (request_kind = 'AD_HOC' AND order_id IS NOT NULL)
    OR (request_kind = 'ROUTE_INSTANCE' AND route_instance_id IS NOT NULL));

-- ---------------------------------------------------------- route master
CREATE TABLE public.freight_repeat_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_code text NOT NULL UNIQUE,
  route_name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  service_type text NOT NULL DEFAULT 'DEDICATED_FREIGHT',
  dedicated_customer_id uuid,
  origin_label text NOT NULL,
  origin_lat numeric(9,6),
  origin_lng numeric(9,6),
  origin_hub_id uuid REFERENCES public.logistics_hubs(id),
  destination_label text NOT NULL,
  destination_lat numeric(9,6),
  destination_lng numeric(9,6),
  destination_hub_id uuid REFERENCES public.logistics_hubs(id),
  distance_km numeric(10,2),
  vehicle_class text NOT NULL,
  committed_capacity_kg numeric(12,2) NOT NULL,
  committed_volume_cbm numeric(12,3) NOT NULL DEFAULT 0,
  weekday_mask integer[] NOT NULL,
  departure_time time NOT NULL,
  arrival_target_time time,
  booking_cutoff_minutes integer NOT NULL DEFAULT 60,
  effective_from date NOT NULL,
  effective_until date,
  generation_horizon_days integer NOT NULL DEFAULT 30,
  allow_overbooking boolean NOT NULL DEFAULT false,
  overbooking_tolerance_pct numeric(5,2) NOT NULL DEFAULT 0,
  vehicle_assignment_mode text NOT NULL DEFAULT 'DYNAMIC',
  driver_assignment_mode text NOT NULL DEFAULT 'DYNAMIC',
  dedicated_vehicle_id uuid REFERENCES public.vehicles(id),
  dedicated_driver_id uuid REFERENCES public.drivers(id),
  rate_plan_code text,
  currency text NOT NULL DEFAULT 'KES',
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rr_status CHECK (status = ANY (ARRAY['DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED','COMPLETED','RETIRED'])),
  CONSTRAINT rr_class CHECK (vehicle_class = ANY (ARRAY['TRUCK_3T','TRUCK_7T','TRUCK_14T','TRUCK_28T'])),
  CONSTRAINT rr_capacity CHECK (committed_capacity_kg > 0),
  CONSTRAINT rr_volume CHECK (committed_volume_cbm >= 0),
  CONSTRAINT rr_cutoff CHECK (booking_cutoff_minutes >= 0 AND booking_cutoff_minutes <= 1440),
  CONSTRAINT rr_horizon CHECK (generation_horizon_days BETWEEN 1 AND 120),
  CONSTRAINT rr_weekdays CHECK (cardinality(weekday_mask) > 0),
  CONSTRAINT rr_overbook CHECK (overbooking_tolerance_pct >= 0 AND overbooking_tolerance_pct <= 25
                                AND (allow_overbooking OR overbooking_tolerance_pct = 0)),
  CONSTRAINT rr_assign_mode CHECK (vehicle_assignment_mode = ANY (ARRAY['DYNAMIC','DEDICATED'])
                                   AND driver_assignment_mode = ANY (ARRAY['DYNAMIC','DEDICATED'])),
  CONSTRAINT rr_dates CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
CREATE INDEX idx_rr_status ON public.freight_repeat_routes (status, effective_from);

GRANT SELECT ON public.freight_repeat_routes TO authenticated;
GRANT ALL ON public.freight_repeat_routes TO service_role;
ALTER TABLE public.freight_repeat_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY rr_staff_read ON public.freight_repeat_routes
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));
-- Customers may see the commercial shape of routes open to them, never fleet internals
-- (fleet fields are surfaced only through the staff-scoped board view).
CREATE POLICY rr_customer_read ON public.freight_repeat_routes
  FOR SELECT TO authenticated USING (
    status = 'ACTIVE' AND (dedicated_customer_id IS NULL OR dedicated_customer_id = auth.uid()));

-- ------------------------------------------------------- route instances
CREATE TABLE public.freight_route_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_code text NOT NULL UNIQUE,
  route_id uuid NOT NULL REFERENCES public.freight_repeat_routes(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  scheduled_departure timestamptz NOT NULL,
  scheduled_arrival timestamptz,
  booking_cutoff_at timestamptz NOT NULL,
  vehicle_class text NOT NULL,
  planned_capacity_kg numeric(12,2) NOT NULL,
  planned_volume_cbm numeric(12,3) NOT NULL DEFAULT 0,
  reserved_capacity_kg numeric(12,2) NOT NULL DEFAULT 0,
  reserved_volume_cbm numeric(12,3) NOT NULL DEFAULT 0,
  available_capacity_kg numeric(12,2) GENERATED ALWAYS AS (planned_capacity_kg - reserved_capacity_kg) STORED,
  available_volume_cbm numeric(12,3) GENERATED ALWAYS AS (planned_volume_cbm - reserved_volume_cbm) STORED,
  allocation_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PLANNED',
  dispatch_request_id uuid REFERENCES public.logistics_dispatch_requests(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id),
  driver_id uuid REFERENCES public.drivers(id),
  manifest_version integer NOT NULL DEFAULT 0,
  manifest_locked_at timestamptz,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  completed_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ri_unique_departure UNIQUE (route_id, service_date),
  CONSTRAINT ri_status CHECK (status = ANY (ARRAY[
    'PLANNED','OPEN_FOR_BOOKING','CAPACITY_RESERVED','MANIFEST_CLOSING','MANIFEST_LOCKED',
    'DISPATCHED','DEPARTED','IN_TRANSIT','ARRIVED','COMPLETED','SUSPENDED','CANCELLED','DELAYED'])),
  CONSTRAINT ri_reserved_nonneg CHECK (reserved_capacity_kg >= 0 AND reserved_volume_cbm >= 0),
  CONSTRAINT ri_capacity CHECK (planned_capacity_kg > 0)
);
CREATE INDEX idx_ri_route_date ON public.freight_route_instances (route_id, service_date DESC);
CREATE INDEX idx_ri_open ON public.freight_route_instances (status, scheduled_departure);

GRANT SELECT ON public.freight_route_instances TO authenticated;
GRANT ALL ON public.freight_route_instances TO service_role;
ALTER TABLE public.freight_route_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY ri_staff_read ON public.freight_route_instances
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY ri_customer_read ON public.freight_route_instances
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.freight_repeat_routes r
             WHERE r.id = route_id AND r.status = 'ACTIVE'
               AND (r.dedicated_customer_id IS NULL OR r.dedicated_customer_id = auth.uid())));

-- ---------------------------------------------------- customer allocations
CREATE TABLE public.freight_route_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_code text NOT NULL UNIQUE,
  route_instance_id uuid NOT NULL REFERENCES public.freight_route_instances(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  consignment_id uuid REFERENCES public.freight_consignments(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.freight_quotations(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL,
  commitment_id uuid,
  allocated_weight_kg numeric(12,2) NOT NULL,
  allocated_volume_cbm numeric(12,3) NOT NULL DEFAULT 0,
  pieces integer,
  status text NOT NULL DEFAULT 'RESERVED',
  release_reason text,
  released_at timestamptz,
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ra_status CHECK (status = ANY (ARRAY['RESERVED','MANIFESTED','LOADED','DELIVERED','RELEASED','CANCELLED'])),
  CONSTRAINT ra_weight CHECK (allocated_weight_kg > 0),
  CONSTRAINT ra_volume CHECK (allocated_volume_cbm >= 0)
);
-- One live allocation per consignment per departure.
CREATE UNIQUE INDEX idx_ra_one_live
  ON public.freight_route_allocations (route_instance_id, order_id)
  WHERE status NOT IN ('RELEASED','CANCELLED');
CREATE INDEX idx_ra_customer ON public.freight_route_allocations (customer_id, created_at DESC);

GRANT SELECT ON public.freight_route_allocations TO authenticated;
GRANT ALL ON public.freight_route_allocations TO service_role;
ALTER TABLE public.freight_route_allocations ENABLE ROW LEVEL SECURITY;
-- A customer sees ONLY their own cargo on a shared truck.
CREATE POLICY ra_customer_read ON public.freight_route_allocations
  FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY ra_staff_read ON public.freight_route_allocations
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

-- A customer may also see any departure that carries their own allocation.
CREATE POLICY ri_customer_allocation_read ON public.freight_route_instances
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.freight_route_allocations a
             WHERE a.route_instance_id = freight_route_instances.id
               AND a.customer_id = auth.uid()));

-- ------------------------------------------- recurring customer commitments
CREATE TABLE public.freight_route_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_code text NOT NULL UNIQUE,
  route_id uuid NOT NULL REFERENCES public.freight_repeat_routes(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  weekday_mask integer[] NOT NULL,
  daily_weight_kg numeric(12,2) NOT NULL,
  daily_volume_cbm numeric(12,3) NOT NULL DEFAULT 0,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  template_order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rc_status CHECK (status = ANY (ARRAY['ACTIVE','SUSPENDED','COMPLETED','CANCELLED'])),
  CONSTRAINT rc_weight CHECK (daily_weight_kg > 0),
  CONSTRAINT rc_dates CHECK (ends_on >= starts_on),
  CONSTRAINT rc_weekdays CHECK (cardinality(weekday_mask) > 0)
);
CREATE INDEX idx_rc_route ON public.freight_route_commitments (route_id, status);

GRANT SELECT ON public.freight_route_commitments TO authenticated;
GRANT ALL ON public.freight_route_commitments TO service_role;
ALTER TABLE public.freight_route_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY rc_customer_read ON public.freight_route_commitments
  FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY rc_staff_read ON public.freight_route_commitments
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

-- ------------------------------------------------- versioned load manifest
CREATE TABLE public.freight_route_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_instance_id uuid NOT NULL REFERENCES public.freight_route_instances(id) ON DELETE CASCADE,
  version integer NOT NULL,
  reason text,
  vehicle_id uuid,
  driver_id uuid,
  capacity_kg numeric(12,2) NOT NULL,
  booked_kg numeric(12,2) NOT NULL,
  available_kg numeric(12,2) NOT NULL,
  line_count integer NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frm_version UNIQUE (route_instance_id, version)
);
GRANT SELECT ON public.freight_route_manifests TO authenticated;
GRANT ALL ON public.freight_route_manifests TO service_role;
ALTER TABLE public.freight_route_manifests ENABLE ROW LEVEL SECURITY;
CREATE POLICY frm_staff_read ON public.freight_route_manifests
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._freight_route_manifest_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'freight_route_manifests versions are immutable; create a new version';
END $$;
CREATE TRIGGER trg_frm_immutable BEFORE UPDATE OR DELETE ON public.freight_route_manifests
  FOR EACH ROW EXECUTE FUNCTION public._freight_route_manifest_immutable();
REVOKE ALL ON FUNCTION public._freight_route_manifest_immutable() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------- append-only route events
CREATE TABLE public.freight_route_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid REFERENCES public.freight_repeat_routes(id) ON DELETE CASCADE,
  route_instance_id uuid REFERENCES public.freight_route_instances(id) ON DELETE CASCADE,
  allocation_id uuid REFERENCES public.freight_route_allocations(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  actor_id uuid,
  actor_role text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fre_route ON public.freight_route_events (route_id, occurred_at DESC);
CREATE INDEX idx_fre_instance ON public.freight_route_events (route_instance_id, occurred_at DESC);
GRANT SELECT ON public.freight_route_events TO authenticated;
GRANT ALL ON public.freight_route_events TO service_role;
ALTER TABLE public.freight_route_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY fre_staff_read ON public.freight_route_events
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._freight_route_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'freight_route_events is append-only';
END $$;
CREATE TRIGGER trg_fre_append_only BEFORE UPDATE OR DELETE ON public.freight_route_events
  FOR EACH ROW EXECUTE FUNCTION public._freight_route_events_append_only();
REVOKE ALL ON FUNCTION public._freight_route_events_append_only() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------ route exceptions
CREATE TABLE public.freight_route_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_instance_id uuid REFERENCES public.freight_route_instances(id) ON DELETE CASCADE,
  route_id uuid REFERENCES public.freight_repeat_routes(id) ON DELETE CASCADE,
  commitment_id uuid REFERENCES public.freight_route_commitments(id) ON DELETE CASCADE,
  exception_type text NOT NULL,
  severity text NOT NULL DEFAULT 'MEDIUM',
  status text NOT NULL DEFAULT 'OPEN',
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fex_type CHECK (exception_type = ANY (ARRAY[
    'DEPARTURE_MISSED','CAPACITY_SHORTFALL','VEHICLE_UNAVAILABLE','DRIVER_UNAVAILABLE',
    'NO_CAPACITY_MATCHED','UNDERUTILISED','ROUTE_SUSPENDED','COMMITMENT_UNFULFILLED'])),
  CONSTRAINT fex_sev CHECK (severity = ANY (ARRAY['LOW','MEDIUM','HIGH','CRITICAL'])),
  CONSTRAINT fex_status CHECK (status = ANY (ARRAY['OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED']))
);
CREATE INDEX idx_fex_open ON public.freight_route_exceptions (status, severity, created_at DESC);
GRANT SELECT ON public.freight_route_exceptions TO authenticated;
GRANT ALL ON public.freight_route_exceptions TO service_role;
ALTER TABLE public.freight_route_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY fex_staff_read ON public.freight_route_exceptions
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

CREATE TRIGGER trg_rr_touch BEFORE UPDATE ON public.freight_repeat_routes
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_touch();
CREATE TRIGGER trg_ri_touch BEFORE UPDATE ON public.freight_route_instances
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_touch();
CREATE TRIGGER trg_ra_touch BEFORE UPDATE ON public.freight_route_allocations
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_touch();
CREATE TRIGGER trg_rc_touch BEFORE UPDATE ON public.freight_route_commitments
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_touch();

-- =====================================================================
-- ROUTE LIFECYCLE (staff)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_repeat_route_lifecycle(
  _route_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_route public.freight_repeat_routes; v_to text;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_route FROM public.freight_repeat_routes WHERE id = _route_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;

  v_to := CASE
    WHEN _action = 'SUBMIT'   AND v_route.status = 'DRAFT' THEN 'PENDING_APPROVAL'
    WHEN _action = 'APPROVE'  AND v_route.status = 'PENDING_APPROVAL' THEN 'APPROVED'
    WHEN _action = 'ACTIVATE' AND v_route.status IN ('APPROVED','SUSPENDED') THEN 'ACTIVE'
    WHEN _action = 'SUSPEND'  AND v_route.status = 'ACTIVE' THEN 'SUSPENDED'
    WHEN _action = 'RETIRE'   AND v_route.status IN ('ACTIVE','SUSPENDED','APPROVED') THEN 'RETIRED'
    WHEN _action = 'COMPLETE' AND v_route.status IN ('ACTIVE','SUSPENDED') THEN 'COMPLETED'
    ELSE NULL END;

  IF v_to IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_TRANSITION',
      'from', v_route.status, 'action', _action);
  END IF;
  IF v_to IN ('SUSPENDED','RETIRED','COMPLETED') AND COALESCE(length(trim(_reason)), 0) < 5 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'reason');
  END IF;

  UPDATE public.freight_repeat_routes SET
    status = v_to,
    approved_by = CASE WHEN v_to = 'APPROVED' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN v_to = 'APPROVED' THEN now() ELSE approved_at END
  WHERE id = _route_id;

  -- Suspension closes future departures for booking; live movements continue.
  IF v_to IN ('SUSPENDED','RETIRED','COMPLETED') THEN
    UPDATE public.freight_route_instances
       SET status = 'SUSPENDED', cancellation_reason = _reason
     WHERE route_id = _route_id
       AND status IN ('PLANNED','OPEN_FOR_BOOKING')
       AND allocation_count = 0
       AND scheduled_departure > now();
  END IF;

  INSERT INTO public.freight_route_events (route_id, event_type, previous_status, new_status, actor_id, actor_role, reason)
  VALUES (_route_id, 'ROUTE_' || _action, v_route.status, v_to, auth.uid(), 'staff', _reason);

  RETURN jsonb_build_object('error', false, 'code', v_to, 'route_code', v_route.route_code);
END $$;
REVOKE ALL ON FUNCTION public.freight_repeat_route_lifecycle(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_repeat_route_lifecycle(uuid, text, text) TO authenticated, service_role;

-- =====================================================================
-- ROLLING, IDEMPOTENT INSTANCE GENERATION
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_generate_instances(
  _route_id uuid DEFAULT NULL, _horizon_days integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_route public.freight_repeat_routes;
  v_day date;
  v_horizon integer;
  v_created integer := 0;
  v_skipped integer := 0;
  v_routes integer := 0;
  v_dep timestamptz;
  v_code text;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage')
     AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  FOR v_route IN
    SELECT * FROM public.freight_repeat_routes
     WHERE status = 'ACTIVE'
       AND (_route_id IS NULL OR id = _route_id)
     ORDER BY route_code
     FOR UPDATE
  LOOP
    v_routes := v_routes + 1;
    v_horizon := LEAST(COALESCE(_horizon_days, v_route.generation_horizon_days), 120);
    v_day := GREATEST(current_date, v_route.effective_from);
    WHILE v_day <= current_date + v_horizon LOOP
      IF (v_route.effective_until IS NULL OR v_day <= v_route.effective_until)
         AND EXTRACT(isodow FROM v_day)::int = ANY (v_route.weekday_mask) THEN
        v_dep := (v_day::text || ' ' || v_route.departure_time::text)::timestamptz;
        v_code := 'RTR-' || v_route.route_code || '-' || to_char(v_day, 'YYYYMMDD')
                  || '-' || to_char(v_route.departure_time, 'HH24MI');
        BEGIN
          INSERT INTO public.freight_route_instances (
            instance_code, route_id, service_date, scheduled_departure, scheduled_arrival,
            booking_cutoff_at, vehicle_class, planned_capacity_kg, planned_volume_cbm,
            status, vehicle_id, driver_id)
          VALUES (
            v_code, v_route.id, v_day, v_dep,
            CASE WHEN v_route.arrival_target_time IS NULL THEN NULL
                 ELSE (v_day::text || ' ' || v_route.arrival_target_time::text)::timestamptz
                      + CASE WHEN v_route.arrival_target_time < v_route.departure_time
                             THEN interval '1 day' ELSE interval '0' END END,
            v_dep - make_interval(mins => v_route.booking_cutoff_minutes),
            v_route.vehicle_class, v_route.committed_capacity_kg, v_route.committed_volume_cbm,
            'OPEN_FOR_BOOKING',
            CASE WHEN v_route.vehicle_assignment_mode = 'DEDICATED' THEN v_route.dedicated_vehicle_id END,
            CASE WHEN v_route.driver_assignment_mode = 'DEDICATED' THEN v_route.dedicated_driver_id END);
          v_created := v_created + 1;
          INSERT INTO public.freight_route_events (route_id, route_instance_id, event_type, new_status, actor_id, actor_role)
          SELECT v_route.id, i.id, 'INSTANCE_GENERATED', 'OPEN_FOR_BOOKING', auth.uid(), 'system'
            FROM public.freight_route_instances i
           WHERE i.instance_code = v_code;
        EXCEPTION WHEN unique_violation THEN
          -- Idempotency: the departure already exists; never duplicated.
          v_skipped := v_skipped + 1;
        END;
      END IF;
      v_day := v_day + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('error', false, 'code', 'GENERATED',
    'routes_processed', v_routes, 'instances_created', v_created, 'instances_existing', v_skipped);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_generate_instances(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_generate_instances(uuid, integer) TO authenticated, service_role;

-- =====================================================================
-- CAPACITY ALLOCATION — the single capacity engine for route departures
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_book_space(
  _instance_id uuid,
  _order_id uuid,
  _idempotency_key text DEFAULT NULL,
  _commitment_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  v_route public.freight_repeat_routes;
  v_order public.delivery_orders;
  v_cons public.freight_consignments;
  v_quote public.freight_quotations;
  v_alloc public.freight_route_allocations;
  v_existing uuid;
  v_weight numeric; v_volume numeric;
  v_limit_kg numeric; v_limit_cbm numeric;
  v_is_staff boolean;
  v_dispatch jsonb;
  v_code text;
BEGIN
  v_is_staff := public.has_staff_permission('staff.logistics.manage');

  IF NULLIF(_idempotency_key, '') IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.freight_route_allocations WHERE idempotency_key = _idempotency_key;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_alloc FROM public.freight_route_allocations WHERE id = v_existing;
      RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'replay', true,
        'allocation_id', v_alloc.id, 'allocation_code', v_alloc.allocation_code,
        'status', v_alloc.status, 'allocated_weight_kg', v_alloc.allocated_weight_kg);
    END IF;
  END IF;

  -- Lock the departure: this is what makes concurrent bookings safe.
  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  SELECT * INTO v_route FROM public.freight_repeat_routes WHERE id = v_inst.route_id;

  IF v_route.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('error', true, 'code', 'ROUTE_NOT_ACTIVE', 'route_status', v_route.status);
  END IF;
  IF v_route.dedicated_customer_id IS NOT NULL
     AND NOT v_is_staff AND v_route.dedicated_customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'ROUTE_DEDICATED_TO_ANOTHER_CUSTOMER');
  END IF;
  IF v_inst.status NOT IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'BOOKING_CLOSED', 'instance_status', v_inst.status);
  END IF;
  IF now() >= v_inst.booking_cutoff_at THEN
    RETURN jsonb_build_object('error', true, 'code', 'BOOKING_CUTOFF_PASSED',
      'cutoff_at', v_inst.booking_cutoff_at);
  END IF;

  SELECT * INTO v_order FROM public.delivery_orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'ORDER_NOT_FOUND'); END IF;
  IF NOT v_is_staff AND v_order.customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_cons FROM public.freight_consignments WHERE order_id = _order_id ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NO_CONSIGNMENT'); END IF;

  -- Pricing stays with the authoritative quotation. No route-side pricing.
  SELECT * INTO v_quote FROM public.freight_quotations WHERE order_id = _order_id
   ORDER BY accepted_at DESC NULLS LAST LIMIT 1;
  IF v_quote.id IS NULL OR v_quote.status NOT IN ('ACCEPTED','CONVERTED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'QUOTE_NOT_ACCEPTED');
  END IF;

  IF v_quote.vehicle_class IS DISTINCT FROM v_inst.vehicle_class THEN
    RETURN jsonb_build_object('error', true, 'code', 'VEHICLE_CLASS_MISMATCH',
      'quoted_class', v_quote.vehicle_class, 'route_class', v_inst.vehicle_class);
  END IF;

  v_weight := GREATEST(COALESCE(v_cons.chargeable_weight_kg, v_cons.gross_weight_kg), 1);
  v_volume := COALESCE(v_cons.volume_cbm, 0);

  v_limit_kg := v_inst.planned_capacity_kg
                * (1 + CASE WHEN v_route.allow_overbooking THEN v_route.overbooking_tolerance_pct / 100 ELSE 0 END);
  v_limit_cbm := CASE WHEN v_inst.planned_volume_cbm > 0
                 THEN v_inst.planned_volume_cbm
                      * (1 + CASE WHEN v_route.allow_overbooking THEN v_route.overbooking_tolerance_pct / 100 ELSE 0 END)
                 ELSE NULL END;

  IF v_inst.reserved_capacity_kg + v_weight > v_limit_kg THEN
    INSERT INTO public.freight_route_exceptions (
      route_instance_id, route_id, commitment_id, exception_type, severity, detail, metadata, raised_by)
    VALUES (_instance_id, v_route.id, _commitment_id, 'CAPACITY_SHORTFALL', 'MEDIUM',
      format('Requested %s kg against %s kg available on %s.',
             v_weight, v_inst.available_capacity_kg, v_inst.instance_code),
      jsonb_build_object('order_id', _order_id, 'requested_kg', v_weight,
                         'available_kg', v_inst.available_capacity_kg), auth.uid());
    RETURN jsonb_build_object('error', true, 'code', 'INSUFFICIENT_AVAILABLE_CAPACITY',
      'requested_kg', v_weight, 'available_kg', v_inst.available_capacity_kg,
      'instance_code', v_inst.instance_code);
  END IF;
  IF v_limit_cbm IS NOT NULL AND v_volume > 0
     AND v_inst.reserved_volume_cbm + v_volume > v_limit_cbm THEN
    RETURN jsonb_build_object('error', true, 'code', 'INSUFFICIENT_AVAILABLE_VOLUME',
      'requested_cbm', v_volume, 'available_cbm', v_inst.available_volume_cbm);
  END IF;

  v_code := 'ALC-' || to_char(now(), 'YYYYMM') || '-' ||
            upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  BEGIN
    INSERT INTO public.freight_route_allocations (
      allocation_code, route_instance_id, order_id, consignment_id, quote_id, customer_id,
      commitment_id, allocated_weight_kg, allocated_volume_cbm, pieces, idempotency_key, created_by)
    VALUES (v_code, _instance_id, _order_id, v_cons.id, v_quote.id, v_order.customer_id,
            _commitment_id, v_weight, v_volume, v_cons.pieces, NULLIF(_idempotency_key,''), auth.uid())
    RETURNING * INTO v_alloc;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_alloc FROM public.freight_route_allocations
     WHERE route_instance_id = _instance_id AND order_id = _order_id
       AND status NOT IN ('RELEASED','CANCELLED') LIMIT 1;
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_ALLOCATED',
      'allocation_id', v_alloc.id, 'allocation_code', v_alloc.allocation_code);
  END;

  UPDATE public.freight_route_instances SET
    reserved_capacity_kg = reserved_capacity_kg + v_weight,
    reserved_volume_cbm = reserved_volume_cbm + v_volume,
    allocation_count = allocation_count + 1,
    status = 'CAPACITY_RESERVED'
  WHERE id = _instance_id;

  -- The customer's own leg is bound to this departure (multi-leg stays intact).
  UPDATE public.logistics_order_legs
     SET status = CASE WHEN status = 'PLANNED' THEN 'AWAITING_CAPACITY' ELSE status END
   WHERE order_id = _order_id AND status = 'PLANNED';

  INSERT INTO public.freight_route_events (
    route_id, route_instance_id, allocation_id, event_type, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_route.id, _instance_id, v_alloc.id, 'CAPACITY_ALLOCATED', 'CAPACITY_RESERVED', auth.uid(),
          CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END, 'Customer booked route space',
          jsonb_build_object('order_id', _order_id, 'weight_kg', v_weight, 'volume_cbm', v_volume,
                             'quote_number', v_quote.quote_number));

  -- One dispatch engine: the departure asks the Stage 3 engine for a truck.
  v_dispatch := public.freight_route_instance_dispatch(_instance_id);

  RETURN jsonb_build_object('error', false, 'code', 'SPACE_BOOKED',
    'allocation_id', v_alloc.id, 'allocation_code', v_alloc.allocation_code,
    'instance_code', v_inst.instance_code,
    'allocated_weight_kg', v_weight, 'allocated_volume_cbm', v_volume,
    'quote_number', v_quote.quote_number, 'quoted_amount', v_quote.total_amount,
    'dispatch', v_dispatch);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_book_space(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_book_space(uuid, uuid, text, uuid) TO authenticated, service_role;

-- =====================================================================
-- ROUTE INSTANCE → STAGE 3 DISPATCH (no second dispatch engine)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_instance_dispatch(_instance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  v_route public.freight_repeat_routes;
  v_req public.logistics_dispatch_requests;
  v_num text;
  v_match jsonb;
BEGIN
  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  SELECT * INTO v_route FROM public.freight_repeat_routes WHERE id = v_inst.route_id;

  -- Already dispatched: report, never duplicate.
  IF v_inst.dispatch_request_id IS NOT NULL THEN
    SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_inst.dispatch_request_id;
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_DISPATCHED',
      'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
      'status', v_req.status, 'matching_status', v_req.matching_status,
      'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id);
  END IF;

  v_num := 'DSP-' || to_char(now(), 'YYYYMM') || '-' ||
           upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.logistics_dispatch_requests (
    request_number, request_kind, route_instance_id, order_id, customer_id,
    origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
    pickup_window_start, pickup_window_end, vehicle_class,
    required_payload_kg, required_volume_cbm, priority, created_by)
  VALUES (
    v_num, 'ROUTE_INSTANCE', _instance_id, NULL,
    COALESCE(v_route.dedicated_customer_id, auth.uid()),
    v_route.origin_label, v_route.origin_lat, v_route.origin_lng,
    v_route.destination_label, v_route.destination_lat, v_route.destination_lng,
    v_inst.scheduled_departure, v_inst.scheduled_arrival,
    v_inst.vehicle_class,
    GREATEST(v_inst.reserved_capacity_kg, 1), v_inst.reserved_volume_cbm, 4, auth.uid())
  RETURNING * INTO v_req;

  UPDATE public.freight_route_instances SET dispatch_request_id = v_req.id WHERE id = _instance_id;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_req.id, 'DISPATCH_REQUESTED', 'REQUESTED', auth.uid(), 'system',
          'Dedicated route departure', jsonb_build_object('route_instance_id', _instance_id,
          'instance_code', v_inst.instance_code, 'route_code', v_route.route_code));

  -- Dedicated fleet still passes Stage 3 eligibility: an override is recorded
  -- explicitly; otherwise the shared matching engine decides.
  IF v_route.vehicle_assignment_mode = 'DEDICATED' AND v_route.dedicated_vehicle_id IS NOT NULL THEN
    v_match := public.logistics_dispatch_override(
      v_req.id, v_route.dedicated_vehicle_id, v_route.dedicated_driver_id,
      format('Dedicated route %s committed vehicle assignment', v_route.route_code));
  ELSE
    v_match := public.logistics_dispatch_match(v_req.id, true);
  END IF;

  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_req.id;

  UPDATE public.freight_route_instances SET
    vehicle_id = v_req.assigned_vehicle_id,
    driver_id = v_req.assigned_driver_id,
    status = CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'DISPATCHED' ELSE status END
  WHERE id = _instance_id;

  IF v_req.assigned_vehicle_id IS NULL THEN
    INSERT INTO public.freight_route_exceptions (
      route_instance_id, route_id, exception_type, severity, detail, raised_by)
    VALUES (_instance_id, v_route.id, 'NO_CAPACITY_MATCHED', 'HIGH',
      format('No compliant %s capacity matched for departure %s.',
             v_inst.vehicle_class, v_inst.instance_code), auth.uid());
  END IF;

  RETURN jsonb_build_object('error', false, 'code',
    CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'DISPATCHED' ELSE 'AWAITING_CAPACITY' END,
    'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
    'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id,
    'match', v_match);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_instance_dispatch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_instance_dispatch(uuid) TO authenticated, service_role;

-- =====================================================================
-- MANIFEST CLOSE / RE-VERSION
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_manifest_close(
  _instance_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  v_lines jsonb;
  v_count integer;
  v_version integer;
  v_prev jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage')
     AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  IF v_inst.status IN ('CANCELLED','COMPLETED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_STATE', 'status', v_inst.status);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'allocation_code', a.allocation_code,
           'consignment_number', c.consignment_number,
           'order_number', o.order_number,
           'customer_id', a.customer_id,
           'weight_kg', a.allocated_weight_kg,
           'volume_cbm', a.allocated_volume_cbm,
           'pieces', a.pieces,
           'status', a.status) ORDER BY a.created_at), '[]'::jsonb), count(*)
    INTO v_lines, v_count
    FROM public.freight_route_allocations a
    JOIN public.delivery_orders o ON o.id = a.order_id
    LEFT JOIN public.freight_consignments c ON c.id = a.consignment_id
   WHERE a.route_instance_id = _instance_id AND a.status NOT IN ('RELEASED','CANCELLED');

  v_version := v_inst.manifest_version + 1;
  SELECT lines INTO v_prev FROM public.freight_route_manifests
   WHERE route_instance_id = _instance_id ORDER BY version DESC LIMIT 1;

  INSERT INTO public.freight_route_manifests (
    route_instance_id, version, reason, vehicle_id, driver_id,
    capacity_kg, booked_kg, available_kg, line_count, lines, changes, actor_id)
  VALUES (_instance_id, v_version,
          COALESCE(NULLIF(trim(_reason), ''),
                   CASE WHEN v_version = 1 THEN 'Booking cut-off reached; manifest locked'
                        ELSE 'Operational change after manifest lock' END),
          v_inst.vehicle_id, v_inst.driver_id,
          v_inst.planned_capacity_kg, v_inst.reserved_capacity_kg, v_inst.available_capacity_kg,
          v_count, v_lines,
          jsonb_build_object('previous_version', v_inst.manifest_version,
                             'previous_lines', COALESCE(v_prev, '[]'::jsonb)),
          auth.uid());

  UPDATE public.freight_route_instances SET
    manifest_version = v_version,
    manifest_locked_at = now(),
    status = CASE WHEN status IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED','MANIFEST_CLOSING')
                  THEN 'MANIFEST_LOCKED' ELSE status END
  WHERE id = _instance_id;

  UPDATE public.freight_route_allocations SET status = 'MANIFESTED'
   WHERE route_instance_id = _instance_id AND status = 'RESERVED';

  INSERT INTO public.freight_route_events (
    route_id, route_instance_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_inst.route_id, _instance_id, 'MANIFEST_LOCKED', v_inst.status, 'MANIFEST_LOCKED',
          auth.uid(), 'staff', _reason,
          jsonb_build_object('version', v_version, 'lines', v_count,
                             'booked_kg', v_inst.reserved_capacity_kg));

  RETURN jsonb_build_object('error', false, 'code', 'MANIFEST_LOCKED',
    'version', v_version, 'line_count', v_count,
    'booked_kg', v_inst.reserved_capacity_kg, 'available_kg', v_inst.available_capacity_kg);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_manifest_close(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_manifest_close(uuid, text) TO authenticated, service_role;

-- =====================================================================
-- VEHICLE SUBSTITUTION — the route continues; shipments are not cancelled
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_substitute_capacity(
  _instance_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst public.freight_route_instances; v_release jsonb; v_req public.logistics_dispatch_requests;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF COALESCE(length(trim(_reason)), 0) < 5 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'reason');
  END IF;

  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  IF v_inst.dispatch_request_id IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_DISPATCH_TO_SUBSTITUTE');
  END IF;

  -- Reuse the Stage 3 release + re-match path exactly.
  v_release := public.logistics_capacity_release(v_inst.dispatch_request_id, _reason, 'MAINTENANCE');
  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_inst.dispatch_request_id;

  UPDATE public.freight_route_instances SET
    vehicle_id = v_req.assigned_vehicle_id,
    driver_id = v_req.assigned_driver_id,
    status = CASE WHEN v_req.assigned_vehicle_id IS NULL THEN 'DELAYED' ELSE 'DISPATCHED' END
  WHERE id = _instance_id;

  IF v_req.assigned_vehicle_id IS NULL THEN
    INSERT INTO public.freight_route_exceptions (
      route_instance_id, route_id, exception_type, severity, detail, raised_by)
    VALUES (_instance_id, v_inst.route_id, 'VEHICLE_UNAVAILABLE', 'CRITICAL',
      format('Substitute capacity not found for %s: %s', v_inst.instance_code, _reason), auth.uid());
  END IF;

  INSERT INTO public.freight_route_events (
    route_id, route_instance_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_inst.route_id, _instance_id, 'CAPACITY_SUBSTITUTED', v_inst.status,
          CASE WHEN v_req.assigned_vehicle_id IS NULL THEN 'DELAYED' ELSE 'DISPATCHED' END,
          auth.uid(), 'staff', _reason,
          jsonb_build_object('previous_vehicle_id', v_inst.vehicle_id,
                             'new_vehicle_id', v_req.assigned_vehicle_id));

  RETURN jsonb_build_object('error', false,
    'code', CASE WHEN v_req.assigned_vehicle_id IS NULL THEN 'NO_SUBSTITUTE_CAPACITY' ELSE 'SUBSTITUTED' END,
    'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id,
    'release', v_release);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_substitute_capacity(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_substitute_capacity(uuid, text) TO authenticated, service_role;

-- =====================================================================
-- MISSED DEPARTURE SWEEP — records an exception, never rewrites the time
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_sweep_departures(_grace_minutes integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_missed integer := 0; v_row record;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage')
     AND auth.role() <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  FOR v_row IN
    SELECT i.* FROM public.freight_route_instances i
     WHERE i.status IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED','MANIFEST_LOCKED','DISPATCHED')
       AND i.actual_departure IS NULL
       AND i.scheduled_departure < now() - make_interval(mins => GREATEST(_grace_minutes, 0))
       AND i.allocation_count > 0
     FOR UPDATE
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.freight_route_exceptions
                    WHERE route_instance_id = v_row.id AND exception_type = 'DEPARTURE_MISSED'
                      AND status IN ('OPEN','ACKNOWLEDGED')) THEN
      INSERT INTO public.freight_route_exceptions (
        route_instance_id, route_id, exception_type, severity, detail, metadata, raised_by)
      VALUES (v_row.id, v_row.route_id, 'DEPARTURE_MISSED', 'HIGH',
        format('%s did not depart at %s.', v_row.instance_code, v_row.scheduled_departure),
        jsonb_build_object('scheduled_departure', v_row.scheduled_departure,
                           'allocations', v_row.allocation_count), auth.uid());
      UPDATE public.freight_route_instances SET status = 'DELAYED' WHERE id = v_row.id;
      INSERT INTO public.freight_route_events (
        route_id, route_instance_id, event_type, previous_status, new_status, actor_role, reason)
      VALUES (v_row.route_id, v_row.id, 'DEPARTURE_MISSED', v_row.status, 'DELAYED', 'system',
              'Scheduled departure passed without an actual departure');
      v_missed := v_missed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('error', false, 'code', 'SWEPT', 'missed_departures', v_missed);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_sweep_departures(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_sweep_departures(integer) TO authenticated, service_role;

-- =====================================================================
-- RECURRING COMMITMENT → per-departure bookings, with capacity exceptions
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_route_commitment_plan(_commitment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_c public.freight_route_commitments;
  v_row record;
  v_plan jsonb := '[]'::jsonb;
  v_fits integer := 0;
  v_full integer := 0;
BEGIN
  SELECT * INTO v_c FROM public.freight_route_commitments WHERE id = _commitment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;
  IF NOT public.has_staff_permission('staff.logistics.read') AND v_c.customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  FOR v_row IN
    SELECT i.id, i.instance_code, i.service_date, i.available_capacity_kg, i.status, i.booking_cutoff_at
      FROM public.freight_route_instances i
     WHERE i.route_id = v_c.route_id
       AND i.service_date BETWEEN v_c.starts_on AND v_c.ends_on
       AND EXTRACT(isodow FROM i.service_date)::int = ANY (v_c.weekday_mask)
     ORDER BY i.service_date
  LOOP
    IF v_row.status IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED')
       AND v_row.available_capacity_kg >= v_c.daily_weight_kg
       AND v_row.booking_cutoff_at > now() THEN
      v_fits := v_fits + 1;
      v_plan := v_plan || jsonb_build_object('service_date', v_row.service_date,
        'instance_id', v_row.id, 'instance_code', v_row.instance_code,
        'available_kg', v_row.available_capacity_kg, 'verdict', 'AVAILABLE');
    ELSE
      v_full := v_full + 1;
      v_plan := v_plan || jsonb_build_object('service_date', v_row.service_date,
        'instance_id', v_row.id, 'instance_code', v_row.instance_code,
        'available_kg', v_row.available_capacity_kg,
        'verdict', CASE WHEN v_row.status NOT IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED') THEN 'CLOSED'
                        WHEN v_row.booking_cutoff_at <= now() THEN 'CUTOFF_PASSED'
                        ELSE 'FULL' END);
      INSERT INTO public.freight_route_exceptions (
        route_instance_id, route_id, commitment_id, exception_type, severity, detail, raised_by)
      SELECT v_row.id, v_c.route_id, v_c.id, 'COMMITMENT_UNFULFILLED', 'MEDIUM',
             format('Commitment %s needs %s kg on %s; %s kg available.',
                    v_c.commitment_code, v_c.daily_weight_kg, v_row.service_date, v_row.available_capacity_kg),
             auth.uid()
       WHERE NOT EXISTS (SELECT 1 FROM public.freight_route_exceptions e
                          WHERE e.commitment_id = v_c.id AND e.route_instance_id = v_row.id
                            AND e.status IN ('OPEN','ACKNOWLEDGED'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('error', false, 'code', 'PLANNED',
    'commitment_code', v_c.commitment_code, 'dates_available', v_fits,
    'dates_blocked', v_full, 'plan', v_plan);
END $$;
REVOKE ALL ON FUNCTION public.freight_route_commitment_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_commitment_plan(uuid) TO authenticated, service_role;

-- =====================================================================
-- READ PROJECTIONS
-- =====================================================================
CREATE VIEW public.v_freight_route_board
WITH (security_invoker = true) AS
SELECT
  i.id AS route_instance_id,
  i.instance_code,
  r.id AS route_id,
  r.route_code,
  r.route_name,
  r.status AS route_status,
  r.origin_label,
  r.destination_label,
  i.service_date,
  i.scheduled_departure,
  i.scheduled_arrival,
  i.booking_cutoff_at,
  i.vehicle_class,
  i.planned_capacity_kg,
  i.reserved_capacity_kg,
  i.available_capacity_kg,
  CASE WHEN i.planned_capacity_kg > 0
       THEN ROUND(i.reserved_capacity_kg / i.planned_capacity_kg * 100, 1) ELSE 0 END AS utilisation_pct,
  i.allocation_count,
  i.status,
  i.manifest_version,
  i.manifest_locked_at,
  i.actual_departure,
  i.actual_arrival,
  v.number_plate,
  d.first_name || ' ' || d.last_name AS driver_name,
  dr.request_number AS dispatch_request_number,
  dr.status AS dispatch_status,
  (SELECT count(*) FROM public.freight_route_exceptions e
    WHERE e.route_instance_id = i.id AND e.status IN ('OPEN','ACKNOWLEDGED')) AS open_exceptions
FROM public.freight_route_instances i
JOIN public.freight_repeat_routes r ON r.id = i.route_id
LEFT JOIN public.vehicles v ON v.id = i.vehicle_id
LEFT JOIN public.drivers d ON d.id = i.driver_id
LEFT JOIN public.logistics_dispatch_requests dr ON dr.id = i.dispatch_request_id;

GRANT SELECT ON public.v_freight_route_board TO authenticated;

-- Customer-safe availability projection: capacity only, no other customer's cargo.
CREATE VIEW public.v_freight_route_availability
WITH (security_invoker = true) AS
SELECT
  i.id AS route_instance_id,
  i.instance_code,
  r.route_code,
  r.route_name,
  r.origin_label,
  r.destination_label,
  i.service_date,
  i.scheduled_departure,
  i.booking_cutoff_at,
  i.vehicle_class,
  i.planned_capacity_kg,
  i.available_capacity_kg,
  i.available_volume_cbm,
  i.status
FROM public.freight_route_instances i
JOIN public.freight_repeat_routes r ON r.id = i.route_id
WHERE r.status = 'ACTIVE'
  AND i.status IN ('OPEN_FOR_BOOKING','CAPACITY_RESERVED')
  AND i.booking_cutoff_at > now();

GRANT SELECT ON public.v_freight_route_availability TO authenticated;

CREATE VIEW public.v_freight_route_performance
WITH (security_invoker = true) AS
SELECT
  r.id AS route_id,
  r.route_code,
  r.route_name,
  r.status,
  count(i.id) AS trips_scheduled,
  count(i.id) FILTER (WHERE i.status = 'COMPLETED') AS trips_completed,
  count(i.id) FILTER (WHERE i.status = 'CANCELLED') AS trips_cancelled,
  count(i.id) FILTER (WHERE i.status = 'DELAYED') AS trips_delayed,
  COALESCE(sum(i.planned_capacity_kg), 0) AS capacity_kg,
  COALESCE(sum(i.reserved_capacity_kg), 0) AS booked_kg,
  CASE WHEN COALESCE(sum(i.planned_capacity_kg), 0) > 0
       THEN ROUND(sum(i.reserved_capacity_kg) / sum(i.planned_capacity_kg) * 100, 1) ELSE 0 END AS utilisation_pct,
  COALESCE(sum(i.planned_capacity_kg) - sum(i.reserved_capacity_kg), 0) AS empty_capacity_kg,
  count(i.id) FILTER (WHERE i.actual_departure IS NOT NULL
                        AND i.actual_departure <= i.scheduled_departure + interval '15 minutes') AS on_time_departures,
  count(i.id) FILTER (WHERE i.actual_departure IS NOT NULL) AS actual_departures,
  (SELECT count(*) FROM public.freight_route_exceptions e WHERE e.route_id = r.id) AS exceptions_raised,
  -- Revenue is only what authoritative accepted quotations state. Cost inputs do
  -- not exist yet, so margin is deliberately NOT computed here.
  COALESCE((SELECT sum(q.total_amount)
              FROM public.freight_route_allocations a
              JOIN public.freight_quotations q ON q.id = a.quote_id
             WHERE a.route_instance_id IN (SELECT id FROM public.freight_route_instances WHERE route_id = r.id)
               AND a.status NOT IN ('RELEASED','CANCELLED')), 0) AS allocated_revenue_kes,
  NULL::numeric AS operating_cost_kes,
  NULL::numeric AS contribution_kes
FROM public.freight_repeat_routes r
LEFT JOIN public.freight_route_instances i ON i.route_id = r.id
GROUP BY r.id, r.route_code, r.route_name, r.status;

GRANT SELECT ON public.v_freight_route_performance TO authenticated;