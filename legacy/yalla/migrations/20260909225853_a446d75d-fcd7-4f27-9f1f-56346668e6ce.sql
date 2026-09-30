ALTER TABLE public.corporate_ride_approvals
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.trip_bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS passenger_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cost_center_code text,
  ADD COLUMN IF NOT EXISTS purpose text;

CREATE OR REPLACE FUNCTION public.request_corporate_ride(
  _corporate_id uuid,
  _employee_id uuid,
  _ride_type text,
  _pickup_address text,
  _dropoff_address text,
  _fare_cents bigint,
  _scheduled_for timestamptz DEFAULT NULL,
  _passenger_count integer DEFAULT 1,
  _department_id uuid DEFAULT NULL,
  _cost_center_code text DEFAULT NULL,
  _purpose text DEFAULT NULL,
  _distance_km numeric DEFAULT NULL,
  _ride_type_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _emp public.corporate_employees;
  _is_manager boolean;
  _is_platform boolean;
  _eval record;
  _when timestamptz := COALESCE(_scheduled_for, now());
  _booking public.trip_bookings;
  _approval public.corporate_ride_approvals;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF _fare_cents IS NULL OR _fare_cents <= 0 THEN
    RAISE EXCEPTION 'estimated value must be greater than zero' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(_pickup_address),'') = '' OR coalesce(btrim(_dropoff_address),'') = '' THEN
    RAISE EXCEPTION 'pickup and drop-off are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _emp
    FROM public.corporate_employees
   WHERE id = _employee_id AND corporate_id = _corporate_id;
  IF _emp.id IS NULL THEN
    RAISE EXCEPTION 'employee does not belong to this organisation' USING ERRCODE = '42501';
  END IF;
  IF _emp.status <> 'active' THEN
    RAISE EXCEPTION 'employee is not active' USING ERRCODE = '42501';
  END IF;
  IF _emp.user_id IS NULL THEN
    RAISE EXCEPTION 'employee has no linked account and cannot travel yet' USING ERRCODE = '22023';
  END IF;

  _is_manager := public.has_corporate_role(_caller, _corporate_id, 'corporate_admin'::corporate_employee_role)
              OR public.has_corporate_role(_caller, _corporate_id, 'corporate_manager'::corporate_employee_role);
  _is_platform := public.has_role(_caller, 'admin'::app_role) OR public.has_role(_caller, 'super_admin'::app_role);

  IF NOT (_is_manager OR _is_platform OR _emp.user_id = _caller) THEN
    RAISE EXCEPTION 'not authorised to request rides for this organisation' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _eval
    FROM public.evaluate_corporate_ride_policy(_employee_id, _ride_type, _fare_cents, _distance_km, _when);

  IF _eval.decision IS NULL THEN
    _eval.decision := 'allow'::corporate_decision;
    _eval.reason := 'within policy';
  END IF;

  IF _eval.decision = 'block' THEN
    INSERT INTO public.corporate_policy_violations (
      corporate_id, employee_id, user_id, decision, reason, policy_id, rule_id,
      ride_type, fare_cents, distance_km, context
    ) VALUES (
      _corporate_id, _employee_id, _caller, 'block', _eval.reason, _eval.policy_id, _eval.rule_id,
      _ride_type, _fare_cents, _distance_km,
      jsonb_build_object('pickup', _pickup_address, 'dropoff', _dropoff_address, 'purpose', _purpose)
    );
    INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
    VALUES (_caller, 'corporate', 'corporate_ride_request', _corporate_id, 'blocked_by_policy',
            jsonb_build_object('employee_id', _employee_id, 'reason', _eval.reason, 'fare_cents', _fare_cents));
    RETURN jsonb_build_object(
      'decision', 'block', 'reason', _eval.reason,
      'policy_id', _eval.policy_id, 'rule_id', _eval.rule_id
    );
  END IF;

  IF _eval.decision = 'requires_approval' OR _emp.requires_approval THEN
    INSERT INTO public.corporate_ride_approvals (
      corporate_id, employee_id, department_id, requested_by, ride_type,
      pickup_address, dropoff_address, estimated_fare_cents, estimated_distance_km,
      scheduled_for, justification, triggering_policy_id, triggering_rule_id,
      passenger_count, cost_center_code, purpose
    ) VALUES (
      _corporate_id, _employee_id, COALESCE(_department_id, _emp.department_id), _caller, _ride_type,
      _pickup_address, _dropoff_address, _fare_cents, _distance_km,
      _scheduled_for, _purpose, _eval.policy_id, _eval.rule_id,
      GREATEST(COALESCE(_passenger_count,1),1), _cost_center_code, _purpose
    )
    RETURNING * INTO _approval;

    INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
    VALUES (_caller, 'corporate', 'corporate_ride_approval', _approval.id, 'requested',
            jsonb_build_object('employee_id', _employee_id, 'fare_cents', _fare_cents, 'reason', _eval.reason));

    RETURN jsonb_build_object(
      'decision', 'requires_approval', 'reason',
      CASE WHEN _eval.decision = 'requires_approval' THEN _eval.reason ELSE 'employee requires approval for every trip' END,
      'approval_id', _approval.id,
      'policy_id', _eval.policy_id, 'rule_id', _eval.rule_id
    );
  END IF;

  INSERT INTO public.trip_bookings (
    rider_user_id, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, passenger_count,
    intent, payment_method, ride_type_id, total_fare, status, scheduled_for
  ) VALUES (
    _emp.user_id, _pickup_address, 0, 0,
    _dropoff_address, 0, 0, GREATEST(COALESCE(_passenger_count,1),1),
    'corporate', 'corporate_wallet', _ride_type_id, _fare_cents::numeric / 100, 
    CASE WHEN _scheduled_for IS NOT NULL THEN 'scheduled' ELSE 'pending' END,
    _scheduled_for
  )
  RETURNING * INTO _booking;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
  VALUES (_caller, 'corporate', 'trip_booking', _booking.id, 'corporate_ride_auto_approved',
          jsonb_build_object('corporate_id', _corporate_id, 'employee_id', _employee_id,
                             'fare_cents', _fare_cents, 'cost_center_code', _cost_center_code,
                             'purpose', _purpose, 'policy_reason', _eval.reason));

  RETURN jsonb_build_object(
    'decision', 'allow', 'reason', _eval.reason,
    'booking_id', _booking.id, 'booking_number', _booking.booking_number,
    'policy_id', _eval.policy_id, 'rule_id', _eval.rule_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_corporate_ride(uuid,uuid,text,text,text,bigint,timestamptz,integer,uuid,text,text,numeric,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_corporate_ride(uuid,uuid,text,text,text,bigint,timestamptz,integer,uuid,text,text,numeric,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_corporate_ride_request(
  _approval_id uuid,
  _decision text,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _ap public.corporate_ride_approvals;
  _emp public.corporate_employees;
  _authorised boolean;
  _booking public.trip_bookings;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'decision must be approved or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _ap FROM public.corporate_ride_approvals WHERE id = _approval_id FOR UPDATE;
  IF _ap.id IS NULL THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = 'NO_DATA';
  END IF;
  IF _ap.status <> 'pending' THEN
    RAISE EXCEPTION 'request has already been decided' USING ERRCODE = '22023';
  END IF;

  _authorised := public.has_corporate_role(_caller, _ap.corporate_id, 'corporate_admin'::corporate_employee_role)
              OR public.has_corporate_role(_caller, _ap.corporate_id, 'corporate_manager'::corporate_employee_role)
              OR public.has_role(_caller, 'admin'::app_role)
              OR public.has_role(_caller, 'super_admin'::app_role)
              OR EXISTS (
                   SELECT 1 FROM public.corporate_employee_approvers a
                    WHERE a.corporate_id = _ap.corporate_id
                      AND a.employee_id = _ap.employee_id
                      AND a.approver_user_id = _caller
                 );
  IF NOT _authorised THEN
    RAISE EXCEPTION 'not authorised to decide this request' USING ERRCODE = '42501';
  END IF;

  IF _ap.expires_at < now() THEN
    UPDATE public.corporate_ride_approvals
       SET status = 'expired', decided_at = now(), updated_at = now()
     WHERE id = _ap.id;
    RETURN jsonb_build_object('status','expired','reason','the request expired before a decision was made');
  END IF;

  IF _decision = 'rejected' THEN
    UPDATE public.corporate_ride_approvals
       SET status = 'rejected', decided_by = _caller, decided_at = now(),
           decision_note = _note, updated_at = now()
     WHERE id = _ap.id;
    INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
    VALUES (_caller, 'corporate', 'corporate_ride_approval', _ap.id, 'rejected',
            jsonb_build_object('note', _note));
    RETURN jsonb_build_object('status','rejected');
  END IF;

  SELECT * INTO _emp FROM public.corporate_employees WHERE id = _ap.employee_id;
  IF _emp.user_id IS NULL THEN
    RAISE EXCEPTION 'employee has no linked account and cannot travel yet' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.trip_bookings (
    rider_user_id, pickup_address, pickup_lat, pickup_lng,
    dropoff_address, dropoff_lat, dropoff_lng, passenger_count,
    intent, payment_method, total_fare, status, scheduled_for
  ) VALUES (
    _emp.user_id, COALESCE(_ap.pickup_address,'-'), 0, 0,
    COALESCE(_ap.dropoff_address,'-'), 0, 0, GREATEST(COALESCE(_ap.passenger_count,1),1),
    'corporate', 'corporate_wallet', _ap.estimated_fare_cents::numeric / 100,
    CASE WHEN _ap.scheduled_for IS NOT NULL THEN 'scheduled' ELSE 'pending' END,
    _ap.scheduled_for
  )
  RETURNING * INTO _booking;

  UPDATE public.corporate_ride_approvals
     SET status = 'approved', decided_by = _caller, decided_at = now(),
         decision_note = _note, booking_id = _booking.id, updated_at = now()
   WHERE id = _ap.id;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
  VALUES (_caller, 'corporate', 'corporate_ride_approval', _ap.id, 'approved',
          jsonb_build_object('booking_id', _booking.id, 'booking_number', _booking.booking_number, 'note', _note));

  RETURN jsonb_build_object('status','approved','booking_id',_booking.id,'booking_number',_booking.booking_number);
END;
$$;

REVOKE ALL ON FUNCTION public.decide_corporate_ride_request(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_corporate_ride_request(uuid,text,text) TO authenticated;