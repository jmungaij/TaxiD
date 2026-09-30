CREATE OR REPLACE FUNCTION public.carrier_activation_readiness(_carrier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match jsonb;
  v_blocking jsonb := '[]'::jsonb;
  r jsonb;
BEGIN
  v_match := public.carrier_matchability(_carrier_id);
  FOR r IN SELECT jsonb_array_elements(v_match->'blocking') LOOP
    -- Lifecycle-derived blockers are what activation itself resolves; every
    -- evidence, declaration and settlement blocker still fails closed.
    IF (r->>'code') IN ('CARRIER_COMPLIANCE_BLOCKED', 'CARRIER_COMPLIANCE_LEGAL_REVIEW_REQUIRED') THEN
      CONTINUE;
    END IF;
    v_blocking := v_blocking || r;
  END LOOP;

  FOR r IN SELECT jsonb_array_elements(v_match->'compliance'->'blocking') LOOP
    IF (r->>'code') IN ('CARRIER_ONBOARDING', 'CONTRACT_NONE', 'CONTRACT_DRAFT') THEN
      CONTINUE;
    END IF;
    v_blocking := v_blocking || r;
  END LOOP;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blocking) = 0,
    'state', CASE WHEN jsonb_array_length(v_blocking) = 0 THEN 'READY_FOR_ACTIVATION' ELSE 'NOT_READY' END,
    'blocking', v_blocking,
    'matchability', v_match,
    'evaluated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.carrier_activation_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_activation_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.carrier_activate(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier uuid := (p->>'carrier_id')::uuid;
  v_ready jsonb;
  v_agreement public.carrier_declarations;
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

  v_ready := public.carrier_activation_readiness(v_carrier);
  IF NOT COALESCE((v_ready->>'ready')::boolean, false) THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_MATCHABLE', 'readiness', v_ready);
  END IF;

  SELECT * INTO v_agreement FROM public.carrier_declarations
   WHERE carrier_id = v_carrier AND declaration_code = 'FLEET_OWNER_AGREEMENT' AND state = 'ACCEPTED'
   ORDER BY accepted_at DESC LIMIT 1;

  UPDATE public.carrier_profiles SET
    operating_status = 'ACTIVE',
    contract_status = 'SIGNED',
    contract_reference = COALESCE(contract_reference,
      'FOA-' || v_agreement.declaration_version || '-' || upper(substr(v_agreement.declaration_text_hash, 1, 10))),
    effective_from = COALESCE(effective_from, v_agreement.accepted_at::date),
    updated_at = now()
   WHERE id = v_carrier;

  UPDATE public.logistics_fleet_capacity fc
     SET carrier_id = v_carrier, updated_at = now()
   WHERE fc.carrier_id IS NULL
     AND EXISTS (SELECT 1 FROM public.carrier_compliance_items ci
                  WHERE ci.carrier_id = v_carrier AND ci.vehicle_id = fc.vehicle_id
                    AND ci.state = 'VERIFIED');
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'operating_status','ACTIVE',
    'contract_of_record', jsonb_build_object(
      'declaration_version', v_agreement.declaration_version,
      'accepted_at', v_agreement.accepted_at,
      'text_hash', v_agreement.declaration_text_hash),
    'capacity_records_linked', v_linked,
    'matchability', public.carrier_matchability(v_carrier));
END; $$;

REVOKE ALL ON FUNCTION public.carrier_activate(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_activate(jsonb) TO authenticated, service_role;