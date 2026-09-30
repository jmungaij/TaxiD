-- 1. Defect: provisioning inserted a state that is not part of the state enum.
CREATE OR REPLACE FUNCTION public.carrier_requirements_provision(
  _carrier_id uuid,
  _vehicle_id uuid DEFAULT NULL,
  _driver_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier public.carrier_profiles;
  v_level text;
  v_created int := 0;
  r record;
BEGIN
  IF NOT (public._carrier_is_member(_carrier_id)
          OR public.has_staff_permission('staff.logistics.compliance.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_carrier FROM public.carrier_profiles WHERE id = _carrier_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_CARRIER'); END IF;

  IF _vehicle_id IS NOT NULL AND _driver_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'AMBIGUOUS_SUBJECT');
  END IF;
  v_level := CASE WHEN _vehicle_id IS NOT NULL THEN 'VEHICLE'
                  WHEN _driver_user_id IS NOT NULL THEN 'DRIVER'
                  ELSE 'CARRIER' END;

  FOR r IN
    SELECT * FROM public.carrier_requirement_templates
     WHERE active
       AND responsibility_level = v_level
       AND (service_categories = '{}'::text[]
            OR service_categories && COALESCE(v_carrier.service_categories::text[], '{}'::text[]))
  LOOP
    INSERT INTO public.carrier_compliance_items
      (carrier_id, requirement_code, requirement_label, category, is_mandatory,
       state, responsibility_level, vehicle_id, driver_user_id, issuing_authority)
    SELECT _carrier_id, r.requirement_code, r.requirement_label, r.category, r.is_mandatory,
           'MISSING', v_level, _vehicle_id, _driver_user_id, r.issuing_authority_hint
     WHERE NOT EXISTS (
       SELECT 1 FROM public.carrier_compliance_items ci
        WHERE ci.carrier_id = _carrier_id
          AND ci.requirement_code = r.requirement_code
          AND COALESCE(ci.vehicle_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_vehicle_id, '00000000-0000-0000-0000-000000000000')
          AND COALESCE(ci.driver_user_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_driver_user_id, '00000000-0000-0000-0000-000000000000'));
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'level', v_level, 'requirements_ensured', v_created);
END; $$;

-- Driver-level items need their own identity slot.
DROP INDEX IF EXISTS public.cci_identity;
CREATE UNIQUE INDEX cci_identity ON public.carrier_compliance_items
  (carrier_id, requirement_code,
   coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(driver_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 2. Fleet Owner submits evidence for ONE of its own requirement items.
CREATE OR REPLACE FUNCTION public.carrier_evidence_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.carrier_compliance_items;
  v_id uuid := (p->>'item_id')::uuid;
  v_path text := nullif(p->>'evidence_storage_path','');
BEGIN
  SELECT * INTO v_item FROM public.carrier_compliance_items WHERE id = v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_ITEM'); END IF;

  IF NOT (public._carrier_is_member(v_item.carrier_id)
          OR public.has_staff_permission('staff.logistics.compliance.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF v_path IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','EVIDENCE_DOCUMENT_REQUIRED');
  END IF;

  UPDATE public.carrier_compliance_items SET
    evidence_storage_path = v_path,
    evidence_hash = nullif(p->>'evidence_hash',''),
    reference_number = nullif(p->>'reference_number',''),
    issuing_authority = COALESCE(nullif(p->>'issuing_authority',''), issuing_authority),
    issued_on = nullif(p->>'issued_on','')::date,
    expires_on = nullif(p->>'expires_on','')::date,
    state = 'PENDING_REVIEW',
    reviewed_by = NULL, reviewed_at = NULL, review_notes = NULL,
    updated_at = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'item_id', v_id, 'state', 'PENDING_REVIEW',
    'responsibility_level', v_item.responsibility_level);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_evidence_submit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_evidence_submit(jsonb) TO authenticated, service_role;

-- 3. Staff verification / rejection.
CREATE OR REPLACE FUNCTION public.carrier_evidence_review(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item public.carrier_compliance_items;
  v_id uuid := (p->>'item_id')::uuid;
  v_decision text := upper(coalesce(p->>'decision',''));
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.compliance.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO v_item FROM public.carrier_compliance_items WHERE id = v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_ITEM'); END IF;
  IF v_decision NOT IN ('VERIFY','REJECT','LEGAL_REVIEW') THEN
    RETURN jsonb_build_object('error', true, 'code','UNKNOWN_DECISION');
  END IF;
  IF v_decision = 'VERIFY' AND v_item.evidence_storage_path IS NULL AND v_item.evidence_document_id IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','EVIDENCE_DOCUMENT_REQUIRED');
  END IF;

  UPDATE public.carrier_compliance_items SET
    state = CASE v_decision WHEN 'VERIFY' THEN 'VERIFIED'::public.carrier_compliance_state
                            WHEN 'REJECT' THEN 'REJECTED'::public.carrier_compliance_state
                            ELSE 'LEGAL_REVIEW_REQUIRED'::public.carrier_compliance_state END,
    legal_review_reason = CASE WHEN v_decision = 'LEGAL_REVIEW'
                               THEN COALESCE(nullif(p->>'notes',''), 'LEGAL DETERMINATION REQUIRED') END,
    reviewed_by = auth.uid(), reviewed_at = now(),
    review_notes = nullif(p->>'notes',''), updated_at = now()
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'item_id', v_id, 'decision', v_decision);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_evidence_review(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_evidence_review(jsonb) TO authenticated, service_role;

-- 4. Staff verification of the nominated settlement destination.
CREATE OR REPLACE FUNCTION public.carrier_destination_verify(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'destination_id')::uuid;
  v_decision text := upper(coalesce(p->>'decision',''));
  v_state text;
BEGIN
  IF NOT (public.has_staff_permission('staff.finance.manage')
          OR public.has_staff_permission('staff.logistics.compliance.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  v_state := CASE v_decision WHEN 'VERIFY' THEN 'VERIFIED' WHEN 'REJECT' THEN 'REJECTED'
                             WHEN 'SUSPEND' THEN 'SUSPENDED' WHEN 'REVIEW' THEN 'UNDER_REVIEW' END;
  IF v_state IS NULL THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_DECISION'); END IF;

  UPDATE public.carrier_settlement_destinations SET
    verification_state = v_state,
    verified_at = CASE WHEN v_state = 'VERIFIED' THEN now() ELSE NULL END,
    verified_by = auth.uid(),
    verification_notes = nullif(p->>'notes',''),
    updated_at = now()
  WHERE id = v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_DESTINATION'); END IF;

  RETURN jsonb_build_object('ok', true, 'destination_id', v_id, 'verification_state', v_state);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_destination_verify(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_destination_verify(jsonb) TO authenticated, service_role;

-- 5. Activation: only the authoritative verdict may open marketplace access,
--    and activation is what attributes vehicle capacity to the Fleet Owner.
CREATE OR REPLACE FUNCTION public.carrier_activate(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier uuid := (p->>'carrier_id')::uuid;
  v_match jsonb;
  v_linked int := 0;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.compliance.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF upper(coalesce(p->>'action','ACTIVATE')) = 'SUSPEND' THEN
    UPDATE public.carrier_profiles SET operating_status = 'SUSPENDED', updated_at = now()
     WHERE id = v_carrier;
    RETURN jsonb_build_object('ok', true, 'operating_status', 'SUSPENDED');
  END IF;

  v_match := public.carrier_matchability(v_carrier);
  IF NOT COALESCE((v_match->>'matchable')::boolean, false) THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_MATCHABLE', 'matchability', v_match);
  END IF;

  UPDATE public.carrier_profiles SET operating_status = 'ACTIVE', updated_at = now()
   WHERE id = v_carrier;

  -- Attribute this Fleet Owner's verified vehicles to it, so the dispatch gate
  -- can evaluate them. Vehicles with no verified vehicle evidence stay unlinked.
  UPDATE public.logistics_fleet_capacity fc
     SET carrier_id = v_carrier, updated_at = now()
   WHERE fc.carrier_id IS NULL
     AND EXISTS (SELECT 1 FROM public.carrier_compliance_items ci
                  WHERE ci.carrier_id = v_carrier AND ci.vehicle_id = fc.vehicle_id
                    AND ci.state = 'VERIFIED');
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'operating_status','ACTIVE',
    'capacity_records_linked', v_linked, 'matchability', v_match);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_activate(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_activate(jsonb) TO authenticated, service_role;