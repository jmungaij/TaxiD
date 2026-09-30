-- =====================================================================
-- FACILITATOR MODEL — OPERATIONAL ENFORCEMENT
-- Wire the authoritative Fleet Owner compliance verdict (carrier_matchability
-- + carrier_subject_eligibility) into the EXISTING dispatch matching engine.
-- No second matching engine, no second compliance engine.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.carrier_dispatch_gate(
  _carrier_id uuid,
  _vehicle_id uuid DEFAULT NULL,
  _driver_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier public.carrier_profiles;
  v_match jsonb; v_veh jsonb; v_drv jsonb;
  v_blocking jsonb := '[]'::jsonb;
BEGIN
  -- FAIL CLOSED: capacity that is not attributed to an onboarded Fleet Owner
  -- can never be offered to a client.
  IF _carrier_id IS NULL THEN
    RETURN jsonb_build_object('passes', false, 'primary_reason', 'FLEET_OWNER_NOT_LINKED',
      'blocking', jsonb_build_array(jsonb_build_object('code','FLEET_OWNER_NOT_LINKED')),
      'evaluated_at', now());
  END IF;

  SELECT * INTO v_carrier FROM public.carrier_profiles WHERE id = _carrier_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('passes', false, 'primary_reason', 'FLEET_OWNER_UNKNOWN',
      'blocking', jsonb_build_array(jsonb_build_object('code','FLEET_OWNER_UNKNOWN')),
      'evaluated_at', now());
  END IF;

  IF v_carrier.operating_status::text <> 'ACTIVE' THEN
    v_blocking := v_blocking || jsonb_build_object(
      'code','FLEET_OWNER_NOT_ACTIVE','operating_status', v_carrier.operating_status::text);
  END IF;

  v_match := public.carrier_matchability(_carrier_id);
  IF NOT COALESCE((v_match->>'matchable')::boolean, false) THEN
    v_blocking := v_blocking || jsonb_build_object(
      'code','FLEET_OWNER_NOT_MATCHABLE','detail', v_match->'blocking');
  END IF;

  IF _vehicle_id IS NOT NULL THEN
    v_veh := public.carrier_subject_eligibility(_carrier_id, 'VEHICLE', _vehicle_id, NULL);
    IF NOT COALESCE((v_veh->>'eligible')::boolean, false) THEN
      v_blocking := v_blocking || jsonb_build_object(
        'code','VEHICLE_EVIDENCE_INVALID','detail', v_veh->'blocking');
    END IF;
  END IF;

  IF _driver_user_id IS NULL THEN
    v_blocking := v_blocking || jsonb_build_object('code','DRIVER_IDENTITY_MISSING');
  ELSE
    v_drv := public.carrier_subject_eligibility(_carrier_id, 'DRIVER', NULL, _driver_user_id);
    IF NOT COALESCE((v_drv->>'eligible')::boolean, false) THEN
      v_blocking := v_blocking || jsonb_build_object(
        'code','DRIVER_EVIDENCE_INVALID','detail', v_drv->'blocking');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'passes', jsonb_array_length(v_blocking) = 0,
    'primary_reason', CASE WHEN jsonb_array_length(v_blocking) = 0 THEN NULL
                           ELSE v_blocking->0->>'code' END,
    'carrier_id', _carrier_id,
    'fleet_owner_name', v_carrier.legal_entity_name,
    'matchability', v_match, 'vehicle', v_veh, 'driver', v_drv,
    'blocking', v_blocking, 'evaluated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.carrier_dispatch_gate(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_dispatch_gate(uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistics_dispatch_match(_request_id uuid, _commit boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.logistics_dispatch_requests;
  v_w public.logistics_match_weights;
  v_run uuid;
  v_start timestamptz := clock_timestamp();
  v_cand record;
  v_candidates integer := 0;
  v_eligible integer := 0;
  v_best record;
  v_res uuid;
  v_is_staff boolean;
  v_pickup timestamptz;
BEGIN
  SELECT * INTO v_req FROM public.logistics_dispatch_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND'); END IF;

  v_is_staff := public.has_staff_permission('staff.logistics.manage');
  -- The customer may trigger matching for their OWN request only, and never a
  -- simulation-only run against the fleet.
  IF NOT v_is_staff AND v_req.customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  IF NOT v_is_staff AND _commit = false THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  IF _commit AND v_req.status NOT IN ('REQUESTED','MATCHING','WAITLISTED','EXCEPTION') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_STATE', 'status', v_req.status);
  END IF;

  SELECT * INTO v_w FROM public.logistics_match_weights WHERE active LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'MATCH_WEIGHTS_MISSING'); END IF;

  v_pickup := COALESCE(v_req.pickup_window_start, now());

  IF _commit THEN
    UPDATE public.logistics_dispatch_requests
    SET status = 'MATCHING', matching_status = 'RUNNING' WHERE id = _request_id;
  END IF;

  INSERT INTO public.logistics_match_runs (
    dispatch_request_id, mode, weights_version, outcome, actor_id)
  VALUES (_request_id, CASE WHEN _commit THEN 'COMMIT' ELSE 'SIMULATE' END, v_w.version,
          CASE WHEN _commit THEN 'NO_CAPACITY' ELSE 'SIMULATED' END, auth.uid())
  RETURNING id INTO v_run;

  -- ---- candidate evaluation: every freight-capable vehicle is scored and
  -- ---- every refusal is recorded with a machine-readable reason.
  FOR v_cand IN
    WITH cand AS (
      SELECT
        fc.vehicle_id,
        fc.vehicle_class,
        fc.payload_capacity_kg,
        fc.volume_capacity_cbm,
        fc.capability_status,
        fc.compliance_valid_until,
        fc.hazardous_certified,
        fc.temperature_controlled,
        fc.operating_radius_km,
        fc.base_lat, fc.base_lng, fc.base_label,
        fc.carrier_id,
        v.number_plate,
        v.vehicle_status,
        CASE
          WHEN fc.base_lat IS NULL OR fc.base_lng IS NULL
               OR v_req.origin_lat IS NULL OR v_req.origin_lng IS NULL THEN NULL
          ELSE 6371 * 2 * asin(sqrt(
                 power(sin(radians(v_req.origin_lat - fc.base_lat) / 2), 2)
               + cos(radians(fc.base_lat)) * cos(radians(v_req.origin_lat))
               * power(sin(radians(v_req.origin_lng - fc.base_lng) / 2), 2)))
        END AS origin_distance_km,
        (SELECT d.id FROM public.driver_vehicle_assignments dva
           JOIN public.drivers d ON d.id = dva.driver_id
           LEFT JOIN public.driver_compliance dc ON dc.driver_id = d.id
          WHERE dva.vehicle_id = fc.vehicle_id
            AND dva.status = 'active'
            AND (dva.end_date IS NULL OR dva.end_date >= current_date)
            AND d.status = 'active'
            AND COALESCE(dc.license_valid, false)
            AND COALESCE(dc.insurance_valid, false)
            AND COALESCE(dc.inspection_valid, false)
            AND NOT EXISTS (
              SELECT 1 FROM public.logistics_capacity_reservations r
              WHERE r.driver_id = d.id AND r.status = 'ACTIVE'
                AND r.dispatch_request_id <> _request_id)
          ORDER BY d.driver_rating DESC NULLS LAST
          LIMIT 1) AS driver_id,
        EXISTS (SELECT 1 FROM public.logistics_capacity_reservations r
                 WHERE r.vehicle_id = fc.vehicle_id AND r.status = 'ACTIVE'
                   AND r.dispatch_request_id <> _request_id) AS already_reserved
      FROM public.logistics_fleet_capacity fc
      JOIN public.vehicles v ON v.id = fc.vehicle_id
    )
    SELECT c.*,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN c.payload_capacity_kg < v_req.required_payload_kg THEN 'INSUFFICIENT_CAPACITY' END,
        CASE WHEN v_req.required_volume_cbm > 0 AND c.volume_capacity_cbm > 0
                  AND c.volume_capacity_cbm < v_req.required_volume_cbm THEN 'INSUFFICIENT_VOLUME' END,
        CASE WHEN c.vehicle_class <> v_req.vehicle_class THEN 'VEHICLE_CLASS_MISMATCH' END,
        CASE WHEN c.capability_status <> 'AVAILABLE' THEN 'VEHICLE_UNAVAILABLE' END,
        CASE WHEN c.vehicle_status::text <> 'active' THEN 'VEHICLE_NOT_ACTIVE' END,
        CASE WHEN c.compliance_valid_until IS NULL
                  OR c.compliance_valid_until < v_pickup::date THEN 'COMPLIANCE_FAILURE' END,
        CASE WHEN v_req.hazardous AND NOT c.hazardous_certified THEN 'HAZARDOUS_NOT_CERTIFIED' END,
        CASE WHEN v_req.temperature_controlled AND NOT c.temperature_controlled THEN 'TEMPERATURE_NOT_SUPPORTED' END,
        CASE WHEN c.driver_id IS NULL THEN 'DRIVER_UNAVAILABLE' END,
        CASE WHEN c.already_reserved THEN 'ALREADY_RESERVED' END,
        CASE WHEN c.origin_distance_km IS NULL THEN 'ROUTE_MISMATCH'
             WHEN c.origin_distance_km > c.operating_radius_km THEN 'ROUTE_MISMATCH' END,
        -- FACILITATOR GATE (fail-closed): the authoritative Fleet Owner /
        -- vehicle / driver compliance verdict decides marketplace access.
        CASE WHEN NOT COALESCE((gate.g->>'passes')::boolean, false)
             THEN COALESCE(gate.g->>'primary_reason', 'FLEET_OWNER_NOT_MATCHABLE') END
      ], NULL) AS reasons,
      gate.g AS gate
    FROM cand c
    LEFT JOIN LATERAL (
      SELECT public.carrier_dispatch_gate(
               c.carrier_id, c.vehicle_id,
               (SELECT d2.user_id FROM public.drivers d2 WHERE d2.id = c.driver_id)) AS g) gate ON true
  LOOP
    v_candidates := v_candidates + 1;
    INSERT INTO public.logistics_match_candidates (
      match_run_id, vehicle_id, driver_id, eligible, score, rejection_reasons, evidence)
    VALUES (
      v_run, v_cand.vehicle_id, v_cand.driver_id,
      cardinality(v_cand.reasons) = 0,
      CASE WHEN cardinality(v_cand.reasons) = 0 THEN ROUND((
          v_w.w_capacity * LEAST(1, v_req.required_payload_kg / NULLIF(v_cand.payload_capacity_kg,0))
        + v_w.w_class * 1
        + v_w.w_driver * 1
        + v_w.w_proximity * GREATEST(0, 1 - COALESCE(v_cand.origin_distance_km,0) / NULLIF(v_cand.operating_radius_km,0))
        + v_w.w_route * 1
        + v_w.w_availability * 1
        + v_w.w_compliance * 1
        + v_w.w_schedule * 1)::numeric, 2) ELSE NULL END,
      v_cand.reasons,
      jsonb_build_object(
        'number_plate', v_cand.number_plate,
        'vehicle_class', v_cand.vehicle_class,
        'payload_capacity_kg', v_cand.payload_capacity_kg,
        'required_payload_kg', v_req.required_payload_kg,
        'volume_capacity_cbm', v_cand.volume_capacity_cbm,
        'capability_status', v_cand.capability_status,
        'origin_distance_km', ROUND(COALESCE(v_cand.origin_distance_km, -1)::numeric, 2),
        'operating_radius_km', v_cand.operating_radius_km,
        'base_label', v_cand.base_label,
        'compliance_valid_until', v_cand.compliance_valid_until,
        'carrier_id', v_cand.carrier_id,
        'fleet_owner_gate', v_cand.gate));
    IF cardinality(v_cand.reasons) = 0 THEN v_eligible := v_eligible + 1; END IF;
  END LOOP;

  UPDATE public.logistics_match_candidates c SET rank = s.rnk
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC) AS rnk
          FROM public.logistics_match_candidates
         WHERE match_run_id = v_run AND eligible) s
  WHERE c.id = s.id;

  SELECT mc.vehicle_id, mc.driver_id, mc.score, mc.evidence
    INTO v_best
    FROM public.logistics_match_candidates mc
   WHERE mc.match_run_id = v_run AND mc.eligible
   ORDER BY mc.score DESC LIMIT 1;

  UPDATE public.logistics_match_runs SET
    candidate_count = v_candidates,
    eligible_count = v_eligible,
    rejected_count = v_candidates - v_eligible,
    selected_vehicle_id = CASE WHEN _commit THEN v_best.vehicle_id ELSE NULL END,
    selected_driver_id = CASE WHEN _commit THEN v_best.driver_id ELSE NULL END,
    selected_score = v_best.score,
    matching_duration_ms = GREATEST(0, (EXTRACT(epoch FROM clock_timestamp() - v_start) * 1000)::int)
  WHERE id = v_run;

  -- ---- simulation stops here: no reservation, no state change.
  IF NOT _commit THEN
    RETURN jsonb_build_object(
      'error', false, 'code', 'SIMULATED', 'match_run_id', v_run,
      'candidate_count', v_candidates, 'eligible_count', v_eligible,
      'rejected_count', v_candidates - v_eligible,
      'best_vehicle_id', v_best.vehicle_id, 'best_score', v_best.score);
  END IF;

  IF v_best.vehicle_id IS NULL THEN
    UPDATE public.logistics_dispatch_requests SET
      status = 'WAITLISTED', matching_status = 'NO_CAPACITY',
      last_failure_code = 'NO_ELIGIBLE_CAPACITY',
      last_failure_message = format(
        'No compliant %s vehicle with at least %s kg payload is currently available for this movement. %s candidate(s) evaluated, all refused.',
        v_req.vehicle_class, v_req.required_payload_kg, v_candidates)
    WHERE id = _request_id;
    INSERT INTO public.logistics_dispatch_events (
      dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
    VALUES (_request_id, 'DISPATCH_WAITLISTED', v_req.status, 'WAITLISTED', auth.uid(),
            CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
            'No eligible capacity',
            jsonb_build_object('match_run_id', v_run, 'candidates', v_candidates));
    RETURN jsonb_build_object(
      'error', false, 'code', 'NO_ELIGIBLE_CAPACITY', 'match_run_id', v_run,
      'status', 'WAITLISTED', 'candidate_count', v_candidates, 'eligible_count', 0);
  END IF;

  -- ---- transactional reservation. The unique partial index refuses a second
  -- ---- live reservation on the same truck; we surface that as a conflict
  -- ---- rather than double-booking.
  BEGIN
    INSERT INTO public.logistics_capacity_reservations (
      vehicle_id, driver_id, dispatch_request_id, capacity_reserved_kg, capacity_reserved_cbm, reserved_by)
    VALUES (v_best.vehicle_id, v_best.driver_id, _request_id,
            v_req.required_payload_kg, v_req.required_volume_cbm, auth.uid())
    RETURNING id INTO v_res;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.logistics_match_runs SET outcome = 'RESERVATION_CONFLICT' WHERE id = v_run;
    UPDATE public.logistics_dispatch_requests SET
      status = 'WAITLISTED', matching_status = 'REMATCH_REQUIRED',
      last_failure_code = 'CAPACITY_TAKEN',
      last_failure_message = 'The matched truck was reserved by another movement a moment before this booking. Re-matching is required.'
    WHERE id = _request_id;
    RETURN jsonb_build_object('error', true, 'code', 'CAPACITY_TAKEN', 'match_run_id', v_run);
  END;

  UPDATE public.logistics_fleet_capacity
     SET capability_status = 'RESERVED'
   WHERE vehicle_id = v_best.vehicle_id AND capability_status = 'AVAILABLE';

  UPDATE public.logistics_dispatch_requests SET
    status = 'DRIVER_PENDING', matching_status = 'MATCHED',
    assigned_vehicle_id = v_best.vehicle_id, assigned_driver_id = v_best.driver_id,
    reservation_id = v_res, last_failure_code = NULL, last_failure_message = NULL
  WHERE id = _request_id;

  UPDATE public.logistics_match_runs SET
    outcome = 'MATCHED',
    selection_reason = 'Highest-scoring vehicle passing every mandatory capacity, class, availability, compliance, driver, route and Fleet Owner matchability control.'
  WHERE id = v_run;

  -- Bind the operational assignment onto the Stage 2 leg (no parallel model).
  IF v_req.leg_id IS NOT NULL THEN
    UPDATE public.logistics_order_legs
       SET vehicle_id = v_best.vehicle_id, driver_id = v_best.driver_id,
           status = CASE WHEN status IN ('PLANNED','AWAITING_CAPACITY') THEN 'ASSIGNED' ELSE status END
     WHERE id = v_req.leg_id;
    INSERT INTO public.logistics_leg_events (
      leg_id, order_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
    VALUES (v_req.leg_id, v_req.order_id, 'LEG_ASSIGNED', 'PLANNED', 'ASSIGNED', auth.uid(),
            CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
            'Capacity matched by dispatch engine',
            jsonb_build_object('match_run_id', v_run, 'reservation_id', v_res));
  END IF;

  INSERT INTO public.logistics_dispatch_events (
    dispatch_request_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_request_id, 'CAPACITY_RESERVED', v_req.status, 'DRIVER_PENDING', auth.uid(),
          CASE WHEN v_is_staff THEN 'staff' ELSE 'customer' END,
          'Matched and reserved',
          jsonb_build_object('match_run_id', v_run, 'reservation_id', v_res,
                             'vehicle_id', v_best.vehicle_id, 'driver_id', v_best.driver_id,
                             'score', v_best.score));

  RETURN jsonb_build_object(
    'error', false, 'code', 'MATCHED', 'match_run_id', v_run, 'reservation_id', v_res,
    'status', 'DRIVER_PENDING', 'vehicle_id', v_best.vehicle_id, 'driver_id', v_best.driver_id,
    'score', v_best.score, 'candidate_count', v_candidates, 'eligible_count', v_eligible);
END $$;

REVOKE ALL ON FUNCTION public.logistics_dispatch_match(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_dispatch_match(uuid, boolean) TO authenticated, service_role;