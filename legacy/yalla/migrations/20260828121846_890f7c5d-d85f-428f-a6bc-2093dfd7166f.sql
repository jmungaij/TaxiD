-- ================= PHASE 5B — FREIGHT PROCUREMENT SPINE =================
ALTER FUNCTION public._capacity_ledger_append_only() SET search_path = public;

CREATE TYPE public.tender_state AS ENUM
  ('DRAFT','OPEN','INVITED','RESPONSES_RECEIVED','EVALUATION','AWARDED','CANCELLED','EXPIRED');
CREATE TYPE public.carrier_quote_state AS ENUM
  ('DRAFT','SUBMITTED','SUPERSEDED','ACCEPTED','REJECTED','WITHDRAWN','EXPIRED');
CREATE TYPE public.rfq_invitation_state AS ENUM
  ('INVITED','VIEWED','RESPONDED','DECLINED','EXPIRED','WITHDRAWN');
CREATE TYPE public.freight_booking_state AS ENUM
  ('CREATED','CARRIER_ASSIGNED','RESOURCED','DISPATCHED','EXECUTING','COMPLETED','CANCELLED','FAILED');

-- ------------------------------------------------------------ award policy
CREATE TABLE public.freight_tender_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL UNIQUE,
  policy_label text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  min_responses_to_award integer NOT NULL DEFAULT 1 CHECK (min_responses_to_award >= 1),
  require_compliance_pass boolean NOT NULL DEFAULT true,
  allow_lowest_price_only boolean NOT NULL DEFAULT false,
  weight_price numeric(5,2) NOT NULL DEFAULT 40 CHECK (weight_price >= 0),
  weight_transit numeric(5,2) NOT NULL DEFAULT 15 CHECK (weight_transit >= 0),
  weight_capacity numeric(5,2) NOT NULL DEFAULT 10 CHECK (weight_capacity >= 0),
  weight_performance numeric(5,2) NOT NULL DEFAULT 20 CHECK (weight_performance >= 0),
  weight_compliance numeric(5,2) NOT NULL DEFAULT 15 CHECK (weight_compliance >= 0),
  max_award_variance_pct numeric(6,2) NOT NULL DEFAULT 0,
  require_four_eyes_above numeric(14,2),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (weight_price + weight_transit + weight_capacity + weight_performance + weight_compliance = 100)
);
GRANT SELECT ON public.freight_tender_policies TO authenticated;
GRANT ALL ON public.freight_tender_policies TO service_role;
ALTER TABLE public.freight_tender_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ftp_service ON public.freight_tender_policies TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ftp_staff_read ON public.freight_tender_policies FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));

-- -------------------------------------------------------------------- RFQ
CREATE TABLE public.freight_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number text NOT NULL UNIQUE,
  requirement_id uuid NOT NULL REFERENCES public.freight_requirements(id) ON DELETE CASCADE,
  tenant_id uuid,
  sourcing_mode text NOT NULL DEFAULT 'MULTI' CHECK (sourcing_mode IN ('SINGLE','MULTI')),
  state public.tender_state NOT NULL DEFAULT 'DRAFT',
  policy_id uuid REFERENCES public.freight_tender_policies(id) ON DELETE SET NULL,
  title text NOT NULL,
  scope_notes text,
  currency text NOT NULL DEFAULT 'KES',
  target_budget numeric(14,2),
  response_deadline timestamptz NOT NULL,
  clarification_deadline timestamptz,
  opened_at timestamptz,
  issued_at timestamptz,
  evaluation_started_at timestamptz,
  awarded_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  is_test boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX frfq_state ON public.freight_rfqs (state, response_deadline);
GRANT SELECT ON public.freight_rfqs TO authenticated;
GRANT ALL ON public.freight_rfqs TO service_role;
ALTER TABLE public.freight_rfqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY frfq_service ON public.freight_rfqs TO service_role USING (true) WITH CHECK (true);
CREATE POLICY frfq_staff_read ON public.freight_rfqs FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));

CREATE TABLE public.freight_rfq_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.freight_rfqs(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  description text NOT NULL,
  pricing_basis public.freight_pricing_basis NOT NULL DEFAULT 'PER_SHIPMENT',
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  uom text NOT NULL DEFAULT 'SHIPMENT',
  weight_kg numeric(12,2),
  volume_cbm numeric(12,3),
  vehicle_type text,
  equipment text[] NOT NULL DEFAULT '{}',
  origin_area_code text,
  destination_area_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, line_no)
);
GRANT SELECT ON public.freight_rfq_lines TO authenticated;
GRANT ALL ON public.freight_rfq_lines TO service_role;
ALTER TABLE public.freight_rfq_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY frl_service ON public.freight_rfq_lines TO service_role USING (true) WITH CHECK (true);
CREATE POLICY frl_staff_read ON public.freight_rfq_lines FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));

CREATE TABLE public.freight_rfq_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.freight_rfqs(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  state public.rfq_invitation_state NOT NULL DEFAULT 'INVITED',
  match_score numeric(6,2),
  match_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  responded_at timestamptz,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, carrier_id)
);
GRANT SELECT ON public.freight_rfq_invitations TO authenticated;
GRANT ALL ON public.freight_rfq_invitations TO service_role;
ALTER TABLE public.freight_rfq_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY fri_service ON public.freight_rfq_invitations TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fri_staff_read ON public.freight_rfq_invitations FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY fri_carrier_read ON public.freight_rfq_invitations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

-- A carrier sees an RFQ only through its own invitation.
CREATE POLICY frfq_carrier_read ON public.freight_rfqs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.freight_rfq_invitations i
      JOIN public.carrier_profiles c ON c.id = i.carrier_id
     WHERE i.rfq_id = freight_rfqs.id AND public.partner_api_is_member(c.partner_id)));
CREATE POLICY frl_carrier_read ON public.freight_rfq_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.freight_rfq_invitations i
      JOIN public.carrier_profiles c ON c.id = i.carrier_id
     WHERE i.rfq_id = freight_rfq_lines.rfq_id AND public.partner_api_is_member(c.partner_id)));

CREATE TABLE public.freight_rfq_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid NOT NULL REFERENCES public.freight_rfqs(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  question text NOT NULL,
  asked_by uuid,
  asked_at timestamptz NOT NULL DEFAULT now(),
  answer text,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at timestamptz,
  visible_to_all boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.freight_rfq_clarifications TO authenticated;
GRANT ALL ON public.freight_rfq_clarifications TO service_role;
ALTER TABLE public.freight_rfq_clarifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY frc_service ON public.freight_rfq_clarifications TO service_role USING (true) WITH CHECK (true);
CREATE POLICY frc_staff_read ON public.freight_rfq_clarifications FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY frc_carrier_read ON public.freight_rfq_clarifications FOR SELECT TO authenticated
  USING (visible_to_all AND EXISTS (
           SELECT 1 FROM public.freight_rfq_invitations i JOIN public.carrier_profiles c ON c.id=i.carrier_id
            WHERE i.rfq_id = freight_rfq_clarifications.rfq_id AND public.partner_api_is_member(c.partner_id))
     OR EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id = carrier_id AND public.partner_api_is_member(c.partner_id)));

-- ------------------------------------------------------------- quotations
CREATE TABLE public.carrier_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE,
  rfq_id uuid NOT NULL REFERENCES public.freight_rfqs(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_id uuid REFERENCES public.carrier_quotations(id) ON DELETE SET NULL,
  state public.carrier_quote_state NOT NULL DEFAULT 'DRAFT',
  currency text NOT NULL DEFAULT 'KES',
  pricing_basis public.freight_pricing_basis NOT NULL DEFAULT 'PER_SHIPMENT',
  rate_card_version_id uuid,
  base_freight numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_freight >= 0),
  fuel_surcharge numeric(14,2) NOT NULL DEFAULT 0 CHECK (fuel_surcharge >= 0),
  waiting_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (waiting_charge >= 0),
  toll_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (toll_charge >= 0),
  handling_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (handling_charge >= 0),
  storage_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (storage_charge >= 0),
  loading_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (loading_charge >= 0),
  protection_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (protection_charge >= 0),
  accessorials jsonb NOT NULL DEFAULT '[]'::jsonb,
  accessorial_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (accessorial_total >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  capacity_offered_kg numeric(12,2) NOT NULL CHECK (capacity_offered_kg > 0),
  capacity_slot_id uuid REFERENCES public.carrier_capacity_slots(id) ON DELETE SET NULL,
  transit_time_hours numeric(8,2),
  pickup_eta timestamptz,
  delivery_eta timestamptz,
  sla_committed text,
  vehicle_type text,
  equipment text[] NOT NULL DEFAULT '{}',
  conditions text,
  valid_until timestamptz NOT NULL,
  submitted_at timestamptz,
  submitted_by uuid,
  accepted_at timestamptz,
  snapshot jsonb,
  snapshot_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, carrier_id, version)
);
CREATE INDEX cq_rfq_state ON public.carrier_quotations (rfq_id, state);
GRANT SELECT ON public.carrier_quotations TO authenticated;
GRANT ALL ON public.carrier_quotations TO service_role;
ALTER TABLE public.carrier_quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cq_service ON public.carrier_quotations TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cq_staff_read ON public.carrier_quotations FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY cq_carrier_read ON public.carrier_quotations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

-- A submitted quotation is a commercial commitment: it can only change state,
-- never its money. Amendments arrive as a new version.
CREATE OR REPLACE FUNCTION public._carrier_quote_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.state IN ('SUBMITTED','ACCEPTED','SUPERSEDED','REJECTED','WITHDRAWN','EXPIRED') THEN
    IF NEW.base_freight <> OLD.base_freight OR NEW.fuel_surcharge <> OLD.fuel_surcharge
       OR NEW.waiting_charge <> OLD.waiting_charge OR NEW.toll_charge <> OLD.toll_charge
       OR NEW.handling_charge <> OLD.handling_charge OR NEW.storage_charge <> OLD.storage_charge
       OR NEW.loading_charge <> OLD.loading_charge OR NEW.protection_charge <> OLD.protection_charge
       OR NEW.accessorial_total <> OLD.accessorial_total OR NEW.discount <> OLD.discount
       OR NEW.tax_amount <> OLD.tax_amount OR NEW.total <> OLD.total
       OR NEW.accessorials <> OLD.accessorials
       OR NEW.capacity_offered_kg <> OLD.capacity_offered_kg
       OR NEW.currency <> OLD.currency OR NEW.pricing_basis <> OLD.pricing_basis THEN
      RAISE EXCEPTION 'quotation % is submitted; commercial terms are immutable — submit a new version', OLD.quote_number;
    END IF;
    IF NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash AND OLD.snapshot_hash IS NOT NULL THEN
      RAISE EXCEPTION 'quotation snapshot is sealed';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER cq_immutable BEFORE UPDATE ON public.carrier_quotations
  FOR EACH ROW EXECUTE FUNCTION public._carrier_quote_immutability();

-- ----------------------------------------------------------------- awards
CREATE TABLE public.freight_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_number text NOT NULL UNIQUE,
  rfq_id uuid NOT NULL REFERENCES public.freight_rfqs(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES public.freight_requirements(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL UNIQUE REFERENCES public.carrier_quotations(id) ON DELETE RESTRICT,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES public.capacity_reservations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'AWARDED' CHECK (status IN ('AWARDED','CANCELLED','SUPERSEDED')),
  awarded_total numeric(14,2) NOT NULL CHECK (awarded_total >= 0),
  currency text NOT NULL DEFAULT 'KES',
  evaluation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  award_justification text NOT NULL,
  lowest_price_bypassed boolean NOT NULL DEFAULT false,
  bypass_reason text,
  awarded_by uuid NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  countersigned_by uuid,
  countersigned_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT lowest_price_bypassed OR bypass_reason IS NOT NULL)
);
-- One live award per tender: enforced by the database, not by the UI.
CREATE UNIQUE INDEX fa_one_live_award ON public.freight_awards (rfq_id) WHERE status = 'AWARDED';
GRANT SELECT ON public.freight_awards TO authenticated;
GRANT ALL ON public.freight_awards TO service_role;
ALTER TABLE public.freight_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY fa_service ON public.freight_awards TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fa_staff_read ON public.freight_awards FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY fa_carrier_read ON public.freight_awards FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

-- --------------------------------------------------------------- bookings
CREATE TABLE public.freight_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text NOT NULL UNIQUE,
  award_id uuid NOT NULL UNIQUE REFERENCES public.freight_awards(id) ON DELETE RESTRICT,
  requirement_id uuid NOT NULL REFERENCES public.freight_requirements(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES public.capacity_reservations(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.logistics_routes(id) ON DELETE SET NULL,
  route_version_id uuid REFERENCES public.logistics_route_versions(id) ON DELETE SET NULL,
  manifest_id uuid REFERENCES public.logistics_manifests(id) ON DELETE SET NULL,
  dispatch_job_id uuid,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_user_id uuid,
  state public.freight_booking_state NOT NULL DEFAULT 'CREATED',
  carrier_accepted_at timestamptz,
  carrier_declined_at timestamptz,
  carrier_decline_reason text,
  agreed_total numeric(14,2) NOT NULL CHECK (agreed_total >= 0),
  currency text NOT NULL DEFAULT 'KES',
  planned_pickup timestamptz,
  planned_delivery timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_state ON public.freight_bookings (state, created_at DESC);
GRANT SELECT ON public.freight_bookings TO authenticated;
GRANT ALL ON public.freight_bookings TO service_role;
ALTER TABLE public.freight_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY fb_service ON public.freight_bookings TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fb_staff_read ON public.freight_bookings FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY fb_carrier_read ON public.freight_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

-- ------------------------------------------------------ contracts & rates
CREATE TABLE public.carrier_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text NOT NULL UNIQUE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  contract_type text NOT NULL DEFAULT 'FRAMEWORK' CHECK (contract_type IN ('FRAMEWORK','SPOT','DEDICATED','SEASONAL')),
  status public.carrier_contract_status NOT NULL DEFAULT 'DRAFT',
  currency text NOT NULL DEFAULT 'KES',
  payment_terms_days integer NOT NULL DEFAULT 30,
  effective_from date NOT NULL,
  effective_until date,
  document_id uuid,
  signed_by_carrier_at timestamptz,
  signed_by_yalla_at timestamptz,
  signed_by uuid,
  termination_notice_days integer NOT NULL DEFAULT 30,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until >= effective_from)
);
GRANT SELECT ON public.carrier_contracts TO authenticated;
GRANT ALL ON public.carrier_contracts TO service_role;
ALTER TABLE public.carrier_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_service ON public.carrier_contracts TO service_role USING (true) WITH CHECK (true);
CREATE POLICY cc_staff_read ON public.carrier_contracts FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.commercial.read'));
CREATE POLICY cc_carrier_read ON public.carrier_contracts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

CREATE TABLE public.carrier_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES public.carrier_contracts(id) ON DELETE SET NULL,
  rate_card_code text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','LIVE','SUPERSEDED','EXPIRED')),
  currency text NOT NULL DEFAULT 'KES',
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  published_at timestamptz,
  published_by uuid,
  supersedes_id uuid REFERENCES public.carrier_rate_cards(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, rate_card_code, version)
);
CREATE UNIQUE INDEX crc_one_live ON public.carrier_rate_cards (carrier_id, rate_card_code) WHERE status = 'LIVE';
GRANT SELECT ON public.carrier_rate_cards TO authenticated;
GRANT ALL ON public.carrier_rate_cards TO service_role;
ALTER TABLE public.carrier_rate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY crc_service ON public.carrier_rate_cards TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crc_staff_read ON public.carrier_rate_cards FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.commercial.read'));
CREATE POLICY crc_carrier_read ON public.carrier_rate_cards FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

CREATE TABLE public.carrier_rate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id uuid NOT NULL REFERENCES public.carrier_rate_cards(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  corridor text,
  origin_area_code text,
  destination_area_code text,
  vehicle_class text,
  pricing_basis public.freight_pricing_basis NOT NULL,
  unit_rate numeric(14,4) NOT NULL CHECK (unit_rate >= 0),
  minimum_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_charge >= 0),
  included_units numeric(12,3),
  fuel_surcharge_pct numeric(6,3) NOT NULL DEFAULT 0,
  waiting_rate_per_hour numeric(12,2) NOT NULL DEFAULT 0,
  accessorials jsonb NOT NULL DEFAULT '[]'::jsonb,
  break_min numeric(12,3),
  break_max numeric(12,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_card_id, line_no)
);
GRANT SELECT ON public.carrier_rate_lines TO authenticated;
GRANT ALL ON public.carrier_rate_lines TO service_role;
ALTER TABLE public.carrier_rate_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY crl_service ON public.carrier_rate_lines TO service_role USING (true) WITH CHECK (true);
CREATE POLICY crl_read ON public.carrier_rate_lines FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
     OR EXISTS (SELECT 1 FROM public.carrier_rate_cards rc JOIN public.carrier_profiles c ON c.id=rc.carrier_id
                 WHERE rc.id = rate_card_id AND public.partner_api_is_member(c.partner_id)));

-- A published rate line is frozen; a change means a new rate-card version so
-- historic transactions keep the version they were priced on.
CREATE OR REPLACE FUNCTION public._carrier_rate_line_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.carrier_rate_cards WHERE id = coalesce(NEW.rate_card_id, OLD.rate_card_id);
  IF v_status IN ('LIVE','SUPERSEDED','EXPIRED') THEN
    RAISE EXCEPTION 'rate card is % — create a new version instead of editing published rates', v_status;
  END IF;
  RETURN coalesce(NEW, OLD);
END; $$;
CREATE TRIGGER crl_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.carrier_rate_lines
  FOR EACH ROW EXECUTE FUNCTION public._carrier_rate_line_frozen();

-- --------------------------------------------------- freight audit lineage
CREATE TABLE public.freight_price_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES public.freight_requirements(id) ON DELETE CASCADE,
  rfq_id uuid REFERENCES public.freight_rfqs(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.carrier_quotations(id) ON DELETE SET NULL,
  award_id uuid REFERENCES public.freight_awards(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.freight_bookings(id) ON DELETE SET NULL,
  carrier_id uuid REFERENCES public.carrier_profiles(id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (stage IN ('REQUESTED','QUOTED','ACCEPTED','ACTUAL','ADJUSTED','INVOICED','SETTLED')),
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  variance_vs_accepted numeric(14,2),
  invoice_reference text,
  settlement_reference text,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fpl_req ON public.freight_price_lineage (requirement_id, recorded_at);
GRANT SELECT ON public.freight_price_lineage TO authenticated;
GRANT ALL ON public.freight_price_lineage TO service_role;
ALTER TABLE public.freight_price_lineage ENABLE ROW LEVEL SECURITY;
CREATE POLICY fpl_service ON public.freight_price_lineage TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fpl_staff_read ON public.freight_price_lineage FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.commercial.read'));

CREATE OR REPLACE FUNCTION public._freight_lineage_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'freight_price_lineage is append-only'; END; $$;
CREATE TRIGGER fpl_immutable BEFORE UPDATE OR DELETE ON public.freight_price_lineage
  FOR EACH ROW EXECUTE FUNCTION public._freight_lineage_append_only();

-- ------------------------------------------------------ procurement audit
CREATE TABLE public.freight_procurement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  from_state text,
  to_state text,
  actor_id uuid,
  actor_role text NOT NULL DEFAULT 'staff',
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fpa_entity ON public.freight_procurement_audit (entity_type, entity_id, created_at DESC);
GRANT SELECT ON public.freight_procurement_audit TO authenticated;
GRANT ALL ON public.freight_procurement_audit TO service_role;
ALTER TABLE public.freight_procurement_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY fpa_service ON public.freight_procurement_audit TO service_role USING (true) WITH CHECK (true);
CREATE POLICY fpa_staff_read ON public.freight_procurement_audit FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._freight_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'freight_procurement_audit is append-only'; END; $$;
CREATE TRIGGER fpa_immutable BEFORE UPDATE OR DELETE ON public.freight_procurement_audit
  FOR EACH ROW EXECUTE FUNCTION public._freight_audit_append_only();

-- ------------------------------------------------- carrier score snapshots
CREATE TABLE public.carrier_score_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  bookings_total integer NOT NULL DEFAULT 0,
  on_time_pickup_pct numeric(6,2),
  on_time_delivery_pct numeric(6,2),
  acceptance_rate_pct numeric(6,2),
  tender_response_rate_pct numeric(6,2),
  cancellation_rate_pct numeric(6,2),
  failure_rate_pct numeric(6,2),
  damage_rate_pct numeric(6,2),
  pod_compliance_pct numeric(6,2),
  exception_rate_pct numeric(6,2),
  claim_rate_pct numeric(6,2),
  invoice_accuracy_pct numeric(6,2),
  reliability_score numeric(6,2),
  computed_from jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, period_start, period_end)
);
GRANT SELECT ON public.carrier_score_snapshots TO authenticated;
GRANT ALL ON public.carrier_score_snapshots TO service_role;
ALTER TABLE public.carrier_score_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY css_service ON public.carrier_score_snapshots TO service_role USING (true) WITH CHECK (true);
CREATE POLICY css_staff_read ON public.carrier_score_snapshots FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
-- A carrier may read its score; it can never write one.
CREATE POLICY css_carrier_read ON public.carrier_score_snapshots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carrier_profiles c WHERE c.id=carrier_id AND public.partner_api_is_member(c.partner_id)));

CREATE TRIGGER frfq_touch BEFORE UPDATE ON public.freight_rfqs FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER fri_touch BEFORE UPDATE ON public.freight_rfq_invitations FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER cq_touch BEFORE UPDATE ON public.carrier_quotations FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER fb_touch BEFORE UPDATE ON public.freight_bookings FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER cc_touch BEFORE UPDATE ON public.carrier_contracts FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER crc_touch BEFORE UPDATE ON public.carrier_rate_cards FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();
CREATE TRIGGER ftp_touch BEFORE UPDATE ON public.freight_tender_policies FOR EACH ROW EXECUTE FUNCTION public._phase5_touch();

ALTER TABLE public.capacity_reservations
  ADD CONSTRAINT cr_requirement_fk FOREIGN KEY (requirement_id) REFERENCES public.freight_requirements(id) ON DELETE SET NULL,
  ADD CONSTRAINT cr_award_fk FOREIGN KEY (award_id) REFERENCES public.freight_awards(id) ON DELETE SET NULL,
  ADD CONSTRAINT cr_booking_fk FOREIGN KEY (booking_id) REFERENCES public.freight_bookings(id) ON DELETE SET NULL;