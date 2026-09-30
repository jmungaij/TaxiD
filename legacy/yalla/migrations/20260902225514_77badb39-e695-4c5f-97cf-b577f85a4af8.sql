-- =====================================================================
-- STAGE 3 — TRUCK DISPATCH: CAPACITY DISCOVERY, MATCHING, RESERVATION
-- Built on the proven Stage 2 spine (freight_quotations →
-- freight_quotation_accept → delivery_orders → freight_consignments →
-- logistics_order_legs). No parallel order/shipment model is created.
-- =====================================================================

-- ---------------------------------------------------------------- fleet
CREATE TABLE public.logistics_fleet_capacity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL UNIQUE REFERENCES public.vehicles(id) ON DELETE CASCADE,
  vehicle_class text NOT NULL,
  payload_capacity_kg numeric(12,2) NOT NULL,
  volume_capacity_cbm numeric(12,3) NOT NULL DEFAULT 0,
  base_label text NOT NULL,
  base_lat numeric(9,6),
  base_lng numeric(9,6),
  operating_radius_km numeric(8,2) NOT NULL DEFAULT 150,
  capability_status text NOT NULL DEFAULT 'UNAVAILABLE',
  hazardous_certified boolean NOT NULL DEFAULT false,
  temperature_controlled boolean NOT NULL DEFAULT false,
  compliance_valid_until date,
  carrier_id uuid,
  notes text,
  registered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_cap_class CHECK (vehicle_class = ANY (ARRAY['TRUCK_3T','TRUCK_7T','TRUCK_14T','TRUCK_28T'])),
  CONSTRAINT fleet_cap_payload CHECK (payload_capacity_kg > 0 AND payload_capacity_kg <= 60000),
  CONSTRAINT fleet_cap_volume CHECK (volume_capacity_cbm >= 0),
  CONSTRAINT fleet_cap_radius CHECK (operating_radius_km > 0),
  CONSTRAINT fleet_cap_status CHECK (capability_status = ANY (ARRAY['AVAILABLE','RESERVED','DISPATCHED','IN_TRANSIT','MAINTENANCE','UNAVAILABLE','INACTIVE']))
);
CREATE INDEX idx_fleet_cap_status ON public.logistics_fleet_capacity (capability_status, vehicle_class);

GRANT SELECT ON public.logistics_fleet_capacity TO authenticated;
GRANT ALL ON public.logistics_fleet_capacity TO service_role;
ALTER TABLE public.logistics_fleet_capacity ENABLE ROW LEVEL SECURITY;
CREATE POLICY fleet_cap_staff_read ON public.logistics_fleet_capacity
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

-- ------------------------------------------------------- match weights
CREATE TABLE public.logistics_match_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT false,
  w_capacity numeric(5,2) NOT NULL,
  w_class numeric(5,2) NOT NULL,
  w_driver numeric(5,2) NOT NULL,
  w_proximity numeric(5,2) NOT NULL,
  w_route numeric(5,2) NOT NULL,
  w_availability numeric(5,2) NOT NULL,
  w_compliance numeric(5,2) NOT NULL,
  w_schedule numeric(5,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_match_weights_active ON public.logistics_match_weights (active) WHERE active;
GRANT SELECT ON public.logistics_match_weights TO authenticated;
GRANT ALL ON public.logistics_match_weights TO service_role;
ALTER TABLE public.logistics_match_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_weights_staff_read ON public.logistics_match_weights
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

INSERT INTO public.logistics_match_weights
  (version, active, w_capacity, w_class, w_driver, w_proximity, w_route, w_availability, w_compliance, w_schedule)
VALUES (1, true, 20, 15, 15, 15, 10, 10, 10, 5);

-- --------------------------------------------------- dispatch requests
CREATE TABLE public.logistics_dispatch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  consignment_id uuid REFERENCES public.freight_consignments(id) ON DELETE SET NULL,
  leg_id uuid REFERENCES public.logistics_order_legs(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.freight_quotations(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL,
  origin_label text NOT NULL,
  origin_lat numeric(9,6),
  origin_lng numeric(9,6),
  destination_label text NOT NULL,
  destination_lat numeric(9,6),
  destination_lng numeric(9,6),
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  delivery_window_start timestamptz,
  delivery_window_end timestamptz,
  vehicle_class text NOT NULL,
  required_payload_kg numeric(12,2) NOT NULL,
  required_volume_cbm numeric(12,3) NOT NULL DEFAULT 0,
  hazardous boolean NOT NULL DEFAULT false,
  temperature_controlled boolean NOT NULL DEFAULT false,
  special_requirements text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'REQUESTED',
  matching_status text NOT NULL DEFAULT 'PENDING',
  assigned_vehicle_id uuid REFERENCES public.vehicles(id),
  assigned_driver_id uuid REFERENCES public.drivers(id),
  reservation_id uuid,
  last_failure_code text,
  last_failure_message text,
  idempotency_key text UNIQUE,
  correlation_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dr_class CHECK (vehicle_class = ANY (ARRAY['TRUCK_3T','TRUCK_7T','TRUCK_14T','TRUCK_28T'])),
  CONSTRAINT dr_payload CHECK (required_payload_kg > 0),
  CONSTRAINT dr_priority CHECK (priority BETWEEN 1 AND 9),
  CONSTRAINT dr_status CHECK (status = ANY (ARRAY[
    'REQUESTED','MATCHING','MATCHED','RESERVED','BOOKED','DRIVER_PENDING','DRIVER_ACCEPTED',
    'READY_FOR_PICKUP','EN_ROUTE_TO_PICKUP','ARRIVED_PICKUP','LOADING','LOADED','IN_TRANSIT',
    'WAITLISTED','EXCEPTION','CANCELLED'])),
  CONSTRAINT dr_matching CHECK (matching_status = ANY (ARRAY['PENDING','RUNNING','MATCHED','NO_CAPACITY','REMATCH_REQUIRED','MANUAL_REVIEW']))
);
CREATE INDEX idx_dr_customer ON public.logistics_dispatch_requests (customer_id, created_at DESC);
CREATE INDEX idx_dr_status ON public.logistics_dispatch_requests (status, matching_status);
CREATE INDEX idx_dr_order ON public.logistics_dispatch_requests (order_id);
CREATE UNIQUE INDEX idx_dr_leg_live ON public.logistics_dispatch_requests (leg_id)
  WHERE status NOT IN ('CANCELLED');

GRANT SELECT ON public.logistics_dispatch_requests TO authenticated;
GRANT ALL ON public.logistics_dispatch_requests TO service_role;
ALTER TABLE public.logistics_dispatch_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY dr_customer_read ON public.logistics_dispatch_requests
  FOR SELECT TO authenticated USING (customer_id = auth.uid());
CREATE POLICY dr_staff_read ON public.logistics_dispatch_requests
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY dr_driver_read ON public.logistics_dispatch_requests
  FOR SELECT TO authenticated USING (
    assigned_driver_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = assigned_driver_id AND d.user_id = auth.uid())
  );

-- ----------------------------------------------- capacity reservations
CREATE TABLE public.logistics_capacity_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id),
  dispatch_request_id uuid NOT NULL REFERENCES public.logistics_dispatch_requests(id) ON DELETE CASCADE,
  capacity_reserved_kg numeric(12,2) NOT NULL,
  capacity_reserved_cbm numeric(12,3) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  released_at timestamptz,
  release_reason text,
  reserved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cap_res_status CHECK (status = ANY (ARRAY['ACTIVE','CONSUMED','RELEASED','EXPIRED','INVALIDATED'])),
  CONSTRAINT cap_res_amount CHECK (capacity_reserved_kg > 0)
);
-- One truck can hold at most ONE live reservation. This is the database-level
-- guarantee that two customers cannot book the same truck.
CREATE UNIQUE INDEX idx_cap_res_one_live_per_vehicle
  ON public.logistics_capacity_reservations (vehicle_id)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX idx_cap_res_one_live_per_request
  ON public.logistics_capacity_reservations (dispatch_request_id)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_cap_res_driver_live ON public.logistics_capacity_reservations (driver_id) WHERE status = 'ACTIVE';

GRANT SELECT ON public.logistics_capacity_reservations TO authenticated;
GRANT ALL ON public.logistics_capacity_reservations TO service_role;
ALTER TABLE public.logistics_capacity_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cap_res_staff_read ON public.logistics_capacity_reservations
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY cap_res_customer_read ON public.logistics_capacity_reservations
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.logistics_dispatch_requests r
    WHERE r.id = dispatch_request_id AND r.customer_id = auth.uid()));

-- --------------------------------------------- matching observability
CREATE TABLE public.logistics_match_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id uuid NOT NULL REFERENCES public.logistics_dispatch_requests(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'COMMIT',
  weights_version integer,
  candidate_count integer NOT NULL DEFAULT 0,
  eligible_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  selected_vehicle_id uuid,
  selected_driver_id uuid,
  selected_score numeric(6,2),
  selection_reason text,
  outcome text NOT NULL,
  matching_duration_ms integer,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_run_mode CHECK (mode = ANY (ARRAY['COMMIT','SIMULATE'])),
  CONSTRAINT match_run_outcome CHECK (outcome = ANY (ARRAY['MATCHED','NO_CAPACITY','RESERVATION_CONFLICT','SIMULATED','ERROR']))
);
CREATE INDEX idx_match_runs_request ON public.logistics_match_runs (dispatch_request_id, created_at DESC);

CREATE TABLE public.logistics_match_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_run_id uuid NOT NULL REFERENCES public.logistics_match_runs(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  driver_id uuid,
  eligible boolean NOT NULL,
  score numeric(6,2),
  rank integer,
  rejection_reasons text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_candidates_run ON public.logistics_match_candidates (match_run_id, eligible, score DESC);

GRANT SELECT ON public.logistics_match_runs TO authenticated;
GRANT SELECT ON public.logistics_match_candidates TO authenticated;
GRANT ALL ON public.logistics_match_runs TO service_role;
GRANT ALL ON public.logistics_match_candidates TO service_role;
ALTER TABLE public.logistics_match_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_match_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_runs_staff_read ON public.logistics_match_runs
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY match_runs_customer_read ON public.logistics_match_runs
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.logistics_dispatch_requests r
    WHERE r.id = dispatch_request_id AND r.customer_id = auth.uid()));
CREATE POLICY match_candidates_staff_read ON public.logistics_match_candidates
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

-- --------------------------------------------- append-only event trail
CREATE TABLE public.logistics_dispatch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id uuid NOT NULL REFERENCES public.logistics_dispatch_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  actor_id uuid,
  actor_role text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispatch_events_request ON public.logistics_dispatch_events (dispatch_request_id, occurred_at DESC);
GRANT SELECT ON public.logistics_dispatch_events TO authenticated;
GRANT ALL ON public.logistics_dispatch_events TO service_role;
ALTER TABLE public.logistics_dispatch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispatch_events_staff_read ON public.logistics_dispatch_events
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY dispatch_events_customer_read ON public.logistics_dispatch_events
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.logistics_dispatch_requests r
    WHERE r.id = dispatch_request_id AND r.customer_id = auth.uid()));

CREATE OR REPLACE FUNCTION public._logistics_dispatch_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'logistics_dispatch_events is append-only';
END $$;
CREATE TRIGGER trg_dispatch_events_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_dispatch_events
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_events_append_only();
REVOKE ALL ON FUNCTION public._logistics_dispatch_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._logistics_dispatch_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_dr_touch BEFORE UPDATE ON public.logistics_dispatch_requests
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_touch();
CREATE TRIGGER trg_fleet_cap_touch BEFORE UPDATE ON public.logistics_fleet_capacity
  FOR EACH ROW EXECUTE FUNCTION public._logistics_dispatch_touch();
REVOKE ALL ON FUNCTION public._logistics_dispatch_touch() FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- FLEET CAPACITY REGISTRATION (staff only)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.logistics_fleet_capacity_upsert(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_vehicle uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  v_vehicle := (_payload->>'vehicle_id')::uuid;
  IF v_vehicle IS NULL OR NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = v_vehicle) THEN
    RETURN jsonb_build_object('error', true, 'code', 'VEHICLE_NOT_FOUND');
  END IF;

  INSERT INTO public.logistics_fleet_capacity (
    vehicle_id, vehicle_class, payload_capacity_kg, volume_capacity_cbm, base_label,
    base_lat, base_lng, operating_radius_km, capability_status, hazardous_certified,
    temperature_controlled, compliance_valid_until, carrier_id, notes, registered_by)
  VALUES (
    v_vehicle,
    _payload->>'vehicle_class',
    (_payload->>'payload_capacity_kg')::numeric,
    COALESCE((_payload->>'volume_capacity_cbm')::numeric, 0),
    _payload->>'base_label',
    NULLIF(_payload->>'base_lat','')::numeric,
    NULLIF(_payload->>'base_lng','')::numeric,
    COALESCE(NULLIF(_payload->>'operating_radius_km','')::numeric, 150),
    COALESCE(_payload->>'capability_status', 'UNAVAILABLE'),
    COALESCE((_payload->>'hazardous_certified')::boolean, false),
    COALESCE((_payload->>'temperature_controlled')::boolean, false),
    NULLIF(_payload->>'compliance_valid_until','')::date,
    NULLIF(_payload->>'carrier_id','')::uuid,
    _payload->>'notes',
    auth.uid())
  ON CONFLICT (vehicle_id) DO UPDATE SET
    vehicle_class = EXCLUDED.vehicle_class,
    payload_capacity_kg = EXCLUDED.payload_capacity_kg,
    volume_capacity_cbm = EXCLUDED.volume_capacity_cbm,
    base_label = EXCLUDED.base_label,
    base_lat = EXCLUDED.base_lat,
    base_lng = EXCLUDED.base_lng,
    operating_radius_km = EXCLUDED.operating_radius_km,
    capability_status = EXCLUDED.capability_status,
    hazardous_certified = EXCLUDED.hazardous_certified,
    temperature_controlled = EXCLUDED.temperature_controlled,
    compliance_valid_until = EXCLUDED.compliance_valid_until,
    carrier_id = EXCLUDED.carrier_id,
    notes = EXCLUDED.notes
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('error', false, 'code', 'REGISTERED', 'capacity_id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.logistics_fleet_capacity_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_fleet_capacity_upsert(jsonb) TO authenticated, service_role;

-- =====================================================================
-- THE MATCHING ENGINE — one engine, used by self-booking, operations
-- simulation and re-matching. _commit = false runs a pure simulation.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.logistics_dispatch_match(_request_id uuid, _commit boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.logistics_dispatch_requests;
  v_w public.logistics_match_weights;
  v_run uuid;
  v_start timestamptz := clock_timestamp();
  v_cand record;
  v_candidates integer := 0;
  v_eligible integer := 0;
  v_best record;
  v_res uuid;
  v_is_staff boolean;
  v_pickup timestamptz;
BEGIN
  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;

  v_is_staff := public.has_staff_permission('staff.logistics.manage');
  -- The customer may trigger matching for their OWN request only, and never a
  -- simulation-only run against the fleet.
  IF NOT v_is_staff AND v_req.customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF NOT v_is_staff AND _commit = false THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  IF _commit AND v_req.status NOT IN ('REQUESTED','MATCHING','WAITLISTED','EXCEPTION') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_STATE', 'status', v_req.status);
  END IF;

  SELECT * INTO v_w FROM public.logistics_match_weights WHERE active LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'MATCH_WEIGHTS_MISSING'); END IF;

  v_pickup := COALESCE(v_req.pickup_window_start, now());

  IF _commit THEN
    UPDATE public.logistics_dispatch_requests
    SET status = 'MATCHING', matching_status = 'RUNNING' WHERE id = _request_id;
  END IF;

  INSERT INTO public.logistics_match_runs (
    dispatch_request_id, mode, weights_version, outcome, actor_id)
  VALUES (_request_id, CASE WHEN _commit THEN 'COMMIT' ELSE 'SIMULATE' END, v_w.version,
          CASE WHEN _commit THEN 'NO_CAPACITY' ELSE 'SIMULATED' END, auth.uid())
  RETURNING id INTO v_run;

  -- ---- candidate evaluation: every freight-capable vehicle is scored and
  -- ---- every refusal is recorded with a machine-readable reason.
  FOR v_cand IN
    WITH cand AS (
      SELECT
        fc.vehicle_id,
        fc.vehicle_class,
        fc.payload_capacity_kg,
        fc.volume_capacity_cbm,
        fc.capability_status,
        fc.compliance_valid_until,
        fc.hazardous_certified,
        fc.temperature_controlled,
        fc.operating_radius_km,
        fc.base_lat, fc.base_lng, fc.base_label,
        v.number_plate,
        v.vehicle_status,
        CASE
          WHEN fc.base_lat IS NULL OR fc.base_lng IS NULL
               OR v_req.origin_lat IS NULL OR v_req.origin_lng IS NULL THEN NULL
          ELSE 6371 * 2 * asin(sqrt(
                 power(sin(radians(v_req.origin_lat - fc.base_lat) / 2), 2)
               + cos(radians(fc.base_lat)) * cos(radians(v_req.origin_lat))
               * power(sin(radians(v_req.origin_lng - fc.base_lng) / 2), 2)))
        END AS origin_distance_km,
        (SELECT d.id FROM public.driver_vehicle_assignments dva
           JOIN public.drivers d ON d.id = dva.driver_id
           LEFT JOIN public.driver_compliance dc ON dc.driver_id = d.id
          WHERE dva.vehicle_id = fc.vehicle_id
            AND dva.status = 'active'
            AND (dva.end_date IS NULL OR dva.end_date >= current_date)
            AND d.status = 'active'
            AND COALESCE(dc.license_valid, false)
            AND COALESCE(dc.insurance_valid, false)
            AND COALESCE(dc.inspection_valid, false)
            AND NOT EXISTS (
              SELECT 1 FROM public.logistics_capacity_reservations r
              WHERE r.driver_id = d.id AND r.status = 'ACTIVE'
                AND r.dispatch_request_id <> _request_id)
          ORDER BY d.driver_rating DESC NULLS LAST
          LIMIT 1) AS driver_id,
        EXISTS (SELECT 1 FROM public.logistics_capacity_reservations r
                 WHERE r.vehicle_id = fc.vehicle_id AND r.status = 'ACTIVE'
                   AND r.dispatch_request_id <> _request_id) AS already_reserved
      FROM public.logistics_fleet_capacity fc
      JOIN public.vehicles v ON v.id = fc.vehicle_id
    )
    SELECT c.*,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN c.payload_capacity_kg < v_req.required_payload_kg THEN 'INSUFFICIENT_CAPACITY' END,
        CASE WHEN v_req.required_volume_cbm > 0 AND c.volume_capacity_cbm > 0
                  AND c.volume_capacity_cbm < v_req.required_volume_cbm THEN 'INSUFFICIENT_VOLUME' END,
        CASE WHEN c.vehicle_class <> v_req.vehicle_class THEN 'VEHICLE_CLASS_MISMATCH' END,
        CASE WHEN c.capability_status <> 'AVAILABLE' THEN 'VEHICLE_UNAVAILABLE' END,
        CASE WHEN c.vehicle_status::text <> 'active' THEN 'VEHICLE_NOT_ACTIVE' END,
        CASE WHEN c.compliance_valid_until IS NULL
                  OR c.compliance_valid_until < v_pickup::date THEN 'COMPLIANCE_FAILURE' END,
        CASE WHEN v_req.hazardous AND NOT c.hazardous_certified THEN 'HAZARDOUS_NOT_CERTIFIED' END,
        CASE WHEN v_req.temperature_controlled AND NOT c.temperature_controlled THEN 'TEMPERATURE_NOT_SUPPORTED' END,
        CASE WHEN c.driver_id IS NULL THEN 'DRIVER_UNAVAILABLE' END,
        CASE WHEN c.already_reserved THEN 'ALREADY_RESERVED' END,
        CASE WHEN c.origin_distance_km IS NULL THEN 'ROUTE_MISMATCH'
             WHEN c.origin_distance_km > c.operating_radius_km THEN 'ROUTE_MISMATCH' END
      ], NULL) AS reasons
    FROM cand c
  LOOP
    v_candidates := v_candidates + 1;
    INSERT INTO public.logistics_match_candidates (
      match_run_id, vehicle_id, driver_id, eligible, score, rejection_reasons, evidence)
    VALUES (
      v_run, v_cand.vehicle_id, v_cand.driver_id,
      cardinality(v_cand.reasons) = 0,
      CASE WHEN cardinality(v_cand.reasons) = 0 THEN ROUND((
          v_w.w_capacity * LEAST(1, v_req.required_payload_kg / NULLIF(v_cand.payload_capacity_kg,0))
        + v_w.w_class * 1
        + v_w.w_driver * 1
        + v_w.w_proximity * GREATEST(0, 1 - COALESCE(v_cand.origin_distance_km,0) / NULLIF(v_cand.operating_radius_km,0))
        + v_w.w_route * 1
        + v_w.w_availability * 1
        + v_w.w_compliance * 1
        + v_w.w_schedule * 1)::numeric, 2) ELSE NULL END,
      v_cand.reasons,
      jsonb_build_object(
        'number_plate', v_cand.number_plate,
        'vehicle_class', v_cand.vehicle_class,
        'payload_capacity_kg', v_cand.payload_capacity_kg,
        'required_payload_kg', v_req.required_payload_kg,
        'volume_capacity_cbm', v_cand.volume_capacity_cbm,
        'capability_status', v_cand.capability_status,
        'origin_distance_km', ROUND(COALESCE(v_cand.origin_distance_km, -1)::numeric, 2),
        'operating_radius_km', v_cand.operating_radius_km,
        'base_label', v_cand.base_label,
        'compliance_valid_until', v_cand.compliance_valid_until));
    IF cardinality(v_cand.reasons) = 0 THEN v_eligible := v_eligible + 1; END IF;
  END LOOP;

  UPDATE public.logistics_match_candidates c SET rank = s.rnk
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) AS rnk
          FROM public.logistics_match_candidates
         WHERE match_run_id = v_run AND eligible) s
  WHERE c.id = s.id;

  SELECT mc.vehicle_id, mc.driver_id, mc.score, mc.evidence
    INTO v_best
    FROM public.logistics_match_candidates mc
   WHERE mc.match_run_id = v_run AND mc.eligible
   ORDER BY mc.score DESC LIMIT 1;

  UPDATE public.logistics_match_runs SET
    candidate_count = v_candidates,
    eligible_count = v_eligible,
    rejected_count = v_candidates - v_eligible,
    selected_vehicle_id = CASE WHEN _commit THEN v_best.vehicle_id ELSE NULL END,
    selected_driver_id = CASE WHEN _commit THEN v_best.driver_id ELSE NULL END,
    selected_score = v_best.score,
    matching_duration_ms = GREATEST(0, (EXTRACT(epoch FROM clock_timestamp() - v_start) * 1000)::int)
  WHERE id = v_run;

  -- ---- simulation stops here: no reservation, no state change.
  IF NOT _commit THEN
    RETURN jsonb_build_object(
      'error', false, 'code', 'SIMULATED', 'match_run_id', v_run,
      'candidate_count', v_candidates, 'eligible_count', v_eligible,
      'rejected_count', v_candidates - v_eligible,
      'best_vehicle_id', v_best.vehicle_id, 'best_score', v_best.score);
  END IF;

  IF v_best.vehicle_id IS NULL THEN
    UPDATE public.logistics_dispatch_requests SET
      status = 'WAITLISTED', matching_status = 'NO_CAPACITY',
      last_failure_code = 'NO_ELIGIBLE_CAPACITY',
      last_failure_message = format(
        'No compliant %s vehicle with at least %s kg payload is currently available for this movement. %s candidate(s) evaluated, all refused.',
        v_req.vehicle_class, v_req.required_payload_kg, v_candidates)
    WHERE id = _request_id;
    INSERT INTO public.logistics_dispatch_events (
      dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
    VALUES (_request_id, 'DISPATCH_WAITLISTED', v_req.status, 'WAITLISTED', auth.uid(),
            CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
            'No eligible capacity',
            jsonb_build_object('match_run_id', v_run, 'candidates', v_candidates));
    RETURN jsonb_build_object(
      'error', false, 'code', 'NO_ELIGIBLE_CAPACITY', 'match_run_id', v_run,
      'status', 'WAITLISTED', 'candidate_count', v_candidates, 'eligible_count', 0);
  END IF;

  -- ---- transactional reservation. The unique partial index refuses a second
  -- ---- live reservation on the same truck; we surface that as a conflict
  -- ---- rather than double-booking.
  BEGIN
    INSERT INTO public.logistics_capacity_reservations (
      vehicle_id, driver_id, dispatch_request_id, capacity_reserved_kg, capacity_reserved_cbm, reserved_by)
    VALUES (v_best.vehicle_id, v_best.driver_id, _request_id,
            v_req.required_payload_kg, v_req.required_volume_cbm, auth.uid())
    RETURNING id INTO v_res;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.logistics_match_runs SET outcome = 'RESERVATION_CONFLICT' WHERE id = v_run;
    UPDATE public.logistics_dispatch_requests SET
      status = 'WAITLISTED', matching_status = 'REMATCH_REQUIRED',
      last_failure_code = 'CAPACITY_TAKEN',
      last_failure_message = 'The matched truck was reserved by another movement a moment before this booking. Re-matching is required.'
    WHERE id = _request_id;
    RETURN jsonb_build_object('error', true, 'code', 'CAPACITY_TAKEN', 'match_run_id', v_run);
  END;

  UPDATE public.logistics_fleet_capacity
     SET capability_status = 'RESERVED'
   WHERE vehicle_id = v_best.vehicle_id AND capability_status = 'AVAILABLE';

  UPDATE public.logistics_dispatch_requests SET
    status = 'DRIVER_PENDING', matching_status = 'MATCHED',
    assigned_vehicle_id = v_best.vehicle_id, assigned_driver_id = v_best.driver_id,
    reservation_id = v_res, last_failure_code = NULL, last_failure_message = NULL
  WHERE id = _request_id;

  UPDATE public.logistics_match_runs SET
    outcome = 'MATCHED',
    selection_reason = 'Highest-scoring vehicle passing every mandatory capacity, class, availability, compliance, driver and route control.'
  WHERE id = v_run;

  -- Bind the operational assignment onto the Stage 2 leg (no parallel model).
  IF v_req.leg_id IS NOT NULL THEN
    UPDATE public.logistics_order_legs
       SET vehicle_id = v_best.vehicle_id, driver_id = v_best.driver_id,
           status = CASE WHEN status IN ('PLANNED','AWAITING_CAPACITY') THEN 'ASSIGNED' ELSE status END
     WHERE id = v_req.leg_id;
    INSERT INTO public.logistics_leg_events (
      leg_id, order_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
    VALUES (v_req.leg_id, v_req.order_id, 'LEG_ASSIGNED', 'PLANNED', 'ASSIGNED', auth.uid(),
            CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
            'Capacity matched by dispatch engine',
            jsonb_build_object('match_run_id', v_run, 'reservation_id', v_res));
  END IF;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_request_id, 'CAPACITY_RESERVED', v_req.status, 'DRIVER_PENDING', auth.uid(),
          CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
          'Matched and reserved',
          jsonb_build_object('match_run_id', v_run, 'reservation_id', v_res,
                             'vehicle_id', v_best.vehicle_id, 'driver_id', v_best.driver_id,
                             'score', v_best.score));

  RETURN jsonb_build_object(
    'error', false, 'code', 'MATCHED', 'match_run_id', v_run, 'reservation_id', v_res,
    'status', 'DRIVER_PENDING', 'vehicle_id', v_best.vehicle_id, 'driver_id', v_best.driver_id,
    'score', v_best.score, 'candidate_count', v_candidates, 'eligible_count', v_eligible);
END $$;
REVOKE ALL ON FUNCTION public.logistics_dispatch_match(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_dispatch_match(uuid, boolean) TO authenticated, service_role;

-- =====================================================================
-- CUSTOMER SELF-BOOKING — converts an accepted Stage 2 freight order into
-- a dispatch request and runs the same matching engine. Nothing commercial
-- is taken from the caller: class, weight, volume and route come from the
-- persisted consignment / quotation records.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.freight_selfbook_dispatch(
  _order_id uuid,
  _idempotency_key text DEFAULT NULL,
  _pickup_window_start timestamptz DEFAULT NULL,
  _pickup_window_end timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.delivery_orders;
  v_cons public.freight_consignments;
  v_quote public.freight_quotations;
  v_leg public.logistics_order_legs;
  v_req public.logistics_dispatch_requests;
  v_existing uuid;
  v_num text;
  v_match jsonb;
  v_is_staff boolean;
BEGIN
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = _order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'ORDER_NOT_FOUND'); END IF;

  v_is_staff := public.has_staff_permission('staff.logistics.manage');
  IF NOT v_is_staff AND v_order.customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR',
      'message', 'This freight order does not belong to you.');
  END IF;

  SELECT * INTO v_cons FROM public.freight_consignments WHERE order_id = _order_id
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_CONSIGNMENT',
      'message', 'This order has no freight consignment, so there is nothing to dispatch.');
  END IF;

  SELECT * INTO v_quote FROM public.freight_quotations WHERE order_id = _order_id
   ORDER BY accepted_at DESC NULLS LAST LIMIT 1;
  IF v_quote.id IS NULL OR v_quote.status NOT IN ('ACCEPTED','CONVERTED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'QUOTE_NOT_ACCEPTED',
      'message', 'Self-booking requires an accepted freight quotation.');
  END IF;

  -- Idempotency: the same booking key always returns the same request.
  IF NULLIF(_idempotency_key, '') IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.logistics_dispatch_requests
     WHERE idempotency_key = _idempotency_key;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_existing;
      RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'replay', true,
        'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
        'status', v_req.status, 'matching_status', v_req.matching_status,
        'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id);
    END IF;
  END IF;

  -- First unexecuted leg carries the truck movement. Hub legs remain
  -- supported: each leg gets its own dispatch request as capacity is needed.
  SELECT * INTO v_leg FROM public.logistics_order_legs
   WHERE order_id = _order_id AND status IN ('PLANNED','AWAITING_CAPACITY')
   ORDER BY leg_no LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_DISPATCHABLE_LEG',
      'message', 'Every planned leg on this order already has capacity assigned.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.logistics_dispatch_requests
              WHERE leg_id = v_leg.id AND status <> 'CANCELLED') THEN
    SELECT * INTO v_req FROM public.logistics_dispatch_requests
     WHERE leg_id = v_leg.id AND status <> 'CANCELLED' LIMIT 1;
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_REQUESTED',
      'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
      'status', v_req.status, 'matching_status', v_req.matching_status);
  END IF;

  v_num := 'DSP-' || to_char(now(), 'YYYYMM') || '-' ||
           upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.logistics_dispatch_requests (
    request_number, order_id, consignment_id, leg_id, quote_id, customer_id,
    origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
    pickup_window_start, pickup_window_end, delivery_window_start, delivery_window_end,
    vehicle_class, required_payload_kg, required_volume_cbm, hazardous, temperature_controlled,
    special_requirements, priority, idempotency_key, created_by)
  VALUES (
    v_num, _order_id, v_cons.id, v_leg.id, v_quote.id, v_order.customer_id,
    v_leg.origin_label, v_leg.origin_lat, v_leg.origin_lng,
    v_leg.destination_label, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(_pickup_window_start, v_leg.planned_departure, v_order.pickup_window_start),
    COALESCE(_pickup_window_end, v_leg.planned_arrival, v_order.pickup_window_end),
    v_cons.delivery_window_start, v_cons.delivery_window_end,
    -- Commercial basis is locked: the vehicle class comes from the quotation.
    COALESCE(v_quote.vehicle_class, 'TRUCK_3T'),
    GREATEST(COALESCE(v_cons.chargeable_weight_kg, v_cons.gross_weight_kg), 1),
    COALESCE(v_cons.volume_cbm, 0),
    COALESCE(v_cons.hazardous, false),
    (v_cons.temp_min_c IS NOT NULL OR v_cons.temp_max_c IS NOT NULL),
    COALESCE(v_cons.special_handling, '{}'),
    5, NULLIF(_idempotency_key, ''), auth.uid())
  RETURNING * INTO v_req;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (v_req.id, 'DISPATCH_REQUESTED', NULL, 'REQUESTED', auth.uid(),
          CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
          'Customer self-booking',
          jsonb_build_object('order_id', _order_id, 'quote_id', v_quote.id, 'leg_id', v_leg.id));

  UPDATE public.logistics_order_legs SET status = 'AWAITING_CAPACITY'
   WHERE id = v_leg.id AND status = 'PLANNED';

  v_match := public.logistics_dispatch_match(v_req.id, true);

  RETURN jsonb_build_object(
    'error', false, 'code', 'SELF_BOOKED',
    'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
    'order_number', v_order.order_number, 'consignment_id', v_cons.id, 'leg_id', v_leg.id,
    'quote_number', v_quote.quote_number, 'quoted_amount', v_quote.total_amount,
    'vehicle_class', v_req.vehicle_class, 'required_payload_kg', v_req.required_payload_kg,
    'match', v_match);
END $$;
REVOKE ALL ON FUNCTION public.freight_selfbook_dispatch(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_selfbook_dispatch(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

-- =====================================================================
-- DRIVER ACCEPTANCE / REJECTION
-- =====================================================================
CREATE OR REPLACE FUNCTION public.logistics_dispatch_driver_respond(
  _request_id uuid, _accept boolean, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.logistics_dispatch_requests;
  v_driver uuid;
  v_is_staff boolean;
  v_rematch jsonb;
BEGIN
  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;

  v_is_staff := public.has_staff_permission('staff.logistics.manage');
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid() LIMIT 1;
  IF NOT v_is_staff AND (v_driver IS NULL OR v_driver <> v_req.assigned_driver_id) THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF v_req.status <> 'DRIVER_PENDING' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_STATE', 'status', v_req.status);
  END IF;

  IF _accept THEN
    UPDATE public.logistics_capacity_reservations
       SET status = 'CONSUMED' WHERE dispatch_request_id = _request_id AND status = 'ACTIVE';
    UPDATE public.logistics_fleet_capacity SET capability_status = 'DISPATCHED'
     WHERE vehicle_id = v_req.assigned_vehicle_id;
    UPDATE public.logistics_dispatch_requests
       SET status = 'READY_FOR_PICKUP' WHERE id = _request_id;
    IF v_req.leg_id IS NOT NULL THEN
      UPDATE public.logistics_order_legs SET status = 'ACCEPTED'
       WHERE id = v_req.leg_id AND status = 'ASSIGNED';
      INSERT INTO public.logistics_leg_events (
        leg_id, order_id, event_type, previous_status, new_status, actor_id, actor_role, reason)
      VALUES (v_req.leg_id, v_req.order_id, 'LEG_ACCEPTED', 'ASSIGNED', 'ACCEPTED', auth.uid(),
              'driver', 'Driver accepted the assignment');
    END IF;
    INSERT INTO public.logistics_dispatch_events (
      dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
    VALUES (_request_id, 'DRIVER_ACCEPTED', 'DRIVER_PENDING', 'READY_FOR_PICKUP', auth.uid(), 'driver',
            NULLIF(trim(COALESCE(_reason, '')), ''),
            jsonb_build_object('driver_id', v_req.assigned_driver_id, 'vehicle_id', v_req.assigned_vehicle_id));
    RETURN jsonb_build_object('error', false, 'code', 'DRIVER_ACCEPTED', 'status', 'READY_FOR_PICKUP');
  END IF;

  -- Rejection: release the reservation, keep the audit trail, re-open matching.
  IF COALESCE(length(trim(_reason)), 0) < 5 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'reason');
  END IF;

  UPDATE public.logistics_capacity_reservations
     SET status = 'RELEASED', released_at = now(), release_reason = _reason
   WHERE dispatch_request_id = _request_id AND status = 'ACTIVE';
  UPDATE public.logistics_fleet_capacity SET capability_status = 'AVAILABLE'
   WHERE vehicle_id = v_req.assigned_vehicle_id AND capability_status = 'RESERVED';
  UPDATE public.logistics_dispatch_requests SET
    status = 'REQUESTED', matching_status = 'REMATCH_REQUIRED',
    assigned_vehicle_id = NULL, assigned_driver_id = NULL, reservation_id = NULL
  WHERE id = _request_id;
  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_request_id, 'DRIVER_REJECTED', 'DRIVER_PENDING', 'REQUESTED', auth.uid(), 'driver', _reason,
          jsonb_build_object('rejected_driver_id', v_req.assigned_driver_id,
                             'rejected_vehicle_id', v_req.assigned_vehicle_id));

  v_rematch := public.logistics_dispatch_match(_request_id, true);
  RETURN jsonb_build_object('error', false, 'code', 'DRIVER_REJECTED', 'rematch', v_rematch);
END $$;
REVOKE ALL ON FUNCTION public.logistics_dispatch_driver_respond(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_dispatch_driver_respond(uuid, boolean, text) TO authenticated, service_role;

-- =====================================================================
-- CAPACITY RELEASE (vehicle failure / stale reservation) → re-match
-- =====================================================================
CREATE OR REPLACE FUNCTION public.logistics_capacity_release(
  _request_id uuid, _reason text, _vehicle_state text DEFAULT 'AVAILABLE')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.logistics_dispatch_requests; v_rematch jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF COALESCE(length(trim(_reason)), 0) < 5 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'reason');
  END IF;
  IF _vehicle_state NOT IN ('AVAILABLE','MAINTENANCE','UNAVAILABLE','INACTIVE') THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'vehicle_state');
  END IF;

  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;

  UPDATE public.logistics_capacity_reservations
     SET status = 'INVALIDATED', released_at = now(), release_reason = _reason
   WHERE dispatch_request_id = _request_id AND status = 'ACTIVE';
  UPDATE public.logistics_fleet_capacity SET capability_status = _vehicle_state
   WHERE vehicle_id = v_req.assigned_vehicle_id;
  UPDATE public.logistics_dispatch_requests SET
    status = 'REQUESTED', matching_status = 'REMATCH_REQUIRED',
    assigned_vehicle_id = NULL, assigned_driver_id = NULL, reservation_id = NULL
  WHERE id = _request_id;
  IF v_req.leg_id IS NOT NULL THEN
    UPDATE public.logistics_order_legs
       SET vehicle_id = NULL, driver_id = NULL,
           status = CASE WHEN status IN ('ASSIGNED','ACCEPTED') THEN 'AWAITING_CAPACITY' ELSE status END
     WHERE id = v_req.leg_id;
  END IF;
  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_request_id, 'CAPACITY_INVALIDATED', v_req.status, 'REQUESTED', auth.uid(), 'staff', _reason,
          jsonb_build_object('released_vehicle_id', v_req.assigned_vehicle_id,
                             'vehicle_state', _vehicle_state));

  v_rematch := public.logistics_dispatch_match(_request_id, true);
  RETURN jsonb_build_object('error', false, 'code', 'CAPACITY_RELEASED', 'rematch', v_rematch);
END $$;
REVOKE ALL ON FUNCTION public.logistics_capacity_release(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_capacity_release(uuid, text, text) TO authenticated, service_role;

-- =====================================================================
-- OPERATIONS OVERRIDE — never silent
-- =====================================================================
CREATE OR REPLACE FUNCTION public.logistics_dispatch_override(
  _request_id uuid, _vehicle_id uuid, _driver_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.logistics_dispatch_requests; v_cap public.logistics_fleet_capacity; v_res uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF COALESCE(length(trim(_reason)), 0) < 10 THEN
    RETURN jsonb_build_object('error', true, 'code', 'VALIDATION_ERROR', 'field', 'reason',
      'message', 'An override requires a recorded operational reason.');
  END IF;

  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;

  SELECT * INTO v_cap FROM public.logistics_fleet_capacity
   WHERE vehicle_id = _vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'VEHICLE_NOT_FREIGHT_CAPABLE');
  END IF;
  -- Even an override may not break the hard capacity law.
  IF v_cap.payload_capacity_kg < v_req.required_payload_kg THEN
    RETURN jsonb_build_object('error', true, 'code', 'INSUFFICIENT_CAPACITY',
      'required_kg', v_req.required_payload_kg, 'capacity_kg', v_cap.payload_capacity_kg);
  END IF;

  UPDATE public.logistics_capacity_reservations
     SET status = 'RELEASED', released_at = now(), release_reason = 'Operations override: ' || _reason
   WHERE dispatch_request_id = _request_id AND status = 'ACTIVE';
  UPDATE public.logistics_fleet_capacity SET capability_status = 'AVAILABLE'
   WHERE vehicle_id = v_req.assigned_vehicle_id AND capability_status = 'RESERVED'
     AND vehicle_id <> _vehicle_id;

  BEGIN
    INSERT INTO public.logistics_capacity_reservations (
      vehicle_id, driver_id, dispatch_request_id, capacity_reserved_kg, capacity_reserved_cbm, reserved_by)
    VALUES (_vehicle_id, _driver_id, _request_id,
            v_req.required_payload_kg, v_req.required_volume_cbm, auth.uid())
    RETURNING id INTO v_res;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', true, 'code', 'CAPACITY_TAKEN');
  END;

  UPDATE public.logistics_fleet_capacity SET capability_status = 'RESERVED' WHERE vehicle_id = _vehicle_id;
  UPDATE public.logistics_dispatch_requests SET
    status = 'DRIVER_PENDING', matching_status = 'MANUAL_REVIEW',
    assigned_vehicle_id = _vehicle_id, assigned_driver_id = _driver_id, reservation_id = v_res
  WHERE id = _request_id;
  IF v_req.leg_id IS NOT NULL THEN
    UPDATE public.logistics_order_legs
       SET vehicle_id = _vehicle_id, driver_id = _driver_id,
           status = CASE WHEN status IN ('PLANNED','AWAITING_CAPACITY') THEN 'ASSIGNED' ELSE status END
     WHERE id = v_req.leg_id;
  END IF;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_request_id, 'OPERATIONS_OVERRIDE', v_req.status, 'DRIVER_PENDING', auth.uid(), 'staff', _reason,
          jsonb_build_object(
            'previous_vehicle_id', v_req.assigned_vehicle_id,
            'previous_driver_id', v_req.assigned_driver_id,
            'new_vehicle_id', _vehicle_id, 'new_driver_id', _driver_id,
            'reservation_id', v_res));

  RETURN jsonb_build_object('error', false, 'code', 'OVERRIDDEN', 'reservation_id', v_res);
END $$;
REVOKE ALL ON FUNCTION public.logistics_dispatch_override(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_dispatch_override(uuid, uuid, uuid, text) TO authenticated, service_role;

-- =====================================================================
-- READ PROJECTIONS (RLS-respecting, security_invoker)
-- =====================================================================
CREATE VIEW public.v_logistics_dispatch_board
WITH (security_invoker = true) AS
SELECT
  r.id AS dispatch_request_id,
  r.request_number,
  r.order_id,
  o.order_number,
  r.customer_id,
  r.consignment_id,
  c.consignment_number,
  r.leg_id,
  r.origin_label,
  r.destination_label,
  r.vehicle_class,
  r.required_payload_kg,
  r.required_volume_cbm,
  r.pickup_window_start,
  r.pickup_window_end,
  r.status,
  r.matching_status,
  r.last_failure_code,
  r.last_failure_message,
  r.assigned_vehicle_id,
  v.number_plate,
  r.assigned_driver_id,
  d.first_name || ' ' || d.last_name AS driver_name,
  d.phone_number AS driver_phone,
  q.quote_number,
  q.total_amount AS quoted_amount,
  q.currency,
  l.status AS leg_status,
  l.eta,
  r.created_at,
  r.updated_at
FROM public.logistics_dispatch_requests r
JOIN public.delivery_orders o ON o.id = r.order_id
LEFT JOIN public.freight_consignments c ON c.id = r.consignment_id
LEFT JOIN public.logistics_order_legs l ON l.id = r.leg_id
LEFT JOIN public.vehicles v ON v.id = r.assigned_vehicle_id
LEFT JOIN public.drivers d ON d.id = r.assigned_driver_id
LEFT JOIN public.freight_quotations q ON q.id = r.quote_id;

GRANT SELECT ON public.v_logistics_dispatch_board TO authenticated;

CREATE VIEW public.v_logistics_capacity_summary
WITH (security_invoker = true) AS
SELECT
  fc.vehicle_class,
  count(*) AS total_vehicles,
  count(*) FILTER (WHERE fc.capability_status = 'AVAILABLE') AS available,
  count(*) FILTER (WHERE fc.capability_status = 'RESERVED') AS reserved,
  count(*) FILTER (WHERE fc.capability_status = 'DISPATCHED') AS dispatched,
  count(*) FILTER (WHERE fc.capability_status = 'IN_TRANSIT') AS in_transit,
  count(*) FILTER (WHERE fc.capability_status = 'MAINTENANCE') AS maintenance,
  count(*) FILTER (WHERE fc.capability_status IN ('UNAVAILABLE','INACTIVE')) AS unavailable,
  COALESCE(sum(fc.payload_capacity_kg), 0) AS total_payload_kg,
  COALESCE(sum(fc.payload_capacity_kg) FILTER (WHERE fc.capability_status = 'AVAILABLE'), 0) AS available_payload_kg,
  COALESCE((SELECT sum(res.capacity_reserved_kg) FROM public.logistics_capacity_reservations res
             WHERE res.status = 'ACTIVE'
               AND res.vehicle_id IN (SELECT vehicle_id FROM public.logistics_fleet_capacity f2
                                       WHERE f2.vehicle_class = fc.vehicle_class)), 0) AS reserved_payload_kg
FROM public.logistics_fleet_capacity fc
GROUP BY fc.vehicle_class;

GRANT SELECT ON public.v_logistics_capacity_summary TO authenticated;