-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 4b: amendment engine + handover-gated states
-- =====================================================================

CREATE OR REPLACE FUNCTION public.rental_booking_request_change(
  _booking_reference text, _action text, _token text DEFAULT NULL,
  _new_start date DEFAULT NULL, _new_end date DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rental_bookings; q public.rental_quote_requests;
        act text := upper(coalesce(_action, '')); authorised boolean := false;
        uid uuid := auth.uid(); mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
        free_units integer; am public.rental_amendments;
BEGIN
  IF act NOT IN ('RESCHEDULE','CANCELLATION') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_ACTION');
  END IF;

  SELECT * INTO b FROM public.rental_bookings
   WHERE booking_reference = upper(coalesce(_booking_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_FOUND');
  END IF;

  SELECT * INTO q FROM public.rental_quote_requests WHERE id = b.quote_id;
  IF _token IS NOT NULL AND length(_token) >= 20 AND q.token = _token THEN
    authorised := true;
  ELSIF uid IS NOT NULL AND (b.rider_user_id = uid OR (mail <> '' AND lower(b.contact_email) = mail)) THEN
    authorised := true;
  END IF;
  IF authorised IS NOT true THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED_FOR_BOOKING');
  END IF;

  IF b.status IN ('RETURNED','CANCELLED') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_CLOSED');
  END IF;
  IF b.change_request IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'CHANGE_ALREADY_REQUESTED');
  END IF;

  IF act = 'RESCHEDULE' THEN
    IF _new_start IS NULL OR _new_end IS NULL OR _new_end < _new_start THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NEW_DATES_REQUIRED');
    END IF;
    IF _new_start < current_date THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'START_DATE_IN_THE_PAST');
    END IF;
    IF (_new_end - _new_start) <> (b.end_date - b.start_date) THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'RENTAL_LENGTH_MUST_MATCH');
    END IF;
    SELECT count(*) INTO free_units
      FROM public.rental_fleet_units u
     WHERE u.status = 'AVAILABLE' AND u.asset_class = b.asset_class AND u.band_label = b.band_label
       AND ((b.category = 'SELF_DRIVE' AND u.self_drive) OR (b.category = 'CHAUFFEUR' AND u.chauffeur))
       AND NOT EXISTS (
         SELECT 1 FROM public.rental_unit_commitments c
          WHERE c.unit_id = u.id AND c.booking_id IS DISTINCT FROM b.id
            AND c.start_date <= _new_end AND c.end_date >= _new_start);
    IF coalesce(free_units, 0) < 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_VEHICLE_FREE_ON_THOSE_DATES');
    END IF;
  ELSE
    IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'CANCELLATION_REASON_REQUIRED');
    END IF;
  END IF;

  UPDATE public.rental_bookings
     SET change_request = act, change_requested_at = now(),
         requested_start_date = CASE WHEN act = 'RESCHEDULE' THEN _new_start ELSE NULL END,
         requested_end_date   = CASE WHEN act = 'RESCHEDULE' THEN _new_end ELSE NULL END,
         change_reason = left(btrim(coalesce(_reason, '')), 1000)
   WHERE id = b.id;

  -- Controlled amendment: original terms preserved alongside the request.
  INSERT INTO public.rental_amendments (
    booking_id, amendment_type, original_start, original_end, original_total_kes,
    requested_start, requested_end, reason, requested_by, requested_channel,
    state, correlation_id)
  VALUES (b.id, act, b.start_date, b.end_date, b.total_kes,
          _new_start, _new_end, left(btrim(coalesce(_reason,'')), 1000), uid,
          CASE WHEN uid IS NULL THEN 'CUSTOMER_TOKEN' ELSE 'CUSTOMER' END,
          CASE WHEN act = 'CANCELLATION' AND b.amount_paid_kes > 0 THEN 'POLICY_REQUIRED' ELSE 'REQUESTED' END,
          b.correlation_id)
  RETURNING * INTO am;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail, actor_id)
  VALUES (b.id, 'CUSTOMER_' || act || '_REQUESTED',
          jsonb_build_object('new_start', _new_start, 'new_end', _new_end,
                             'amendment_id', am.id,
                             'reason', left(btrim(coalesce(_reason, '')), 1000)), uid);

  PERFORM public.rental_emit_event(
    CASE WHEN act = 'RESCHEDULE' THEN 'RescheduleRequested' ELSE 'CancellationRequested' END,
    'booking', b.id, b.booking_reference, b.correlation_id,
    jsonb_build_object('amendment_id', am.id, 'requested_start', _new_start,
                       'requested_end', _new_end, 'amount_paid_kes', b.amount_paid_kes),
    NULL, uid, am.id::text);

  IF am.state = 'POLICY_REQUIRED' THEN
    PERFORM public.rental_exception_open('REFUND_POLICY_REQUIRED','booking', b.id, b.booking_reference,
      b.correlation_id, jsonb_build_object('amendment_id', am.id,
        'amount_paid_kes', b.amount_paid_kes,
        'note','No cancellation or refund rule is defined. A person must decide the outcome.'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason_code', 'CHANGE_REQUESTED', 'action', act,
    'amendment_id', am.id, 'amendment_state', am.state);
END; $$;
GRANT EXECUTE ON FUNCTION public.rental_booking_request_change(text, text, text, date, date, text)
  TO anon, authenticated, service_role;

-- ------------------------------------------------ staff lifecycle actions
CREATE OR REPLACE FUNCTION public.rental_booking_staff_action(
  _booking_reference text, _action text, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rental_bookings; act text := upper(coalesce(_action,''));
        uid uuid := auth.uid(); new_unit uuid; am public.rental_amendments; rf uuid;
BEGIN
  IF public.has_staff_permission('staff.commercial.write') IS NOT true THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED');
  END IF;

  SELECT * INTO b FROM public.rental_bookings
   WHERE booking_reference = upper(coalesce(_booking_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_FOUND');
  END IF;

  SELECT * INTO am FROM public.rental_amendments
   WHERE booking_id = b.id AND state IN ('REQUESTED','POLICY_REQUIRED')
   ORDER BY created_at DESC LIMIT 1;

  IF act IN ('CONFIRM_PICKUP','CONFIRM_RETURN') THEN
    -- Handover is an operational transaction with evidence, never a status flip.
    RETURN jsonb_build_object('ok', false, 'reason_code', 'RECORD_HANDOVER_EVIDENCE_FIRST',
      'detail', 'Capture location, odometer, fuel and condition through the handover record.');

  ELSIF act = 'APPROVE_RESCHEDULE' THEN
    IF b.change_request <> 'RESCHEDULE' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_RESCHEDULE_REQUESTED');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('rental_allocation'));
    SELECT u.id INTO new_unit
      FROM public.rental_fleet_units u
     WHERE u.status = 'AVAILABLE' AND u.asset_class = b.asset_class AND u.band_label = b.band_label
       AND ((b.category = 'SELF_DRIVE' AND u.self_drive) OR (b.category = 'CHAUFFEUR' AND u.chauffeur))
       AND NOT EXISTS (
         SELECT 1 FROM public.rental_unit_commitments c
          WHERE c.unit_id = u.id AND c.booking_id IS DISTINCT FROM b.id
            AND c.start_date <= b.requested_end_date AND c.end_date >= b.requested_start_date)
     ORDER BY (u.id = b.unit_id) DESC, u.created_at LIMIT 1;
    IF new_unit IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_VEHICLE_FREE_ON_THOSE_DATES');
    END IF;
    DELETE FROM public.rental_unit_commitments WHERE booking_id = b.id;
    INSERT INTO public.rental_unit_commitments (unit_id, booking_id, start_date, end_date, source)
    VALUES (new_unit, b.id, b.requested_start_date, b.requested_end_date, 'BOOKING');
    UPDATE public.rental_bookings
       SET start_date = b.requested_start_date, end_date = b.requested_end_date,
           unit_id = new_unit, change_request = NULL, change_requested_at = NULL,
           requested_start_date = NULL, requested_end_date = NULL
     WHERE id = b.id;
    IF am.id IS NOT NULL THEN
      UPDATE public.rental_amendments
         SET state = 'APPROVED', decided_by = uid, decided_at = now(),
             decision_note = left(btrim(coalesce(_note,'')),1000),
             price_difference_kes = 0
       WHERE id = am.id;
    END IF;

  ELSIF act = 'APPROVE_CANCELLATION' THEN
    IF b.change_request <> 'CANCELLATION' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_CANCELLATION_REQUESTED');
    END IF;
    DELETE FROM public.rental_unit_commitments WHERE booking_id = b.id;
    UPDATE public.rental_bookings
       SET status = 'CANCELLED', change_request = NULL, change_requested_at = NULL
     WHERE id = b.id;

    -- Money already taken: a refund decision is required from a human. No
    -- amount is computed here because no refund policy exists.
    IF b.amount_paid_kes > 0 THEN
      INSERT INTO public.rental_refunds (booking_id, correlation_id, reason, state, policy_basis, requested_by, notes)
      VALUES (b.id, b.correlation_id,
              coalesce(nullif(btrim(b.change_reason),''),'Customer cancellation'),
              'POLICY_REQUIRED','NO_REFUND_POLICY_DEFINED', uid,
              left(btrim(coalesce(_note,'')),1000))
      RETURNING id INTO rf;
      IF am.id IS NOT NULL THEN
        UPDATE public.rental_amendments SET refund_id = rf WHERE id = am.id;
      END IF;
      PERFORM public.rental_exception_open('REFUND_POLICY_REQUIRED','booking', b.id, b.booking_reference,
        b.correlation_id, jsonb_build_object('refund_id', rf, 'amount_paid_kes', b.amount_paid_kes));
    END IF;

    IF am.id IS NOT NULL THEN
      UPDATE public.rental_amendments
         SET state = 'APPROVED', decided_by = uid, decided_at = now(),
             decision_note = left(btrim(coalesce(_note,'')),1000)
       WHERE id = am.id;
    END IF;
    PERFORM public.rental_emit_event('CancellationApproved','booking', b.id, b.booking_reference,
      b.correlation_id, jsonb_build_object('refund_id', rf), NULL, uid, 'cancel');

  ELSIF act = 'DECLINE_CHANGE' THEN
    IF b.change_request IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_CHANGE_REQUESTED');
    END IF;
    IF coalesce(btrim(_note),'') = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'DECISION_NOTE_REQUIRED');
    END IF;
    UPDATE public.rental_bookings
       SET change_request = NULL, change_requested_at = NULL,
           requested_start_date = NULL, requested_end_date = NULL
     WHERE id = b.id;
    IF am.id IS NOT NULL THEN
      UPDATE public.rental_amendments
         SET state = 'DECLINED', decided_by = uid, decided_at = now(),
             decision_note = left(btrim(_note),1000)
       WHERE id = am.id;
    END IF;

  ELSIF act = 'REALLOCATE' THEN
    RETURN public.rental_reallocate_booking(b.id);

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_ACTION');
  END IF;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail, actor_id)
  VALUES (b.id, 'STAFF_' || act, jsonb_build_object('note', left(btrim(coalesce(_note,'')), 1000)), uid);

  RETURN jsonb_build_object('ok', true, 'reason_code', act, 'amendment_id', am.id, 'refund_id', rf);
END; $$;
REVOKE ALL ON FUNCTION public.rental_booking_staff_action(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_booking_staff_action(text, text, text) TO authenticated, service_role;

-- Refund authorisation: a named person sets the amount; nothing is automatic.
CREATE OR REPLACE FUNCTION public.rental_refund_decide(
  _refund_id uuid, _decision text, _amount_kes numeric DEFAULT NULL,
  _policy_basis text DEFAULT NULL, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rental_refunds; dec text := upper(coalesce(_decision,''));
BEGIN
  IF NOT (public.has_staff_permission('staff.finance.write')
          OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED');
  END IF;
  IF dec NOT IN ('AUTHORISE','DECLINE') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_DECISION');
  END IF;
  IF coalesce(btrim(_note),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'DECISION_NOTE_REQUIRED');
  END IF;

  SELECT * INTO r FROM public.rental_refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code','REFUND_NOT_FOUND'); END IF;
  IF r.state NOT IN ('REQUESTED','POLICY_REQUIRED') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','REFUND_ALREADY_DECIDED','state', r.state);
  END IF;

  IF dec = 'DECLINE' THEN
    UPDATE public.rental_refunds
       SET state='DECLINED', authorised_by=auth.uid(), authorised_at=now(),
           notes=left(btrim(_note),1000), policy_basis=coalesce(_policy_basis, r.policy_basis)
     WHERE id = r.id RETURNING * INTO r;
    RETURN jsonb_build_object('ok', true, 'state', r.state);
  END IF;

  IF _amount_kes IS NULL OR _amount_kes <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','REFUND_AMOUNT_REQUIRED');
  END IF;
  IF coalesce(btrim(_policy_basis),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','POLICY_BASIS_REQUIRED');
  END IF;

  UPDATE public.rental_refunds
     SET state='AUTHORISED', amount_kes=round(_amount_kes,2), authorised_by=auth.uid(),
         authorised_at=now(), policy_basis=btrim(_policy_basis), notes=left(btrim(_note),1000)
   WHERE id = r.id RETURNING * INTO r;

  PERFORM public.rental_ledger_post('REFUND', r.id::text,
    jsonb_build_array(
      jsonb_build_object('account','CUSTOMER_RECEIVABLE','direction','DEBIT','amount_kes', r.amount_kes),
      jsonb_build_object('account','REFUND_PAYABLE','direction','CREDIT','amount_kes', r.amount_kes)
    ), r.booking_id, NULL, r.correlation_id, 'Authorised rental refund');

  PERFORM public.rental_emit_event('RefundInitiated','booking', r.booking_id, NULL, r.correlation_id,
    jsonb_build_object('refund_id', r.id, 'amount_kes', r.amount_kes), NULL, auth.uid(), r.id::text);

  RETURN jsonb_build_object('ok', true, 'state', r.state, 'amount_kes', r.amount_kes);
END; $$;
REVOKE ALL ON FUNCTION public.rental_refund_decide(uuid,text,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_refund_decide(uuid,text,numeric,text,text) TO authenticated, service_role;