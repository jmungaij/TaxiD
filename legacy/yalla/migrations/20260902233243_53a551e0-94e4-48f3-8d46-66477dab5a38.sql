-- ============================================================================
-- STAGE 5 — CROSS-DOCK & REGIONAL HUB NETWORK
-- Physical network layer over the existing freight/leg/dispatch architecture.
-- Reuses: logistics_hubs, logistics_hub_zones/docks/locations, logistics_hub_audit,
--         logistics_order_legs (state machine), freight_consignments/items,
--         logistics_dispatch_requests + logistics_dispatch_match (Stage 3),
--         freight_route_instances (Stage 4).
-- ============================================================================

-- ---------------------------------------------------------------- hub status
-- Uppercase lifecycle, legacy lowercase values tolerated for existing rows.
ALTER TABLE public.logistics_hubs DROP CONSTRAINT IF EXISTS logistics_hubs_status_chk;
ALTER TABLE public.logistics_hubs DROP CONSTRAINT IF EXISTS logistics_hubs_status_lifecycle;

UPDATE public.logistics_hubs
   SET status = CASE
     WHEN status IN ('inactive','retired') THEN 'RETIRED'
     WHEN status = 'draft' THEN 'DRAFT'
     WHEN status = 'pending' THEN 'PENDING_ACTIVATION'
     WHEN status = 'active' THEN 'ACTIVE'
     WHEN status = 'suspended' THEN 'SUSPENDED'
     ELSE upper(status) END;

ALTER TABLE public.logistics_hubs
  ADD CONSTRAINT logistics_hubs_status_lifecycle CHECK (
    status IN ('DRAFT','PENDING_ACTIVATION','ACTIVE','SUSPENDED','RETIRED',
               'draft','pending','active','inactive','retired','suspended'));

ALTER TABLE public.logistics_hubs
  ADD COLUMN IF NOT EXISTS dock_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_capacity_cbm numeric,
  ADD COLUMN IF NOT EXISTS handling_capacity_units_per_day integer,
  ADD COLUMN IF NOT EXISTS max_weight_capacity_kg numeric,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid,
  ADD COLUMN IF NOT EXISTS activation_reason text;

-- ------------------------------------------------------------ handling units
CREATE TABLE IF NOT EXISTS public.freight_handling_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hu_code text NOT NULL UNIQUE,
  consignment_id uuid NOT NULL REFERENCES public.freight_consignments(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.freight_consignment_items(id) ON DELETE SET NULL,
  order_id uuid,
  seq integer NOT NULL,
  description text,
  unit_type text NOT NULL DEFAULT 'CARTON',
  weight_kg numeric NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  volume_cbm numeric NOT NULL DEFAULT 0 CHECK (volume_cbm >= 0),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN (
    'PLANNED','IN_TRANSIT','RECEIVED','SORTED','STAGED','LOADED','DEPARTED',
    'DELIVERED','MISSING','DAMAGED','HELD','TRANSFERRED')),
  custody_holder_type text NOT NULL DEFAULT 'CUSTOMER' CHECK (
    custody_holder_type IN ('CUSTOMER','DRIVER','HUB','CARRIER','CONSIGNEE')),
  custody_holder_id uuid,
  custody_since timestamptz NOT NULL DEFAULT now(),
  current_hub_id uuid REFERENCES public.logistics_hubs(id),
  current_leg_id uuid REFERENCES public.logistics_order_legs(id),
  next_leg_id uuid REFERENCES public.logistics_order_legs(id),
  staging_zone_id uuid REFERENCES public.logistics_hub_zones(id),
  staging_location_id uuid REFERENCES public.logistics_hub_locations(id),
  arrived_at_hub_at timestamptz,
  received_at timestamptz,
  sorted_at timestamptz,
  staged_at timestamptz,
  loaded_at timestamptz,
  departed_hub_at timestamptz,
  last_scan_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consignment_id, seq),
  -- Custody integrity: a unit held by a hub cannot also be on a truck leg.
  CONSTRAINT hu_custody_singular CHECK (
    NOT (custody_holder_type = 'HUB' AND status IN ('IN_TRANSIT','DEPARTED')))
);
CREATE INDEX IF NOT EXISTS idx_fhu_consignment ON public.freight_handling_units(consignment_id);
CREATE INDEX IF NOT EXISTS idx_fhu_hub_status ON public.freight_handling_units(current_hub_id, status);

GRANT SELECT ON public.freight_handling_units TO authenticated;
GRANT ALL ON public.freight_handling_units TO service_role;
ALTER TABLE public.freight_handling_units ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------- scans
CREATE TABLE IF NOT EXISTS public.freight_hub_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_type text NOT NULL CHECK (scan_type IN (
    'ARRIVAL_SCAN','RECEIVING_SCAN','SORT_SCAN','STAGING_SCAN','LOAD_SCAN',
    'DEPARTURE_SCAN','EXCEPTION_SCAN')),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id),
  handling_unit_id uuid REFERENCES public.freight_handling_units(id) ON DELETE CASCADE,
  consignment_id uuid REFERENCES public.freight_consignments(id) ON DELETE CASCADE,
  order_id uuid,
  leg_id uuid REFERENCES public.logistics_order_legs(id),
  dispatch_request_id uuid REFERENCES public.logistics_dispatch_requests(id),
  route_instance_id uuid REFERENCES public.freight_route_instances(id),
  vehicle_id uuid,
  driver_id uuid,
  actor_id uuid,
  device_ref text,
  location_label text,
  lat numeric,
  lng numeric,
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fhs_hub_time ON public.freight_hub_scans(hub_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fhs_unit ON public.freight_hub_scans(handling_unit_id, occurred_at DESC);

GRANT SELECT ON public.freight_hub_scans TO authenticated;
GRANT ALL ON public.freight_hub_scans TO service_role;
ALTER TABLE public.freight_hub_scans ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- receipts
CREATE TABLE IF NOT EXISTS public.freight_hub_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id),
  consignment_id uuid NOT NULL REFERENCES public.freight_consignments(id) ON DELETE CASCADE,
  order_id uuid,
  inbound_leg_id uuid REFERENCES public.logistics_order_legs(id),
  vehicle_id uuid,
  driver_id uuid,
  arrival_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  condition text NOT NULL DEFAULT 'GOOD' CHECK (condition IN ('GOOD','DAMAGED','PARTIAL')),
  units_expected integer NOT NULL DEFAULT 0,
  units_received integer NOT NULL DEFAULT 0,
  weight_received_kg numeric NOT NULL DEFAULT 0,
  exceptions_raised integer NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, consignment_id, inbound_leg_id)
);
GRANT SELECT ON public.freight_hub_receipts TO authenticated;
GRANT ALL ON public.freight_hub_receipts TO service_role;
ALTER TABLE public.freight_hub_receipts ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------- custody transfers
CREATE TABLE IF NOT EXISTS public.freight_custody_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handling_unit_id uuid NOT NULL REFERENCES public.freight_handling_units(id) ON DELETE CASCADE,
  consignment_id uuid NOT NULL REFERENCES public.freight_consignments(id) ON DELETE CASCADE,
  transfer_type text NOT NULL CHECK (transfer_type IN (
    'PICKUP','HUB_RECEIPT','HUB_RELEASE','DELIVERY','RECOVERY','EXCEPTION_HOLD')),
  from_holder_type text NOT NULL,
  from_holder_id uuid,
  to_holder_type text NOT NULL,
  to_holder_id uuid,
  hub_id uuid REFERENCES public.logistics_hubs(id),
  leg_id uuid REFERENCES public.logistics_order_legs(id),
  scan_id uuid REFERENCES public.freight_hub_scans(id),
  evidence_ref text,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fct_unit ON public.freight_custody_transfers(handling_unit_id, occurred_at DESC);
GRANT SELECT ON public.freight_custody_transfers TO authenticated;
GRANT ALL ON public.freight_custody_transfers TO service_role;
ALTER TABLE public.freight_custody_transfers ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------- sortation / allocations
CREATE TABLE IF NOT EXISTS public.freight_hub_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id),
  handling_unit_id uuid NOT NULL REFERENCES public.freight_handling_units(id) ON DELETE CASCADE,
  consignment_id uuid NOT NULL REFERENCES public.freight_consignments(id) ON DELETE CASCADE,
  next_leg_id uuid REFERENCES public.logistics_order_legs(id),
  route_instance_id uuid REFERENCES public.freight_route_instances(id),
  dispatch_request_id uuid REFERENCES public.logistics_dispatch_requests(id),
  manifest_id uuid,
  staging_zone_id uuid REFERENCES public.logistics_hub_zones(id),
  staging_location_id uuid REFERENCES public.logistics_hub_locations(id),
  destination_label text,
  status text NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN (
    'ALLOCATED','STAGED','MANIFESTED','LOADED','DEPARTED','CANCELLED')),
  allocated_by uuid,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One live outbound allocation per handling unit — no double allocation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fha_live_unit
  ON public.freight_hub_allocations(handling_unit_id)
  WHERE status IN ('ALLOCATED','STAGED','MANIFESTED','LOADED');
GRANT SELECT ON public.freight_hub_allocations TO authenticated;
GRANT ALL ON public.freight_hub_allocations TO service_role;
ALTER TABLE public.freight_hub_allocations ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------ outbound manifests
CREATE TABLE IF NOT EXISTS public.freight_outbound_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_number text NOT NULL UNIQUE,
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id),
  next_leg_id uuid REFERENCES public.logistics_order_legs(id),
  route_instance_id uuid REFERENCES public.freight_route_instances(id),
  dispatch_request_id uuid REFERENCES public.logistics_dispatch_requests(id),
  vehicle_id uuid,
  driver_id uuid,
  destination_label text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','VERIFYING','VERIFIED','LOAD_MISMATCH','DEPARTED','CANCELLED')),
  planned_units integer NOT NULL DEFAULT 0,
  planned_weight_kg numeric NOT NULL DEFAULT 0,
  planned_volume_cbm numeric NOT NULL DEFAULT 0,
  actual_units integer,
  actual_weight_kg numeric,
  verified_at timestamptz,
  verified_by uuid,
  departed_at timestamptz,
  mismatch_detail jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.freight_outbound_manifests TO authenticated;
GRANT ALL ON public.freight_outbound_manifests TO service_role;
ALTER TABLE public.freight_outbound_manifests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.freight_hub_allocations
  DROP CONSTRAINT IF EXISTS fha_manifest_fk;
ALTER TABLE public.freight_hub_allocations
  ADD CONSTRAINT fha_manifest_fk FOREIGN KEY (manifest_id)
  REFERENCES public.freight_outbound_manifests(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.freight_outbound_manifest_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES public.freight_outbound_manifests(id) ON DELETE CASCADE,
  handling_unit_id uuid NOT NULL REFERENCES public.freight_handling_units(id) ON DELETE CASCADE,
  allocation_id uuid REFERENCES public.freight_hub_allocations(id) ON DELETE SET NULL,
  consignment_id uuid,
  planned boolean NOT NULL DEFAULT true,
  loaded boolean NOT NULL DEFAULT false,
  load_scan_id uuid REFERENCES public.freight_hub_scans(id),
  discrepancy text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manifest_id, handling_unit_id)
);
GRANT SELECT ON public.freight_outbound_manifest_lines TO authenticated;
GRANT ALL ON public.freight_outbound_manifest_lines TO service_role;
ALTER TABLE public.freight_outbound_manifest_lines ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------- exceptions
CREATE TABLE IF NOT EXISTS public.freight_hub_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_number text NOT NULL UNIQUE,
  hub_id uuid REFERENCES public.logistics_hubs(id),
  exception_type text NOT NULL CHECK (exception_type IN (
    'MISSING_CARGO','DAMAGED_CARGO','SHORT_RECEIPT','OVER_RECEIPT','MISROUTED_CARGO',
    'WRONG_HANDLING_UNIT','WRONG_DESTINATION','TRUCK_DELAY','DOCK_CONGESTION',
    'HUB_CAPACITY_EXCEEDED','SCAN_FAILURE','DOCUMENT_MISSING','UNEXPECTED_CARGO',
    'MISSED_CONNECTION','DWELL_SLA_BREACH','NO_OUTBOUND_CAPACITY')),
  severity text NOT NULL DEFAULT 'P2' CHECK (severity IN ('P0','P1','P2','P3')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED')),
  handling_unit_id uuid REFERENCES public.freight_handling_units(id) ON DELETE SET NULL,
  consignment_id uuid REFERENCES public.freight_consignments(id) ON DELETE SET NULL,
  order_id uuid,
  leg_id uuid REFERENCES public.logistics_order_legs(id),
  manifest_id uuid REFERENCES public.freight_outbound_manifests(id) ON DELETE SET NULL,
  owner_role text,
  owner_id uuid,
  detail text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_by uuid,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fhe_hub_status ON public.freight_hub_exceptions(hub_id, status, severity);
GRANT SELECT ON public.freight_hub_exceptions TO authenticated;
GRANT ALL ON public.freight_hub_exceptions TO service_role;
ALTER TABLE public.freight_hub_exceptions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------- SLA config
CREATE TABLE IF NOT EXISTS public.freight_hub_sla_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  receiving_minutes integer NOT NULL DEFAULT 60,
  sort_minutes integer NOT NULL DEFAULT 120,
  crossdock_minutes integer NOT NULL DEFAULT 240,
  max_dwell_minutes integer NOT NULL DEFAULT 480,
  outbound_connection_minutes integer NOT NULL DEFAULT 360,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fhsla_hub ON public.freight_hub_sla_config(hub_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fhsla_network ON public.freight_hub_sla_config((hub_id IS NULL)) WHERE hub_id IS NULL;
GRANT SELECT ON public.freight_hub_sla_config TO authenticated;
GRANT ALL ON public.freight_hub_sla_config TO service_role;
ALTER TABLE public.freight_hub_sla_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.freight_hub_sla_config (hub_id) VALUES (NULL)
ON CONFLICT DO NOTHING;

-- ================================================== append-only protection
CREATE OR REPLACE FUNCTION public._freight_hub_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % records cannot be modified or deleted', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS trg_fhs_append_only ON public.freight_hub_scans;
CREATE TRIGGER trg_fhs_append_only BEFORE UPDATE OR DELETE ON public.freight_hub_scans
  FOR EACH ROW EXECUTE FUNCTION public._freight_hub_append_only();

DROP TRIGGER IF EXISTS trg_fct_append_only ON public.freight_custody_transfers;
CREATE TRIGGER trg_fct_append_only BEFORE UPDATE OR DELETE ON public.freight_custody_transfers
  FOR EACH ROW EXECUTE FUNCTION public._freight_hub_append_only();

CREATE OR REPLACE FUNCTION public._freight_hub_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_fhu_touch ON public.freight_handling_units;
CREATE TRIGGER trg_fhu_touch BEFORE UPDATE ON public.freight_handling_units
  FOR EACH ROW EXECUTE FUNCTION public._freight_hub_touch();
DROP TRIGGER IF EXISTS trg_fha_touch ON public.freight_hub_allocations;
CREATE TRIGGER trg_fha_touch BEFORE UPDATE ON public.freight_hub_allocations
  FOR EACH ROW EXECUTE FUNCTION public._freight_hub_touch();
DROP TRIGGER IF EXISTS trg_fom_touch ON public.freight_outbound_manifests;
CREATE TRIGGER trg_fom_touch BEFORE UPDATE ON public.freight_outbound_manifests
  FOR EACH ROW EXECUTE FUNCTION public._freight_hub_touch();
DROP TRIGGER IF EXISTS trg_fhe_touch ON public.freight_hub_exceptions;
CREATE TRIGGER trg_fhe_touch BEFORE UPDATE ON public.freight_hub_exceptions
  FOR EACH ROW EXECUTE FUNCTION public._freight_hub_touch();

-- =============================================================== ownership
CREATE OR REPLACE FUNCTION public._freight_owns_consignment(_consignment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.freight_consignments c
     WHERE c.id = _consignment_id
       AND (c.created_by = auth.uid()
            OR EXISTS (SELECT 1 FROM public.delivery_orders o
                        WHERE o.id = c.order_id AND o.customer_id = auth.uid())));
$$;
REVOKE ALL ON FUNCTION public._freight_owns_consignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._freight_owns_consignment(uuid) TO authenticated, service_role;

-- ==================================================================== RLS
CREATE POLICY fhu_read ON public.freight_handling_units FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public._freight_owns_consignment(consignment_id));
CREATE POLICY fhs_read ON public.freight_hub_scans FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read')
         OR (consignment_id IS NOT NULL AND public._freight_owns_consignment(consignment_id)));
CREATE POLICY fhr_read ON public.freight_hub_receipts FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public._freight_owns_consignment(consignment_id));
CREATE POLICY fct_read ON public.freight_custody_transfers FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public._freight_owns_consignment(consignment_id));
CREATE POLICY fha_read ON public.freight_hub_allocations FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public._freight_owns_consignment(consignment_id));
CREATE POLICY fom_read ON public.freight_outbound_manifests FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read'));
CREATE POLICY foml_read ON public.freight_outbound_manifest_lines FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read'));
CREATE POLICY fhe_read ON public.freight_hub_exceptions FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read')
         OR (consignment_id IS NOT NULL AND public._freight_owns_consignment(consignment_id)));
CREATE POLICY fhsla_read ON public.freight_hub_sla_config FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read'));

-- ====================================================== HUB LIFECYCLE RPC
CREATE OR REPLACE FUNCTION public.freight_hub_lifecycle(
  _hub_id uuid, _new_status text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_prev text;
  v_allowed text[];
BEGIN
  IF NOT public.logistics_hub_authorised('manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_FOUND'); END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 8 THEN
    RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED');
  END IF;

  v_prev := upper(v_hub.status);
  IF v_prev IN ('INACTIVE') THEN v_prev := 'RETIRED'; END IF;
  IF v_prev = 'PENDING' THEN v_prev := 'PENDING_ACTIVATION'; END IF;

  v_allowed := CASE v_prev
    WHEN 'DRAFT' THEN ARRAY['PENDING_ACTIVATION','RETIRED']
    WHEN 'PENDING_ACTIVATION' THEN ARRAY['ACTIVE','DRAFT','RETIRED']
    WHEN 'ACTIVE' THEN ARRAY['SUSPENDED','RETIRED']
    WHEN 'SUSPENDED' THEN ARRAY['ACTIVE','RETIRED']
    WHEN 'RETIRED' THEN ARRAY['PENDING_ACTIVATION']
    ELSE ARRAY[]::text[] END;

  IF NOT (_new_status = ANY (v_allowed)) THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_TRANSITION',
      'from', v_prev, 'to', _new_status, 'allowed', to_jsonb(v_allowed));
  END IF;

  IF _new_status = 'ACTIVE' THEN
    IF v_hub.lat IS NULL OR v_hub.lng IS NULL THEN
      RETURN jsonb_build_object('error', true, 'code', 'GEOCODE_REQUIRED');
    END IF;
    IF COALESCE(v_hub.max_capacity, 0) <= 0 THEN
      RETURN jsonb_build_object('error', true, 'code', 'CAPACITY_REQUIRED');
    END IF;
    IF v_hub.operating_hours = '{}'::jsonb OR v_hub.operating_hours IS NULL THEN
      RETURN jsonb_build_object('error', true, 'code', 'OPERATING_HOURS_REQUIRED');
    END IF;
    IF COALESCE(v_hub.dock_count, 0) <= 0 THEN
      RETURN jsonb_build_object('error', true, 'code', 'DOCK_CONFIGURATION_REQUIRED');
    END IF;
  END IF;

  IF _new_status IN ('SUSPENDED','RETIRED') THEN
    IF EXISTS (SELECT 1 FROM public.freight_handling_units
                WHERE current_hub_id = _hub_id
                  AND status IN ('RECEIVED','SORTED','STAGED','LOADED')) THEN
      RETURN jsonb_build_object('error', true, 'code', 'CARGO_ON_SITE',
        'detail', 'Cargo is physically on site; clear or transfer it before changing hub status.');
    END IF;
  END IF;

  UPDATE public.logistics_hubs SET
    status = _new_status,
    active = (_new_status = 'ACTIVE'),
    activated_at = CASE WHEN _new_status = 'ACTIVE' THEN now() ELSE activated_at END,
    activated_by = CASE WHEN _new_status = 'ACTIVE' THEN auth.uid() ELSE activated_by END,
    activation_reason = _reason,
    updated_at = now()
  WHERE id = _hub_id;

  PERFORM public._logistics_hub_audit(_hub_id, 'STATUS_' || _new_status,
    jsonb_build_object('status', v_prev),
    jsonb_build_object('status', _new_status, 'reason', _reason, 'actor', auth.uid(), 'at', now()));

  RETURN jsonb_build_object('error', false, 'code', 'STATUS_CHANGED',
    'hub_id', _hub_id, 'previous_status', v_prev, 'new_status', _new_status,
    'activation_actor', auth.uid(), 'activation_timestamp', now(), 'reason', _reason);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_lifecycle(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_lifecycle(uuid, text, text) TO authenticated, service_role;

-- ============================================ HANDLING UNIT MATERIALISATION
CREATE OR REPLACE FUNCTION public.freight_hub_generate_units(_consignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cons public.freight_consignments;
  v_existing integer;
  v_created integer := 0;
  v_seq integer := 0;
  r record;
  i integer;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_cons FROM public.freight_consignments WHERE id = _consignment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'CONSIGNMENT_NOT_FOUND'); END IF;

  SELECT count(*) INTO v_existing FROM public.freight_handling_units WHERE consignment_id = _consignment_id;
  IF v_existing > 0 THEN
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_MATERIALISED', 'units', v_existing);
  END IF;

  FOR r IN SELECT * FROM public.freight_consignment_items
            WHERE consignment_id = _consignment_id ORDER BY item_no LOOP
    FOR i IN 1..GREATEST(COALESCE(r.quantity, 1), 1) LOOP
      v_seq := v_seq + 1;
      INSERT INTO public.freight_handling_units (
        hu_code, consignment_id, item_id, order_id, seq, description, unit_type,
        weight_kg, volume_cbm, custody_holder_type, custody_holder_id)
      VALUES (
        'HU-' || split_part(v_cons.consignment_number, '-', 2) || '-' ||
          upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)) || '-' || lpad(v_seq::text, 3, '0'),
        _consignment_id, r.id, v_cons.order_id, v_seq, r.description,
        COALESCE(r.handling_unit, 'CARTON'),
        COALESCE(r.unit_weight_kg, 0), COALESCE(r.volume_cbm, 0),
        'CUSTOMER', v_cons.created_by);
      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  IF v_created = 0 THEN
    FOR i IN 1..GREATEST(COALESCE(v_cons.pieces, 1), 1) LOOP
      INSERT INTO public.freight_handling_units (
        hu_code, consignment_id, order_id, seq, description, unit_type,
        weight_kg, volume_cbm, custody_holder_type, custody_holder_id)
      VALUES (
        'HU-' || split_part(v_cons.consignment_number, '-', 2) || '-' ||
          upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)) || '-' || lpad(i::text, 3, '0'),
        _consignment_id, v_cons.order_id, i, v_cons.commodity,
        COALESCE(v_cons.package_type, 'CARTON'),
        COALESCE(v_cons.gross_weight_kg, 0) / GREATEST(COALESCE(v_cons.pieces, 1), 1),
        COALESCE(v_cons.volume_cbm, 0) / GREATEST(COALESCE(v_cons.pieces, 1), 1),
        'CUSTOMER', v_cons.created_by);
      v_created := v_created + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('error', false, 'code', 'UNITS_CREATED', 'units', v_created,
    'consignment', v_cons.consignment_number);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_generate_units(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_generate_units(uuid) TO authenticated, service_role;

-- =========================================================== EXCEPTION RPC
CREATE OR REPLACE FUNCTION public.freight_hub_exception_raise(
  _hub_id uuid, _type text, _severity text, _detail text,
  _handling_unit_id uuid DEFAULT NULL, _consignment_id uuid DEFAULT NULL,
  _leg_id uuid DEFAULT NULL, _manifest_id uuid DEFAULT NULL,
  _evidence jsonb DEFAULT '{}'::jsonb, _owner_role text DEFAULT 'hub_operations')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.freight_hub_exceptions (
    exception_number, hub_id, exception_type, severity, detail, handling_unit_id,
    consignment_id, leg_id, manifest_id, evidence, owner_role, raised_by)
  VALUES (
    'HEX-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
    _hub_id, _type, _severity, _detail, _handling_unit_id, _consignment_id,
    _leg_id, _manifest_id, COALESCE(_evidence,'{}'::jsonb), _owner_role, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_exception_raise(uuid, text, text, text, uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_exception_raise(uuid, text, text, text, uuid, uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.freight_hub_exception_update(
  _exception_id uuid, _status text, _resolution text DEFAULT NULL, _owner_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.freight_hub_exceptions;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF _status NOT IN ('ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_STATUS');
  END IF;
  IF _status IN ('RESOLVED','CLOSED') AND (_resolution IS NULL OR length(btrim(_resolution)) < 8) THEN
    RETURN jsonb_build_object('error', true, 'code', 'RESOLUTION_REQUIRED');
  END IF;
  UPDATE public.freight_hub_exceptions SET
    status = _status,
    owner_id = COALESCE(_owner_id, owner_id, auth.uid()),
    acknowledged_at = CASE WHEN _status = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
    resolved_at = CASE WHEN _status IN ('RESOLVED','CLOSED') THEN now() ELSE resolved_at END,
    resolution = COALESCE(_resolution, resolution)
  WHERE id = _exception_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'EXCEPTION_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('error', false, 'code', 'EXCEPTION_UPDATED',
    'exception_number', v_row.exception_number, 'status', v_row.status);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_exception_update(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_exception_update(uuid, text, text, uuid) TO authenticated, service_role;

-- ============================================================ HUB RECEIVING
CREATE OR REPLACE FUNCTION public.freight_hub_receive(
  _hub_id uuid, _consignment_id uuid, _inbound_leg_id uuid,
  _unit_ids uuid[], _condition text DEFAULT 'GOOD',
  _idempotency_key text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_leg public.logistics_order_legs;
  v_next public.logistics_order_legs;
  v_receipt public.freight_hub_receipts;
  v_expected integer;
  v_received integer := 0;
  v_weight numeric := 0;
  v_exceptions integer := 0;
  v_scan uuid;
  r record;
  v_missing uuid[] := '{}';
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_receipt FROM public.freight_hub_receipts WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('error', false, 'code', 'ALREADY_RECEIVED',
        'receipt_number', v_receipt.receipt_number, 'units_received', v_receipt.units_received,
        'idempotent', true);
    END IF;
  END IF;

  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_FOUND'); END IF;
  IF upper(v_hub.status) <> 'ACTIVE' OR v_hub.active IS NOT TRUE THEN
    RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_ACTIVE', 'status', v_hub.status);
  END IF;

  IF _inbound_leg_id IS NULL THEN
    PERFORM public.freight_hub_exception_raise(_hub_id, 'UNEXPECTED_CARGO', 'P1',
      'Cargo presented at hub without a valid inbound leg.', NULL, _consignment_id);
    RETURN jsonb_build_object('error', true, 'code', 'NO_INBOUND_LEG');
  END IF;

  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = _inbound_leg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'LEG_NOT_FOUND'); END IF;
  IF v_leg.destination_hub_id IS DISTINCT FROM _hub_id THEN
    PERFORM public.freight_hub_exception_raise(_hub_id, 'MISROUTED_CARGO', 'P1',
      format('Inbound leg %s is destined for a different hub.', v_leg.leg_no), NULL, _consignment_id, _inbound_leg_id);
    RETURN jsonb_build_object('error', true, 'code', 'WRONG_HUB');
  END IF;
  IF v_leg.status NOT IN ('DEPARTED','IN_TRANSIT','ARRIVED','UNLOADING','ACCEPTED','LOADED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'LEG_NOT_IN_TRANSIT', 'leg_status', v_leg.status);
  END IF;

  SELECT count(*) INTO v_expected FROM public.freight_handling_units WHERE consignment_id = _consignment_id;
  IF v_expected = 0 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_HANDLING_UNITS',
      'detail', 'Materialise handling units before receiving.');
  END IF;

  INSERT INTO public.freight_hub_receipts (
    receipt_number, hub_id, consignment_id, order_id, inbound_leg_id,
    vehicle_id, driver_id, arrival_at, received_by, condition, units_expected,
    idempotency_key, notes)
  VALUES (
    'HRC-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
    _hub_id, _consignment_id, v_leg.order_id, _inbound_leg_id,
    v_leg.vehicle_id, v_leg.driver_id, COALESCE(v_leg.actual_arrival, now()), auth.uid(),
    _condition, v_expected, _idempotency_key, _notes)
  RETURNING * INTO v_receipt;

  -- Arrival scan (consignment level)
  INSERT INTO public.freight_hub_scans (
    scan_type, hub_id, consignment_id, order_id, leg_id, vehicle_id, driver_id,
    actor_id, location_label, lat, lng, idempotency_key,
    metadata)
  VALUES ('ARRIVAL_SCAN', _hub_id, _consignment_id, v_leg.order_id, _inbound_leg_id,
    v_leg.vehicle_id, v_leg.driver_id, auth.uid(), v_hub.name, v_hub.lat, v_hub.lng,
    CASE WHEN _idempotency_key IS NULL THEN NULL ELSE _idempotency_key || ':arrival' END,
    jsonb_build_object('receipt_id', v_receipt.id))
  RETURNING id INTO v_scan;

  FOR r IN SELECT * FROM public.freight_handling_units
            WHERE consignment_id = _consignment_id ORDER BY seq FOR UPDATE LOOP
    IF _unit_ids IS NOT NULL AND NOT (r.id = ANY (_unit_ids)) THEN
      -- physically absent
      v_missing := v_missing || r.id;
      UPDATE public.freight_handling_units SET status = 'MISSING', last_scan_at = now()
       WHERE id = r.id;
      PERFORM public.freight_hub_exception_raise(_hub_id, 'MISSING_CARGO', 'P0',
        format('Handling unit %s was manifested inbound but not physically received.', r.hu_code),
        r.id, _consignment_id, _inbound_leg_id, NULL,
        jsonb_build_object('receipt_id', v_receipt.id));
      v_exceptions := v_exceptions + 1;
      CONTINUE;
    END IF;

    IF r.status IN ('RECEIVED','SORTED','STAGED','LOADED') AND r.current_hub_id = _hub_id THEN
      CONTINUE; -- idempotent: already received here
    END IF;

    INSERT INTO public.freight_hub_scans (
      scan_type, hub_id, handling_unit_id, consignment_id, order_id, leg_id,
      vehicle_id, driver_id, actor_id, location_label, idempotency_key, metadata)
    VALUES ('RECEIVING_SCAN', _hub_id, r.id, _consignment_id, v_leg.order_id, _inbound_leg_id,
      v_leg.vehicle_id, v_leg.driver_id, auth.uid(), v_hub.name,
      CASE WHEN _idempotency_key IS NULL THEN NULL ELSE _idempotency_key || ':recv:' || r.id END,
      jsonb_build_object('receipt_id', v_receipt.id, 'condition', _condition))
    RETURNING id INTO v_scan;

    UPDATE public.freight_handling_units SET
      status = CASE WHEN _condition = 'DAMAGED' THEN 'DAMAGED' ELSE 'RECEIVED' END,
      custody_holder_type = 'HUB', custody_holder_id = _hub_id, custody_since = now(),
      current_hub_id = _hub_id, current_leg_id = _inbound_leg_id,
      arrived_at_hub_at = COALESCE(arrived_at_hub_at, now()),
      received_at = now(), last_scan_at = now()
    WHERE id = r.id;

    INSERT INTO public.freight_custody_transfers (
      handling_unit_id, consignment_id, transfer_type, from_holder_type, from_holder_id,
      to_holder_type, to_holder_id, hub_id, leg_id, scan_id, actor_id, evidence_ref)
    VALUES (r.id, _consignment_id, 'HUB_RECEIPT', 'DRIVER', v_leg.driver_id,
      'HUB', _hub_id, _hub_id, _inbound_leg_id, v_scan, auth.uid(), v_receipt.receipt_number);

    IF _condition = 'DAMAGED' THEN
      PERFORM public.freight_hub_exception_raise(_hub_id, 'DAMAGED_CARGO', 'P1',
        format('Handling unit %s received in damaged condition.', r.hu_code),
        r.id, _consignment_id, _inbound_leg_id, NULL,
        jsonb_build_object('receipt_id', v_receipt.id));
      v_exceptions := v_exceptions + 1;
    END IF;

    v_received := v_received + 1;
    v_weight := v_weight + COALESCE(r.weight_kg, 0);
  END LOOP;

  IF v_received < v_expected THEN
    PERFORM public.freight_hub_exception_raise(_hub_id, 'SHORT_RECEIPT', 'P1',
      format('Short receipt: %s of %s units received.', v_received, v_expected),
      NULL, _consignment_id, _inbound_leg_id, NULL,
      jsonb_build_object('receipt_id', v_receipt.id, 'missing', to_jsonb(v_missing)));
    v_exceptions := v_exceptions + 1;
  END IF;

  UPDATE public.freight_hub_receipts SET
    units_received = v_received, weight_received_kg = v_weight,
    exceptions_raised = v_exceptions,
    condition = CASE WHEN v_received < v_expected THEN 'PARTIAL' ELSE _condition END
  WHERE id = v_receipt.id;

  -- Inbound leg completes; next leg becomes operationally ready.
  UPDATE public.logistics_order_legs SET
    status = 'COMPLETED', actual_arrival = COALESCE(actual_arrival, now()), updated_at = now()
  WHERE id = _inbound_leg_id;

  SELECT * INTO v_next FROM public.logistics_order_legs
   WHERE order_id = v_leg.order_id AND leg_no = v_leg.leg_no + 1;
  IF FOUND AND v_next.status = 'PLANNED' THEN
    UPDATE public.logistics_order_legs SET status = 'AWAITING_CAPACITY', updated_at = now()
     WHERE id = v_next.id;
  END IF;

  UPDATE public.logistics_hubs
     SET current_capacity = COALESCE(current_capacity, 0) + v_received, updated_at = now()
   WHERE id = _hub_id;

  IF COALESCE(v_hub.max_capacity, 0) > 0
     AND COALESCE(v_hub.current_capacity, 0) + v_received > v_hub.max_capacity THEN
    PERFORM public.freight_hub_exception_raise(_hub_id, 'HUB_CAPACITY_EXCEEDED', 'P1',
      format('Hub %s is over its configured capacity of %s.', v_hub.code, v_hub.max_capacity),
      NULL, _consignment_id, _inbound_leg_id);
  END IF;

  RETURN jsonb_build_object('error', false, 'code', 'RECEIVED',
    'receipt_number', v_receipt.receipt_number, 'receipt_id', v_receipt.id,
    'units_expected', v_expected, 'units_received', v_received,
    'weight_received_kg', v_weight, 'exceptions_raised', v_exceptions,
    'inbound_leg_status', 'COMPLETED',
    'next_leg_id', v_next.id, 'next_leg_status',
      CASE WHEN v_next.id IS NULL THEN NULL ELSE 'AWAITING_CAPACITY' END);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_receive(uuid, uuid, uuid, uuid[], text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_receive(uuid, uuid, uuid, uuid[], text, text, text) TO authenticated, service_role;

-- ================================================================ SORTATION
CREATE OR REPLACE FUNCTION public.freight_hub_sort(
  _hub_id uuid, _unit_ids uuid[], _next_leg_id uuid,
  _staging_zone_id uuid DEFAULT NULL, _staging_location_id uuid DEFAULT NULL,
  _route_instance_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_leg public.logistics_order_legs;
  v_sorted integer := 0;
  v_refused jsonb := '[]'::jsonb;
  r record;
  v_scan uuid;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF NOT FOUND OR upper(v_hub.status) <> 'ACTIVE' THEN
    RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_ACTIVE');
  END IF;
  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = _next_leg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NEXT_LEG_NOT_FOUND'); END IF;
  IF v_leg.origin_hub_id IS DISTINCT FROM _hub_id THEN
    RETURN jsonb_build_object('error', true, 'code', 'WRONG_DESTINATION',
      'detail', 'The chosen outbound leg does not originate at this hub.');
  END IF;

  FOR r IN SELECT * FROM public.freight_handling_units
            WHERE id = ANY (_unit_ids) ORDER BY seq FOR UPDATE LOOP
    IF r.current_hub_id IS DISTINCT FROM _hub_id
       OR r.status NOT IN ('RECEIVED','SORTED','STAGED') THEN
      v_refused := v_refused || jsonb_build_object('hu_code', r.hu_code,
        'reason', 'NOT_RECEIVED_AT_HUB', 'status', r.status);
      CONTINUE;
    END IF;
    IF r.order_id IS DISTINCT FROM v_leg.order_id THEN
      PERFORM public.freight_hub_exception_raise(_hub_id, 'WRONG_HANDLING_UNIT', 'P1',
        format('Handling unit %s does not belong to the order on outbound leg %s.', r.hu_code, v_leg.leg_no),
        r.id, r.consignment_id, _next_leg_id);
      v_refused := v_refused || jsonb_build_object('hu_code', r.hu_code, 'reason', 'WRONG_HANDLING_UNIT');
      CONTINUE;
    END IF;

    INSERT INTO public.freight_hub_scans (
      scan_type, hub_id, handling_unit_id, consignment_id, order_id, leg_id,
      route_instance_id, actor_id, location_label, metadata)
    VALUES (CASE WHEN _staging_location_id IS NOT NULL OR _staging_zone_id IS NOT NULL
                 THEN 'STAGING_SCAN' ELSE 'SORT_SCAN' END,
      _hub_id, r.id, r.consignment_id, r.order_id, _next_leg_id, _route_instance_id,
      auth.uid(), v_hub.name,
      jsonb_build_object('destination', v_leg.destination_label))
    RETURNING id INTO v_scan;

    INSERT INTO public.freight_hub_allocations (
      hub_id, handling_unit_id, consignment_id, next_leg_id, route_instance_id,
      staging_zone_id, staging_location_id, destination_label, status, allocated_by)
    VALUES (_hub_id, r.id, r.consignment_id, _next_leg_id, _route_instance_id,
      _staging_zone_id, _staging_location_id, v_leg.destination_label,
      CASE WHEN _staging_zone_id IS NOT NULL OR _staging_location_id IS NOT NULL
           THEN 'STAGED' ELSE 'ALLOCATED' END, auth.uid())
    ON CONFLICT (handling_unit_id) WHERE status IN ('ALLOCATED','STAGED','MANIFESTED','LOADED')
    DO UPDATE SET next_leg_id = EXCLUDED.next_leg_id,
                  route_instance_id = EXCLUDED.route_instance_id,
                  staging_zone_id = EXCLUDED.staging_zone_id,
                  staging_location_id = EXCLUDED.staging_location_id,
                  status = EXCLUDED.status, updated_at = now();

    UPDATE public.freight_handling_units SET
      status = CASE WHEN _staging_zone_id IS NOT NULL OR _staging_location_id IS NOT NULL
                    THEN 'STAGED' ELSE 'SORTED' END,
      next_leg_id = _next_leg_id,
      staging_zone_id = _staging_zone_id, staging_location_id = _staging_location_id,
      sorted_at = COALESCE(sorted_at, now()),
      staged_at = CASE WHEN _staging_zone_id IS NOT NULL OR _staging_location_id IS NOT NULL
                       THEN now() ELSE staged_at END,
      last_scan_at = now()
    WHERE id = r.id;
    v_sorted := v_sorted + 1;
  END LOOP;

  RETURN jsonb_build_object('error', false, 'code', 'SORTED',
    'units_sorted', v_sorted, 'refused', v_refused,
    'next_leg_id', _next_leg_id, 'destination', v_leg.destination_label);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_sort(uuid, uuid[], uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_sort(uuid, uuid[], uuid, uuid, uuid, uuid) TO authenticated, service_role;

-- =============================================== OUTBOUND CAPACITY + MANIFEST
CREATE OR REPLACE FUNCTION public.freight_hub_outbound_prepare(
  _hub_id uuid, _next_leg_id uuid, _route_instance_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_leg public.logistics_order_legs;
  v_man public.freight_outbound_manifests;
  v_units integer; v_weight numeric; v_volume numeric;
  v_req public.logistics_dispatch_requests;
  v_num text;
  v_match jsonb;
  v_dispatch jsonb;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id;
  IF NOT FOUND OR upper(v_hub.status) <> 'ACTIVE' THEN
    RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_ACTIVE');
  END IF;
  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = _next_leg_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NEXT_LEG_NOT_FOUND'); END IF;

  SELECT * INTO v_man FROM public.freight_outbound_manifests
   WHERE next_leg_id = _next_leg_id AND status NOT IN ('CANCELLED','DEPARTED')
   ORDER BY created_at DESC LIMIT 1;

  SELECT count(*), COALESCE(sum(u.weight_kg),0), COALESCE(sum(u.volume_cbm),0)
    INTO v_units, v_weight, v_volume
    FROM public.freight_hub_allocations a
    JOIN public.freight_handling_units u ON u.id = a.handling_unit_id
   WHERE a.next_leg_id = _next_leg_id AND a.status IN ('ALLOCATED','STAGED','MANIFESTED');

  IF v_units = 0 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_ALLOCATED_CARGO');
  END IF;

  IF v_man.id IS NULL THEN
    INSERT INTO public.freight_outbound_manifests (
      manifest_number, hub_id, next_leg_id, route_instance_id, destination_label,
      planned_units, planned_weight_kg, planned_volume_cbm, created_by)
    VALUES (
      'OMF-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
      _hub_id, _next_leg_id, _route_instance_id, v_leg.destination_label,
      v_units, v_weight, v_volume, auth.uid())
    RETURNING * INTO v_man;
  ELSE
    UPDATE public.freight_outbound_manifests SET
      planned_units = v_units, planned_weight_kg = v_weight, planned_volume_cbm = v_volume,
      route_instance_id = COALESCE(_route_instance_id, route_instance_id),
      status = CASE WHEN status = 'DRAFT' THEN 'DRAFT' ELSE 'VERIFYING' END
    WHERE id = v_man.id RETURNING * INTO v_man;
  END IF;

  INSERT INTO public.freight_outbound_manifest_lines (
    manifest_id, handling_unit_id, allocation_id, consignment_id, planned)
  SELECT v_man.id, a.handling_unit_id, a.id, a.consignment_id, true
    FROM public.freight_hub_allocations a
   WHERE a.next_leg_id = _next_leg_id AND a.status IN ('ALLOCATED','STAGED','MANIFESTED')
  ON CONFLICT (manifest_id, handling_unit_id) DO NOTHING;

  UPDATE public.freight_hub_allocations SET status = 'MANIFESTED', manifest_id = v_man.id
   WHERE next_leg_id = _next_leg_id AND status IN ('ALLOCATED','STAGED');

  -- Outbound capacity: Stage 4 route instance first, else Stage 3 ad-hoc matching.
  IF _route_instance_id IS NOT NULL THEN
    v_dispatch := public.freight_route_instance_dispatch(_route_instance_id);
    SELECT * INTO v_req FROM public.logistics_dispatch_requests
     WHERE id = (v_dispatch->>'dispatch_request_id')::uuid;
  ELSE
    SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE leg_id = _next_leg_id
     AND status NOT IN ('CANCELLED','COMPLETED') ORDER BY created_at DESC LIMIT 1;
    IF v_req.id IS NULL THEN
      v_num := 'DSP-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
      INSERT INTO public.logistics_dispatch_requests (
        request_number, request_kind, order_id, leg_id, customer_id,
        origin_label, origin_lat, origin_lng, destination_label, destination_lat, destination_lng,
        pickup_window_start, pickup_window_end, vehicle_class,
        required_payload_kg, required_volume_cbm, priority, created_by)
      SELECT v_num, 'AD_HOC', v_leg.order_id, _next_leg_id,
             COALESCE((SELECT o.customer_id FROM public.delivery_orders o WHERE o.id = v_leg.order_id), auth.uid()),
             COALESCE(v_leg.origin_label, v_hub.name), COALESCE(v_leg.origin_lat, v_hub.lat),
             COALESCE(v_leg.origin_lng, v_hub.lng),
             v_leg.destination_label, v_leg.destination_lat, v_leg.destination_lng,
             COALESCE(v_leg.planned_departure, now()), v_leg.planned_arrival,
             COALESCE(v_leg.required_vehicle_type, 'TRUCK_7T'),
             GREATEST(v_weight, 1), v_volume, 4, auth.uid()
      RETURNING * INTO v_req;

      INSERT INTO public.logistics_dispatch_events (
        dispatch_request_id, event_type, new_status, actor_id, actor_role, reason, metadata)
      VALUES (v_req.id, 'DISPATCH_REQUESTED', 'REQUESTED', auth.uid(), 'hub_operator',
        'Hub outbound connection', jsonb_build_object('hub_id', _hub_id, 'manifest_id', v_man.id));
    END IF;
    v_match := public.logistics_dispatch_match(v_req.id, true);
    SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = v_req.id;
    v_dispatch := jsonb_build_object('match', v_match);
  END IF;

  UPDATE public.freight_outbound_manifests SET
    dispatch_request_id = v_req.id, vehicle_id = v_req.assigned_vehicle_id,
    driver_id = v_req.assigned_driver_id,
    status = CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'VERIFYING' ELSE 'DRAFT' END
  WHERE id = v_man.id RETURNING * INTO v_man;

  IF v_req.assigned_vehicle_id IS NULL THEN
    PERFORM public.freight_hub_exception_raise(_hub_id, 'NO_OUTBOUND_CAPACITY', 'P1',
      format('No compliant outbound capacity matched for manifest %s.', v_man.manifest_number),
      NULL, NULL, _next_leg_id, v_man.id, COALESCE(v_dispatch, '{}'::jsonb));
  ELSE
    UPDATE public.logistics_order_legs SET
      status = CASE WHEN status IN ('PLANNED','AWAITING_CAPACITY') THEN 'ASSIGNED' ELSE status END,
      vehicle_id = v_req.assigned_vehicle_id, driver_id = v_req.assigned_driver_id,
      updated_at = now()
    WHERE id = _next_leg_id;
  END IF;

  RETURN jsonb_build_object('error', false,
    'code', CASE WHEN v_req.assigned_vehicle_id IS NOT NULL THEN 'MANIFEST_READY' ELSE 'AWAITING_CAPACITY' END,
    'manifest_id', v_man.id, 'manifest_number', v_man.manifest_number,
    'planned_units', v_units, 'planned_weight_kg', v_weight, 'planned_volume_cbm', v_volume,
    'dispatch_request_id', v_req.id, 'request_number', v_req.request_number,
    'vehicle_id', v_req.assigned_vehicle_id, 'driver_id', v_req.assigned_driver_id,
    'capacity_source', CASE WHEN _route_instance_id IS NOT NULL THEN 'REPEAT_ROUTE' ELSE 'AD_HOC_MATCH' END,
    'dispatch', v_dispatch);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_outbound_prepare(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_outbound_prepare(uuid, uuid, uuid) TO authenticated, service_role;

-- ========================================================= LOAD VERIFICATION
CREATE OR REPLACE FUNCTION public.freight_hub_load_verify(
  _manifest_id uuid, _loaded_unit_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_man public.freight_outbound_manifests;
  v_missing text[] := '{}';
  v_unexpected text[] := '{}';
  v_loaded integer := 0;
  v_weight numeric := 0;
  v_cap numeric;
  r record;
  v_scan uuid;
  v_mismatch boolean := false;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_man FROM public.freight_outbound_manifests WHERE id = _manifest_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'MANIFEST_NOT_FOUND'); END IF;
  IF v_man.status = 'DEPARTED' THEN
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_DEPARTED', 'idempotent', true);
  END IF;

  -- unexpected units presented at the dock
  FOR r IN SELECT u.* FROM public.freight_handling_units u
            WHERE u.id = ANY (COALESCE(_loaded_unit_ids,'{}'))
              AND NOT EXISTS (SELECT 1 FROM public.freight_outbound_manifest_lines l
                               WHERE l.manifest_id = _manifest_id AND l.handling_unit_id = u.id) LOOP
    v_unexpected := v_unexpected || r.hu_code;
    PERFORM public.freight_hub_exception_raise(v_man.hub_id, 'UNEXPECTED_CARGO', 'P1',
      format('Handling unit %s presented for loading but not on manifest %s.', r.hu_code, v_man.manifest_number),
      r.id, r.consignment_id, v_man.next_leg_id, _manifest_id);
    v_mismatch := true;
  END LOOP;

  FOR r IN SELECT l.id AS line_id, u.* FROM public.freight_outbound_manifest_lines l
            JOIN public.freight_handling_units u ON u.id = l.handling_unit_id
           WHERE l.manifest_id = _manifest_id FOR UPDATE OF u LOOP
    IF r.id = ANY (COALESCE(_loaded_unit_ids,'{}')) THEN
      INSERT INTO public.freight_hub_scans (
        scan_type, hub_id, handling_unit_id, consignment_id, order_id, leg_id,
        dispatch_request_id, vehicle_id, driver_id, actor_id, metadata)
      VALUES ('LOAD_SCAN', v_man.hub_id, r.id, r.consignment_id, r.order_id, v_man.next_leg_id,
        v_man.dispatch_request_id, v_man.vehicle_id, v_man.driver_id, auth.uid(),
        jsonb_build_object('manifest_id', _manifest_id))
      RETURNING id INTO v_scan;

      UPDATE public.freight_outbound_manifest_lines SET loaded = true, load_scan_id = v_scan, discrepancy = NULL
       WHERE id = r.line_id;
      UPDATE public.freight_handling_units SET status = 'LOADED', loaded_at = now(), last_scan_at = now()
       WHERE id = r.id;
      UPDATE public.freight_hub_allocations SET status = 'LOADED'
       WHERE handling_unit_id = r.id AND manifest_id = _manifest_id;
      v_loaded := v_loaded + 1;
      v_weight := v_weight + COALESCE(r.weight_kg, 0);
    ELSE
      v_missing := v_missing || r.hu_code;
      UPDATE public.freight_outbound_manifest_lines SET loaded = false, discrepancy = 'NOT_LOADED'
       WHERE id = r.line_id;
      PERFORM public.freight_hub_exception_raise(v_man.hub_id, 'MISSING_CARGO', 'P0',
        format('Manifested unit %s was not loaded onto the outbound truck.', r.hu_code),
        r.id, r.consignment_id, v_man.next_leg_id, _manifest_id);
      v_mismatch := true;
    END IF;
  END LOOP;

  IF v_man.vehicle_id IS NOT NULL THEN
    SELECT payload_capacity_kg INTO v_cap FROM public.logistics_fleet_capacity
     WHERE vehicle_id = v_man.vehicle_id;
    IF COALESCE(v_cap, 0) > 0 AND v_weight > v_cap THEN
      PERFORM public.freight_hub_exception_raise(v_man.hub_id, 'HUB_CAPACITY_EXCEEDED', 'P0',
        format('Loaded weight %s kg exceeds vehicle capacity %s kg.', v_weight, v_cap),
        NULL, NULL, v_man.next_leg_id, _manifest_id,
        jsonb_build_object('loaded_kg', v_weight, 'vehicle_capacity_kg', v_cap));
      v_mismatch := true;
    END IF;
  END IF;

  UPDATE public.freight_outbound_manifests SET
    actual_units = v_loaded, actual_weight_kg = v_weight,
    status = CASE WHEN v_mismatch THEN 'LOAD_MISMATCH' ELSE 'VERIFIED' END,
    verified_at = now(), verified_by = auth.uid(),
    mismatch_detail = CASE WHEN v_mismatch THEN jsonb_build_object(
      'missing', to_jsonb(v_missing), 'unexpected', to_jsonb(v_unexpected)) ELSE NULL END
  WHERE id = _manifest_id;

  RETURN jsonb_build_object('error', false,
    'code', CASE WHEN v_mismatch THEN 'LOAD_MISMATCH' ELSE 'LOAD_VERIFIED' END,
    'manifest_number', v_man.manifest_number,
    'planned_units', v_man.planned_units, 'loaded_units', v_loaded,
    'loaded_weight_kg', v_weight,
    'missing', to_jsonb(v_missing), 'unexpected', to_jsonb(v_unexpected));
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_load_verify(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_load_verify(uuid, uuid[]) TO authenticated, service_role;

-- ================================================================ DEPARTURE
CREATE OR REPLACE FUNCTION public.freight_hub_depart(_manifest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_man public.freight_outbound_manifests;
  v_units integer := 0;
  r record;
  v_scan uuid;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_man FROM public.freight_outbound_manifests WHERE id = _manifest_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'MANIFEST_NOT_FOUND'); END IF;
  IF v_man.status = 'DEPARTED' THEN
    RETURN jsonb_build_object('error', false, 'code', 'ALREADY_DEPARTED', 'idempotent', true,
      'manifest_number', v_man.manifest_number);
  END IF;
  IF v_man.status <> 'VERIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code', 'LOAD_NOT_VERIFIED', 'status', v_man.status,
      'detail', 'A truck may not depart on an unverified or mismatched manifest.');
  END IF;
  IF v_man.vehicle_id IS NULL OR v_man.driver_id IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_ASSIGNED_CAPACITY');
  END IF;

  FOR r IN SELECT u.* FROM public.freight_outbound_manifest_lines l
            JOIN public.freight_handling_units u ON u.id = l.handling_unit_id
           WHERE l.manifest_id = _manifest_id AND l.loaded FOR UPDATE OF u LOOP
    INSERT INTO public.freight_hub_scans (
      scan_type, hub_id, handling_unit_id, consignment_id, order_id, leg_id,
      dispatch_request_id, vehicle_id, driver_id, actor_id, metadata)
    VALUES ('DEPARTURE_SCAN', v_man.hub_id, r.id, r.consignment_id, r.order_id, v_man.next_leg_id,
      v_man.dispatch_request_id, v_man.vehicle_id, v_man.driver_id, auth.uid(),
      jsonb_build_object('manifest_id', _manifest_id))
    RETURNING id INTO v_scan;

    UPDATE public.freight_handling_units SET
      status = 'IN_TRANSIT',
      custody_holder_type = 'DRIVER', custody_holder_id = v_man.driver_id, custody_since = now(),
      current_hub_id = NULL, current_leg_id = v_man.next_leg_id, next_leg_id = NULL,
      staging_zone_id = NULL, staging_location_id = NULL,
      departed_hub_at = now(), last_scan_at = now()
    WHERE id = r.id;

    INSERT INTO public.freight_custody_transfers (
      handling_unit_id, consignment_id, transfer_type, from_holder_type, from_holder_id,
      to_holder_type, to_holder_id, hub_id, leg_id, scan_id, actor_id, evidence_ref)
    VALUES (r.id, r.consignment_id, 'HUB_RELEASE', 'HUB', v_man.hub_id,
      'DRIVER', v_man.driver_id, v_man.hub_id, v_man.next_leg_id, v_scan, auth.uid(),
      v_man.manifest_number);

    UPDATE public.freight_hub_allocations SET status = 'DEPARTED'
     WHERE handling_unit_id = r.id AND manifest_id = _manifest_id;
    v_units := v_units + 1;
  END LOOP;

  UPDATE public.freight_outbound_manifests SET status = 'DEPARTED', departed_at = now()
   WHERE id = _manifest_id;

  UPDATE public.logistics_order_legs SET
    status = 'IN_TRANSIT', actual_departure = COALESCE(actual_departure, now()), updated_at = now()
  WHERE id = v_man.next_leg_id;

  UPDATE public.logistics_hubs
     SET current_capacity = GREATEST(COALESCE(current_capacity,0) - v_units, 0), updated_at = now()
   WHERE id = v_man.hub_id;

  RETURN jsonb_build_object('error', false, 'code', 'DEPARTED',
    'manifest_number', v_man.manifest_number, 'units_departed', v_units,
    'leg_id', v_man.next_leg_id, 'leg_status', 'IN_TRANSIT',
    'vehicle_id', v_man.vehicle_id, 'driver_id', v_man.driver_id);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_depart(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_depart(uuid) TO authenticated, service_role;

-- ==================================================== MISSED CONNECTION RPC
CREATE OR REPLACE FUNCTION public.freight_hub_rebook_connection(
  _next_leg_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.logistics_order_legs;
  v_hub uuid;
  v_res jsonb;
BEGIN
  IF NOT public.logistics_hub_authorised('operate') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = _next_leg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'LEG_NOT_FOUND'); END IF;
  v_hub := v_leg.origin_hub_id;

  PERFORM public.freight_hub_exception_raise(v_hub, 'MISSED_CONNECTION', 'P1',
    COALESCE(_reason, 'Outbound connection missed; searching alternative capacity.'),
    NULL, NULL, _next_leg_id);

  UPDATE public.freight_outbound_manifests SET status = 'CANCELLED'
   WHERE next_leg_id = _next_leg_id AND status IN ('DRAFT','VERIFYING','LOAD_MISMATCH');
  UPDATE public.freight_hub_allocations SET status = 'ALLOCATED', manifest_id = NULL
   WHERE next_leg_id = _next_leg_id AND status = 'MANIFESTED';
  UPDATE public.logistics_dispatch_requests SET status = 'CANCELLED', updated_at = now()
   WHERE leg_id = _next_leg_id AND status NOT IN ('CANCELLED','COMPLETED');
  UPDATE public.logistics_order_legs SET status = 'AWAITING_CAPACITY', vehicle_id = NULL,
         driver_id = NULL, updated_at = now()
   WHERE id = _next_leg_id;

  v_res := public.freight_hub_outbound_prepare(v_hub, _next_leg_id, NULL);
  RETURN jsonb_build_object('error', false, 'code', 'REBOOKED', 'result', v_res);
END $$;
REVOKE ALL ON FUNCTION public.freight_hub_rebook_connection(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.freight_hub_rebook_connection(uuid, text) TO authenticated, service_role;

-- ==================================================================== VIEWS
CREATE OR REPLACE VIEW public.v_freight_hub_board
WITH (security_invoker = true) AS
SELECT h.id AS hub_id, h.code, h.name, h.hub_type, h.status, h.region, h.city,
       h.max_capacity, h.current_capacity, h.dock_count,
       (SELECT count(*) FROM public.freight_handling_units u
         WHERE u.current_hub_id = h.id AND u.status IN ('RECEIVED','SORTED','STAGED','LOADED')) AS cargo_on_site,
       (SELECT count(*) FROM public.freight_handling_units u
         WHERE u.current_hub_id = h.id AND u.status = 'RECEIVED') AS awaiting_sort,
       (SELECT count(*) FROM public.freight_handling_units u
         WHERE u.current_hub_id = h.id AND u.status IN ('SORTED','STAGED')) AS awaiting_outbound,
       (SELECT count(*) FROM public.freight_hub_receipts r
         WHERE r.hub_id = h.id AND r.received_at >= date_trunc('day', now())) AS inbound_today,
       (SELECT count(*) FROM public.freight_outbound_manifests m
         WHERE m.hub_id = h.id AND m.departed_at >= date_trunc('day', now())) AS outbound_today,
       (SELECT count(*) FROM public.freight_hub_exceptions e
         WHERE e.hub_id = h.id AND e.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')) AS open_exceptions,
       (SELECT count(*) FROM public.freight_hub_exceptions e
         WHERE e.hub_id = h.id AND e.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
           AND e.severity IN ('P0','P1')) AS critical_exceptions
  FROM public.logistics_hubs h;
GRANT SELECT ON public.v_freight_hub_board TO authenticated;

CREATE OR REPLACE VIEW public.v_freight_hub_dwell
WITH (security_invoker = true) AS
SELECT u.id AS handling_unit_id, u.hu_code, u.consignment_id, c.consignment_number,
       u.current_hub_id, h.code AS hub_code, u.status,
       u.arrived_at_hub_at, u.received_at, u.sorted_at, u.staged_at, u.loaded_at, u.departed_hub_at,
       EXTRACT(EPOCH FROM (COALESCE(u.departed_hub_at, now()) - u.arrived_at_hub_at))/60 AS dwell_minutes,
       COALESCE(s.max_dwell_minutes, n.max_dwell_minutes) AS max_dwell_minutes,
       (EXTRACT(EPOCH FROM (COALESCE(u.departed_hub_at, now()) - u.arrived_at_hub_at))/60
         > COALESCE(s.max_dwell_minutes, n.max_dwell_minutes)) AS dwell_sla_breached
  FROM public.freight_handling_units u
  JOIN public.freight_consignments c ON c.id = u.consignment_id
  LEFT JOIN public.logistics_hubs h ON h.id = u.current_hub_id
  LEFT JOIN public.freight_hub_sla_config s ON s.hub_id = u.current_hub_id
  LEFT JOIN public.freight_hub_sla_config n ON n.hub_id IS NULL
 WHERE u.arrived_at_hub_at IS NOT NULL;
GRANT SELECT ON public.v_freight_hub_dwell TO authenticated;

CREATE OR REPLACE VIEW public.v_freight_hub_custody
WITH (security_invoker = true) AS
SELECT u.id AS handling_unit_id, u.hu_code, u.consignment_id, c.consignment_number, c.order_id,
       u.status, u.custody_holder_type, u.custody_holder_id, u.custody_since,
       u.current_hub_id, u.current_leg_id, u.next_leg_id,
       (SELECT jsonb_agg(jsonb_build_object('at', t.occurred_at, 'type', t.transfer_type,
                'from', t.from_holder_type, 'to', t.to_holder_type) ORDER BY t.occurred_at)
          FROM public.freight_custody_transfers t WHERE t.handling_unit_id = u.id) AS custody_trail
  FROM public.freight_handling_units u
  JOIN public.freight_consignments c ON c.id = u.consignment_id;
GRANT SELECT ON public.v_freight_hub_custody TO authenticated;