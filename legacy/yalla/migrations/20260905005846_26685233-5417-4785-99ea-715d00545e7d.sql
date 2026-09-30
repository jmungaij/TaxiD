-- ============================================================
-- SALES LEAD PIPELINE
-- ============================================================
CREATE TABLE public.sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_ref text NOT NULL UNIQUE,
  sales_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  organisation_name text NOT NULL,
  contact_name text NOT NULL,
  contact_email text,
  contact_phone text,
  service_interest text NOT NULL,
  origin_label text,
  destination_label text,
  service_date date,
  estimated_value_kes numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  stage text NOT NULL DEFAULT 'NEW',
  qualification_notes text,
  lost_reason text,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  order_id uuid,
  booking_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_leads_stage_chk CHECK (stage IN
    ('NEW','QUALIFIED','OPPORTUNITY','QUOTED','ACCEPTED','BOOKED','FULFILLED','CLOSED_WON','CLOSED_LOST','DISQUALIFIED'))
);
GRANT SELECT, INSERT, UPDATE ON public.sales_leads TO authenticated;
GRANT ALL ON public.sales_leads TO service_role;
ALTER TABLE public.sales_leads ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sales_lead_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  action text NOT NULL,
  stage_from text,
  stage_to text,
  note text,
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_lead_events TO authenticated;
GRANT ALL ON public.sales_lead_events TO service_role;
ALTER TABLE public.sales_lead_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX sales_leads_staff_idx ON public.sales_leads(sales_staff_id, stage);
CREATE INDEX sales_lead_events_lead_idx ON public.sales_lead_events(lead_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._sales_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER sales_leads_touch BEFORE UPDATE ON public.sales_leads
FOR EACH ROW EXECUTE FUNCTION public._sales_touch();

CREATE OR REPLACE FUNCTION public._sales_lead_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'SALES_LEAD_EVENTS_APPEND_ONLY'; END $$;
CREATE TRIGGER sales_lead_events_no_mutate BEFORE UPDATE OR DELETE ON public.sales_lead_events
FOR EACH ROW EXECUTE FUNCTION public._sales_lead_events_append_only();

-- my staff member id (identity link)
CREATE OR REPLACE FUNCTION public._my_staff_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._my_staff_member_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._my_staff_member_id() TO authenticated, service_role;

CREATE POLICY sales_leads_own_read ON public.sales_leads FOR SELECT TO authenticated
USING (sales_staff_id = public._my_staff_member_id() OR public.has_staff_permission('staff.crm.read'));
CREATE POLICY sales_leads_staff_write ON public.sales_leads FOR UPDATE TO authenticated
USING (sales_staff_id = public._my_staff_member_id() OR public.has_staff_permission('staff.crm.manage'))
WITH CHECK (sales_staff_id = public._my_staff_member_id() OR public.has_staff_permission('staff.crm.manage'));
CREATE POLICY sales_leads_own_insert ON public.sales_leads FOR INSERT TO authenticated
WITH CHECK (sales_staff_id = public._my_staff_member_id() OR public.has_staff_permission('staff.crm.manage'));
CREATE POLICY sales_lead_events_read ON public.sales_lead_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.sales_leads l WHERE l.id = lead_id
  AND (l.sales_staff_id = public._my_staff_member_id() OR public.has_staff_permission('staff.crm.read'))));

-- ---------- lead RPCs ----------
CREATE OR REPLACE FUNCTION public.sales_lead_create(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff uuid; v_ref text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF coalesce(trim(p->>'organisation_name'),'') = '' OR coalesce(trim(p->>'contact_name'),'') = ''
     OR coalesce(trim(p->>'service_interest'),'') = '' THEN
    RAISE EXCEPTION 'INCOMPLETE_LEAD_CONTRACT';
  END IF;
  v_ref := 'LEAD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO public.sales_leads (lead_ref, sales_staff_id, created_by, organisation_name, contact_name,
    contact_email, contact_phone, service_interest, origin_label, destination_label, service_date,
    estimated_value_kes, notes)
  VALUES (v_ref, v_staff, auth.uid(), trim(p->>'organisation_name'), trim(p->>'contact_name'),
    nullif(trim(coalesce(p->>'contact_email','')),''), nullif(trim(coalesce(p->>'contact_phone','')),''),
    trim(p->>'service_interest'), nullif(trim(coalesce(p->>'origin_label','')),''),
    nullif(trim(coalesce(p->>'destination_label','')),''), (p->>'service_date')::date,
    (p->>'estimated_value_kes')::numeric, nullif(trim(coalesce(p->>'notes','')),''))
  RETURNING id INTO v_id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_to, actor_user_id, detail)
  VALUES (v_id,'CREATED','NEW',auth.uid(), jsonb_build_object('lead_ref',v_ref));
  RETURN jsonb_build_object('lead_id',v_id,'lead_ref',v_ref,'stage','NEW');
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_create(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_lead_stage(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead public.sales_leads; v_to text; v_staff uuid; v_allowed text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  v_staff := public._my_staff_member_id();
  SELECT * INTO v_lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.sales_staff_id <> v_staff AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'LEAD_NOT_YOURS';
  END IF;
  v_to := upper(trim(p->>'stage'));
  v_allowed := CASE v_lead.stage
    WHEN 'NEW' THEN ARRAY['QUALIFIED','DISQUALIFIED']
    WHEN 'QUALIFIED' THEN ARRAY['OPPORTUNITY','CLOSED_LOST']
    WHEN 'OPPORTUNITY' THEN ARRAY['QUOTED','CLOSED_LOST']
    WHEN 'QUOTED' THEN ARRAY['ACCEPTED','CLOSED_LOST']
    WHEN 'ACCEPTED' THEN ARRAY['BOOKED','CLOSED_LOST']
    WHEN 'BOOKED' THEN ARRAY['FULFILLED','CLOSED_LOST']
    WHEN 'FULFILLED' THEN ARRAY['CLOSED_WON']
    ELSE ARRAY[]::text[] END;
  IF NOT (v_to = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'STAGE_TRANSITION_NOT_ALLOWED: % -> %', v_lead.stage, v_to;
  END IF;
  UPDATE public.sales_leads SET stage = v_to,
    qualification_notes = COALESCE(nullif(trim(coalesce(p->>'note','')),''), qualification_notes),
    lost_reason = CASE WHEN v_to IN ('CLOSED_LOST','DISQUALIFIED') THEN nullif(trim(coalesce(p->>'note','')),'') ELSE lost_reason END
  WHERE id = v_lead.id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, note, actor_user_id)
  VALUES (v_lead.id,'STAGE_CHANGE',v_lead.stage,v_to,nullif(trim(coalesce(p->>'note','')),''),auth.uid());
  RETURN jsonb_build_object('lead_id',v_lead.id,'stage',v_to);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_stage(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_stage(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_lead_to_opportunity(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead public.sales_leads; v_opp uuid; v_ref text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.sales_staff_id <> public._my_staff_member_id()
     AND NOT public.has_staff_permission('staff.crm.manage') THEN RAISE EXCEPTION 'LEAD_NOT_YOURS'; END IF;
  IF v_lead.opportunity_id IS NOT NULL THEN
    RETURN jsonb_build_object('lead_id',v_lead.id,'opportunity_id',v_lead.opportunity_id,'idempotent',true);
  END IF;
  IF v_lead.stage <> 'QUALIFIED' THEN RAISE EXCEPTION 'LEAD_NOT_QUALIFIED'; END IF;
  v_ref := 'OPP-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO public.commercial_opportunities (opportunity_ref, stage, title, customer_kind, customer_label,
    source, source_ref, expected_value_cents, currency, owner_user_id, provenance)
  VALUES (v_ref,'qualified', v_lead.organisation_name || ' — ' || v_lead.service_interest,
    'corporate', v_lead.organisation_name, 'sales_lead', v_lead.lead_ref,
    (COALESCE(v_lead.estimated_value_kes,0) * 100)::bigint, v_lead.currency, auth.uid(), 'LIVE')
  RETURNING id INTO v_opp;
  UPDATE public.sales_leads SET opportunity_id = v_opp, stage = 'OPPORTUNITY' WHERE id = v_lead.id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, actor_user_id, detail)
  VALUES (v_lead.id,'CONVERTED_TO_OPPORTUNITY',v_lead.stage,'OPPORTUNITY',auth.uid(),
    jsonb_build_object('opportunity_id',v_opp,'opportunity_ref',v_ref));
  RETURN jsonb_build_object('lead_id',v_lead.id,'opportunity_id',v_opp,'opportunity_ref',v_ref,'stage','OPPORTUNITY');
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_to_opportunity(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_to_opportunity(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_lead_attach_booking(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead public.sales_leads; v_order uuid; v_ref text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.sales_staff_id <> public._my_staff_member_id()
     AND NOT public.has_staff_permission('staff.crm.manage') THEN RAISE EXCEPTION 'LEAD_NOT_YOURS'; END IF;
  v_order := (p->>'order_id')::uuid;
  v_ref := nullif(trim(coalesce(p->>'booking_ref','')),'');
  IF v_order IS NULL AND v_ref IS NULL THEN RAISE EXCEPTION 'BOOKING_REFERENCE_REQUIRED'; END IF;
  UPDATE public.sales_leads SET order_id = COALESCE(v_order, order_id),
         booking_ref = COALESCE(v_ref, booking_ref),
         stage = CASE WHEN stage IN ('OPPORTUNITY','QUOTED','ACCEPTED') THEN 'BOOKED' ELSE stage END
   WHERE id = v_lead.id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, actor_user_id, detail)
  VALUES (v_lead.id,'BOOKING_ATTACHED',v_lead.stage,'BOOKED',auth.uid(),
    jsonb_build_object('order_id',v_order,'booking_ref',v_ref));
  RETURN jsonb_build_object('lead_id',v_lead.id,'order_id',v_order,'booking_ref',v_ref);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_attach_booking(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_attach_booking(jsonb) TO authenticated, service_role;

-- ============================================================
-- SERVICE PROVIDER CLAIM -> INVOICE -> PAYMENT -> RECEIPT
-- ============================================================
CREATE TABLE public.service_provider_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_ref text NOT NULL UNIQUE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  submitted_by uuid,
  destination_id uuid REFERENCES public.carrier_settlement_destinations(id) ON DELETE RESTRICT,
  order_id uuid,
  leg_id uuid NOT NULL,
  pod_submission_id uuid NOT NULL REFERENCES public.carrier_pod_submissions(id) ON DELETE RESTRICT,
  payable_line_id uuid REFERENCES public.carrier_payable_lines(id) ON DELETE SET NULL,
  sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
  sales_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  customer_label text,
  service_date date,
  origin_label text,
  destination_label text,
  service_description text NOT NULL,
  agreed_amount_kes numeric(14,2),
  claimed_amount_kes numeric(14,2) NOT NULL CHECK (claimed_amount_kes > 0),
  approved_amount_kes numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  supporting_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  declaration_name text,
  declaration_accepted_at timestamptz,
  state text NOT NULL DEFAULT 'DRAFT',
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spc_state_chk CHECK (state IN
    ('DRAFT','SUBMITTED','ADMIN_REVIEW','QUERY','APPROVED','INVOICED','PAYMENT_AUTHORISED','PAID','CLOSED','REJECTED'))
);
GRANT SELECT ON public.service_provider_claims TO authenticated;
GRANT ALL ON public.service_provider_claims TO service_role;
ALTER TABLE public.service_provider_claims ENABLE ROW LEVEL SECURITY;
-- one live claim per approved delivery proof
CREATE UNIQUE INDEX service_provider_claims_pod_live_uk
  ON public.service_provider_claims(pod_submission_id) WHERE state <> 'REJECTED';

CREATE TABLE public.service_provider_claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.service_provider_claims(id) ON DELETE CASCADE,
  action text NOT NULL,
  state_from text,
  state_to text,
  note text,
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.service_provider_claim_events TO authenticated;
GRANT ALL ON public.service_provider_claim_events TO service_role;
ALTER TABLE public.service_provider_claim_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.service_provider_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_ref text NOT NULL UNIQUE,
  claim_id uuid NOT NULL UNIQUE REFERENCES public.service_provider_claims(id) ON DELETE RESTRICT,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  order_id uuid,
  leg_id uuid,
  pod_submission_id uuid NOT NULL,
  payable_line_id uuid,
  sales_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  amount_kes numeric(14,2) NOT NULL CHECK (amount_kes > 0),
  currency text NOT NULL DEFAULT 'KES',
  state text NOT NULL DEFAULT 'ISSUED',
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spi_state_chk CHECK (state IN ('ISSUED','PAYMENT_AUTHORISED','PAID','CANCELLED'))
);
GRANT SELECT ON public.service_provider_invoices TO authenticated;
GRANT ALL ON public.service_provider_invoices TO service_role;
ALTER TABLE public.service_provider_invoices ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.service_provider_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_ref text NOT NULL UNIQUE,
  invoice_id uuid NOT NULL REFERENCES public.service_provider_invoices(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL REFERENCES public.service_provider_claims(id) ON DELETE RESTRICT,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL REFERENCES public.carrier_settlement_destinations(id) ON DELETE RESTRICT,
  msisdn_snapshot text NOT NULL,
  amount_kes numeric(14,2) NOT NULL CHECK (amount_kes > 0),
  currency text NOT NULL DEFAULT 'KES',
  method text NOT NULL DEFAULT 'MPESA',
  state text NOT NULL DEFAULT 'AUTHORISED',
  authorised_by uuid,
  authorised_at timestamptz NOT NULL DEFAULT now(),
  provider_reference text,
  provider_payload jsonb,
  paid_at timestamptz,
  recorded_by uuid,
  failure_reason text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spp_state_chk CHECK (state IN ('AUTHORISED','PENDING_EXECUTION','PAID','FAILED'))
);
GRANT SELECT ON public.service_provider_payments TO authenticated;
GRANT ALL ON public.service_provider_payments TO service_role;
ALTER TABLE public.service_provider_payments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.service_provider_payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text NOT NULL UNIQUE,
  payment_id uuid NOT NULL UNIQUE REFERENCES public.service_provider_payments(id) ON DELETE RESTRICT,
  verification_token text NOT NULL UNIQUE,
  integrity_hash text NOT NULL,
  document_version integer NOT NULL DEFAULT 1,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.service_provider_payment_receipts TO authenticated;
GRANT ALL ON public.service_provider_payment_receipts TO service_role;
ALTER TABLE public.service_provider_payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER spc_touch BEFORE UPDATE ON public.service_provider_claims
FOR EACH ROW EXECUTE FUNCTION public._sales_touch();
CREATE TRIGGER spi_touch BEFORE UPDATE ON public.service_provider_invoices
FOR EACH ROW EXECUTE FUNCTION public._sales_touch();
CREATE TRIGGER spp_touch BEFORE UPDATE ON public.service_provider_payments
FOR EACH ROW EXECUTE FUNCTION public._sales_touch();

CREATE OR REPLACE FUNCTION public._spc_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'CLAIM_EVENTS_APPEND_ONLY'; END $$;
CREATE TRIGGER spc_events_no_mutate BEFORE UPDATE OR DELETE ON public.service_provider_claim_events
FOR EACH ROW EXECUTE FUNCTION public._spc_events_append_only();

-- Payment may never reach PAID without genuine provider evidence.
CREATE OR REPLACE FUNCTION public._spp_evidence_required()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.state = 'PAID' THEN
    IF coalesce(trim(NEW.provider_reference),'') = '' OR NEW.provider_payload IS NULL
       OR NEW.provider_payload = '{}'::jsonb OR NEW.paid_at IS NULL THEN
      RAISE EXCEPTION 'PAYMENT_EVIDENCE_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER spp_evidence BEFORE INSERT OR UPDATE ON public.service_provider_payments
FOR EACH ROW EXECUTE FUNCTION public._spp_evidence_required();

-- Receipt may only exist for an actually paid payment.
CREATE OR REPLACE FUNCTION public._receipt_requires_paid_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_state text;
BEGIN
  SELECT state INTO v_state FROM public.service_provider_payments WHERE id = NEW.payment_id;
  IF v_state IS DISTINCT FROM 'PAID' THEN RAISE EXCEPTION 'RECEIPT_REQUIRES_PAID_PAYMENT'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER spr_requires_paid BEFORE INSERT ON public.service_provider_payment_receipts
FOR EACH ROW EXECUTE FUNCTION public._receipt_requires_paid_payment();

-- RLS
CREATE POLICY spc_read ON public.service_provider_claims FOR SELECT TO authenticated
USING (public._carrier_read_authorised(carrier_id) OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY spc_events_read ON public.service_provider_claim_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.service_provider_claims c WHERE c.id = claim_id
  AND (public._carrier_read_authorised(c.carrier_id) OR public.has_staff_permission('staff.partners.read'))));
CREATE POLICY spi_read ON public.service_provider_invoices FOR SELECT TO authenticated
USING (public._carrier_read_authorised(carrier_id) OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY spp_read ON public.service_provider_payments FOR SELECT TO authenticated
USING (public._carrier_read_authorised(carrier_id) OR public.has_staff_permission('staff.partners.read'));
CREATE POLICY spr_read ON public.service_provider_payment_receipts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.service_provider_payments p WHERE p.id = payment_id
  AND (public._carrier_read_authorised(p.carrier_id) OR public.has_staff_permission('staff.partners.read'))));

-- ---------- claim RPCs ----------
CREATE OR REPLACE FUNCTION public.service_provider_claim_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pod public.carrier_pod_submissions; v_leg public.logistics_order_legs;
        v_dest public.carrier_settlement_destinations; v_ref text; v_id uuid;
        v_payable public.carrier_payable_lines; v_lead public.sales_leads;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_pod FROM public.carrier_pod_submissions WHERE id = (p->>'pod_submission_id')::uuid;
  IF v_pod.id IS NULL THEN RAISE EXCEPTION 'POD_NOT_FOUND'; END IF;
  IF NOT public._carrier_is_member(v_pod.carrier_id) THEN RAISE EXCEPTION 'NOT_YOUR_CARRIER'; END IF;
  IF NOT public._carrier_owns_leg(v_pod.carrier_id, v_pod.leg_id) THEN
    RAISE EXCEPTION 'LEG_NOT_ATTRIBUTED_TO_CARRIER'; END IF;
  SELECT * INTO v_leg FROM public.logistics_order_legs WHERE id = v_pod.leg_id;
  IF v_leg.status <> 'COMPLETED' THEN RAISE EXCEPTION 'SERVICE_NOT_COMPLETED'; END IF;
  IF v_pod.state <> 'APPROVED' THEN RAISE EXCEPTION 'POD_NOT_APPROVED'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_provider_claims c
             WHERE c.pod_submission_id = v_pod.id AND c.state <> 'REJECTED') THEN
    RAISE EXCEPTION 'DUPLICATE_CLAIM';
  END IF;
  SELECT * INTO v_dest FROM public.carrier_settlement_destinations
   WHERE carrier_id = v_pod.carrier_id AND verification_state = 'VERIFIED'
   ORDER BY is_default DESC NULLS LAST LIMIT 1;
  IF v_dest.id IS NULL THEN RAISE EXCEPTION 'NO_VERIFIED_SETTLEMENT_DESTINATION'; END IF;
  IF coalesce(trim(p->>'declaration_name'),'') = '' THEN RAISE EXCEPTION 'CLAIMANT_DECLARATION_REQUIRED'; END IF;
  SELECT * INTO v_payable FROM public.carrier_payable_lines WHERE pod_submission_id = v_pod.id LIMIT 1;
  SELECT * INTO v_lead FROM public.sales_leads WHERE order_id = v_leg.order_id LIMIT 1;
  v_ref := 'CLM-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO public.service_provider_claims (claim_ref, carrier_id, submitted_by, destination_id, order_id,
    leg_id, pod_submission_id, payable_line_id, sales_lead_id, sales_staff_id, customer_label, service_date,
    origin_label, destination_label, service_description, agreed_amount_kes, claimed_amount_kes,
    supporting_documents, declaration_name, declaration_accepted_at, state, submitted_at)
  VALUES (v_ref, v_pod.carrier_id, auth.uid(), v_dest.id, v_leg.order_id, v_leg.id, v_pod.id,
    v_payable.id, v_lead.id, v_lead.sales_staff_id, v_lead.organisation_name, v_leg.actual_arrival::date,
    v_leg.origin_label, v_leg.destination_label, trim(coalesce(p->>'service_description','Completed freight movement')),
    v_payable.net_payable, COALESCE((p->>'claimed_amount_kes')::numeric, v_payable.net_payable),
    COALESCE(p->'supporting_documents','[]'::jsonb), trim(p->>'declaration_name'), now(), 'SUBMITTED', now())
  RETURNING id INTO v_id;
  INSERT INTO public.service_provider_claim_events (claim_id, action, state_to, actor_user_id, detail)
  VALUES (v_id,'SUBMITTED','SUBMITTED',auth.uid(),
    jsonb_build_object('claim_ref',v_ref,'pod_submission_id',v_pod.id,'leg_id',v_leg.id));
  RETURN jsonb_build_object('claim_id',v_id,'claim_ref',v_ref,'state','SUBMITTED');
END $$;
REVOKE ALL ON FUNCTION public.service_provider_claim_submit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_provider_claim_submit(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_provider_claim_review(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim public.service_provider_claims; v_action text; v_to text; v_amount numeric;
        v_pod_state text;
BEGIN
  IF NOT public.has_staff_permission('staff.partners.manage') THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT * INTO v_claim FROM public.service_provider_claims WHERE id = (p->>'claim_id')::uuid;
  IF v_claim.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.submitted_by = auth.uid() THEN RAISE EXCEPTION 'SEPARATION_OF_DUTIES'; END IF;
  v_action := upper(trim(p->>'action'));
  IF v_claim.state IN ('PAID','CLOSED','REJECTED') THEN RAISE EXCEPTION 'CLAIM_CLOSED'; END IF;
  IF v_action = 'OPEN_REVIEW' THEN v_to := 'ADMIN_REVIEW';
  ELSIF v_action = 'QUERY' THEN v_to := 'QUERY';
  ELSIF v_action = 'REJECT' THEN v_to := 'REJECTED';
  ELSIF v_action = 'APPROVE' THEN
    SELECT state INTO v_pod_state FROM public.carrier_pod_submissions WHERE id = v_claim.pod_submission_id;
    IF v_pod_state IS DISTINCT FROM 'APPROVED' THEN RAISE EXCEPTION 'POD_NOT_APPROVED'; END IF;
    v_amount := COALESCE((p->>'approved_amount_kes')::numeric, v_claim.claimed_amount_kes);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_APPROVED_AMOUNT'; END IF;
    v_to := 'APPROVED';
  ELSE RAISE EXCEPTION 'UNKNOWN_ACTION'; END IF;
  UPDATE public.service_provider_claims
     SET state = v_to, approved_amount_kes = COALESCE(v_amount, approved_amount_kes),
         review_notes = nullif(trim(coalesce(p->>'note','')),''), reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = v_claim.id;
  INSERT INTO public.service_provider_claim_events (claim_id, action, state_from, state_to, note, actor_user_id, detail)
  VALUES (v_claim.id, v_action, v_claim.state, v_to, nullif(trim(coalesce(p->>'note','')),''), auth.uid(),
    jsonb_build_object('approved_amount_kes',v_amount));
  RETURN jsonb_build_object('claim_id',v_claim.id,'state',v_to,'approved_amount_kes',v_amount);
END $$;
REVOKE ALL ON FUNCTION public.service_provider_claim_review(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_provider_claim_review(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_provider_invoice_issue(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim public.service_provider_claims; v_ref text; v_id uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.partners.manage') THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT * INTO v_claim FROM public.service_provider_claims WHERE id = (p->>'claim_id')::uuid;
  IF v_claim.id IS NULL THEN RAISE EXCEPTION 'CLAIM_NOT_FOUND'; END IF;
  IF v_claim.state NOT IN ('APPROVED') THEN RAISE EXCEPTION 'CLAIM_NOT_APPROVED'; END IF;
  IF EXISTS (SELECT 1 FROM public.service_provider_invoices WHERE claim_id = v_claim.id) THEN
    SELECT id, invoice_ref INTO v_id, v_ref FROM public.service_provider_invoices WHERE claim_id = v_claim.id;
    RETURN jsonb_build_object('invoice_id',v_id,'invoice_ref',v_ref,'idempotent',true);
  END IF;
  v_ref := 'INV-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO public.service_provider_invoices (invoice_ref, claim_id, carrier_id, order_id, leg_id,
    pod_submission_id, payable_line_id, sales_staff_id, amount_kes, currency, issued_by)
  VALUES (v_ref, v_claim.id, v_claim.carrier_id, v_claim.order_id, v_claim.leg_id, v_claim.pod_submission_id,
    v_claim.payable_line_id, v_claim.sales_staff_id, v_claim.approved_amount_kes, v_claim.currency, auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.service_provider_claims SET state = 'INVOICED' WHERE id = v_claim.id;
  INSERT INTO public.service_provider_claim_events (claim_id, action, state_from, state_to, actor_user_id, detail)
  VALUES (v_claim.id,'INVOICED','APPROVED','INVOICED',auth.uid(),
    jsonb_build_object('invoice_id',v_id,'invoice_ref',v_ref,'amount_kes',v_claim.approved_amount_kes));
  RETURN jsonb_build_object('invoice_id',v_id,'invoice_ref',v_ref,'amount_kes',v_claim.approved_amount_kes);
END $$;
REVOKE ALL ON FUNCTION public.service_provider_invoice_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_provider_invoice_issue(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_provider_payment_authorise(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv public.service_provider_invoices; v_claim public.service_provider_claims;
        v_dest public.carrier_settlement_destinations; v_ref text; v_id uuid; v_idem text;
BEGIN
  IF NOT public.has_staff_permission('staff.partners.manage') THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT * INTO v_inv FROM public.service_provider_invoices WHERE id = (p->>'invoice_id')::uuid;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  SELECT * INTO v_claim FROM public.service_provider_claims WHERE id = v_inv.claim_id;
  IF v_inv.amount_kes <> v_claim.approved_amount_kes THEN RAISE EXCEPTION 'INVOICE_AMOUNT_MISMATCH'; END IF;
  SELECT * INTO v_dest FROM public.carrier_settlement_destinations WHERE id = v_claim.destination_id;
  IF v_dest.id IS NULL OR v_dest.carrier_id <> v_inv.carrier_id THEN RAISE EXCEPTION 'DESTINATION_NOT_REGISTERED'; END IF;
  IF v_dest.verification_state <> 'VERIFIED' THEN RAISE EXCEPTION 'DESTINATION_NOT_VERIFIED'; END IF;
  IF v_dest.destination_type = 'MPESA' AND coalesce(trim(v_dest.msisdn),'') = '' THEN
    RAISE EXCEPTION 'DESTINATION_MSISDN_MISSING'; END IF;
  v_idem := COALESCE(nullif(trim(coalesce(p->>'idempotency_key','')),''), 'inv:' || v_inv.id::text);
  SELECT id, payment_ref INTO v_id, v_ref FROM public.service_provider_payments WHERE idempotency_key = v_idem;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('payment_id',v_id,'payment_ref',v_ref,'idempotent',true);
  END IF;
  v_ref := 'PAY-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO public.service_provider_payments (payment_ref, invoice_id, claim_id, carrier_id, destination_id,
    msisdn_snapshot, amount_kes, currency, state, authorised_by, idempotency_key)
  VALUES (v_ref, v_inv.id, v_claim.id, v_inv.carrier_id, v_dest.id, coalesce(v_dest.msisdn,''),
    v_inv.amount_kes, v_inv.currency, 'AUTHORISED', auth.uid(), v_idem)
  RETURNING id INTO v_id;
  UPDATE public.service_provider_invoices SET state = 'PAYMENT_AUTHORISED' WHERE id = v_inv.id;
  UPDATE public.service_provider_claims SET state = 'PAYMENT_AUTHORISED' WHERE id = v_claim.id;
  INSERT INTO public.service_provider_claim_events (claim_id, action, state_from, state_to, actor_user_id, detail)
  VALUES (v_claim.id,'PAYMENT_AUTHORISED','INVOICED','PAYMENT_AUTHORISED',auth.uid(),
    jsonb_build_object('payment_id',v_id,'payment_ref',v_ref,'destination_id',v_dest.id));
  RETURN jsonb_build_object('payment_id',v_id,'payment_ref',v_ref,'state','AUTHORISED','amount_kes',v_inv.amount_kes);
END $$;
REVOKE ALL ON FUNCTION public.service_provider_payment_authorise(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_provider_payment_authorise(jsonb) TO authenticated, service_role;

-- Payment evidence is recorded by the platform (service_role) only: no UI button
-- may declare a payment paid.
CREATE OR REPLACE FUNCTION public.service_provider_payment_record_evidence(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pay public.service_provider_payments; v_receipt text; v_token text; v_hash text; v_rid uuid;
BEGIN
  SELECT * INTO v_pay FROM public.service_provider_payments WHERE id = (p->>'payment_id')::uuid;
  IF v_pay.id IS NULL THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;
  IF v_pay.state = 'PAID' THEN
    SELECT receipt_no INTO v_receipt FROM public.service_provider_payment_receipts WHERE payment_id = v_pay.id;
    RETURN jsonb_build_object('payment_id',v_pay.id,'state','PAID','receipt_no',v_receipt,'idempotent',true);
  END IF;
  IF coalesce(trim(p->>'provider_reference'),'') = '' OR p->'provider_payload' IS NULL
     OR p->'provider_payload' = '{}'::jsonb THEN
    RAISE EXCEPTION 'PAYMENT_EVIDENCE_REQUIRED';
  END IF;
  UPDATE public.service_provider_payments
     SET state = 'PAID', provider_reference = trim(p->>'provider_reference'),
         provider_payload = p->'provider_payload', paid_at = now(), recorded_by = auth.uid()
   WHERE id = v_pay.id;
  UPDATE public.service_provider_invoices SET state = 'PAID' WHERE id = v_pay.invoice_id;
  UPDATE public.service_provider_claims SET state = 'PAID' WHERE id = v_pay.claim_id;
  v_receipt := 'YBL-RCPT-' || to_char(now(),'YYYYMM') || '-' ||
               lpad((SELECT count(*) + 1 FROM public.service_provider_payment_receipts)::text, 6, '0');
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  v_hash := encode(digest(v_receipt || '|' || v_pay.id::text || '|' || v_pay.amount_kes::text || '|' ||
            trim(p->>'provider_reference') || '|' || v_token, 'sha256'), 'hex');
  INSERT INTO public.service_provider_payment_receipts (receipt_no, payment_id, verification_token, integrity_hash, issued_by)
  VALUES (v_receipt, v_pay.id, v_token, v_hash, auth.uid()) RETURNING id INTO v_rid;
  INSERT INTO public.service_provider_claim_events (claim_id, action, state_from, state_to, actor_user_id, detail)
  VALUES (v_pay.claim_id,'PAID','PAYMENT_AUTHORISED','PAID',auth.uid(),
    jsonb_build_object('payment_id',v_pay.id,'provider_reference',trim(p->>'provider_reference'),'receipt_no',v_receipt));
  RETURN jsonb_build_object('payment_id',v_pay.id,'state','PAID','receipt_id',v_rid,'receipt_no',v_receipt);
END $$;
REVOKE ALL ON FUNCTION public.service_provider_payment_record_evidence(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_provider_payment_record_evidence(jsonb) TO service_role;