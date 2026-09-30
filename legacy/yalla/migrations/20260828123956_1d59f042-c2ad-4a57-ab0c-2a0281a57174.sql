-- ============ PHASE 5D — SOURCING, AWARD, EXECUTION BRIDGE ============

-- ------------------------------------------------------------- SCORECARD
CREATE OR REPLACE FUNCTION public.carrier_scorecard(_carrier_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invites int; v_responses int; v_awards int; v_accepted int; v_declined int;
  v_bookings int; v_completed int; v_cancelled int; v_failed int;
  v_pod int; v_exceptions int; v_ontime int; v_delivered int;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.read') OR public._carrier_is_member(_carrier_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;

  SELECT count(*) FILTER (WHERE true),
         count(*) FILTER (WHERE state IN ('RESPONDED')),
         count(*) FILTER (WHERE state = 'DECLINED')
    INTO v_invites, v_responses, v_declined
    FROM public.freight_rfq_invitations WHERE carrier_id = _carrier_id;

  SELECT count(*) INTO v_awards FROM public.freight_awards WHERE carrier_id = _carrier_id AND status='AWARDED';

  SELECT count(*),
         count(*) FILTER (WHERE state = 'COMPLETED'),
         count(*) FILTER (WHERE state = 'CANCELLED'),
         count(*) FILTER (WHERE state = 'FAILED'),
         count(*) FILTER (WHERE carrier_accepted_at IS NOT NULL),
         count(*) FILTER (WHERE state='COMPLETED' AND completed_at IS NOT NULL AND planned_delivery IS NOT NULL AND completed_at <= planned_delivery)
    INTO v_bookings, v_completed, v_cancelled, v_failed, v_accepted, v_ontime
    FROM public.freight_bookings WHERE carrier_id = _carrier_id;

  SELECT count(DISTINCT p.id) INTO v_delivered
    FROM public.freight_bookings b
    JOIN public.packages p ON p.order_id = b.order_id
   WHERE b.carrier_id = _carrier_id AND p.status = 'delivered';

  SELECT count(*) INTO v_pod
    FROM public.freight_bookings b
    JOIN public.packages p ON p.order_id = b.order_id
    JOIN public.logistics_pod_records r ON r.package_id = p.id
   WHERE b.carrier_id = _carrier_id;

  SELECT count(*) INTO v_exceptions
    FROM public.freight_bookings b
    JOIN public.logistics_exceptions e ON e.order_id = b.order_id
   WHERE b.carrier_id = _carrier_id;

  RETURN jsonb_build_object(
    'ok', true,
    'carrier_id', _carrier_id,
    'measured_at', now(),
    'sample', jsonb_build_object('invitations', v_invites, 'bookings', v_bookings, 'delivered_packages', v_delivered),
    -- Percentages are NULL, not zero, when there is nothing to measure.
    'tender_response_rate_pct', CASE WHEN v_invites > 0 THEN round(100.0*(v_responses+v_declined)/v_invites,2) END,
    'acceptance_rate_pct',      CASE WHEN v_bookings > 0 THEN round(100.0*v_accepted/v_bookings,2) END,
    'on_time_delivery_pct',     CASE WHEN v_completed > 0 THEN round(100.0*v_ontime/v_completed,2) END,
    'cancellation_rate_pct',    CASE WHEN v_bookings > 0 THEN round(100.0*v_cancelled/v_bookings,2) END,
    'failure_rate_pct',         CASE WHEN v_bookings > 0 THEN round(100.0*v_failed/v_bookings,2) END,
    'pod_compliance_pct',       CASE WHEN v_delivered > 0 THEN round(100.0*least(v_pod,v_delivered)/v_delivered,2) END,
    'exception_rate_pct',       CASE WHEN v_bookings > 0 THEN round(100.0*v_exceptions/v_bookings,2) END,
    'reliability_score',        CASE WHEN v_bookings > 0
                                     THEN round(greatest(0, 100 - (100.0*v_failed/v_bookings) - (50.0*v_cancelled/v_bookings)),2) END,
    'evidence_basis', 'bookings, packages, pod records and exceptions');
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_scorecard(uuid) TO authenticated;

-- ------------------------------------------------------------ REQUIREMENT
CREATE OR REPLACE FUNCTION public.freight_requirement_create(
  _origin_label text, _destination_label text,
  _pickup_window_start timestamptz, _pickup_window_end timestamptz,
  _weight_kg numeric, _package_count integer DEFAULT 1,
  _volume_cbm numeric DEFAULT NULL, _service_level text DEFAULT 'STANDARD',
  _origin_area_code text DEFAULT NULL, _destination_area_code text DEFAULT NULL,
  _delivery_window_start timestamptz DEFAULT NULL, _delivery_window_end timestamptz DEFAULT NULL,
  _cargo_class text DEFAULT 'GENERAL', _handling_requirements text[] DEFAULT '{}',
  _equipment_required text[] DEFAULT '{}', _vehicle_type_required text DEFAULT NULL,
  _temperature_controlled boolean DEFAULT false, _cross_border boolean DEFAULT false,
  _declared_value numeric DEFAULT NULL, _target_budget numeric DEFAULT NULL,
  _special_instructions text DEFAULT NULL, _tenant_id uuid DEFAULT NULL,
  _order_id uuid DEFAULT NULL, _enquiry_id uuid DEFAULT NULL, _is_test boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.freight_requirements;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  IF _weight_kg IS NULL OR _weight_kg <= 0 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_WEIGHT');
  END IF;
  IF _pickup_window_end < _pickup_window_start THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_PICKUP_WINDOW');
  END IF;

  INSERT INTO public.freight_requirements (
    requirement_number, tenant_id, requested_by, order_id, enquiry_id, state, service_level,
    origin_label, origin_area_code, destination_label, destination_area_code,
    pickup_window_start, pickup_window_end, delivery_window_start, delivery_window_end,
    weight_kg, volume_cbm, package_count, cargo_class, handling_requirements,
    equipment_required, vehicle_type_required, temperature_controlled, cross_border,
    declared_value, target_budget, special_instructions, is_test)
  VALUES (public._freight_seq('FRQ'), _tenant_id, auth.uid(), _order_id, _enquiry_id, 'SUBMITTED', _service_level,
    _origin_label, upper(_origin_area_code), _destination_label, upper(_destination_area_code),
    _pickup_window_start, _pickup_window_end, _delivery_window_start, _delivery_window_end,
    _weight_kg, _volume_cbm, _package_count, _cargo_class, _handling_requirements,
    _equipment_required, _vehicle_type_required, _temperature_controlled, _cross_border,
    _declared_value, _target_budget, _special_instructions, _is_test)
  RETURNING * INTO v;

  INSERT INTO public.freight_price_lineage (requirement_id, stage, amount, currency, breakdown, recorded_by)
  VALUES (v.id, 'REQUESTED', coalesce(_target_budget, 0), v.currency,
          jsonb_build_object('target_budget', _target_budget, 'weight_kg', _weight_kg), auth.uid());

  PERFORM public._freight_audit('requirement', v.id, 'REQUIREMENT_CREATED', NULL, v.state::text);
  RETURN jsonb_build_object('ok',true,'requirement_id',v.id,'requirement_number',v.requirement_number);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_requirement_create(text,text,timestamptz,timestamptz,numeric,integer,numeric,text,text,text,timestamptz,timestamptz,text,text[],text[],text,boolean,boolean,numeric,numeric,text,uuid,uuid,uuid,boolean) TO authenticated;

-- -------------------------------------------------------- CAPACITY SEARCH
CREATE OR REPLACE FUNCTION public.carrier_capacity_search(_requirement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req public.freight_requirements; r record;
  v_out jsonb := '[]'::jsonb; v_rejected jsonb := '[]'::jsonb;
  v_reasons jsonb; v_blockers jsonb; v_score numeric; v_avail numeric; v_comp jsonb; v_perf jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.read') THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  SELECT * INTO req FROM public.freight_requirements WHERE id = _requirement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REQUIREMENT_NOT_FOUND'); END IF;

  FOR r IN
    SELECT s.*, c.carrier_code, c.legal_entity_name, c.operating_status,
           cap.max_payload_kg, cap.max_volume_cbm, cap.temperature_controlled AS cap_temp,
           cap.cross_border_capable, cap.equipment AS cap_equipment
      FROM public.carrier_capacity_slots s
      JOIN public.carrier_profiles c ON c.id = s.carrier_id
      LEFT JOIN public.carrier_capabilities cap
             ON cap.carrier_id = s.carrier_id AND cap.vehicle_type = s.vehicle_type
     WHERE s.availability_status = 'AVAILABLE'
       AND s.effective_from <= req.pickup_window_end
       AND s.effective_until >= req.pickup_window_start
  LOOP
    v_reasons := '[]'::jsonb; v_blockers := '[]'::jsonb; v_score := 0;
    v_avail := r.offered_kg - r.reserved_kg - r.committed_kg - r.consumed_kg;

    IF v_avail < req.weight_kg THEN
      v_blockers := v_blockers || jsonb_build_object('code','INSUFFICIENT_CAPACITY','available_kg',v_avail);
    ELSE
      v_reasons := v_reasons || jsonb_build_object('code','CAPACITY_SUFFICIENT','available_kg',v_avail);
      v_score := v_score + 25;
    END IF;

    IF req.vehicle_type_required IS NOT NULL AND r.vehicle_type <> req.vehicle_type_required THEN
      v_blockers := v_blockers || jsonb_build_object('code','VEHICLE_TYPE_MISMATCH','offered',r.vehicle_type);
    ELSIF req.vehicle_type_required IS NOT NULL THEN
      v_reasons := v_reasons || jsonb_build_object('code','VEHICLE_TYPE_MATCH'); v_score := v_score + 10;
    END IF;

    IF r.max_payload_kg IS NOT NULL AND req.weight_kg > r.max_payload_kg THEN
      v_blockers := v_blockers || jsonb_build_object('code','PAYLOAD_EXCEEDS_CAPABILITY','max_payload_kg',r.max_payload_kg);
    END IF;
    IF req.temperature_controlled AND NOT coalesce(r.cap_temp,false) THEN
      v_blockers := v_blockers || jsonb_build_object('code','NO_TEMPERATURE_CAPABILITY');
    END IF;
    IF req.cross_border AND NOT coalesce(r.cross_border_capable,false) THEN
      v_blockers := v_blockers || jsonb_build_object('code','NO_CROSS_BORDER_CAPABILITY');
    END IF;
    IF cardinality(req.equipment_required) > 0
       AND NOT (coalesce(r.cap_equipment,'{}') || r.equipment) @> req.equipment_required THEN
      v_blockers := v_blockers || jsonb_build_object('code','EQUIPMENT_MISSING','required',to_jsonb(req.equipment_required));
    ELSIF cardinality(req.equipment_required) > 0 THEN
      v_score := v_score + 5;
    END IF;

    IF req.origin_area_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.carrier_service_areas a
         WHERE a.carrier_id = r.carrier_id AND a.active
           AND a.area_code = req.origin_area_code AND a.direction IN ('ORIGIN','BOTH')) THEN
      v_reasons := v_reasons || jsonb_build_object('code','ORIGIN_SERVED'); v_score := v_score + 10;
    ELSIF req.origin_area_code IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code','ORIGIN_NOT_SERVED','area',req.origin_area_code);
    END IF;
    IF req.destination_area_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.carrier_service_areas a
         WHERE a.carrier_id = r.carrier_id AND a.active
           AND a.area_code = req.destination_area_code AND a.direction IN ('DESTINATION','BOTH')) THEN
      v_reasons := v_reasons || jsonb_build_object('code','DESTINATION_SERVED'); v_score := v_score + 10;
    ELSIF req.destination_area_code IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code','DESTINATION_NOT_SERVED','area',req.destination_area_code);
    END IF;

    v_comp := public.carrier_compliance_state(r.carrier_id);
    IF v_comp->>'state' = 'PASS' THEN
      v_score := v_score + 25; v_reasons := v_reasons || jsonb_build_object('code','COMPLIANCE_PASS');
    ELSE
      v_blockers := v_blockers || jsonb_build_object('code','COMPLIANCE_' || (v_comp->>'state'),
        'detail', v_comp->'blocking');
    END IF;

    v_perf := public.carrier_scorecard(r.carrier_id);
    v_score := v_score + coalesce((v_perf->>'reliability_score')::numeric, 60) * 0.15;

    IF jsonb_array_length(v_blockers) = 0 THEN
      v_out := v_out || jsonb_build_object(
        'slot_id', r.id, 'slot_reference', r.slot_reference, 'carrier_id', r.carrier_id,
        'carrier_code', r.carrier_code, 'carrier_name', r.legal_entity_name,
        'vehicle_type', r.vehicle_type, 'vehicle_id', r.vehicle_id,
        'available_kg', v_avail, 'window_start', r.effective_from, 'window_until', r.effective_until,
        'match_score', round(v_score,2), 'match_reasons', v_reasons,
        'compliance_state', v_comp->>'state',
        'reliability_score', v_perf->'reliability_score');
    ELSE
      v_rejected := v_rejected || jsonb_build_object(
        'slot_id', r.id, 'carrier_id', r.carrier_id, 'carrier_name', r.legal_entity_name,
        'blocking', v_blockers);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'requirement_id',_requirement_id,
    'candidates', v_out, 'rejected', v_rejected,
    'state', CASE WHEN jsonb_array_length(v_out) = 0 AND jsonb_array_length(v_rejected) = 0
                  THEN 'OWNER_CONFIGURATION_REQUIRED' ELSE 'EVALUATED' END);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_capacity_search(uuid) TO authenticated;

-- -------------------------------------------------------------------- RFQ
CREATE OR REPLACE FUNCTION public.freight_rfq_create(
  _requirement_id uuid, _title text, _response_deadline timestamptz,
  _sourcing_mode text DEFAULT 'MULTI', _scope_notes text DEFAULT NULL,
  _target_budget numeric DEFAULT NULL, _policy_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE req public.freight_requirements; v public.freight_rfqs; v_policy uuid;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  SELECT * INTO req FROM public.freight_requirements WHERE id = _requirement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','REQUIREMENT_NOT_FOUND'); END IF;
  IF req.state IN ('AWARDED','BOOKED','FULFILLED','CANCELLED') THEN
    RETURN jsonb_build_object('ok',false,'code','REQUIREMENT_CLOSED','state',req.state);
  END IF;
  IF _response_deadline <= now() THEN
    RETURN jsonb_build_object('ok',false,'code','DEADLINE_IN_PAST');
  END IF;

  SELECT id INTO v_policy FROM public.freight_tender_policies
   WHERE (policy_code = _policy_code) OR (_policy_code IS NULL AND active) LIMIT 1;

  INSERT INTO public.freight_rfqs (
    rfq_number, requirement_id, tenant_id, sourcing_mode, state, policy_id, title,
    scope_notes, currency, target_budget, response_deadline, is_test, created_by)
  VALUES (public._freight_seq('RFQ'), req.id, req.tenant_id,
    CASE WHEN _sourcing_mode = 'SINGLE' THEN 'SINGLE' ELSE 'MULTI' END, 'DRAFT', v_policy, _title,
    _scope_notes, req.currency, coalesce(_target_budget, req.target_budget), _response_deadline,
    req.is_test, auth.uid())
  RETURNING * INTO v;

  INSERT INTO public.freight_rfq_lines (rfq_id, line_no, description, pricing_basis, quantity, uom,
    weight_kg, volume_cbm, vehicle_type, equipment, origin_area_code, destination_area_code)
  VALUES (v.id, 1, format('%s → %s (%s kg, %s package(s))', req.origin_label, req.destination_label,
          req.weight_kg, req.package_count), 'PER_SHIPMENT', 1, 'SHIPMENT',
    req.weight_kg, req.volume_cbm, req.vehicle_type_required, req.equipment_required,
    req.origin_area_code, req.destination_area_code);

  UPDATE public.freight_requirements SET state='SOURCING' WHERE id = req.id AND state = 'SUBMITTED';

  PERFORM public.logistics_event_emit_internal('rfq.created','rfq', v.id,
    jsonb_build_object('rfq_id',v.id,'rfq_number',v.rfq_number,'requirement_id',req.id,
      'sourcing_mode',v.sourcing_mode,'response_deadline',v.response_deadline),
    req.tenant_id, NULL, NULL, 'staff', auth.uid(),
    CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment,
    req.is_test, jsonb_build_object('table','freight_rfqs','id',v.id), 'rfq:' || v.id::text || ':created');

  PERFORM public._freight_audit('rfq', v.id, 'RFQ_CREATED', NULL, 'DRAFT');
  RETURN jsonb_build_object('ok',true,'rfq_id',v.id,'rfq_number',v.rfq_number,
    'policy_state', CASE WHEN v_policy IS NULL THEN 'OWNER_CONFIGURATION_REQUIRED' ELSE 'CONFIGURED' END);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_rfq_create(uuid,text,timestamptz,text,text,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.freight_rfq_invite(_rfq_id uuid, _carrier_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.freight_rfqs; cid uuid; v_invited int := 0; v_skipped jsonb := '[]'::jsonb; v_comp jsonb;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  SELECT * INTO v FROM public.freight_rfqs WHERE id = _rfq_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_FOUND'); END IF;
  IF v.state NOT IN ('DRAFT','OPEN','INVITED','RESPONSES_RECEIVED') THEN
    RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_OPEN','state',v.state);
  END IF;
  IF v.sourcing_mode = 'SINGLE' AND cardinality(_carrier_ids) > 1 THEN
    RETURN jsonb_build_object('ok',false,'code','SINGLE_SOURCE_ONE_CARRIER');
  END IF;

  FOREACH cid IN ARRAY _carrier_ids LOOP
    v_comp := public.carrier_compliance_state(cid);
    IF v_comp->>'state' = 'UNKNOWN_CARRIER' THEN
      v_skipped := v_skipped || jsonb_build_object('carrier_id',cid,'reason','UNKNOWN_CARRIER');
      CONTINUE;
    END IF;
    INSERT INTO public.freight_rfq_invitations (rfq_id, carrier_id, state, invited_by,
      match_reasons)
    VALUES (_rfq_id, cid, 'INVITED', auth.uid(),
      jsonb_build_array(jsonb_build_object('compliance', v_comp->>'state')))
    ON CONFLICT (rfq_id, carrier_id) DO NOTHING;
    IF FOUND THEN v_invited := v_invited + 1; END IF;
  END LOOP;

  IF v_invited > 0 AND v.state = 'DRAFT' THEN
    UPDATE public.freight_rfqs SET state='INVITED' WHERE id = _rfq_id;
  END IF;
  PERFORM public._freight_audit('rfq', _rfq_id, 'CARRIERS_INVITED', v.state::text, 'INVITED', NULL,
    jsonb_build_object('invited', v_invited));
  RETURN jsonb_build_object('ok',true,'invited',v_invited,'skipped',v_skipped);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_rfq_invite(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.freight_rfq_issue(_rfq_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.freight_rfqs; req public.freight_requirements; v_count int;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  SELECT * INTO v FROM public.freight_rfqs WHERE id = _rfq_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_FOUND'); END IF;
  IF v.state NOT IN ('DRAFT','INVITED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','state',v.state);
  END IF;
  SELECT count(*) INTO v_count FROM public.freight_rfq_invitations WHERE rfq_id = _rfq_id AND state <> 'WITHDRAWN';
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok',false,'code','NO_CARRIERS_INVITED',
      'message','Invite at least one carrier before issuing the tender.');
  END IF;
  IF v.response_deadline <= now() THEN
    RETURN jsonb_build_object('ok',false,'code','DEADLINE_IN_PAST');
  END IF;

  SELECT * INTO req FROM public.freight_requirements WHERE id = v.requirement_id;
  UPDATE public.freight_rfqs SET state='OPEN', opened_at=now(), issued_at=now() WHERE id = _rfq_id RETURNING * INTO v;

  PERFORM public.logistics_event_emit_internal('rfq.sent','rfq', v.id,
    jsonb_build_object('rfq_id',v.id,'rfq_number',v.rfq_number,'invited_carriers',v_count,
      'response_deadline',v.response_deadline),
    req.tenant_id, NULL, NULL, 'staff', auth.uid(),
    CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment,
    req.is_test, jsonb_build_object('table','freight_rfqs','id',v.id), 'rfq:' || v.id::text || ':sent');
  PERFORM public.logistics_event_emit_internal('tender.opened','rfq', v.id,
    jsonb_build_object('rfq_id',v.id,'rfq_number',v.rfq_number,'response_deadline',v.response_deadline),
    req.tenant_id, NULL, NULL, 'staff', auth.uid(),
    CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment,
    req.is_test, jsonb_build_object('table','freight_rfqs','id',v.id), 'rfq:' || v.id::text || ':opened');

  PERFORM public._freight_audit('rfq', v.id, 'RFQ_ISSUED', 'INVITED', 'OPEN');
  RETURN jsonb_build_object('ok',true,'rfq_id',v.id,'state',v.state,'invited',v_count);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_rfq_issue(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.freight_rfq_transition(_rfq_id uuid, _to public.tender_state, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.freight_rfqs; v_ok boolean;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  SELECT * INTO v FROM public.freight_rfqs WHERE id = _rfq_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_FOUND'); END IF;

  v_ok := CASE
    WHEN v.state = 'OPEN' AND _to IN ('RESPONSES_RECEIVED','EVALUATION','CANCELLED','EXPIRED') THEN true
    WHEN v.state = 'INVITED' AND _to IN ('OPEN','CANCELLED') THEN true
    WHEN v.state = 'RESPONSES_RECEIVED' AND _to IN ('EVALUATION','CANCELLED','EXPIRED') THEN true
    WHEN v.state = 'EVALUATION' AND _to IN ('CANCELLED','RESPONSES_RECEIVED') THEN true
    WHEN v.state = 'DRAFT' AND _to = 'CANCELLED' THEN true
    ELSE false END;
  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state,'to',_to);
  END IF;
  IF _to = 'CANCELLED' AND coalesce(_reason,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'code','REASON_REQUIRED');
  END IF;

  UPDATE public.freight_rfqs SET state=_to,
    evaluation_started_at = CASE WHEN _to='EVALUATION' THEN now() ELSE evaluation_started_at END,
    cancelled_at = CASE WHEN _to='CANCELLED' THEN now() END,
    cancel_reason = CASE WHEN _to='CANCELLED' THEN _reason END
  WHERE id = _rfq_id;

  PERFORM public._freight_audit('rfq', _rfq_id, 'RFQ_TRANSITION', v.state::text, _to::text, _reason);
  RETURN jsonb_build_object('ok',true,'rfq_id',_rfq_id,'state',_to);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_rfq_transition(uuid,public.tender_state,text) TO authenticated;

-- ----------------------------------------------------------- CARRIER SIDE
CREATE OR REPLACE FUNCTION public.carrier_quote_submit(
  _rfq_id uuid, _carrier_id uuid, _base_freight numeric, _capacity_offered_kg numeric,
  _valid_until timestamptz, _fuel_surcharge numeric DEFAULT 0, _waiting_charge numeric DEFAULT 0,
  _toll_charge numeric DEFAULT 0, _handling_charge numeric DEFAULT 0, _storage_charge numeric DEFAULT 0,
  _loading_charge numeric DEFAULT 0, _protection_charge numeric DEFAULT 0,
  _accessorials jsonb DEFAULT '[]'::jsonb, _discount numeric DEFAULT 0, _tax_amount numeric DEFAULT 0,
  _transit_time_hours numeric DEFAULT NULL, _pickup_eta timestamptz DEFAULT NULL,
  _delivery_eta timestamptz DEFAULT NULL, _sla_committed text DEFAULT NULL,
  _vehicle_type text DEFAULT NULL, _equipment text[] DEFAULT '{}',
  _capacity_slot_id uuid DEFAULT NULL, _pricing_basis public.freight_pricing_basis DEFAULT 'PER_SHIPMENT',
  _conditions text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rfq public.freight_rfqs; v_prev public.carrier_quotations; v public.carrier_quotations;
  v_acc_total numeric := 0; v_sub numeric; v_total numeric; v_version int := 1; req public.freight_requirements;
BEGIN
  IF NOT (public._carrier_is_member(_carrier_id) OR public.has_staff_permission('staff.logistics.manage')) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED','message','You cannot quote for this carrier.');
  END IF;

  SELECT * INTO v_rfq FROM public.freight_rfqs WHERE id = _rfq_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_FOUND'); END IF;
  IF v_rfq.state NOT IN ('OPEN','RESPONSES_RECEIVED') THEN
    RETURN jsonb_build_object('ok',false,'code','TENDER_NOT_OPEN','state',v_rfq.state,
      'message','This tender is not accepting quotations.');
  END IF;
  IF v_rfq.response_deadline < now() THEN
    RETURN jsonb_build_object('ok',false,'code','DEADLINE_PASSED','message','The response deadline has passed.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.freight_rfq_invitations
                  WHERE rfq_id=_rfq_id AND carrier_id=_carrier_id AND state <> 'WITHDRAWN') THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_INVITED');
  END IF;
  IF _valid_until <= now() THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTE_VALIDITY_IN_PAST');
  END IF;
  IF _capacity_offered_kg IS NULL OR _capacity_offered_kg <= 0 OR _base_freight IS NULL OR _base_freight < 0 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_QUOTE');
  END IF;
  IF _capacity_slot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.carrier_capacity_slots WHERE id=_capacity_slot_id AND carrier_id=_carrier_id) THEN
    RETURN jsonb_build_object('ok',false,'code','SLOT_NOT_OWNED');
  END IF;

  SELECT coalesce(sum((x->>'amount')::numeric),0) INTO v_acc_total
    FROM jsonb_array_elements(coalesce(_accessorials,'[]'::jsonb)) x;

  v_sub := _base_freight + _fuel_surcharge + _waiting_charge + _toll_charge + _handling_charge
         + _storage_charge + _loading_charge + _protection_charge + v_acc_total - _discount;
  IF v_sub < 0 THEN RETURN jsonb_build_object('ok',false,'code','DISCOUNT_EXCEEDS_CHARGES'); END IF;
  v_total := v_sub + _tax_amount;

  SELECT * INTO v_prev FROM public.carrier_quotations
   WHERE rfq_id=_rfq_id AND carrier_id=_carrier_id ORDER BY version DESC LIMIT 1;
  IF FOUND THEN
    IF v_prev.state = 'ACCEPTED' THEN
      RETURN jsonb_build_object('ok',false,'code','QUOTE_ACCEPTED','message','An accepted quotation cannot be changed.');
    END IF;
    v_version := v_prev.version + 1;
    UPDATE public.carrier_quotations SET state='SUPERSEDED' WHERE id = v_prev.id AND state IN ('DRAFT','SUBMITTED');
  END IF;

  INSERT INTO public.carrier_quotations (
    quote_number, rfq_id, carrier_id, version, supersedes_id, state, currency, pricing_basis,
    base_freight, fuel_surcharge, waiting_charge, toll_charge, handling_charge, storage_charge,
    loading_charge, protection_charge, accessorials, accessorial_total, discount, tax_amount,
    subtotal, total, capacity_offered_kg, capacity_slot_id, transit_time_hours, pickup_eta,
    delivery_eta, sla_committed, vehicle_type, equipment, conditions, valid_until,
    submitted_at, submitted_by)
  VALUES (public._freight_seq('QTE'), _rfq_id, _carrier_id, v_version, v_prev.id, 'SUBMITTED',
    v_rfq.currency, _pricing_basis, _base_freight, _fuel_surcharge, _waiting_charge, _toll_charge,
    _handling_charge, _storage_charge, _loading_charge, _protection_charge,
    coalesce(_accessorials,'[]'::jsonb), v_acc_total, _discount, _tax_amount, v_sub, v_total,
    _capacity_offered_kg, _capacity_slot_id, _transit_time_hours, _pickup_eta, _delivery_eta,
    _sla_committed, _vehicle_type, _equipment, _conditions, _valid_until, now(), auth.uid())
  RETURNING * INTO v;

  UPDATE public.carrier_quotations SET
    snapshot = to_jsonb(v) - 'snapshot' - 'snapshot_hash',
    snapshot_hash = encode(digest(convert_to((to_jsonb(v) - 'snapshot' - 'snapshot_hash')::text,'UTF8'),'sha256'),'hex')
  WHERE id = v.id RETURNING * INTO v;

  UPDATE public.freight_rfq_invitations SET state='RESPONDED', responded_at=now()
   WHERE rfq_id=_rfq_id AND carrier_id=_carrier_id;
  UPDATE public.freight_rfqs SET state='RESPONSES_RECEIVED' WHERE id=_rfq_id AND state='OPEN';

  SELECT * INTO req FROM public.freight_requirements WHERE id = v_rfq.requirement_id;
  PERFORM public.logistics_event_emit_internal(
    CASE WHEN v_version = 1 THEN 'quote.submitted' ELSE 'quote.updated' END, 'quotation', v.id,
    jsonb_build_object('quotation_id',v.id,'quote_number',v.quote_number,'rfq_id',_rfq_id,
      'carrier_id',_carrier_id,'version',v_version,'total',v_total),
    req.tenant_id, NULL, NULL, 'carrier', auth.uid(),
    CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment,
    req.is_test, jsonb_build_object('table','carrier_quotations','id',v.id),
    'quote:' || v.id::text || ':submitted');

  PERFORM public._freight_audit('quotation', v.id, 'QUOTE_SUBMITTED', NULL, 'SUBMITTED', NULL,
    jsonb_build_object('version', v_version, 'total', v_total), 'carrier');
  RETURN jsonb_build_object('ok',true,'quotation_id',v.id,'quote_number',v.quote_number,
    'version',v_version,'total',v_total,'snapshot_hash',v.snapshot_hash);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_quote_submit(uuid,uuid,numeric,numeric,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,numeric,numeric,numeric,timestamptz,timestamptz,text,text,text[],uuid,public.freight_pricing_basis,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.carrier_invitation_respond(
  _rfq_id uuid, _carrier_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.freight_rfq_invitations;
BEGIN
  IF NOT public._carrier_is_member(_carrier_id) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  SELECT * INTO v FROM public.freight_rfq_invitations WHERE rfq_id=_rfq_id AND carrier_id=_carrier_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','INVITATION_NOT_FOUND'); END IF;
  IF _action = 'VIEW' THEN
    UPDATE public.freight_rfq_invitations SET state = CASE WHEN state='INVITED' THEN 'VIEWED' ELSE state END,
      viewed_at = coalesce(viewed_at, now()) WHERE id = v.id;
  ELSIF _action = 'DECLINE' THEN
    IF coalesce(_reason,'') = '' THEN RETURN jsonb_build_object('ok',false,'code','REASON_REQUIRED'); END IF;
    IF v.state = 'RESPONDED' THEN RETURN jsonb_build_object('ok',false,'code','ALREADY_QUOTED'); END IF;
    UPDATE public.freight_rfq_invitations SET state='DECLINED', declined_at=now(), decline_reason=_reason
     WHERE id = v.id;
    PERFORM public._freight_audit('rfq_invitation', v.id, 'INVITATION_DECLINED', v.state::text, 'DECLINED', _reason, '{}'::jsonb, 'carrier');
  ELSE
    RETURN jsonb_build_object('ok',false,'code','UNKNOWN_ACTION');
  END IF;
  RETURN jsonb_build_object('ok',true);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_invitation_respond(uuid,uuid,text,text) TO authenticated;

-- ------------------------------------------------------- BID COMPARISON
CREATE OR REPLACE FUNCTION public.freight_bid_comparison(_rfq_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rfq public.freight_rfqs; pol public.freight_tender_policies; r record;
  v_min numeric; v_min_transit numeric; v_rows jsonb := '[]'::jsonb;
  v_comp jsonb; v_perf jsonb; v_score numeric; v_price_score numeric; v_transit_score numeric;
  req public.freight_requirements;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.read') THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  SELECT * INTO v_rfq FROM public.freight_rfqs WHERE id = _rfq_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_FOUND'); END IF;
  SELECT * INTO req FROM public.freight_requirements WHERE id = v_rfq.requirement_id;
  SELECT * INTO pol FROM public.freight_tender_policies WHERE id = v_rfq.policy_id;

  SELECT min(total), min(coalesce(transit_time_hours, 9999)) INTO v_min, v_min_transit
    FROM public.carrier_quotations WHERE rfq_id=_rfq_id AND state='SUBMITTED';

  FOR r IN
    SELECT q.*, c.legal_entity_name, c.carrier_code
      FROM public.carrier_quotations q JOIN public.carrier_profiles c ON c.id=q.carrier_id
     WHERE q.rfq_id = _rfq_id AND q.state IN ('SUBMITTED','ACCEPTED')
     ORDER BY q.total
  LOOP
    v_comp := public.carrier_compliance_state(r.carrier_id);
    v_perf := public.carrier_scorecard(r.carrier_id);
    v_price_score   := CASE WHEN v_min IS NULL OR r.total = 0 THEN 0 ELSE least(1, v_min / nullif(r.total,0)) END;
    v_transit_score := CASE WHEN r.transit_time_hours IS NULL THEN 0.5
                            ELSE least(1, v_min_transit / nullif(r.transit_time_hours,0)) END;
    v_score :=
        coalesce(pol.weight_price, 40)       * v_price_score
      + coalesce(pol.weight_transit, 15)     * v_transit_score
      + coalesce(pol.weight_capacity, 10)    * CASE WHEN req.weight_kg IS NULL OR r.capacity_offered_kg >= req.weight_kg THEN 1 ELSE 0 END
      + coalesce(pol.weight_performance, 20) * (coalesce((v_perf->>'reliability_score')::numeric, 60) / 100.0)
      + coalesce(pol.weight_compliance, 15)  * CASE WHEN v_comp->>'state' = 'PASS' THEN 1 ELSE 0 END;

    v_rows := v_rows || jsonb_build_object(
      'quotation_id', r.id, 'quote_number', r.quote_number, 'version', r.version, 'state', r.state,
      'carrier_id', r.carrier_id, 'carrier_name', r.legal_entity_name, 'carrier_code', r.carrier_code,
      'total', r.total, 'currency', r.currency, 'is_lowest_price', (r.total = v_min),
      'breakdown', jsonb_build_object('base_freight',r.base_freight,'fuel_surcharge',r.fuel_surcharge,
        'waiting',r.waiting_charge,'tolls',r.toll_charge,'handling',r.handling_charge,
        'storage',r.storage_charge,'loading',r.loading_charge,'protection',r.protection_charge,
        'accessorials',r.accessorial_total,'discount',r.discount,'tax',r.tax_amount),
      'capacity_offered_kg', r.capacity_offered_kg,
      'capacity_sufficient', (req.weight_kg IS NULL OR r.capacity_offered_kg >= req.weight_kg),
      'transit_time_hours', r.transit_time_hours, 'sla_committed', r.sla_committed,
      'valid_until', r.valid_until, 'expired', (r.valid_until < now()),
      'compliance_state', v_comp->>'state', 'compliance_blocking', v_comp->'blocking',
      'reliability_score', v_perf->'reliability_score',
      'on_time_delivery_pct', v_perf->'on_time_delivery_pct',
      'awardable', (v_comp->>'state' = 'PASS' AND r.valid_until >= now() AND r.state='SUBMITTED'),
      'weighted_score', round(v_score,2));
  END LOOP;

  RETURN jsonb_build_object('ok',true,'rfq_id',_rfq_id,'state',v_rfq.state,
    'policy', CASE WHEN pol.id IS NULL THEN jsonb_build_object('state','OWNER_CONFIGURATION_REQUIRED')
                   ELSE jsonb_build_object('state','CONFIGURED','policy_code',pol.policy_code,
                        'min_responses_to_award',pol.min_responses_to_award,
                        'require_compliance_pass',pol.require_compliance_pass,
                        'weights',jsonb_build_object('price',pol.weight_price,'transit',pol.weight_transit,
                          'capacity',pol.weight_capacity,'performance',pol.weight_performance,
                          'compliance',pol.weight_compliance)) END,
    'lowest_total', v_min, 'bids', v_rows);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_bid_comparison(uuid) TO authenticated;

-- -------------------------------------------------------------- AWARD
CREATE OR REPLACE FUNCTION public.freight_award(
  _rfq_id uuid, _quotation_id uuid, _justification text,
  _idempotency_key text DEFAULT NULL, _reservation_ttl_minutes integer DEFAULT 1440)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rfq public.freight_rfqs; req public.freight_requirements; q public.carrier_quotations;
  pol public.freight_tender_policies; v_comp jsonb; v_existing public.freight_awards;
  v_min numeric; v_responses int; v_slot uuid; v_res jsonb; v_award public.freight_awards;
  v_bypass boolean := false; v_env public.partner_api_environment;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  IF coalesce(_justification,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'code','JUSTIFICATION_REQUIRED',
      'message','Every award must record why this carrier was chosen.');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.freight_awards WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok',true,'replayed',true,'award_id',v_existing.id,
        'award_number',v_existing.award_number);
    END IF;
  END IF;

  -- Serialise concurrent award attempts on the same tender.
  SELECT * INTO v_rfq FROM public.freight_rfqs WHERE id = _rfq_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RFQ_NOT_FOUND'); END IF;
  IF v_rfq.state NOT IN ('OPEN','RESPONSES_RECEIVED','EVALUATION') THEN
    RETURN jsonb_build_object('ok',false,'code','TENDER_NOT_AWARDABLE','state',v_rfq.state);
  END IF;
  IF EXISTS (SELECT 1 FROM public.freight_awards WHERE rfq_id=_rfq_id AND status='AWARDED') THEN
    RETURN jsonb_build_object('ok',false,'code','ALREADY_AWARDED',
      'message','This tender already carries a live award.');
  END IF;

  SELECT * INTO q FROM public.carrier_quotations WHERE id = _quotation_id FOR UPDATE;
  IF NOT FOUND OR q.rfq_id <> _rfq_id THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTATION_NOT_FOUND');
  END IF;
  IF q.state <> 'SUBMITTED' THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTATION_NOT_SUBMITTED','state',q.state);
  END IF;
  IF q.valid_until < now() THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTATION_EXPIRED');
  END IF;

  SELECT * INTO req FROM public.freight_requirements WHERE id = v_rfq.requirement_id FOR UPDATE;
  IF q.capacity_offered_kg < req.weight_kg THEN
    RETURN jsonb_build_object('ok',false,'code','QUOTED_CAPACITY_INSUFFICIENT',
      'message','The quoted capacity is below the freight requirement.');
  END IF;

  SELECT * INTO pol FROM public.freight_tender_policies WHERE id = v_rfq.policy_id;
  v_comp := public.carrier_compliance_state(q.carrier_id);
  IF coalesce(pol.require_compliance_pass, true) AND v_comp->>'state' <> 'PASS' THEN
    RETURN jsonb_build_object('ok',false,'code','CARRIER_NOT_COMPLIANT',
      'compliance', v_comp, 'message','This carrier cannot be awarded until compliance clears.');
  END IF;

  SELECT count(*) INTO v_responses FROM public.carrier_quotations
   WHERE rfq_id=_rfq_id AND state IN ('SUBMITTED','ACCEPTED');
  IF v_responses < coalesce(pol.min_responses_to_award, 1) THEN
    RETURN jsonb_build_object('ok',false,'code','INSUFFICIENT_RESPONSES',
      'received', v_responses, 'required', coalesce(pol.min_responses_to_award,1));
  END IF;

  SELECT min(total) INTO v_min FROM public.carrier_quotations WHERE rfq_id=_rfq_id AND state='SUBMITTED';
  v_bypass := (v_min IS NOT NULL AND q.total > v_min);
  IF v_bypass AND coalesce(pol.allow_lowest_price_only, false) THEN
    RETURN jsonb_build_object('ok',false,'code','POLICY_REQUIRES_LOWEST_PRICE');
  END IF;

  -- Capacity: reserve the quoted slot, or the carrier's best matching slot.
  v_slot := q.capacity_slot_id;
  IF v_slot IS NULL THEN
    SELECT s.id INTO v_slot FROM public.carrier_capacity_slots s
     WHERE s.carrier_id = q.carrier_id AND s.availability_status='AVAILABLE'
       AND s.effective_from <= req.pickup_window_end AND s.effective_until >= req.pickup_window_start
       AND (s.offered_kg - s.reserved_kg - s.committed_kg - s.consumed_kg) >= req.weight_kg
     ORDER BY (s.offered_kg - s.reserved_kg - s.committed_kg - s.consumed_kg) ASC LIMIT 1;
  END IF;
  IF v_slot IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','NO_CAPACITY_AVAILABLE',
      'message','That carrier has no available capacity slot covering this requirement.');
  END IF;

  v_res := public.capacity_reserve(v_slot, req.weight_kg, req.id, NULL, _reservation_ttl_minutes,
             coalesce(_idempotency_key,'award:' || _quotation_id::text) || ':capacity', req.volume_cbm);
  IF NOT (v_res->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok',false,'code', v_res->>'code',
      'message', coalesce(v_res->>'message','Capacity could not be reserved for this award.'));
  END IF;

  INSERT INTO public.freight_awards (
    award_number, rfq_id, requirement_id, quotation_id, carrier_id, reservation_id,
    awarded_total, currency, evaluation_snapshot, award_justification,
    lowest_price_bypassed, bypass_reason, awarded_by, idempotency_key)
  VALUES (public._freight_seq('AWD'), _rfq_id, req.id, q.id, q.carrier_id,
    (v_res->>'reservation_id')::uuid, q.total, q.currency,
    public.freight_bid_comparison(_rfq_id), _justification,
    v_bypass, CASE WHEN v_bypass THEN _justification END, auth.uid(), _idempotency_key)
  RETURNING * INTO v_award;

  UPDATE public.capacity_reservations SET award_id = v_award.id WHERE id = (v_res->>'reservation_id')::uuid;
  UPDATE public.carrier_quotations SET state='ACCEPTED', accepted_at=now() WHERE id = q.id;
  UPDATE public.carrier_quotations SET state='REJECTED'
   WHERE rfq_id=_rfq_id AND id <> q.id AND state='SUBMITTED';
  UPDATE public.freight_rfqs SET state='AWARDED', awarded_at=now() WHERE id=_rfq_id;
  UPDATE public.freight_requirements SET state='AWARDED' WHERE id=req.id;

  INSERT INTO public.freight_price_lineage (requirement_id, rfq_id, quotation_id, award_id, carrier_id, stage, amount, currency, breakdown, recorded_by)
  VALUES (req.id, _rfq_id, q.id, v_award.id, q.carrier_id, 'QUOTED', q.total, q.currency, q.snapshot, auth.uid()),
         (req.id, _rfq_id, q.id, v_award.id, q.carrier_id, 'ACCEPTED', q.total, q.currency,
          jsonb_build_object('snapshot_hash', q.snapshot_hash), auth.uid());

  v_env := CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment;
  PERFORM public.logistics_event_emit_internal('tender.awarded','rfq', v_rfq.id,
    jsonb_build_object('rfq_id',v_rfq.id,'award_id',v_award.id,'award_number',v_award.award_number,
      'carrier_id',q.carrier_id,'quotation_id',q.id,'total',q.total),
    req.tenant_id, NULL, NULL, 'staff', auth.uid(), v_env, req.is_test,
    jsonb_build_object('table','freight_awards','id',v_award.id), 'award:' || v_award.id::text);

  PERFORM public._freight_audit('award', v_award.id, 'TENDER_AWARDED', v_rfq.state::text, 'AWARDED', _justification,
    jsonb_build_object('total', q.total, 'lowest_total', v_min, 'lowest_price_bypassed', v_bypass));

  RETURN jsonb_build_object('ok',true,'award_id',v_award.id,'award_number',v_award.award_number,
    'carrier_id',q.carrier_id,'total',q.total,'reservation_id',v_res->>'reservation_id',
    'lowest_price_bypassed', v_bypass);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_award(uuid,uuid,text,text,integer) TO authenticated;

-- ------------------------------------------------------------- BOOKING
CREATE OR REPLACE FUNCTION public.freight_booking_create(_award_id uuid, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.freight_awards; req public.freight_requirements; v public.freight_bookings; v_env public.partner_api_environment;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v FROM public.freight_bookings WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('ok',true,'replayed',true,'booking_id',v.id,'booking_number',v.booking_number); END IF;
  END IF;

  SELECT * INTO a FROM public.freight_awards WHERE id=_award_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','AWARD_NOT_FOUND'); END IF;
  IF a.status <> 'AWARDED' THEN RETURN jsonb_build_object('ok',false,'code','AWARD_NOT_LIVE','status',a.status); END IF;
  IF EXISTS (SELECT 1 FROM public.freight_bookings WHERE award_id=_award_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ALREADY_BOOKED');
  END IF;

  SELECT * INTO req FROM public.freight_requirements WHERE id = a.requirement_id;

  INSERT INTO public.freight_bookings (
    booking_number, award_id, requirement_id, carrier_id, reservation_id, order_id,
    state, agreed_total, currency, planned_pickup, planned_delivery, idempotency_key, created_by)
  VALUES (public._freight_seq('FBK'), a.id, a.requirement_id, a.carrier_id, a.reservation_id,
    req.order_id, 'CREATED', a.awarded_total, a.currency,
    req.pickup_window_start, coalesce(req.delivery_window_end, req.pickup_window_end),
    _idempotency_key, auth.uid())
  RETURNING * INTO v;

  UPDATE public.capacity_reservations SET booking_id = v.id WHERE id = a.reservation_id;
  UPDATE public.freight_requirements SET state='BOOKED' WHERE id = req.id;

  v_env := CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment;
  PERFORM public.logistics_event_emit_internal('freight.booked','booking', v.id,
    jsonb_build_object('booking_id',v.id,'booking_number',v.booking_number,'requirement_id',req.id,
      'carrier_id',a.carrier_id,'route_id',NULL,'total',a.awarded_total),
    req.tenant_id, NULL, NULL, 'staff', auth.uid(), v_env, req.is_test,
    jsonb_build_object('table','freight_bookings','id',v.id), 'booking:' || v.id::text || ':booked');

  PERFORM public._freight_audit('booking', v.id, 'BOOKING_CREATED', NULL, 'CREATED');
  RETURN jsonb_build_object('ok',true,'booking_id',v.id,'booking_number',v.booking_number);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_booking_create(uuid,text) TO authenticated;

-- Bridge into EXISTING execution: existing route, existing vehicle, existing driver.
CREATE OR REPLACE FUNCTION public.freight_booking_attach_execution(
  _booking_id uuid, _route_id uuid DEFAULT NULL, _vehicle_id uuid DEFAULT NULL,
  _driver_user_id uuid DEFAULT NULL, _manifest_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.freight_bookings; req public.freight_requirements; v_env public.partner_api_environment; v_res jsonb;
BEGIN
  PERFORM public.require_staff('staff.logistics.manage');
  SELECT * INTO b FROM public.freight_bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','BOOKING_NOT_FOUND'); END IF;
  IF b.state IN ('CANCELLED','COMPLETED','FAILED') THEN
    RETURN jsonb_build_object('ok',false,'code','BOOKING_CLOSED','state',b.state);
  END IF;

  IF _route_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.logistics_routes WHERE id=_route_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ROUTE_NOT_FOUND',
      'message','Plan the route in Route Control first — freight bookings attach to existing routes.');
  END IF;
  IF _manifest_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.logistics_manifests WHERE id=_manifest_id) THEN
    RETURN jsonb_build_object('ok',false,'code','MANIFEST_NOT_FOUND');
  END IF;
  IF _vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id=_vehicle_id) THEN
    RETURN jsonb_build_object('ok',false,'code','VEHICLE_NOT_FOUND');
  END IF;
  IF _driver_user_id IS NOT NULL AND NOT public.logistics_driver_eligible(_driver_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','DRIVER_NOT_ELIGIBLE',
      'message','That driver is not active and verified in the driver register.');
  END IF;

  UPDATE public.freight_bookings SET
    route_id = coalesce(_route_id, route_id),
    manifest_id = coalesce(_manifest_id, manifest_id),
    vehicle_id = coalesce(_vehicle_id, vehicle_id),
    driver_user_id = coalesce(_driver_user_id, driver_user_id),
    state = CASE WHEN coalesce(_route_id, route_id) IS NOT NULL
                  AND coalesce(_vehicle_id, vehicle_id) IS NOT NULL
                  AND coalesce(_driver_user_id, driver_user_id) IS NOT NULL
                 THEN 'RESOURCED' ELSE 'CARRIER_ASSIGNED' END
  WHERE id = _booking_id RETURNING * INTO b;

  -- Reserved capacity becomes a firm commitment once resources are attached.
  IF b.reservation_id IS NOT NULL AND b.state = 'RESOURCED' THEN
    v_res := public.capacity_transition(b.reservation_id, 'COMMIT', 'Resources attached to booking ' || b.booking_number);
  END IF;

  SELECT * INTO req FROM public.freight_requirements WHERE id = b.requirement_id;
  v_env := CASE WHEN req.is_test THEN 'sandbox' ELSE 'production' END::public.partner_api_environment;
  PERFORM public.logistics_event_emit_internal('carrier.assigned','booking', b.id,
    jsonb_build_object('booking_id',b.id,'booking_number',b.booking_number,'carrier_id',b.carrier_id,
      'award_id',b.award_id,'vehicle_id',b.vehicle_id,'driver_assigned',(b.driver_user_id IS NOT NULL)),
    req.tenant_id, NULL, NULL, 'staff', auth.uid(), v_env, req.is_test,
    jsonb_build_object('table','freight_bookings','id',b.id), 'booking:' || b.id::text || ':carrier_assigned');

  PERFORM public._freight_audit('booking', b.id, 'EXECUTION_ATTACHED', NULL, b.state::text, NULL,
    jsonb_build_object('route_id',b.route_id,'vehicle_id',b.vehicle_id,'driver_assigned',(b.driver_user_id IS NOT NULL)));
  RETURN jsonb_build_object('ok',true,'booking_id',b.id,'state',b.state,
    'capacity', coalesce(v_res, jsonb_build_object('state','UNCHANGED')));
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_booking_attach_execution(uuid,uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.freight_booking_transition(
  _booking_id uuid, _to public.freight_booking_state, _reason text DEFAULT NULL,
  _actual_amount numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.freight_bookings; v_ok boolean; v_is_carrier boolean;
BEGIN
  SELECT * INTO b FROM public.freight_bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','BOOKING_NOT_FOUND'); END IF;
  v_is_carrier := public._carrier_is_member(b.carrier_id);
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR v_is_carrier) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;

  v_ok := CASE
    WHEN b.state IN ('CREATED','CARRIER_ASSIGNED','RESOURCED') AND _to = 'DISPATCHED' THEN true
    WHEN b.state = 'DISPATCHED' AND _to IN ('EXECUTING','FAILED','CANCELLED') THEN true
    WHEN b.state = 'EXECUTING' AND _to IN ('COMPLETED','FAILED') THEN true
    WHEN b.state IN ('CREATED','CARRIER_ASSIGNED','RESOURCED') AND _to = 'CANCELLED' THEN true
    ELSE false END;
  IF NOT v_ok THEN RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',b.state,'to',_to); END IF;
  IF _to IN ('CANCELLED','FAILED') AND coalesce(_reason,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'code','REASON_REQUIRED');
  END IF;
  IF _to = 'DISPATCHED' AND (b.route_id IS NULL OR b.driver_user_id IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','EXECUTION_NOT_RESOURCED',
      'message','Attach the route, vehicle and driver before dispatching.');
  END IF;

  UPDATE public.freight_bookings SET state=_to,
    dispatched_at = CASE WHEN _to='DISPATCHED' THEN now() ELSE dispatched_at END,
    completed_at  = CASE WHEN _to='COMPLETED' THEN now() ELSE completed_at END,
    cancelled_at  = CASE WHEN _to IN ('CANCELLED','FAILED') THEN now() END,
    cancel_reason = CASE WHEN _to IN ('CANCELLED','FAILED') THEN _reason ELSE cancel_reason END
  WHERE id=_booking_id RETURNING * INTO b;

  IF b.reservation_id IS NOT NULL THEN
    IF _to = 'COMPLETED' THEN
      PERFORM public.capacity_transition(b.reservation_id, 'CONSUME', 'Booking completed');
    ELSIF _to IN ('CANCELLED','FAILED') THEN
      PERFORM public.capacity_transition(b.reservation_id, 'RELEASE', coalesce(_reason,'Booking closed'));
    END IF;
  END IF;

  IF _to = 'COMPLETED' THEN
    INSERT INTO public.freight_price_lineage (requirement_id, booking_id, award_id, carrier_id, stage, amount, currency, breakdown, variance_vs_accepted, recorded_by)
    VALUES (b.requirement_id, b.id, b.award_id, b.carrier_id, 'ACTUAL',
            coalesce(_actual_amount, b.agreed_total), b.currency,
            jsonb_build_object('agreed_total', b.agreed_total, 'actual', coalesce(_actual_amount, b.agreed_total)),
            coalesce(_actual_amount, b.agreed_total) - b.agreed_total, auth.uid());
    UPDATE public.freight_requirements SET state='FULFILLED' WHERE id = b.requirement_id;
  END IF;

  PERFORM public._freight_audit('booking', b.id, 'BOOKING_' || _to::text, NULL, _to::text, _reason,
    '{}'::jsonb, CASE WHEN v_is_carrier THEN 'carrier' ELSE 'staff' END);
  RETURN jsonb_build_object('ok',true,'booking_id',b.id,'state',b.state);
END; $$;
GRANT EXECUTE ON FUNCTION public.freight_booking_transition(uuid,public.freight_booking_state,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.carrier_award_respond(_booking_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.freight_bookings;
BEGIN
  SELECT * INTO b FROM public.freight_bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','BOOKING_NOT_FOUND'); END IF;
  IF NOT public._carrier_is_member(b.carrier_id) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  IF b.state NOT IN ('CREATED','CARRIER_ASSIGNED') THEN
    RETURN jsonb_build_object('ok',false,'code','RESPONSE_WINDOW_CLOSED','state',b.state);
  END IF;

  IF _action = 'ACCEPT' THEN
    UPDATE public.freight_bookings SET carrier_accepted_at=now(), state='CARRIER_ASSIGNED' WHERE id=b.id;
    PERFORM public._freight_audit('booking', b.id, 'AWARD_ACCEPTED', b.state::text, 'CARRIER_ASSIGNED', NULL, '{}'::jsonb, 'carrier');
    RETURN jsonb_build_object('ok',true,'state','CARRIER_ASSIGNED');
  ELSIF _action = 'DECLINE' THEN
    IF coalesce(_reason,'') = '' THEN RETURN jsonb_build_object('ok',false,'code','REASON_REQUIRED'); END IF;
    UPDATE public.freight_bookings SET carrier_declined_at=now(), carrier_decline_reason=_reason,
      state='CANCELLED', cancelled_at=now(), cancel_reason='Carrier declined: ' || _reason WHERE id=b.id;
    IF b.reservation_id IS NOT NULL THEN
      PERFORM public.capacity_transition(b.reservation_id, 'RELEASE', 'Carrier declined the award');
    END IF;
    UPDATE public.freight_awards SET status='CANCELLED', cancelled_at=now(),
      cancel_reason='Carrier declined' WHERE id = b.award_id;
    UPDATE public.freight_requirements SET state='SOURCING' WHERE id = b.requirement_id;
    PERFORM public._freight_audit('booking', b.id, 'AWARD_DECLINED', b.state::text, 'CANCELLED', _reason, '{}'::jsonb, 'carrier');
    RETURN jsonb_build_object('ok',true,'state','CANCELLED','requirement_returned_to','SOURCING');
  END IF;
  RETURN jsonb_build_object('ok',false,'code','UNKNOWN_ACTION');
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_award_respond(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.freight_tender_expiry_sweep(_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'freight_tender_expiry_sweep is internal'; END IF;
  WITH x AS (
    UPDATE public.freight_rfqs SET state='EXPIRED'
     WHERE state IN ('OPEN','INVITED','RESPONSES_RECEIVED') AND response_deadline < now()
     RETURNING 1)
  SELECT count(*) INTO v_count FROM x;
  UPDATE public.carrier_quotations SET state='EXPIRED' WHERE state='SUBMITTED' AND valid_until < now();
  RETURN jsonb_build_object('ok',true,'tenders_expired',v_count);
END; $$;
REVOKE ALL ON FUNCTION public.freight_tender_expiry_sweep(integer) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------- lock out anonymous use
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public'
       AND (p.proname LIKE 'carrier\_%' OR p.proname LIKE 'freight\_%'
            OR p.proname LIKE 'capacity\_%' OR p.proname LIKE '\_freight\_%'
            OR p.proname LIKE '\_carrier\_%' OR p.proname LIKE '\_capacity\_%'
            OR p.proname LIKE '\_phase5\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

-- Internal helpers are never callable by signed-in users either.
REVOKE ALL ON FUNCTION public._freight_audit(text,uuid,text,text,text,text,jsonb,text) FROM authenticated;
REVOKE ALL ON FUNCTION public._freight_seq(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._carrier_is_member(uuid) TO authenticated;