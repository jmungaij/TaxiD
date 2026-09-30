-- =========================================================
-- PHASE 6 — WAREHOUSE / FULFILMENT EXECUTION LAYER
-- Subordinate to the existing logistics spine:
--   packages, delivery_orders, logistics_manifests(+lines,+events),
--   logistics_hubs, package_chain_of_custody, logistics_routes(+versions,
--   +stops,+stop_packages), delivery_dispatch_jobs, logistics_exceptions,
--   logistics_returns, carrier capacity (Phase 5).
-- No parallel authority is introduced by any object below.
-- =========================================================

-- ---------- 1. ZONES (child of logistics_hubs) ----------
CREATE TABLE public.logistics_hub_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  zone_type text NOT NULL CHECK (zone_type = ANY (ARRAY['RECEIVING','SORTING','STAGING','STORAGE','PICKING','PACKING','DISPATCH','RETURNS','QUARANTINE','COLD_CHAIN'])),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status = ANY (ARRAY['ACTIVE','BLOCKED','MAINTENANCE','QUARANTINED'])),
  temperature_min_c numeric,
  temperature_max_c numeric,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, code)
);

-- ---------- 2. LOCATIONS (child of zone/hub) ----------
CREATE TABLE public.logistics_hub_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.logistics_hub_zones(id) ON DELETE SET NULL,
  code text NOT NULL,
  location_type text NOT NULL CHECK (location_type = ANY (ARRAY['ZONE','AISLE','RACK','SHELF','BIN','STAGING_POSITION','DOCK_FLOOR'])),
  aisle text, rack text, shelf text, bin text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status = ANY (ARRAY['ACTIVE','BLOCKED','FULL','MAINTENANCE','QUARANTINED'])),
  max_units integer,
  max_weight_kg numeric,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, code)
);
CREATE INDEX idx_wh_locations_hub_zone ON public.logistics_hub_locations(hub_id, zone_id, status);

-- ---------- 3. DOCKS ----------
CREATE TABLE public.logistics_hub_docks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  code text NOT NULL,
  dock_type text NOT NULL DEFAULT 'BOTH' CHECK (dock_type = ANY (ARRAY['INBOUND','OUTBOUND','BOTH'])),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status = ANY (ARRAY['AVAILABLE','OCCUPIED','BLOCKED','MAINTENANCE'])),
  max_vehicle_length_m numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, code)
);

-- ---------- 4. GATE EVENTS (append-only) ----------
CREATE TABLE public.logistics_gate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction = ANY (ARRAY['ARRIVAL','DEPARTURE'])),
  manifest_id uuid REFERENCES public.logistics_manifests(id) ON DELETE SET NULL,
  carrier_id uuid REFERENCES public.carrier_profiles(id) ON DELETE SET NULL,
  vehicle_id uuid,
  driver_id uuid,
  vehicle_registration text,
  dock_id uuid REFERENCES public.logistics_hub_docks(id) ON DELETE SET NULL,
  seal_id text,
  seal_intact boolean,
  expected_package_count integer,
  declared_package_count integer,
  operation_key text UNIQUE,
  actor_id uuid,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wh_gate_hub_time ON public.logistics_gate_events(hub_id, occurred_at DESC);

-- ---------- 5. RECEIVING SESSIONS (reconcile an arriving manifest) ----------
CREATE TABLE public.logistics_receiving_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE RESTRICT,
  manifest_id uuid REFERENCES public.logistics_manifests(id) ON DELETE RESTRICT,
  gate_event_id uuid REFERENCES public.logistics_gate_events(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status = ANY (ARRAY['OPEN','RECONCILED','CLOSED','ABANDONED'])),
  expected_count integer NOT NULL DEFAULT 0,
  received_count integer NOT NULL DEFAULT 0,
  damaged_count integer NOT NULL DEFAULT 0,
  variance_explained boolean NOT NULL DEFAULT false,
  variance_note text,
  operator_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_wh_open_session_per_manifest
  ON public.logistics_receiving_sessions(manifest_id)
  WHERE status = 'OPEN' AND manifest_id IS NOT NULL;

-- ---------- 6. WAREHOUSE OPERATION LEDGER (append-only, NOT a custody ledger) ----------
-- Each row records a physical action and REFERENCES the custody event that the
-- existing package_chain_of_custody authority produced for it.
CREATE TABLE public.logistics_wh_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE,
  operation_type text NOT NULL CHECK (operation_type = ANY (ARRAY[
    'GATE_ARRIVAL','GATE_DEPARTURE','RECEIVE','SCAN','SORT','STAGE','CROSS_DOCK',
    'PUT_AWAY','MOVE','PICK','PACK','LABEL','CONSOLIDATE','DECONSOLIDATE',
    'OUTBOUND_STAGE','DISPATCH','RETURN_RECEIVE','TEMPERATURE'])),
  hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE RESTRICT,
  package_id uuid REFERENCES public.packages(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  manifest_id uuid REFERENCES public.logistics_manifests(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.logistics_routes(id) ON DELETE SET NULL,
  stop_id uuid REFERENCES public.logistics_route_stops(id) ON DELETE SET NULL,
  dispatch_job_id uuid REFERENCES public.delivery_dispatch_jobs(id) ON DELETE SET NULL,
  return_id uuid,
  from_location_id uuid REFERENCES public.logistics_hub_locations(id) ON DELETE SET NULL,
  to_location_id uuid REFERENCES public.logistics_hub_locations(id) ON DELETE SET NULL,
  custody_event_id uuid REFERENCES public.package_chain_of_custody(id) ON DELETE SET NULL,
  from_stage text,
  to_stage text,
  quantity numeric,
  billable_code text,
  reason_code text,
  narrative text,
  device_id text,
  actor_id uuid,
  is_synthetic boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wh_ops_package ON public.logistics_wh_operations(package_id, occurred_at DESC);
CREATE INDEX idx_wh_ops_hub_type ON public.logistics_wh_operations(hub_id, operation_type, occurred_at DESC);
CREATE INDEX idx_wh_ops_manifest ON public.logistics_wh_operations(manifest_id);

-- ---------- 7. PACKAGE PLACEMENT (one physical location per package) ----------
CREATE TABLE public.logistics_package_placement (
  package_id uuid PRIMARY KEY REFERENCES public.packages(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.logistics_hub_locations(id) ON DELETE RESTRICT,
  inventory_state text NOT NULL DEFAULT 'on_hand' CHECK (inventory_state = ANY (ARRAY['on_hand','reserved','allocated','picked','packed','staged','dispatched','quarantined','hold'])),
  custody_holder text NOT NULL DEFAULT 'hub',
  merchant_owned boolean NOT NULL DEFAULT false,
  placed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wh_placement_location ON public.logistics_package_placement(location_id, inventory_state);

-- ---------- 8. PICK LISTS ----------
CREATE TABLE public.logistics_pick_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_number text NOT NULL UNIQUE,
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status = ANY (ARRAY['OPEN','IN_PROGRESS','COMPLETE','SHORT','CANCELLED'])),
  picker_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE TABLE public.logistics_pick_list_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id uuid NOT NULL REFERENCES public.logistics_pick_lists(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.logistics_hub_locations(id) ON DELETE SET NULL,
  quantity_expected numeric NOT NULL DEFAULT 1,
  quantity_picked numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status = ANY (ARRAY['PENDING','PICKED','SHORT','EXCEPTION','CANCELLED'])),
  reason_code text,
  narrative text,
  picked_by uuid,
  picked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pick_list_id, package_id)
);

-- ---------- 9. PACK UNITS (lineage to the authoritative package) ----------
CREATE TABLE public.logistics_pack_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE RESTRICT,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  source_package_id uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  station_code text,
  packer_id uuid,
  packaging_type text,
  weight_kg numeric,
  length_cm integer, width_cm integer, height_cm integer,
  label_reference text,
  label_kind text CHECK (label_kind IS NULL OR label_kind = ANY (ARRAY['SHIPPING','RETURN'])),
  notes text,
  packed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wh_pack_units_pkg ON public.logistics_pack_units(package_id);

-- ---------- 10. OFFLINE SCAN QUEUE ----------
CREATE TABLE public.logistics_wh_offline_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE,
  device_id text NOT NULL,
  actor_id uuid,
  hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE SET NULL,
  operation_type text NOT NULL,
  captured_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state = ANY (ARRAY['PENDING','APPLIED','DUPLICATE','CONFLICT','REJECTED'])),
  server_result jsonb,
  conflict_reason text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wh_offline_state ON public.logistics_wh_offline_queue(state, captured_at);

-- ---------- 11. TEMPERATURE READINGS ----------
CREATE TABLE public.logistics_temperature_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  zone_id uuid REFERENCES public.logistics_hub_zones(id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.packages(id) ON DELETE CASCADE,
  reading_c numeric NOT NULL,
  requirement_min_c numeric,
  requirement_max_c numeric,
  excursion boolean NOT NULL DEFAULT false,
  evidence jsonb,
  exception_id uuid REFERENCES public.logistics_exceptions(id) ON DELETE SET NULL,
  actor_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- APPEND-ONLY GUARDS ----------
CREATE OR REPLACE FUNCTION public._wh_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'append_only_table_%', TG_TABLE_NAME;
END; $$;

CREATE TRIGGER trg_wh_ops_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_wh_operations
  FOR EACH ROW EXECUTE FUNCTION public._wh_append_only();
CREATE TRIGGER trg_wh_gate_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_gate_events
  FOR EACH ROW EXECUTE FUNCTION public._wh_append_only();
CREATE TRIGGER trg_wh_pack_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_pack_units
  FOR EACH ROW EXECUTE FUNCTION public._wh_append_only();
CREATE TRIGGER trg_wh_temp_append_only
  BEFORE DELETE ON public.logistics_temperature_readings
  FOR EACH ROW EXECUTE FUNCTION public._wh_append_only();

CREATE OR REPLACE FUNCTION public._wh_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_wh_zones_touch BEFORE UPDATE ON public.logistics_hub_zones
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_locations_touch BEFORE UPDATE ON public.logistics_hub_locations
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_docks_touch BEFORE UPDATE ON public.logistics_hub_docks
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_sessions_touch BEFORE UPDATE ON public.logistics_receiving_sessions
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_placement_touch BEFORE UPDATE ON public.logistics_package_placement
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_picklist_touch BEFORE UPDATE ON public.logistics_pick_lists
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_picklines_touch BEFORE UPDATE ON public.logistics_pick_list_lines
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();
CREATE TRIGGER trg_wh_offline_touch BEFORE UPDATE ON public.logistics_wh_offline_queue
  FOR EACH ROW EXECUTE FUNCTION public._wh_touch();

-- ---------- GRANTS (read-only for staff; all writes via SECURITY DEFINER RPCs) ----------
GRANT SELECT ON public.logistics_hub_zones TO authenticated;
GRANT SELECT ON public.logistics_hub_locations TO authenticated;
GRANT SELECT ON public.logistics_hub_docks TO authenticated;
GRANT SELECT ON public.logistics_gate_events TO authenticated;
GRANT SELECT ON public.logistics_receiving_sessions TO authenticated;
GRANT SELECT ON public.logistics_wh_operations TO authenticated;
GRANT SELECT ON public.logistics_package_placement TO authenticated;
GRANT SELECT ON public.logistics_pick_lists TO authenticated;
GRANT SELECT ON public.logistics_pick_list_lines TO authenticated;
GRANT SELECT ON public.logistics_pack_units TO authenticated;
GRANT SELECT ON public.logistics_wh_offline_queue TO authenticated;
GRANT SELECT ON public.logistics_temperature_readings TO authenticated;

GRANT ALL ON public.logistics_hub_zones TO service_role;
GRANT ALL ON public.logistics_hub_locations TO service_role;
GRANT ALL ON public.logistics_hub_docks TO service_role;
GRANT ALL ON public.logistics_gate_events TO service_role;
GRANT ALL ON public.logistics_receiving_sessions TO service_role;
GRANT ALL ON public.logistics_wh_operations TO service_role;
GRANT ALL ON public.logistics_package_placement TO service_role;
GRANT ALL ON public.logistics_pick_lists TO service_role;
GRANT ALL ON public.logistics_pick_list_lines TO service_role;
GRANT ALL ON public.logistics_pack_units TO service_role;
GRANT ALL ON public.logistics_wh_offline_queue TO service_role;
GRANT ALL ON public.logistics_temperature_readings TO service_role;

-- ---------- RLS ----------
ALTER TABLE public.logistics_hub_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_hub_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_hub_docks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_gate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_receiving_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_wh_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_package_placement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_pick_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_pick_list_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_pack_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_wh_offline_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_temperature_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wh_zones_staff_read" ON public.logistics_hub_zones FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_locations_staff_read" ON public.logistics_hub_locations FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_docks_staff_read" ON public.logistics_hub_docks FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_gate_staff_read" ON public.logistics_gate_events FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_sessions_staff_read" ON public.logistics_receiving_sessions FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_ops_staff_read" ON public.logistics_wh_operations FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_placement_staff_read" ON public.logistics_package_placement FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_picklists_staff_read" ON public.logistics_pick_lists FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_picklines_staff_read" ON public.logistics_pick_list_lines FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_packunits_staff_read" ON public.logistics_pack_units FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_offline_staff_read" ON public.logistics_wh_offline_queue FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));
CREATE POLICY "wh_temp_staff_read" ON public.logistics_temperature_readings FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

-- ---------- EVENT CATALOGUE (existing Phase 4 stream, new event types) ----------
INSERT INTO public.logistics_event_catalogue
  (event_type, aggregate_type, event_version, schema_version, description, payload_keys, ordinal, publishable)
VALUES
  ('package.received','package','1','1','Package physically received at a hub against a manifest',ARRAY['package_id','hub_id','manifest_id','custody_event_id'],200,true),
  ('package.sorted','package','1','1','Package sorted to an outbound destination',ARRAY['package_id','hub_id','destination_hub_id','route_id','stop_id'],201,true),
  ('package.staged','package','1','1','Package staged for outbound movement',ARRAY['package_id','hub_id','location_id','manifest_id'],202,true),
  ('package.cross_docked','package','1','1','Package consolidated onto an outbound manifest without storage',ARRAY['package_id','hub_id','manifest_id'],203,true),
  ('package.put_away','package','1','1','Package put away into a storage location',ARRAY['package_id','hub_id','location_id'],204,false),
  ('package.picked','package','1','1','Package picked from a storage location',ARRAY['package_id','hub_id','location_id','pick_list_id'],205,false),
  ('package.packed','package','1','1','Package packed at a packing station',ARRAY['package_id','hub_id','pack_unit_id','weight_kg'],206,true),
  ('package.outbound_staged','package','1','1','Package staged against an outbound route/stop',ARRAY['package_id','hub_id','route_id','stop_id'],207,true),
  ('package.dispatched','package','1','1','Package dispatched from the hub on a manifest',ARRAY['package_id','hub_id','manifest_id','route_id','driver_id','vehicle_id'],208,true)
ON CONFLICT (event_type) DO NOTHING;