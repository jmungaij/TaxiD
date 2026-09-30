-- ============================================================
-- COMMERCIAL LIFECYCLE (QUOTE-TO-CASH) STATE MACHINE
-- Won is NOT revenue. Revenue is a state, reached only with evidence.
-- ============================================================

CREATE TABLE public.commercial_state_registry (
  state              text PRIMARY KEY,
  seq                int  NOT NULL,
  label              text NOT NULL,
  description        text NOT NULL,
  entry_condition    text NOT NULL,
  exit_condition     text NOT NULL,
  revenue_treatment  text NOT NULL DEFAULT 'none'
                     CHECK (revenue_treatment IN ('none','pipeline','contracted','qualifying')),
  is_terminal        boolean NOT NULL DEFAULT false,
  work_kind          text,
  work_title         text,
  sla_minutes        int,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.commercial_state_registry TO authenticated;
GRANT ALL    ON public.commercial_state_registry TO service_role;
ALTER TABLE public.commercial_state_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read state registry" ON public.commercial_state_registry
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);

INSERT INTO public.commercial_state_registry
 (state, seq, label, description, entry_condition, exit_condition, revenue_treatment, is_terminal, work_kind, work_title, sla_minutes) VALUES
 ('LEAD',        10,'Lead','An enquiry has been captured but not yet qualified.',
   'Enquiry recorded with a customer and a responsible salesperson.',
   'Requirement understood and the customer qualifies.','none',false,
   'sales_qualify','Qualify the enquiry', 1440),
 ('OPPORTUNITY', 20,'Opportunity','A qualified requirement being priced and proposed.',
   'Requirement, service and indicative value confirmed.',
   'Customer accepts the quotation in writing.','pipeline',false,
   'sales_proposal','Price and issue the quotation', 2880),
 ('WON',         30,'Won','The customer has accepted commercially. This is not revenue.',
   'Accepted quotation or written acceptance on file.',
   'Contract executed, or contract confirmed as not required.','pipeline',false,
   'sales_contract','Put the commercial agreement in place', 2880),
 ('CONTRACTED',  40,'Contracted','A binding agreement is in force.',
   'Executed Mobility Service Contract, or a recorded waiver where none is required.',
   'Customer authorisation to purchase and a service order exist.','contracted',false,
   'sales_order','Obtain purchase authorisation and raise the service order', 2880),
 ('ORDERED',     50,'Ordered','The service has been ordered and scheduled.',
   'Service order raised; purchase order or LPO received where required.',
   'Service performed.','contracted',false,
   'ops_deliver','Deliver the ordered service', 4320),
 ('DELIVERED',   60,'Delivered','The service has been performed.',
   'Service completion recorded.',
   'Proof of delivery accepted.','contracted',false,
   'ops_pod','Collect and verify proof of delivery', 2880),
 ('BILLABLE',    70,'Billable','Delivery is evidenced, so the work can be billed.',
   'Accepted proof of delivery on file.',
   'Invoice issued.','contracted',false,
   'finance_invoice','Raise the invoice', 1440),
 ('INVOICED',    80,'Invoiced','An invoice has been issued. Still not revenue.',
   'Issued invoice linked to the delivered service.',
   'Revenue recognition rule satisfied.','contracted',false,
   'finance_recognise','Confirm revenue recognition', 2880),
 ('RECOGNISED',  90,'Revenue recognised','Qualifying revenue. This is what counts to target.',
   'Invoice issued against evidenced delivery and the recognition rule satisfied.',
   'Cash received in full.','qualifying',false,
   'finance_collect','Follow up payment', 4320),
 ('COLLECTED',  100,'Cash collected','Payment received in full.',
   'Payment or remittance recorded against the invoice.',
   'Terminal state.','qualifying',true, NULL, NULL, NULL),
 ('LOST',       900,'Lost','The customer did not proceed.',
   'Loss reason recorded.','Terminal state.','none',true,NULL,NULL,NULL),
 ('CANCELLED',  910,'Cancelled','The transaction was withdrawn after acceptance.',
   'Cancellation reason recorded.','Terminal state.','none',true,NULL,NULL,NULL);

-- Evidence each state requires (configurable, never hard-coded in the UI)
CREATE TABLE public.commercial_state_requirements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state         text NOT NULL REFERENCES public.commercial_state_registry(state) ON DELETE CASCADE,
  document_type text NOT NULL,
  label         text NOT NULL,
  is_required   boolean NOT NULL DEFAULT true,
  applies_when  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state, document_type)
);
GRANT SELECT ON public.commercial_state_requirements TO authenticated;
GRANT ALL    ON public.commercial_state_requirements TO service_role;
ALTER TABLE public.commercial_state_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read state requirements" ON public.commercial_state_requirements
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);

INSERT INTO public.commercial_state_requirements (state, document_type, label, is_required) VALUES
 ('WON',        'quotation_accepted',         'Accepted quotation or written acceptance', true),
 ('CONTRACTED', 'mobility_service_contract',  'Executed Mobility Service Contract',      true),
 ('ORDERED',    'purchase_order',             'Customer purchase order or LPO',          false),
 ('ORDERED',    'service_order',              'Booking confirmation / service order',    true),
 ('DELIVERED',  'service_completion',         'Service completion record',               true),
 ('BILLABLE',   'pod',                        'Accepted proof of delivery',              true),
 ('INVOICED',   'invoice',                    'Issued invoice',                          true),
 ('RECOGNISED', 'invoice',                    'Issued invoice',                          true),
 ('COLLECTED',  'payment',                    'Payment or remittance record',            true);

-- One lifecycle record per Commercial Book enquiry
CREATE TABLE public.commercial_lifecycle (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid NOT NULL UNIQUE REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  lead_ref            text,
  account_id          uuid,
  opportunity_id      uuid,
  staff_member_id     uuid,
  current_state       text NOT NULL DEFAULT 'LEAD' REFERENCES public.commercial_state_registry(state),
  opportunity_value_kes numeric,
  contracted_value_kes  numeric,
  ordered_value_kes     numeric,
  delivered_value_kes   numeric,
  billable_value_kes    numeric,
  invoiced_value_kes    numeric,
  recognised_value_kes  numeric,
  collected_value_kes   numeric,
  won_at         timestamptz,
  contracted_at  timestamptz,
  ordered_at     timestamptz,
  delivered_at   timestamptz,
  billable_at    timestamptz,
  invoiced_at    timestamptz,
  recognised_at  timestamptz,
  collected_at   timestamptz,
  lost_at        timestamptz,
  cancelled_at   timestamptz,
  blocked_reason text,
  is_test        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_lifecycle_state_idx ON public.commercial_lifecycle (current_state, is_test);
CREATE INDEX commercial_lifecycle_staff_idx ON public.commercial_lifecycle (staff_member_id, recognised_at);
GRANT SELECT ON public.commercial_lifecycle TO authenticated;
GRANT ALL    ON public.commercial_lifecycle TO service_role;
ALTER TABLE public.commercial_lifecycle ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read lifecycle" ON public.commercial_lifecycle
  FOR SELECT TO authenticated
  USING (public.is_commercial_staff() OR staff_member_id = public._my_staff_member_id());

CREATE TRIGGER trg_commercial_lifecycle_touch
  BEFORE UPDATE ON public.commercial_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public._sales_touch();

-- Append-only transition history
CREATE TABLE public.commercial_lifecycle_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_id  uuid NOT NULL REFERENCES public.commercial_lifecycle(id) ON DELETE CASCADE,
  lead_ref      text,
  from_state    text,
  to_state      text NOT NULL,
  amount_kes    numeric,
  reason        text,
  evidence      jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_override   boolean NOT NULL DEFAULT false,
  actor_id      uuid,
  actor_staff_id uuid,
  work_item_id  uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_lifecycle_events_idx ON public.commercial_lifecycle_events (lifecycle_id, created_at DESC);
GRANT SELECT ON public.commercial_lifecycle_events TO authenticated;
GRANT ALL    ON public.commercial_lifecycle_events TO service_role;
ALTER TABLE public.commercial_lifecycle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read lifecycle events" ON public.commercial_lifecycle_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.commercial_lifecycle l
                  WHERE l.id = lifecycle_id
                    AND (public.is_commercial_staff() OR l.staff_member_id = public._my_staff_member_id())));
CREATE TRIGGER trg_commercial_lifecycle_events_append_only
  BEFORE UPDATE OR DELETE ON public.commercial_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public._sales_append_only();

-- Evidence register (append-only)
CREATE TABLE public.commercial_lifecycle_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_id  uuid NOT NULL REFERENCES public.commercial_lifecycle(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  reference     text,
  document_id   uuid,
  document_table text,
  note          text,
  recorded_by   uuid,
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_lifecycle_evidence_idx ON public.commercial_lifecycle_evidence (lifecycle_id, document_type);
GRANT SELECT ON public.commercial_lifecycle_evidence TO authenticated;
GRANT ALL    ON public.commercial_lifecycle_evidence TO service_role;
ALTER TABLE public.commercial_lifecycle_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read lifecycle evidence" ON public.commercial_lifecycle_evidence
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.commercial_lifecycle l
                  WHERE l.id = lifecycle_id
                    AND (public.is_commercial_staff() OR l.staff_member_id = public._my_staff_member_id())));
CREATE TRIGGER trg_commercial_lifecycle_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.commercial_lifecycle_evidence
  FOR EACH ROW EXECUTE FUNCTION public._sales_append_only();

-- Configurable revenue rule
ALTER TABLE public.sales_engine_settings
  ADD COLUMN IF NOT EXISTS revenue_basis text NOT NULL DEFAULT 'RECOGNISED',
  ADD COLUMN IF NOT EXISTS require_state_evidence boolean NOT NULL DEFAULT true;
ALTER TABLE public.sales_engine_settings
  DROP CONSTRAINT IF EXISTS sales_engine_settings_revenue_basis_check;
ALTER TABLE public.sales_engine_settings
  ADD CONSTRAINT sales_engine_settings_revenue_basis_check
  CHECK (revenue_basis IN ('RECOGNISED','COLLECTED','CLOSED_WON'));

-- ============================================================
-- Engine
-- ============================================================

CREATE OR REPLACE FUNCTION public._commercial_state_seq(_state text)
RETURNS int LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT seq FROM public.commercial_state_registry WHERE state = _state
$$;
REVOKE ALL ON FUNCTION public._commercial_state_seq(text) FROM PUBLIC, anon;

-- Missing required evidence for a target state
CREATE OR REPLACE FUNCTION public._commercial_missing_evidence(_lifecycle uuid, _state text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('document_type', r.document_type, 'label', r.label)), '[]'::jsonb)
    FROM public.commercial_state_requirements r
   WHERE r.state = _state AND r.is_required
     AND NOT EXISTS (
       SELECT 1 FROM public.commercial_lifecycle_evidence e
        WHERE e.lifecycle_id = _lifecycle AND e.document_type = r.document_type)
$$;
REVOKE ALL ON FUNCTION public._commercial_missing_evidence(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._commercial_missing_evidence(uuid, text) TO authenticated;

-- Ensure a lifecycle record exists for an enquiry
CREATE OR REPLACE FUNCTION public.commercial_lifecycle_ensure(_lead uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_l record; v_state text;
BEGIN
  SELECT id INTO v_id FROM public.commercial_lifecycle WHERE lead_id = _lead;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT * INTO v_l FROM public.sales_leads WHERE id = _lead;
  IF v_l.id IS NULL THEN RETURN NULL; END IF;

  v_state := CASE
    WHEN v_l.stage = 'CLOSED_WON' THEN 'WON'
    WHEN v_l.stage IN ('CLOSED_LOST','DISQUALIFIED') THEN 'LOST'
    WHEN v_l.stage IN ('NEW','CONTACTED') THEN 'LEAD'
    ELSE 'OPPORTUNITY' END;

  INSERT INTO public.commercial_lifecycle
    (lead_id, lead_ref, account_id, opportunity_id, staff_member_id, current_state,
     opportunity_value_kes, won_at, lost_at, is_test)
  VALUES (_lead, v_l.lead_ref, v_l.account_id, v_l.opportunity_id, v_l.sales_staff_id, v_state,
     v_l.estimated_value_kes,
     CASE WHEN v_state='WON'  THEN coalesce(v_l.closed_at, v_l.updated_at) END,
     CASE WHEN v_state='LOST' THEN coalesce(v_l.closed_at, v_l.updated_at) END,
     coalesce(v_l.is_test,false))
  RETURNING id INTO v_id;

  INSERT INTO public.commercial_lifecycle_events (lifecycle_id, lead_ref, from_state, to_state, amount_kes, reason)
  VALUES (v_id, v_l.lead_ref, NULL, v_state, v_l.estimated_value_kes, 'Lifecycle opened from the Commercial Book record');

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.commercial_lifecycle_ensure(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_lifecycle_ensure(uuid) TO authenticated;

-- Record evidence against a lifecycle
CREATE OR REPLACE FUNCTION public.commercial_lifecycle_evidence_add(
  _lead uuid, _document_type text, _reference text DEFAULT NULL,
  _document_id uuid DEFAULT NULL, _document_table text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lc uuid; v_me uuid; v_id uuid;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  v_lc := public.commercial_lifecycle_ensure(_lead);
  IF v_lc IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_RECORD_NOT_FOUND'; END IF;

  INSERT INTO public.commercial_lifecycle_evidence
    (lifecycle_id, document_type, reference, document_id, document_table, note, recorded_by)
  VALUES (v_lc, _document_type, _reference, _document_id, _document_table, _note, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.commercial_lifecycle_evidence_add(uuid, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_lifecycle_evidence_add(uuid, text, text, uuid, text, text) TO authenticated;

-- Advance (or, with override, correct) the commercial state
CREATE OR REPLACE FUNCTION public.commercial_lifecycle_advance(
  _lead uuid, _to_state text, _amount numeric DEFAULT NULL,
  _reason text DEFAULT NULL, _override boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lc public.commercial_lifecycle; v_reg public.commercial_state_registry;
  v_me uuid; v_missing jsonb; v_from text; v_from_seq int; v_to_seq int;
  v_may_override boolean; v_amount numeric; v_work uuid; v_settings record;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;

  PERFORM public.commercial_lifecycle_ensure(_lead);
  SELECT * INTO v_lc FROM public.commercial_lifecycle WHERE lead_id = _lead FOR UPDATE;
  IF v_lc.id IS NULL THEN RAISE EXCEPTION 'COMMERCIAL_RECORD_NOT_FOUND'; END IF;

  SELECT * INTO v_reg FROM public.commercial_state_registry WHERE state = _to_state;
  IF v_reg.state IS NULL THEN RAISE EXCEPTION 'UNKNOWN_STATE'; END IF;

  v_may_override := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
                    OR public.has_staff_permission('staff.commercial.approve');
  v_from := v_lc.current_state;
  v_from_seq := public._commercial_state_seq(v_from);
  v_to_seq   := v_reg.seq;
  SELECT * INTO v_settings FROM public.sales_engine_settings LIMIT 1;

  IF v_from = _to_state THEN RAISE EXCEPTION 'ALREADY_IN_STATE'; END IF;

  -- Terminal states are reachable from anywhere; otherwise only the next step forward.
  IF _to_state NOT IN ('LOST','CANCELLED') THEN
    IF v_from IN ('LOST','CANCELLED','COLLECTED') AND NOT (_override AND v_may_override) THEN
      RAISE EXCEPTION 'RECORD_IS_CLOSED';
    END IF;
    IF v_to_seq < v_from_seq AND NOT (_override AND v_may_override) THEN
      RAISE EXCEPTION 'BACKWARD_TRANSITION_REQUIRES_OVERRIDE';
    END IF;
    IF v_to_seq > v_from_seq
       AND v_to_seq <> (SELECT min(seq) FROM public.commercial_state_registry
                         WHERE seq > v_from_seq AND NOT is_terminal)
       AND NOT (_override AND v_may_override) THEN
      RAISE EXCEPTION 'STEP_SKIPPED_REQUIRES_OVERRIDE';
    END IF;
  END IF;

  IF _override AND NOT v_may_override THEN RAISE EXCEPTION 'OVERRIDE_NOT_PERMITTED'; END IF;
  IF _override AND coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED'; END IF;

  v_missing := public._commercial_missing_evidence(v_lc.id, _to_state);
  IF jsonb_array_length(v_missing) > 0
     AND coalesce(v_settings.require_state_evidence, true)
     AND _to_state NOT IN ('LOST','CANCELLED')
     AND NOT _override THEN
    RETURN jsonb_build_object('ok', false, 'error', 'DOCUMENTATION_INCOMPLETE',
      'state', v_from, 'requested_state', _to_state, 'missing', v_missing);
  END IF;

  v_amount := coalesce(_amount, v_lc.opportunity_value_kes,
                       (SELECT estimated_value_kes FROM public.sales_leads WHERE id = _lead));

  UPDATE public.commercial_lifecycle SET
    current_state = _to_state,
    blocked_reason = CASE WHEN jsonb_array_length(v_missing) > 0 THEN 'Overridden with missing evidence' END,
    contracted_value_kes = CASE WHEN _to_state='CONTRACTED'  THEN v_amount ELSE contracted_value_kes END,
    ordered_value_kes    = CASE WHEN _to_state='ORDERED'     THEN v_amount ELSE ordered_value_kes END,
    delivered_value_kes  = CASE WHEN _to_state='DELIVERED'   THEN v_amount ELSE delivered_value_kes END,
    billable_value_kes   = CASE WHEN _to_state='BILLABLE'    THEN v_amount ELSE billable_value_kes END,
    invoiced_value_kes   = CASE WHEN _to_state='INVOICED'    THEN v_amount ELSE invoiced_value_kes END,
    recognised_value_kes = CASE WHEN _to_state='RECOGNISED'  THEN v_amount ELSE recognised_value_kes END,
    collected_value_kes  = CASE WHEN _to_state='COLLECTED'   THEN v_amount ELSE collected_value_kes END,
    won_at        = CASE WHEN _to_state='WON'        THEN coalesce(won_at, now())        ELSE won_at END,
    contracted_at = CASE WHEN _to_state='CONTRACTED' THEN coalesce(contracted_at, now()) ELSE contracted_at END,
    ordered_at    = CASE WHEN _to_state='ORDERED'    THEN coalesce(ordered_at, now())    ELSE ordered_at END,
    delivered_at  = CASE WHEN _to_state='DELIVERED'  THEN coalesce(delivered_at, now())  ELSE delivered_at END,
    billable_at   = CASE WHEN _to_state='BILLABLE'   THEN coalesce(billable_at, now())   ELSE billable_at END,
    invoiced_at   = CASE WHEN _to_state='INVOICED'   THEN coalesce(invoiced_at, now())   ELSE invoiced_at END,
    recognised_at = CASE WHEN _to_state='RECOGNISED' THEN coalesce(recognised_at, now()) ELSE recognised_at END,
    collected_at  = CASE WHEN _to_state='COLLECTED'  THEN coalesce(collected_at, now())  ELSE collected_at END,
    lost_at       = CASE WHEN _to_state='LOST'       THEN coalesce(lost_at, now())       ELSE lost_at END,
    cancelled_at  = CASE WHEN _to_state='CANCELLED'  THEN coalesce(cancelled_at, now())  ELSE cancelled_at END
  WHERE id = v_lc.id;

  -- Exactly one follow-up task per state, never a duplicate
  IF v_reg.work_kind IS NOT NULL AND v_lc.staff_member_id IS NOT NULL THEN
    v_work := public._sales_work_ensure(
      v_lc.staff_member_id, v_reg.work_kind,
      v_reg.work_title || ' — ' || coalesce(v_lc.lead_ref,'enquiry'),
      v_reg.exit_condition, 'commercial_lifecycle', v_lc.id, v_lc.lead_ref, 'high', v_reg.sla_minutes);
  END IF;

  INSERT INTO public.commercial_lifecycle_events
    (lifecycle_id, lead_ref, from_state, to_state, amount_kes, reason, missing_evidence,
     is_override, actor_id, actor_staff_id, work_item_id)
  VALUES (v_lc.id, v_lc.lead_ref, v_from, _to_state, v_amount, _reason, v_missing,
     coalesce(_override,false), auth.uid(), v_me, v_work);

  RETURN jsonb_build_object('ok', true, 'state', _to_state, 'from', v_from,
    'amount_kes', v_amount, 'work_item_id', v_work,
    'revenue_treatment', v_reg.revenue_treatment,
    'overridden_missing', v_missing);
END $$;
REVOKE ALL ON FUNCTION public.commercial_lifecycle_advance(uuid, text, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_lifecycle_advance(uuid, text, numeric, text, boolean) TO authenticated;

-- Readiness / lifecycle view of one commercial record
CREATE OR REPLACE FUNCTION public.commercial_lifecycle_detail(_lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lc public.commercial_lifecycle; v_states jsonb; v_seq int;
BEGIN
  IF public._my_staff_member_id() IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  SELECT * INTO v_lc FROM public.commercial_lifecycle WHERE lead_id = _lead;
  IF v_lc.id IS NULL THEN RETURN jsonb_build_object('exists', false); END IF;
  v_seq := public._commercial_state_seq(v_lc.current_state);

  SELECT jsonb_agg(jsonb_build_object(
           'state', r.state, 'label', r.label, 'seq', r.seq,
           'description', r.description,
           'entry_condition', r.entry_condition, 'exit_condition', r.exit_condition,
           'revenue_treatment', r.revenue_treatment,
           'position', CASE WHEN r.seq < v_seq THEN 'complete'
                            WHEN r.seq = v_seq THEN 'current' ELSE 'pending' END,
           'missing', public._commercial_missing_evidence(v_lc.id, r.state)
         ) ORDER BY r.seq)
    INTO v_states FROM public.commercial_state_registry r WHERE NOT r.is_terminal OR r.state='COLLECTED';

  RETURN jsonb_build_object(
    'exists', true,
    'lifecycle_id', v_lc.id,
    'lead_id', v_lc.lead_id,
    'lead_ref', v_lc.lead_ref,
    'current_state', v_lc.current_state,
    'current_label', (SELECT label FROM public.commercial_state_registry WHERE state=v_lc.current_state),
    'revenue_treatment', (SELECT revenue_treatment FROM public.commercial_state_registry WHERE state=v_lc.current_state),
    'is_revenue', (SELECT revenue_treatment='qualifying' FROM public.commercial_state_registry WHERE state=v_lc.current_state),
    'values', jsonb_build_object(
      'opportunity_kes', v_lc.opportunity_value_kes, 'contracted_kes', v_lc.contracted_value_kes,
      'ordered_kes', v_lc.ordered_value_kes, 'delivered_kes', v_lc.delivered_value_kes,
      'billable_kes', v_lc.billable_value_kes, 'invoiced_kes', v_lc.invoiced_value_kes,
      'recognised_kes', v_lc.recognised_value_kes, 'collected_kes', v_lc.collected_value_kes),
    'blocked_reason', v_lc.blocked_reason,
    'states', coalesce(v_states,'[]'::jsonb),
    'next_missing', public._commercial_missing_evidence(v_lc.id,
       (SELECT state FROM public.commercial_state_registry
         WHERE seq > v_seq AND NOT is_terminal ORDER BY seq LIMIT 1)),
    'next_state', (SELECT state FROM public.commercial_state_registry
                    WHERE seq > v_seq AND NOT is_terminal ORDER BY seq LIMIT 1),
    'evidence', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'document_type', e.document_type, 'reference', e.reference,
                    'recorded_at', e.recorded_at, 'note', e.note) ORDER BY e.recorded_at DESC), '[]'::jsonb)
                   FROM public.commercial_lifecycle_evidence e WHERE e.lifecycle_id = v_lc.id),
    'history', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'from_state', x.from_state, 'to_state', x.to_state, 'amount_kes', x.amount_kes,
                    'reason', x.reason, 'is_override', x.is_override, 'at', x.created_at)
                    ORDER BY x.created_at DESC), '[]'::jsonb)
                  FROM public.commercial_lifecycle_events x WHERE x.lifecycle_id = v_lc.id)
  );
END $$;
REVOKE ALL ON FUNCTION public.commercial_lifecycle_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_lifecycle_detail(uuid) TO authenticated;

-- Qualifying revenue, period-anchored so historical months never move
CREATE OR REPLACE FUNCTION public.commercial_qualifying_revenue(
  _staff uuid, _from timestamptz, _to timestamptz, _include_test boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_basis text; v_total numeric := 0;
BEGIN
  SELECT coalesce(revenue_basis,'RECOGNISED') INTO v_basis FROM public.sales_engine_settings LIMIT 1;

  IF v_basis = 'CLOSED_WON' THEN
    SELECT coalesce(sum(estimated_value_kes),0) INTO v_total FROM public.sales_leads
     WHERE sales_staff_id = _staff AND stage='CLOSED_WON'
       AND (_include_test OR NOT is_test) AND closed_at >= _from AND closed_at < _to;
  ELSIF v_basis = 'COLLECTED' THEN
    SELECT coalesce(sum(coalesce(collected_value_kes, recognised_value_kes, 0)),0) INTO v_total
      FROM public.commercial_lifecycle
     WHERE staff_member_id = _staff AND (_include_test OR NOT is_test)
       AND collected_at >= _from AND collected_at < _to;
  ELSE
    SELECT coalesce(sum(coalesce(recognised_value_kes, opportunity_value_kes, 0)),0) INTO v_total
      FROM public.commercial_lifecycle
     WHERE staff_member_id = _staff AND (_include_test OR NOT is_test)
       AND recognised_at >= _from AND recognised_at < _to;
  END IF;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION public.commercial_qualifying_revenue(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_qualifying_revenue(uuid, timestamptz, timestamptz, boolean) TO authenticated;

-- Backfill a lifecycle record for every existing enquiry
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sales_leads LOOP
    PERFORM public.commercial_lifecycle_ensure(r.id);
  END LOOP;
END $$;

-- Keep the lifecycle in step with the Commercial Book record
CREATE OR REPLACE FUNCTION public._commercial_lifecycle_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lc uuid;
BEGIN
  v_lc := public.commercial_lifecycle_ensure(NEW.id);
  IF v_lc IS NULL THEN RETURN NEW; END IF;

  UPDATE public.commercial_lifecycle
     SET lead_ref = NEW.lead_ref, account_id = NEW.account_id,
         opportunity_id = NEW.opportunity_id, staff_member_id = NEW.sales_staff_id,
         opportunity_value_kes = NEW.estimated_value_kes,
         is_test = coalesce(NEW.is_test,false)
   WHERE id = v_lc;

  -- Commercial acceptance moves the record to WON only; revenue is never implied.
  IF NEW.stage = 'CLOSED_WON' AND (TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage) THEN
    UPDATE public.commercial_lifecycle
       SET current_state = CASE WHEN public._commercial_state_seq(current_state) <
                                     public._commercial_state_seq('WON')
                                THEN 'WON' ELSE current_state END,
           won_at = coalesce(won_at, NEW.closed_at, now())
     WHERE id = v_lc;
  ELSIF NEW.stage IN ('CLOSED_LOST','DISQUALIFIED') AND (TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM NEW.stage) THEN
    UPDATE public.commercial_lifecycle
       SET current_state='LOST', lost_at = coalesce(lost_at, NEW.closed_at, now())
     WHERE id = v_lc AND current_state NOT IN ('RECOGNISED','COLLECTED');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._commercial_lifecycle_sync() FROM PUBLIC, anon;

CREATE TRIGGER trg_commercial_lifecycle_sync
  AFTER INSERT OR UPDATE OF stage, estimated_value_kes, sales_staff_id, account_id, opportunity_id, is_test
  ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public._commercial_lifecycle_sync();