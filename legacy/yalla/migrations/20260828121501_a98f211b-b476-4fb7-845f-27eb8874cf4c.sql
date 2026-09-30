-- =====================================================================
-- PHASE 5A — CARRIER MASTER, CAPABILITY, COMPLIANCE, CAPACITY, DEMAND
-- Integrates with existing partners / vehicles / drivers. No new registry.
-- =====================================================================

CREATE TYPE public.carrier_operating_status AS ENUM
  ('ONBOARDING','ACTIVE','SUSPENDED','OFFBOARDED');
CREATE TYPE public.carrier_contract_status AS ENUM
  ('NONE','DRAFT','SIGNED','EXPIRED','TERMINATED');
CREATE TYPE public.carrier_compliance_state AS ENUM
  ('MISSING','PENDING_REVIEW','VERIFIED','EXPIRED','REJECTED','LEGAL_REVIEW_REQUIRED');
CREATE TYPE public.capacity_availability_state AS ENUM
  ('CONFIGURED','AVAILABLE','SUSPENDED','EXPIRED','CANCELLED');
CREATE TYPE public.capacity_reservation_state AS ENUM
  ('ACTIVE','COMMITTED','CONSUMED','RELEASED','EXPIRED','CANCELLED');
CREATE TYPE public.freight_requirement_state AS ENUM
  ('DRAFT','SUBMITTED','SOURCING','AWARDED','BOOKED','FULFILLED','CANCELLED');
CREATE TYPE public.freight_pricing_basis AS ENUM
  ('PER_SHIPMENT','PER_PACKAGE','PER_KG','PER_KM','PER_TRIP','PER_LOAD','PER_PALLET','PER_CONTAINER','CONTRACT_RATE');

-- ---------------------------------------------------------------- master
CREATE TABLE public.carrier_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL UNIQUE REFERENCES public.partners(id) ON DELETE CASCADE,
  carrier_code text NOT NULL UNIQUE,
  legal_entity_name text NOT NULL,
  operating_status public.carrier_operating_status NOT NULL DEFAULT 'ONBOARDING',
  service_categories text[] NOT NULL DEFAULT '{}',
  corridors text[] NOT NULL DEFAULT '{}',
  operating_countries text[] NOT NULL DEFAULT '{KE}',
  regions text[] NOT NULL DEFAULT '{}',
  ops_contact_name text, ops_contact_email text, ops_contact_phone text,
  finance_contact_name text, finance_contact_email text,
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 180),
  settlement_currency text NOT NULL DEFAULT 'KES',
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_identifier text,
  contract_status public.carrier_contract_status NOT NULL DEFAULT 'NONE',
  contract_reference text,
  effective_from date,
  effective_until date,
  onboarding_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_profiles TO authenticated;
GRANT ALL ON public.carrier_profiles TO service_role;
ALTER TABLE public.carrier_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY cp_service ON public.carrier_profiles TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cp_staff_read ON public.carrier_profiles FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY cp_carrier_read ON public.carrier_profiles FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id));

-- ------------------------------------------------------------ capability
CREATE TABLE public.carrier_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL,
  vehicle_class text,
  max_payload_kg numeric(12,2) NOT NULL CHECK (max_payload_kg > 0),
  max_volume_cbm numeric(12,3),
  max_length_cm numeric(10,1), max_width_cm numeric(10,1), max_height_cm numeric(10,1),
  temperature_controlled boolean NOT NULL DEFAULT false,
  temperature_min_c numeric(5,1), temperature_max_c numeric(5,1),
  refrigerated boolean NOT NULL DEFAULT false,
  hazmat_capable boolean NOT NULL DEFAULT false,
  hazmat_authority_reference text,
  fragile_capable boolean NOT NULL DEFAULT false,
  high_value_capable boolean NOT NULL DEFAULT false,
  oversized_capable boolean NOT NULL DEFAULT false,
  container_capable boolean NOT NULL DEFAULT false,
  cross_border_capable boolean NOT NULL DEFAULT false,
  warehouse_capable boolean NOT NULL DEFAULT false,
  last_mile_capable boolean NOT NULL DEFAULT true,
  line_haul_capable boolean NOT NULL DEFAULT false,
  special_handling text[] NOT NULL DEFAULT '{}',
  equipment text[] NOT NULL DEFAULT '{}',
  units_declared integer NOT NULL DEFAULT 0 CHECK (units_declared >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Hazmat is a legal authorisation, never a self-declared flag.
  CHECK (NOT hazmat_capable OR hazmat_authority_reference IS NOT NULL)
);
CREATE UNIQUE INDEX ccap_identity ON public.carrier_capabilities (carrier_id, vehicle_type, coalesce(vehicle_class,''));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_capabilities TO authenticated;
GRANT ALL ON public.carrier_capabilities TO service_role;
ALTER TABLE public.carrier_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccap_service ON public.carrier_capabilities TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ccap_staff_read ON public.carrier_capabilities FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY ccap_carrier_read ON public.carrier_capabilities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id = carrier_id AND public.partner_api_is_member(c.partner_id)));

-- ---------------------------------------------------------- service area
CREATE TABLE public.carrier_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  area_kind text NOT NULL CHECK (area_kind IN ('CITY','COUNTY','COUNTRY','CORRIDOR','ZONE')),
  area_code text NOT NULL,
  area_label text NOT NULL,
  direction text NOT NULL DEFAULT 'BOTH' CHECK (direction IN ('ORIGIN','DESTINATION','BOTH')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, area_kind, area_code, direction)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_service_areas TO authenticated;
GRANT ALL ON public.carrier_service_areas TO service_role;
ALTER TABLE public.carrier_service_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY csa_service ON public.carrier_service_areas TO service_role USING (true) WITH CHECK (true);
CREATE POLICY csa_staff_read ON public.carrier_service_areas FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY csa_carrier_read ON public.carrier_service_areas FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id = carrier_id AND public.partner_api_is_member(c.partner_id)));

-- ------------------------------------------------------------ compliance
CREATE TABLE public.carrier_compliance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  requirement_code text NOT NULL,
  requirement_label text NOT NULL,
  category text NOT NULL CHECK (category IN ('LICENCE','PROTECTION','TAX','VEHICLE','DRIVER','CONTRACT','OTHER')),
  is_mandatory boolean NOT NULL DEFAULT true,
  state public.carrier_compliance_state NOT NULL DEFAULT 'MISSING',
  evidence_document_id uuid,
  evidence_storage_path text,
  evidence_hash text,
  issuing_authority text,
  reference_number text,
  issued_on date,
  expires_on date,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_user_id uuid,
  legal_review_reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A verified item must carry real evidence and a review author.
  CHECK (state <> 'VERIFIED' OR (reviewed_by IS NOT NULL AND (evidence_document_id IS NOT NULL OR evidence_storage_path IS NOT NULL))),
  CHECK (state <> 'LEGAL_REVIEW_REQUIRED' OR legal_review_reason IS NOT NULL)
);
CREATE UNIQUE INDEX cci_identity ON public.carrier_compliance_items
  (carrier_id, requirement_code, coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_compliance_items TO authenticated;
GRANT ALL ON public.carrier_compliance_items TO service_role;
ALTER TABLE public.carrier_compliance_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY cci_service ON public.carrier_compliance_items TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cci_staff_read ON public.carrier_compliance_items FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY cci_carrier_read ON public.carrier_compliance_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id = carrier_id AND public.partner_api_is_member(c.partner_id)));

-- -------------------------------------------------------------- capacity
-- Capacity is measured in kg and cbm against an EXISTING vehicle where the
-- carrier has registered one. offered >= reserved + committed + consumed is a
-- database invariant: overbooking cannot be introduced by application code.
CREATE TABLE public.carrier_capacity_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  slot_reference text NOT NULL UNIQUE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_type text NOT NULL,
  vehicle_class text,
  equipment text[] NOT NULL DEFAULT '{}',
  origin_area_code text,
  destination_area_code text,
  corridor text,
  exclusive_vehicle boolean NOT NULL DEFAULT false,
  offered_kg numeric(12,2) NOT NULL CHECK (offered_kg > 0),
  offered_cbm numeric(12,3),
  reserved_kg numeric(12,2) NOT NULL DEFAULT 0 CHECK (reserved_kg >= 0),
  committed_kg numeric(12,2) NOT NULL DEFAULT 0 CHECK (committed_kg >= 0),
  consumed_kg numeric(12,2) NOT NULL DEFAULT 0 CHECK (consumed_kg >= 0),
  availability_status public.capacity_availability_state NOT NULL DEFAULT 'CONFIGURED',
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until > effective_from),
  CONSTRAINT ccs_no_overbooking CHECK (reserved_kg + committed_kg + consumed_kg <= offered_kg)
);
CREATE INDEX ccs_search ON public.carrier_capacity_slots (availability_status, vehicle_type, effective_from, effective_until);
CREATE INDEX ccs_carrier ON public.carrier_capacity_slots (carrier_id, availability_status);
CREATE UNIQUE INDEX ccs_exclusive_vehicle_window ON public.carrier_capacity_slots (vehicle_id, effective_from, effective_until)
  WHERE exclusive_vehicle AND vehicle_id IS NOT NULL AND availability_status IN ('CONFIGURED','AVAILABLE');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carrier_capacity_slots TO authenticated;
GRANT ALL ON public.carrier_capacity_slots TO service_role;
ALTER TABLE public.carrier_capacity_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccs_service ON public.carrier_capacity_slots TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ccs_staff_read ON public.carrier_capacity_slots FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY ccs_carrier_read ON public.carrier_capacity_slots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id = carrier_id AND public.partner_api_is_member(c.partner_id)));

-- Append-only movement ledger. Every reserve/release/commit/consume lands here.
CREATE TABLE public.carrier_capacity_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.carrier_capacity_slots(id) ON DELETE CASCADE,
  reservation_id uuid,
  entry_type text NOT NULL CHECK (entry_type IN ('OFFER','RESERVE','RELEASE','COMMIT','CONSUME','EXPIRE','ADJUST')),
  qty_kg numeric(12,2) NOT NULL,
  balance_after_kg numeric(12,2) NOT NULL,
  reason text,
  actor_id uuid,
  actor_role text NOT NULL DEFAULT 'system',
  idempotency_key text UNIQUE,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ccl_slot ON public.carrier_capacity_ledger (slot_id, created_at DESC);
GRANT SELECT ON public.carrier_capacity_ledger TO authenticated;
GRANT ALL ON public.carrier_capacity_ledger TO service_role;
ALTER TABLE public.carrier_capacity_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccl_service ON public.carrier_capacity_ledger TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ccl_staff_read ON public.carrier_capacity_ledger FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._capacity_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'carrier_capacity_ledger is append-only';
END; $$;
CREATE TRIGGER ccl_immutable BEFORE UPDATE OR DELETE ON public.carrier_capacity_ledger
  FOR EACH ROW EXECUTE FUNCTION public._capacity_ledger_append_only();

CREATE TABLE public.capacity_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_reference text NOT NULL UNIQUE,
  slot_id uuid NOT NULL REFERENCES public.carrier_capacity_slots(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  tenant_id uuid,
  requirement_id uuid,
  award_id uuid,
  booking_id uuid,
  qty_kg numeric(12,2) NOT NULL CHECK (qty_kg > 0),
  qty_cbm numeric(12,3),
  state public.capacity_reservation_state NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  released_reason text,
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cr_slot_state ON public.capacity_reservations (slot_id, state);
CREATE INDEX cr_expiry ON public.capacity_reservations (state, expires_at);
GRANT SELECT ON public.capacity_reservations TO authenticated;
GRANT ALL ON public.capacity_reservations TO service_role;
ALTER TABLE public.capacity_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY crv_service ON public.capacity_reservations TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crv_staff_read ON public.capacity_reservations FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY crv_carrier_read ON public.capacity_reservations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id = carrier_id AND public.partner_api_is_member(c.partner_id)));

-- ------------------------------------------------------------- demand
CREATE TABLE public.freight_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_number text NOT NULL UNIQUE,
  tenant_id uuid,
  customer_id uuid,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  enquiry_id uuid REFERENCES public.logistics_enquiries(id) ON DELETE SET NULL,
  state public.freight_requirement_state NOT NULL DEFAULT 'DRAFT',
  service_level text NOT NULL DEFAULT 'STANDARD',
  origin_label text NOT NULL,
  origin_area_code text,
  origin_lat numeric, origin_lng numeric,
  destination_label text NOT NULL,
  destination_area_code text,
  destination_lat numeric, destination_lng numeric,
  corridor text,
  pickup_window_start timestamptz NOT NULL,
  pickup_window_end timestamptz NOT NULL,
  delivery_window_start timestamptz,
  delivery_window_end timestamptz,
  weight_kg numeric(12,2) NOT NULL CHECK (weight_kg > 0),
  volume_cbm numeric(12,3),
  length_cm numeric(10,1), width_cm numeric(10,1), height_cm numeric(10,1),
  package_count integer NOT NULL DEFAULT 1 CHECK (package_count > 0),
  cargo_class text NOT NULL DEFAULT 'GENERAL',
  goods_code text,
  handling_requirements text[] NOT NULL DEFAULT '{}',
  equipment_required text[] NOT NULL DEFAULT '{}',
  vehicle_type_required text,
  temperature_controlled boolean NOT NULL DEFAULT false,
  temperature_min_c numeric(5,1), temperature_max_c numeric(5,1),
  cross_border boolean NOT NULL DEFAULT false,
  declared_value numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  target_budget numeric(14,2),
  special_instructions text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pickup_window_end >= pickup_window_start),
  CHECK (delivery_window_end IS NULL OR delivery_window_start IS NULL OR delivery_window_end >= delivery_window_start)
);
CREATE INDEX fr_state ON public.freight_requirements (state, created_at DESC);
CREATE INDEX fr_tenant ON public.freight_requirements (tenant_id, created_at DESC);
GRANT SELECT ON public.freight_requirements TO authenticated;
GRANT ALL ON public.freight_requirements TO service_role;
ALTER TABLE public.freight_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY frq_service ON public.freight_requirements TO service_role USING (true) WITH CHECK (true);
CREATE POLICY frq_staff_read ON public.freight_requirements FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY frq_customer_read ON public.freight_requirements FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR requested_by = auth.uid());

-- ------------------------------------------------------- updated_at wiring
CREATE OR REPLACE FUNCTION public._phase5_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER cp_touch BEFORE UPDATE ON public.carrier_profiles FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER ccap_touch BEFORE UPDATE ON public.carrier_capabilities FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER cci_touch BEFORE UPDATE ON public.carrier_compliance_items FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER ccs_touch BEFORE UPDATE ON public.carrier_capacity_slots FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER crv_touch BEFORE UPDATE ON public.capacity_reservations FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER frq_touch BEFORE UPDATE ON public.freight_requirements FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();

-- ---------------------------------------------- Phase 4 event catalogue rows
INSERT INTO public.logistics_event_catalogue (event_type, aggregate_type, description, payload_keys, ordinal, publishable) VALUES
  ('rfq.created','rfq','A freight RFQ has been created for a customer requirement.', ARRAY['rfq_id','rfq_number','requirement_id','sourcing_mode','response_deadline'], 610, true),
  ('rfq.sent','rfq','An RFQ has been issued to one or more invited carriers.', ARRAY['rfq_id','rfq_number','invited_carriers','response_deadline'], 611, true),
  ('tender.opened','rfq','A tender is open and accepting carrier quotations.', ARRAY['rfq_id','rfq_number','response_deadline'], 612, true),
  ('quote.submitted','quotation','A carrier submitted a quotation against an RFQ.', ARRAY['quotation_id','quote_number','rfq_id','carrier_id','version','total'], 613, true),
  ('quote.updated','quotation','A carrier superseded its quotation with a new version.', ARRAY['quotation_id','quote_number','rfq_id','carrier_id','version','total'], 614, true),
  ('tender.awarded','rfq','A tender was awarded to a carrier against an accepted quotation.', ARRAY['rfq_id','award_id','award_number','carrier_id','quotation_id','total'], 615, true),
  ('capacity.reserved','capacity','Carrier capacity was reserved for an awarded requirement.', ARRAY['reservation_id','reservation_reference','slot_id','carrier_id','qty_kg','expires_at'], 616, true),
  ('capacity.released','capacity','A capacity reservation was released back to the carrier.', ARRAY['reservation_id','reservation_reference','slot_id','carrier_id','qty_kg','reason'], 617, true),
  ('carrier.assigned','booking','A carrier was assigned to execute a freight booking.', ARRAY['booking_id','booking_number','carrier_id','award_id','vehicle_id','driver_assigned'], 618, true),
  ('freight.booked','booking','A freight booking was created and connected to execution.', ARRAY['booking_id','booking_number','requirement_id','carrier_id','route_id','total'], 619, true)
ON CONFLICT (event_type) DO NOTHING;