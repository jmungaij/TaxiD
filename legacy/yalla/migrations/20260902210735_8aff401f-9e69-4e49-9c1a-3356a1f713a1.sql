-- =====================================================================
-- Stage 1 — Freight order spine (consignments, items, legs, leg events)
-- Extends the existing delivery_orders aggregate. No parallel order store.
-- =====================================================================

CREATE TABLE public.freight_consignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  consignment_number text NOT NULL UNIQUE,
  service_level text NOT NULL DEFAULT 'STANDARD',
  cargo_type text NOT NULL,
  commodity text,
  package_type text,
  pieces integer NOT NULL DEFAULT 1,
  gross_weight_kg numeric(12,3) NOT NULL,
  volume_cbm numeric(12,4),
  chargeable_weight_kg numeric(12,3),
  declared_value numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  fragile boolean NOT NULL DEFAULT false,
  hazardous boolean NOT NULL DEFAULT false,
  hazard_class text,
  temp_min_c numeric(5,2),
  temp_max_c numeric(5,2),
  loading_requirements text[] NOT NULL DEFAULT '{}',
  special_handling text[] NOT NULL DEFAULT '{}',
  shipper_name text,
  shipper_phone text,
  consignee_name text,
  consignee_phone text,
  origin_hub_id uuid REFERENCES public.logistics_hubs(id),
  destination_hub_id uuid REFERENCES public.logistics_hubs(id),
  delivery_address text,
  delivery_lat numeric(10,6),
  delivery_lng numeric(10,6),
  delivery_window_start timestamptz,
  delivery_window_end timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT freight_consignments_pieces_positive CHECK (pieces > 0),
  CONSTRAINT freight_consignments_weight_positive CHECK (gross_weight_kg > 0),
  CONSTRAINT freight_consignments_volume_nonneg CHECK (volume_cbm IS NULL OR volume_cbm >= 0),
  CONSTRAINT freight_consignments_hazard_declared CHECK (NOT hazardous OR hazard_class IS NOT NULL),
  CONSTRAINT freight_consignments_temp_range CHECK (temp_min_c IS NULL OR temp_max_c IS NULL OR temp_min_c <= temp_max_c),
  CONSTRAINT freight_consignments_cargo_type CHECK (cargo_type IN ('GENERAL','PALLETISED','CONTAINERISED','BULK','REFRIGERATED','FRAGILE','HAZARDOUS','OVERSIZED','DOCUMENTS'))
);

GRANT SELECT, INSERT, UPDATE ON public.freight_consignments TO authenticated;
GRANT ALL ON public.freight_consignments TO service_role;
ALTER TABLE public.freight_consignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY freight_consignments_read ON public.freight_consignments
FOR SELECT TO authenticated
USING (
  public.has_staff_permission('staff.logistics.read')
  OR EXISTS (SELECT 1 FROM public.delivery_orders o WHERE o.id = order_id AND o.customer_id = auth.uid())
);
CREATE POLICY freight_consignments_staff_write ON public.freight_consignments
FOR INSERT TO authenticated
WITH CHECK (public.has_staff_permission('staff.logistics.manage'));
CREATE POLICY freight_consignments_staff_update ON public.freight_consignments
FOR UPDATE TO authenticated
USING (public.has_staff_permission('staff.logistics.manage'))
WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE INDEX freight_consignments_order_idx ON public.freight_consignments(order_id);
CREATE TRIGGER freight_consignments_touch BEFORE UPDATE ON public.freight_consignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
CREATE TABLE public.freight_consignment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id uuid NOT NULL REFERENCES public.freight_consignments(id) ON DELETE CASCADE,
  item_no integer NOT NULL,
  description text NOT NULL,
  handling_unit text NOT NULL DEFAULT 'CARTON',
  quantity integer NOT NULL DEFAULT 1,
  unit_weight_kg numeric(12,3),
  length_cm numeric(10,2),
  width_cm numeric(10,2),
  height_cm numeric(10,2),
  volume_cbm numeric(12,4),
  declared_value numeric(14,2),
  hazardous boolean NOT NULL DEFAULT false,
  temperature_controlled boolean NOT NULL DEFAULT false,
  marks_and_numbers text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consignment_id, item_no),
  CONSTRAINT freight_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT freight_items_weight_positive CHECK (unit_weight_kg IS NULL OR unit_weight_kg > 0),
  CONSTRAINT freight_items_handling_unit CHECK (handling_unit IN ('CARTON','PALLET','CRATE','DRUM','SACK','BUNDLE','CONTAINER','LOOSE','ENVELOPE'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.freight_consignment_items TO authenticated;
GRANT ALL ON public.freight_consignment_items TO service_role;
ALTER TABLE public.freight_consignment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY freight_items_read ON public.freight_consignment_items
FOR SELECT TO authenticated
USING (
  public.has_staff_permission('staff.logistics.read')
  OR EXISTS (
    SELECT 1 FROM public.freight_consignments c
    JOIN public.delivery_orders o ON o.id = c.order_id
    WHERE c.id = consignment_id AND o.customer_id = auth.uid()
  )
);
CREATE POLICY freight_items_staff_write ON public.freight_consignment_items
FOR ALL TO authenticated
USING (public.has_staff_permission('staff.logistics.manage'))
WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE INDEX freight_items_consignment_idx ON public.freight_consignment_items(consignment_id);
CREATE TRIGGER freight_items_touch BEFORE UPDATE ON public.freight_consignment_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Multi-leg movement model
-- ---------------------------------------------------------------------
CREATE TABLE public.logistics_order_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  leg_no integer NOT NULL,
  leg_type text NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED',
  origin_kind text NOT NULL DEFAULT 'ADDRESS',
  origin_hub_id uuid REFERENCES public.logistics_hubs(id),
  origin_label text NOT NULL,
  origin_lat numeric(10,6),
  origin_lng numeric(10,6),
  destination_kind text NOT NULL DEFAULT 'ADDRESS',
  destination_hub_id uuid REFERENCES public.logistics_hubs(id),
  destination_label text NOT NULL,
  destination_lat numeric(10,6),
  destination_lng numeric(10,6),
  route_id uuid REFERENCES public.logistics_routes(id),
  vehicle_id uuid,
  driver_id uuid,
  planned_departure timestamptz,
  planned_arrival timestamptz,
  actual_departure timestamptz,
  actual_arrival timestamptz,
  eta timestamptz,
  planned_distance_km numeric(10,2),
  actual_distance_km numeric(10,2),
  exception_open boolean NOT NULL DEFAULT false,
  correlation_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, leg_no),
  CONSTRAINT legs_leg_no_positive CHECK (leg_no > 0),
  CONSTRAINT legs_leg_type CHECK (leg_type IN ('FIRST_MILE','LINE_HAUL','CROSS_DOCK','FINAL_MILE','RETURN')),
  CONSTRAINT legs_status CHECK (status IN (
    'PLANNED','AWAITING_CAPACITY','ASSIGNED','ACCEPTED','EN_ROUTE_TO_PICKUP','AT_PICKUP','LOADING','LOADED',
    'DEPARTED','IN_TRANSIT','ARRIVED','UNLOADING','COMPLETED','CANCELLED','FAILED'
  )),
  CONSTRAINT legs_origin_kind CHECK (origin_kind IN ('ADDRESS','HUB')),
  CONSTRAINT legs_destination_kind CHECK (destination_kind IN ('ADDRESS','HUB')),
  CONSTRAINT legs_origin_hub_present CHECK (origin_kind <> 'HUB' OR origin_hub_id IS NOT NULL),
  CONSTRAINT legs_destination_hub_present CHECK (destination_kind <> 'HUB' OR destination_hub_id IS NOT NULL),
  CONSTRAINT legs_timing_order CHECK (actual_arrival IS NULL OR actual_departure IS NULL OR actual_arrival >= actual_departure)
);

GRANT SELECT, INSERT, UPDATE ON public.logistics_order_legs TO authenticated;
GRANT ALL ON public.logistics_order_legs TO service_role;
ALTER TABLE public.logistics_order_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY legs_read ON public.logistics_order_legs
FOR SELECT TO authenticated
USING (
  public.has_staff_permission('staff.logistics.read')
  OR driver_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.delivery_orders o WHERE o.id = order_id AND o.customer_id = auth.uid())
);
CREATE POLICY legs_staff_insert ON public.logistics_order_legs
FOR INSERT TO authenticated
WITH CHECK (public.has_staff_permission('staff.logistics.manage'));
CREATE POLICY legs_staff_update ON public.logistics_order_legs
FOR UPDATE TO authenticated
USING (public.has_staff_permission('staff.logistics.manage'))
WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE INDEX legs_order_idx ON public.logistics_order_legs(order_id, leg_no);
CREATE INDEX legs_status_idx ON public.logistics_order_legs(status);
CREATE INDEX legs_driver_idx ON public.logistics_order_legs(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX legs_dest_hub_idx ON public.logistics_order_legs(destination_hub_id) WHERE destination_hub_id IS NOT NULL;
CREATE TRIGGER legs_touch BEFORE UPDATE ON public.logistics_order_legs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Controlled leg state machine
-- ---------------------------------------------------------------------
CREATE TABLE public.logistics_leg_transitions (
  from_status text NOT NULL,
  to_status text NOT NULL,
  event_name text NOT NULL,
  requires_reason boolean NOT NULL DEFAULT false,
  PRIMARY KEY (from_status, to_status)
);

GRANT SELECT ON public.logistics_leg_transitions TO authenticated;
GRANT ALL ON public.logistics_leg_transitions TO service_role;
ALTER TABLE public.logistics_leg_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY leg_transitions_read ON public.logistics_leg_transitions
FOR SELECT TO authenticated USING (true);

INSERT INTO public.logistics_leg_transitions (from_status, to_status, event_name, requires_reason) VALUES
  ('PLANNED','AWAITING_CAPACITY','LEG_AWAITING_CAPACITY', false),
  ('PLANNED','ASSIGNED','LEG_ASSIGNED', false),
  ('AWAITING_CAPACITY','ASSIGNED','LEG_ASSIGNED', false),
  ('ASSIGNED','ACCEPTED','LEG_ACCEPTED', false),
  ('ASSIGNED','PLANNED','LEG_UNASSIGNED', true),
  ('ACCEPTED','EN_ROUTE_TO_PICKUP','LEG_EN_ROUTE_TO_PICKUP', false),
  ('ACCEPTED','PLANNED','LEG_UNASSIGNED', true),
  ('EN_ROUTE_TO_PICKUP','AT_PICKUP','LEG_ARRIVED_PICKUP', false),
  ('AT_PICKUP','LOADING','LEG_LOADING', false),
  ('LOADING','LOADED','LEG_LOADED', false),
  ('LOADED','DEPARTED','LEG_DEPARTED', false),
  ('DEPARTED','IN_TRANSIT','LEG_IN_TRANSIT', false),
  ('IN_TRANSIT','ARRIVED','LEG_ARRIVED', false),
  ('ARRIVED','UNLOADING','LEG_UNLOADING', false),
  ('UNLOADING','COMPLETED','LEG_COMPLETED', false),
  ('ARRIVED','COMPLETED','LEG_COMPLETED', false),
  ('PLANNED','CANCELLED','LEG_CANCELLED', true),
  ('AWAITING_CAPACITY','CANCELLED','LEG_CANCELLED', true),
  ('ASSIGNED','CANCELLED','LEG_CANCELLED', true),
  ('ACCEPTED','CANCELLED','LEG_CANCELLED', true),
  ('EN_ROUTE_TO_PICKUP','FAILED','LEG_FAILED', true),
  ('AT_PICKUP','FAILED','LEG_FAILED', true),
  ('LOADING','FAILED','LEG_FAILED', true),
  ('IN_TRANSIT','FAILED','LEG_FAILED', true),
  ('DEPARTED','FAILED','LEG_FAILED', true),
  ('ARRIVED','FAILED','LEG_FAILED', true),
  ('FAILED','ASSIGNED','LEG_RECOVERED', true),
  ('FAILED','PLANNED','LEG_REPLANNED', true);

-- ---------------------------------------------------------------------
-- Append-only leg event history
-- ---------------------------------------------------------------------
CREATE TABLE public.logistics_leg_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leg_id uuid NOT NULL REFERENCES public.logistics_order_legs(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_status text,
  new_status text,
  actor_id uuid,
  actor_role text,
  hub_id uuid REFERENCES public.logistics_hubs(id),
  lat numeric(10,6),
  lng numeric(10,6),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}',
  dedupe_key text UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logistics_leg_events TO authenticated;
GRANT ALL ON public.logistics_leg_events TO service_role;
ALTER TABLE public.logistics_leg_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY leg_events_read ON public.logistics_leg_events
FOR SELECT TO authenticated
USING (
  public.has_staff_permission('staff.logistics.read')
  OR EXISTS (SELECT 1 FROM public.delivery_orders o WHERE o.id = order_id AND o.customer_id = auth.uid())
);

CREATE INDEX leg_events_leg_idx ON public.logistics_leg_events(leg_id, occurred_at);
CREATE INDEX leg_events_order_idx ON public.logistics_leg_events(order_id, occurred_at);

CREATE OR REPLACE FUNCTION public._logistics_leg_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'logistics_leg_events is append-only';
END;
$$;
REVOKE ALL ON FUNCTION public._logistics_leg_events_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER leg_events_append_only
BEFORE UPDATE OR DELETE ON public.logistics_leg_events
FOR EACH ROW EXECUTE FUNCTION public._logistics_leg_events_append_only();

-- ---------------------------------------------------------------------
-- Derived custody position — never hand-set
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_logistics_order_custody
WITH (security_invoker = true)
AS
SELECT
  o.id AS order_id,
  o.order_number,
  o.status AS order_status,
  l.id AS active_leg_id,
  l.leg_no AS active_leg_no,
  l.leg_type AS active_leg_type,
  l.status AS active_leg_status,
  CASE
    WHEN o.status IN ('delivered','closed') THEN 'DELIVERED'
    WHEN l.id IS NULL THEN 'AT_ORIGIN'
    WHEN l.status IN ('PLANNED','AWAITING_CAPACITY','ASSIGNED','ACCEPTED','EN_ROUTE_TO_PICKUP')
      THEN CASE WHEN l.origin_kind = 'HUB' THEN 'AT_HUB' ELSE 'AT_ORIGIN' END
    WHEN l.status IN ('AT_PICKUP','LOADING')
      THEN CASE WHEN l.origin_kind = 'HUB' THEN 'IN_CROSS_DOCK' ELSE 'AT_ORIGIN' END
    WHEN l.status = 'LOADED' THEN 'LOADED'
    WHEN l.status IN ('DEPARTED','IN_TRANSIT') THEN 'IN_TRANSIT'
    WHEN l.status IN ('ARRIVED','UNLOADING')
      THEN CASE WHEN l.destination_kind = 'HUB' THEN 'AT_HUB' ELSE 'AT_DESTINATION' END
    WHEN l.status = 'COMPLETED'
      THEN CASE WHEN l.destination_kind = 'HUB' THEN 'STAGED' ELSE 'AT_DESTINATION' END
    ELSE 'AT_ORIGIN'
  END AS custody_position,
  COALESCE(l.destination_hub_id, l.origin_hub_id) AS custody_hub_id,
  l.driver_id AS custody_driver_id,
  l.eta,
  (SELECT count(*) FROM public.logistics_order_legs x WHERE x.order_id = o.id) AS total_legs,
  (SELECT count(*) FROM public.logistics_order_legs x WHERE x.order_id = o.id AND x.status = 'COMPLETED') AS completed_legs
FROM public.delivery_orders o
LEFT JOIN LATERAL (
  SELECT * FROM public.logistics_order_legs g
  WHERE g.order_id = o.id AND g.status NOT IN ('COMPLETED','CANCELLED')
  ORDER BY g.leg_no
  LIMIT 1
) l ON true;

GRANT SELECT ON public.v_logistics_order_custody TO authenticated;
GRANT SELECT ON public.v_logistics_order_custody TO service_role;