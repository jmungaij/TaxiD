-- ============ PHASE 5C — PROCUREMENT & CAPACITY OPERATIONS SPINE ============

CREATE OR REPLACE FUNCTION public._freight_seq(_prefix text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT _prefix || '-' || to_char(now(),'YYMM') || '-' ||
         upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
$$;

CREATE OR REPLACE FUNCTION public._freight_audit(
  _entity_type text, _entity_id uuid, _action text,
  _from text DEFAULT NULL, _to text DEFAULT NULL, _reason text DEFAULT NULL,
  _detail jsonb DEFAULT '{}'::jsonb, _actor_role text DEFAULT 'staff')
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.freight_procurement_audit
    (entity_type, entity_id, action, from_state, to_state, actor_id, actor_role, reason, detail)
  VALUES (_entity_type, _entity_id, _action, _from, _to, auth.uid(), _actor_role, _reason, coalesce(_detail,'{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._carrier_is_member(_carrier_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.carrier_profiles c
                  WHERE c.id = _carrier_id AND public.partner_api_is_member(c.partner_id));
$$;

-- ------------------------------------------------------------- COMPLIANCE
-- Never a boolean. Evidence + expiry + explicit legal-review state.
CREATE OR REPLACE FUNCTION public.carrier_compliance_state(_carrier_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier public.carrier_profiles;
  v_total int; v_blocking jsonb := '[]'::jsonb; v_expiring jsonb := '[]'::jsonb;
  r record; v_state text;
BEGIN
  SELECT * INTO v_carrier FROM public.carrier_profiles WHERE id = _carrier_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','UNKNOWN_CARRIER','blocking','[]'::jsonb);
  END IF;

  SELECT count(*) INTO v_total FROM public.carrier_compliance_items
   WHERE carrier_id = _carrier_id AND is_mandatory;

  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'state','OWNER_CONFIGURATION_REQUIRED',
      'detail','No mandatory compliance requirements have been configured for this carrier.',
      'blocking', jsonb_build_array(jsonb_build_object('code','COMPLIANCE_NOT_CONFIGURED')),
      'expiring','[]'::jsonb);
  END IF;

  FOR r IN
    SELECT * FROM public.carrier_compliance_items
     WHERE carrier_id = _carrier_id AND is_mandatory
  LOOP
    IF r.state = 'LEGAL_REVIEW_REQUIRED' THEN
      v_blocking := v_blocking || jsonb_build_object('code','LEGAL_REVIEW_REQUIRED',
        'requirement', r.requirement_code, 'reason', r.legal_review_reason);
    ELSIF r.state <> 'VERIFIED' THEN
      v_blocking := v_blocking || jsonb_build_object('code','EVIDENCE_' || r.state::text,
        'requirement', r.requirement_code);
    ELSIF r.expires_on IS NOT NULL AND r.expires_on < current_date THEN
      v_blocking := v_blocking || jsonb_build_object('code','EVIDENCE_EXPIRED',
        'requirement', r.requirement_code, 'expired_on', r.expires_on);
    ELSIF r.expires_on IS NOT NULL AND r.expires_on < current_date + 30 THEN
      v_expiring := v_expiring || jsonb_build_object('requirement', r.requirement_code, 'expires_on', r.expires_on);
    END IF;
  END LOOP;

  IF v_carrier.operating_status <> 'ACTIVE' THEN
    v_blocking := v_blocking || jsonb_build_object('code','CARRIER_' || v_carrier.operating_status::text);
  END IF;
  IF v_carrier.contract_status <> 'SIGNED' THEN
    v_blocking := v_blocking || jsonb_build_object('code','CONTRACT_' || v_carrier.contract_status::text);
  END IF;
  IF v_carrier.effective_until IS NOT NULL AND v_carrier.effective_until < current_date THEN
    v_blocking := v_blocking || jsonb_build_object('code','CARRIER_TERMS_EXPIRED');
  END IF;

  v_state := CASE
    WHEN v_blocking @> '[{"code":"LEGAL_REVIEW_REQUIRED"}]'::jsonb THEN 'LEGAL_REVIEW_REQUIRED'
    WHEN jsonb_array_length(v_blocking) > 0 THEN 'BLOCKED'
    ELSE 'PASS' END;

  RETURN jsonb_build_object('state', v_state, 'blocking', v_blocking, 'expiring', v_expiring,
                            'evaluated_at', now(), 'mandatory_items', v_total);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_compliance_state(uuid) TO authenticated;

-- --------------------------------------------------------- CARRIER MASTER
CREATE OR REPLACE FUNCTION public.carrier_profile_upsert(
  _partner_id uuid, _legal_entity_name text, _service_categories text[] DEFAULT '{}',
  _corridors text[] DEFAULT '{}', _operating_countries text[] DEFAULT '{KE}',
  _regions text[] DEFAULT '{}', _payment_terms_days integer DEFAULT 30,
  _ops_contact_name text DEFAULT NULL, _ops_contact_email text DEFAULT NULL,
  _ops_contact_phone text DEFAULT NULL, _tax_identifier text DEFAULT NULL,
  _operating_status public.carrier_operating_status DEFAULT 'ONBOARDING',
  _contract_status public.carrier_contract_status DEFAULT 'NONE',
  _contract_reference text DEFAULT NULL,
  _effective_from date DEFAULT NULL, _effective_until date DEFAULT NULL,
  _commercial_terms jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.carrier_profiles; v_code text;
BEGIN
  PERFORM public.require_staff('staff.partners.manage');
  IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = _partner_id) THEN
    RETURN jsonb_build_object('ok',false,'code','PARTNER_NOT_FOUND','message','That partner does not exist.');
  END IF;

  SELECT * INTO v FROM public.carrier_profiles WHERE partner_id = _partner_id;
  IF FOUND THEN
    UPDATE public.carrier_profiles SET
      legal_entity_name=_legal_entity_name, service_categories=_service_categories,
      corridors=_corridors, operating_countries=_operating_countries, regions=_regions,
      payment_terms_days=_payment_terms_days, ops_contact_name=_ops_contact_name,
      ops_contact_email=_ops_contact_email, ops_contact_phone=_ops_contact_phone,
      tax_identifier=_tax_identifier, operating_status=_operating_status,
      contract_status=_contract_status, contract_reference=_contract_reference,
      effective_from=_effective_from, effective_until=_effective_until,
      commercial_terms=coalesce(_commercial_terms,'{}'::jsonb)
    WHERE id = v.id RETURNING * INTO v;
    PERFORM public._freight_audit('carrier', v.id, 'CARRIER_UPDATED', NULL, v.operating_status::text);
  ELSE
    SELECT 'CAR-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)) INTO v_code;
    INSERT INTO public.carrier_profiles (
      partner_id, carrier_code, legal_entity_name, service_categories, corridors,
      operating_countries, regions, payment_terms_days, ops_contact_name, ops_contact_email,
      ops_contact_phone, tax_identifier, operating_status, contract_status, contract_reference,
      effective_from, effective_until, commercial_terms, created_by)
    VALUES (_partner_id, v_code, _legal_entity_name, _service_categories, _corridors,
      _operating_countries, _regions, _payment_terms_days, _ops_contact_name, _ops_contact_email,
      _ops_contact_phone, _tax_identifier, _operating_status, _contract_status, _contract_reference,
      _effective_from, _effective_until, coalesce(_commercial_terms,'{}'::jsonb), auth.uid())
    RETURNING * INTO v;
    PERFORM public._freight_audit('carrier', v.id, 'CARRIER_CREATED', NULL, v.operating_status::text);
  END IF;

  RETURN jsonb_build_object('ok',true,'carrier_id',v.id,'carrier_code',v.carrier_code,
                            'compliance', public.carrier_compliance_state(v.id));
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_profile_upsert(uuid,text,text[],text[],text[],text[],integer,text,text,text,text,public.carrier_operating_status,public.carrier_contract_status,text,date,date,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.carrier_capability_upsert(
  _carrier_id uuid, _vehicle_type text, _max_payload_kg numeric,
  _vehicle_class text DEFAULT NULL, _max_volume_cbm numeric DEFAULT NULL,
  _temperature_controlled boolean DEFAULT false, _refrigerated boolean DEFAULT false,
  _hazmat_capable boolean DEFAULT false, _hazmat_authority_reference text DEFAULT NULL,
  _fragile_capable boolean DEFAULT false, _high_value_capable boolean DEFAULT false,
  _oversized_capable boolean DEFAULT false, _container_capable boolean DEFAULT false,
  _cross_border_capable boolean DEFAULT false, _warehouse_capable boolean DEFAULT false,
  _last_mile_capable boolean DEFAULT true, _line_haul_capable boolean DEFAULT false,
  _special_handling text[] DEFAULT '{}', _equipment text[] DEFAULT '{}',
  _units_declared integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR public._carrier_is_member(_carrier_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED','message','You cannot maintain this carrier.');
  END IF;
  IF _hazmat_capable AND coalesce(_hazmat_authority_reference,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'code','LEGAL_REVIEW_REQUIRED',
      'message','Hazardous-goods capability requires a recorded authority reference. It cannot be self-declared.');
  END IF;

  INSERT INTO public.carrier_capabilities (
    carrier_id, vehicle_type, vehicle_class, max_payload_kg, max_volume_cbm,
    temperature_controlled, refrigerated, hazmat_capable, hazmat_authority_reference,
    fragile_capable, high_value_capable, oversized_capable, container_capable,
    cross_border_capable, warehouse_capable, last_mile_capable, line_haul_capable,
    special_handling, equipment, units_declared)
  VALUES (_carrier_id,_vehicle_type,_vehicle_class,_max_payload_kg,_max_volume_cbm,
    _temperature_controlled,_refrigerated,_hazmat_capable,_hazmat_authority_reference,
    _fragile_capable,_high_value_capable,_oversized_capable,_container_capable,
    _cross_border_capable,_warehouse_capable,_last_mile_capable,_line_haul_capable,
    _special_handling,_equipment,_units_declared)
  ON CONFLICT (carrier_id, vehicle_type, coalesce(vehicle_class,'')) DO UPDATE SET
    max_payload_kg=excluded.max_payload_kg, max_volume_cbm=excluded.max_volume_cbm,
    temperature_controlled=excluded.temperature_controlled, refrigerated=excluded.refrigerated,
    hazmat_capable=excluded.hazmat_capable, hazmat_authority_reference=excluded.hazmat_authority_reference,
    fragile_capable=excluded.fragile_capable, high_value_capable=excluded.high_value_capable,
    oversized_capable=excluded.oversized_capable, container_capable=excluded.container_capable,
    cross_border_capable=excluded.cross_border_capable, warehouse_capable=excluded.warehouse_capable,
    last_mile_capable=excluded.last_mile_capable, line_haul_capable=excluded.line_haul_capable,
    special_handling=excluded.special_handling, equipment=excluded.equipment,
    units_declared=excluded.units_declared
  RETURNING id INTO v_id;

  PERFORM public._freight_audit('carrier_capability', v_id, 'CAPABILITY_DECLARED', NULL, _vehicle_type);
  RETURN jsonb_build_object('ok',true,'capability_id',v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_capability_upsert(uuid,text,numeric,text,numeric,boolean,boolean,boolean,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text[],text[],integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.carrier_service_area_set(
  _carrier_id uuid, _area_kind text, _area_code text, _area_label text,
  _direction text DEFAULT 'BOTH', _active boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR public._carrier_is_member(_carrier_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  INSERT INTO public.carrier_service_areas (carrier_id, area_kind, area_code, area_label, direction, active)
  VALUES (_carrier_id, _area_kind, upper(_area_code), _area_label, _direction, _active)
  ON CONFLICT (carrier_id, area_kind, area_code, direction)
    DO UPDATE SET area_label = excluded.area_label, active = excluded.active
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'service_area_id',v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_service_area_set(uuid,text,text,text,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.carrier_compliance_record(
  _carrier_id uuid, _requirement_code text, _requirement_label text, _category text,
  _state public.carrier_compliance_state, _is_mandatory boolean DEFAULT true,
  _evidence_storage_path text DEFAULT NULL, _evidence_hash text DEFAULT NULL,
  _issuing_authority text DEFAULT NULL, _reference_number text DEFAULT NULL,
  _issued_on date DEFAULT NULL, _expires_on date DEFAULT NULL,
  _vehicle_id uuid DEFAULT NULL, _legal_review_reason text DEFAULT NULL,
  _review_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_is_staff boolean := public.has_staff_permission('staff.logistics.manage');
BEGIN
  IF NOT (v_is_staff OR public._carrier_is_member(_carrier_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  -- A carrier may submit evidence; only staff may verify it.
  IF _state = 'VERIFIED' AND NOT v_is_staff THEN
    RETURN jsonb_build_object('ok',false,'code','VERIFICATION_IS_STAFF_ONLY',
      'message','A carrier cannot verify its own compliance evidence.');
  END IF;
  IF _state = 'VERIFIED' AND coalesce(_evidence_storage_path,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'code','EVIDENCE_REQUIRED',
      'message','Verification requires stored evidence.');
  END IF;

  INSERT INTO public.carrier_compliance_items (
    carrier_id, requirement_code, requirement_label, category, is_mandatory, state,
    evidence_storage_path, evidence_hash, issuing_authority, reference_number,
    issued_on, expires_on, vehicle_id, legal_review_reason, review_notes,
    reviewed_by, reviewed_at)
  VALUES (_carrier_id,_requirement_code,_requirement_label,_category,_is_mandatory,
    CASE WHEN v_is_staff THEN _state ELSE 'PENDING_REVIEW'::public.carrier_compliance_state END,
    _evidence_storage_path,_evidence_hash,_issuing_authority,_reference_number,
    _issued_on,_expires_on,_vehicle_id,_legal_review_reason,_review_notes,
    CASE WHEN v_is_staff AND _state='VERIFIED' THEN auth.uid() END,
    CASE WHEN v_is_staff AND _state='VERIFIED' THEN now() END)
  ON CONFLICT (carrier_id, requirement_code, coalesce(vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET
    requirement_label=excluded.requirement_label, category=excluded.category,
    is_mandatory=excluded.is_mandatory, state=excluded.state,
    evidence_storage_path=coalesce(excluded.evidence_storage_path, carrier_compliance_items.evidence_storage_path),
    evidence_hash=coalesce(excluded.evidence_hash, carrier_compliance_items.evidence_hash),
    issuing_authority=excluded.issuing_authority, reference_number=excluded.reference_number,
    issued_on=excluded.issued_on, expires_on=excluded.expires_on,
    legal_review_reason=excluded.legal_review_reason, review_notes=excluded.review_notes,
    reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at
  RETURNING id INTO v_id;

  PERFORM public._freight_audit('carrier_compliance', v_id, 'COMPLIANCE_RECORDED', NULL, _state::text,
    _legal_review_reason, jsonb_build_object('requirement', _requirement_code),
    CASE WHEN v_is_staff THEN 'staff' ELSE 'carrier' END);
  RETURN jsonb_build_object('ok',true,'item_id',v_id,'compliance', public.carrier_compliance_state(_carrier_id));
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_compliance_record(uuid,text,text,text,public.carrier_compliance_state,boolean,text,text,text,text,date,date,uuid,text,text) TO authenticated;

-- ---------------------------------------------------------------- CAPACITY
CREATE OR REPLACE FUNCTION public.carrier_capacity_slot_upsert(
  _carrier_id uuid, _vehicle_type text, _offered_kg numeric,
  _effective_from timestamptz, _effective_until timestamptz,
  _id uuid DEFAULT NULL, _vehicle_id uuid DEFAULT NULL, _vehicle_class text DEFAULT NULL,
  _offered_cbm numeric DEFAULT NULL, _equipment text[] DEFAULT '{}',
  _origin_area_code text DEFAULT NULL, _destination_area_code text DEFAULT NULL,
  _corridor text DEFAULT NULL, _exclusive_vehicle boolean DEFAULT false,
  _availability_status public.capacity_availability_state DEFAULT 'AVAILABLE',
  _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.carrier_capacity_slots; v_used numeric;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR public._carrier_is_member(_carrier_id)) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  IF _effective_until <= _effective_from THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_WINDOW','message','The availability window must end after it starts.');
  END IF;
  IF _vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = _vehicle_id) THEN
    RETURN jsonb_build_object('ok',false,'code','VEHICLE_NOT_FOUND',
      'message','Register the vehicle in the fleet first — capacity attaches to the existing vehicle record.');
  END IF;

  IF _id IS NOT NULL THEN
    SELECT * INTO v FROM public.carrier_capacity_slots WHERE id = _id FOR UPDATE;
    IF NOT FOUND OR v.carrier_id <> _carrier_id THEN
      RETURN jsonb_build_object('ok',false,'code','SLOT_NOT_FOUND');
    END IF;
    v_used := v.reserved_kg + v.committed_kg + v.consumed_kg;
    IF _offered_kg < v_used THEN
      RETURN jsonb_build_object('ok',false,'code','CAPACITY_IN_USE',
        'message', format('%s kg of this slot is already reserved or consumed; capacity cannot be reduced below it.', v_used));
    END IF;
    UPDATE public.carrier_capacity_slots SET
      vehicle_id=_vehicle_id, vehicle_type=_vehicle_type, vehicle_class=_vehicle_class,
      offered_kg=_offered_kg, offered_cbm=_offered_cbm, equipment=_equipment,
      origin_area_code=upper(_origin_area_code), destination_area_code=upper(_destination_area_code),
      corridor=_corridor, exclusive_vehicle=_exclusive_vehicle,
      availability_status=_availability_status, effective_from=_effective_from,
      effective_until=_effective_until, notes=_notes
    WHERE id = _id RETURNING * INTO v;
  ELSE
    INSERT INTO public.carrier_capacity_slots (
      carrier_id, slot_reference, vehicle_id, vehicle_type, vehicle_class, equipment,
      origin_area_code, destination_area_code, corridor, exclusive_vehicle,
      offered_kg, offered_cbm, availability_status, effective_from, effective_until, notes, created_by)
    VALUES (_carrier_id, public._freight_seq('CAP'), _vehicle_id, _vehicle_type, _vehicle_class, _equipment,
      upper(_origin_area_code), upper(_destination_area_code), _corridor, _exclusive_vehicle,
      _offered_kg, _offered_cbm, _availability_status, _effective_from, _effective_until, _notes, auth.uid())
    RETURNING * INTO v;
    INSERT INTO public.carrier_capacity_ledger (slot_id, entry_type, qty_kg, balance_after_kg, reason, actor_id, actor_role)
    VALUES (v.id, 'OFFER', _offered_kg, _offered_kg, 'Capacity offered', auth.uid(),
            CASE WHEN public.has_staff_permission('staff.logistics.manage') THEN 'staff' ELSE 'carrier' END);
  END IF;

  PERFORM public._freight_audit('capacity_slot', v.id, 'CAPACITY_DECLARED', NULL, v.availability_status::text);
  RETURN jsonb_build_object('ok',true,'slot_id',v.id,'slot_reference',v.slot_reference,
    'available_kg', v.offered_kg - v.reserved_kg - v.committed_kg - v.consumed_kg);
END; $$;
GRANT EXECUTE ON FUNCTION public.carrier_capacity_slot_upsert(uuid,text,numeric,timestamptz,timestamptz,uuid,uuid,text,numeric,text[],text,text,text,boolean,public.capacity_availability_state,text) TO authenticated;

-- Transactional reservation. Row lock + database invariant + idempotency.
CREATE OR REPLACE FUNCTION public.capacity_reserve(
  _slot_id uuid, _qty_kg numeric, _requirement_id uuid DEFAULT NULL,
  _award_id uuid DEFAULT NULL, _ttl_minutes integer DEFAULT 120,
  _idempotency_key text DEFAULT NULL, _qty_cbm numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot public.carrier_capacity_slots;
  v_existing public.capacity_reservations;
  v_available numeric; v_res public.capacity_reservations; v_tenant uuid; v_test boolean := false;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR public.is_service_context()) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  IF _qty_kg IS NULL OR _qty_kg <= 0 THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_QUANTITY');
  END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.capacity_reservations WHERE idempotency_key = _idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok',true,'replayed',true,'reservation_id',v_existing.id,
        'reservation_reference',v_existing.reservation_reference,'state',v_existing.state);
    END IF;
  END IF;

  -- Serialise every concurrent claim on this slot.
  SELECT * INTO v_slot FROM public.carrier_capacity_slots WHERE id = _slot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','SLOT_NOT_FOUND'); END IF;

  IF v_slot.availability_status <> 'AVAILABLE' THEN
    RETURN jsonb_build_object('ok',false,'code','CAPACITY_' || v_slot.availability_status::text,
      'message','That capacity is not available for booking.');
  END IF;
  IF now() >= v_slot.effective_until THEN
    UPDATE public.carrier_capacity_slots SET availability_status='EXPIRED' WHERE id = v_slot.id;
    RETURN jsonb_build_object('ok',false,'code','CAPACITY_EXPIRED','message','That capacity window has closed.');
  END IF;

  v_available := v_slot.offered_kg - v_slot.reserved_kg - v_slot.committed_kg - v_slot.consumed_kg;
  IF _qty_kg > v_available THEN
    RETURN jsonb_build_object('ok',false,'code','CAPACITY_EXCEEDED',
      'message', format('Only %s kg remains on this capacity slot.', v_available),
      'available_kg', v_available);
  END IF;
  IF v_slot.exclusive_vehicle AND v_slot.reserved_kg + v_slot.committed_kg + v_slot.consumed_kg > 0 THEN
    RETURN jsonb_build_object('ok',false,'code','EXCLUSIVE_CAPACITY_TAKEN',
      'message','This vehicle is offered exclusively and is already committed.');
  END IF;

  SELECT tenant_id, is_test INTO v_tenant, v_test FROM public.freight_requirements WHERE id = _requirement_id;

  INSERT INTO public.capacity_reservations (
    reservation_reference, slot_id, carrier_id, tenant_id, requirement_id, award_id,
    qty_kg, qty_cbm, state, expires_at, idempotency_key, created_by)
  VALUES (public._freight_seq('RSV'), v_slot.id, v_slot.carrier_id, v_tenant, _requirement_id, _award_id,
    _qty_kg, _qty_cbm, 'ACTIVE', now() + make_interval(mins => greatest(_ttl_minutes,5)), _idempotency_key, auth.uid())
  RETURNING * INTO v_res;

  UPDATE public.carrier_capacity_slots
     SET reserved_kg = reserved_kg + _qty_kg
   WHERE id = v_slot.id;

  INSERT INTO public.carrier_capacity_ledger (slot_id, reservation_id, entry_type, qty_kg, balance_after_kg, reason, actor_id, actor_role, idempotency_key)
  VALUES (v_slot.id, v_res.id, 'RESERVE', _qty_kg, v_available - _qty_kg, 'Capacity reserved', auth.uid(), 'staff',
          coalesce(_idempotency_key, 'reserve:' || v_res.id::text));

  PERFORM public.logistics_event_emit_internal('capacity.reserved','capacity', v_res.id,
    jsonb_build_object('reservation_id',v_res.id,'reservation_reference',v_res.reservation_reference,
      'slot_id',v_slot.id,'carrier_id',v_slot.carrier_id,'qty_kg',_qty_kg,'expires_at',v_res.expires_at),
    v_tenant, NULL, NULL, 'staff', auth.uid(),
    CASE WHEN coalesce(v_test,false) THEN 'sandbox' ELSE 'production' END::public.partner_api_environment,
    coalesce(v_test,false), jsonb_build_object('table','capacity_reservations','id',v_res.id),
    'capacity:' || v_res.id::text || ':reserved');

  PERFORM public._freight_audit('capacity_reservation', v_res.id, 'CAPACITY_RESERVED', NULL, 'ACTIVE');
  RETURN jsonb_build_object('ok',true,'reservation_id',v_res.id,
    'reservation_reference',v_res.reservation_reference,'expires_at',v_res.expires_at,
    'remaining_kg', v_available - _qty_kg);
END; $$;
GRANT EXECUTE ON FUNCTION public.capacity_reserve(uuid,numeric,uuid,uuid,integer,text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.capacity_transition(
  _reservation_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.capacity_reservations; v_slot public.carrier_capacity_slots; v_bal numeric;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR public.is_service_context()) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  IF _action NOT IN ('RELEASE','COMMIT','CONSUME','EXPIRE') THEN
    RETURN jsonb_build_object('ok',false,'code','UNKNOWN_ACTION');
  END IF;

  SELECT * INTO v FROM public.capacity_reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_NOT_FOUND'); END IF;
  SELECT * INTO v_slot FROM public.carrier_capacity_slots WHERE id = v.slot_id FOR UPDATE;

  IF _action IN ('RELEASE','EXPIRE') AND v.state NOT IN ('ACTIVE','COMMITTED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state);
  END IF;
  IF _action = 'COMMIT' AND v.state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state);
  END IF;
  IF _action = 'CONSUME' AND v.state NOT IN ('ACTIVE','COMMITTED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state);
  END IF;

  IF _action IN ('RELEASE','EXPIRE') THEN
    UPDATE public.carrier_capacity_slots SET
      reserved_kg  = reserved_kg  - CASE WHEN v.state='ACTIVE' THEN v.qty_kg ELSE 0 END,
      committed_kg = committed_kg - CASE WHEN v.state='COMMITTED' THEN v.qty_kg ELSE 0 END
    WHERE id = v_slot.id;
    UPDATE public.capacity_reservations
       SET state = CASE WHEN _action='EXPIRE' THEN 'EXPIRED' ELSE 'RELEASED' END,
           released_at = now(), released_reason = _reason
     WHERE id = v.id RETURNING * INTO v;
  ELSIF _action = 'COMMIT' THEN
    UPDATE public.carrier_capacity_slots
       SET reserved_kg = reserved_kg - v.qty_kg, committed_kg = committed_kg + v.qty_kg
     WHERE id = v_slot.id;
    UPDATE public.capacity_reservations SET state='COMMITTED' WHERE id = v.id RETURNING * INTO v;
  ELSE -- CONSUME
    UPDATE public.carrier_capacity_slots SET
      reserved_kg  = reserved_kg  - CASE WHEN v.state='ACTIVE' THEN v.qty_kg ELSE 0 END,
      committed_kg = committed_kg - CASE WHEN v.state='COMMITTED' THEN v.qty_kg ELSE 0 END,
      consumed_kg  = consumed_kg + v.qty_kg
    WHERE id = v_slot.id;
    UPDATE public.capacity_reservations SET state='CONSUMED' WHERE id = v.id RETURNING * INTO v;
  END IF;

  SELECT offered_kg - reserved_kg - committed_kg - consumed_kg INTO v_bal
    FROM public.carrier_capacity_slots WHERE id = v_slot.id;

  INSERT INTO public.carrier_capacity_ledger (slot_id, reservation_id, entry_type, qty_kg, balance_after_kg, reason, actor_id, actor_role)
  VALUES (v_slot.id, v.id, _action, v.qty_kg, v_bal, _reason, auth.uid(), 'staff');

  IF _action IN ('RELEASE','EXPIRE') THEN
    PERFORM public.logistics_event_emit_internal('capacity.released','capacity', v.id,
      jsonb_build_object('reservation_id',v.id,'reservation_reference',v.reservation_reference,
        'slot_id',v_slot.id,'carrier_id',v_slot.carrier_id,'qty_kg',v.qty_kg,'reason',_reason),
      v.tenant_id, NULL, NULL, 'staff', auth.uid(), 'production', false,
      jsonb_build_object('table','capacity_reservations','id',v.id),
      'capacity:' || v.id::text || ':released');
  END IF;

  PERFORM public._freight_audit('capacity_reservation', v.id, 'CAPACITY_' || _action, NULL, v.state::text, _reason);
  RETURN jsonb_build_object('ok',true,'reservation_id',v.id,'state',v.state,'remaining_kg',v_bal);
END; $$;
GRANT EXECUTE ON FUNCTION public.capacity_transition(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.capacity_expiry_sweep(_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_count int := 0; v_slots int := 0;
BEGIN
  IF NOT public.is_service_context() THEN
    RAISE EXCEPTION 'capacity_expiry_sweep is internal';
  END IF;
  FOR r IN SELECT id FROM public.capacity_reservations
            WHERE state='ACTIVE' AND expires_at < now() ORDER BY expires_at LIMIT _limit
  LOOP
    PERFORM public.capacity_transition(r.id, 'EXPIRE', 'Reservation window elapsed');
    v_count := v_count + 1;
  END LOOP;
  WITH x AS (
    UPDATE public.carrier_capacity_slots SET availability_status='EXPIRED'
     WHERE availability_status IN ('CONFIGURED','AVAILABLE') AND effective_until < now()
     RETURNING 1)
  SELECT count(*) INTO v_slots FROM x;
  RETURN jsonb_build_object('ok',true,'reservations_expired',v_count,'slots_expired',v_slots);
END; $$;
REVOKE ALL ON FUNCTION public.capacity_expiry_sweep(integer) FROM PUBLIC, anon, authenticated;