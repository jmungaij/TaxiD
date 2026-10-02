CREATE OR REPLACE FUNCTION private.corporate_policy_evaluate(_corporate_id uuid, _employee_id uuid, _ride_type_id uuid, _fare_cents bigint, _distance_km numeric, _at timestamptz DEFAULT now(), _exclude_booking uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e corporate_employees%ROWTYPE; rt ride_types%ROWTYPE; r record; reasons jsonb := '[]'::jsonb;
  lt timestamp := (_at AT TIME ZONE 'Africa/Nairobi'); tod time := lt::time; dow int := extract(dow FROM lt)::int;
  week_spent bigint; month_spent bigint; hit boolean; msg text; sev text; worst int := 0; rank int; names text[];
BEGIN
  SELECT * INTO e FROM corporate_employees WHERE id=_employee_id AND corporate_id=_corporate_id;
  SELECT * INTO rt FROM ride_types WHERE id=_ride_type_id;
  names := ARRAY[lower(coalesce(rt.code,'')), lower(coalesce(rt.name,'')), lower(regexp_replace(coalesce(rt.name,''),'^(SAFARID|TaxiD)\s+','','i'))];
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint INTO week_spent FROM trip_bookings WHERE corporate_employee_id=_employee_id
    AND created_at >= date_trunc('week', now()) AND status NOT IN ('cancelled','rejected') AND id IS DISTINCT FROM _exclude_booking;
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint INTO month_spent FROM trip_bookings WHERE corporate_employee_id=_employee_id
    AND created_at >= date_trunc('month', now()) AND status NOT IN ('cancelled','rejected') AND id IS DISTINCT FROM _exclude_booking;

  FOR r IN SELECT pr.*, p.name AS policy_name FROM corporate_policy_rules pr JOIN corporate_ride_policies p ON p.id=pr.policy_id
    WHERE p.corporate_id=_corporate_id AND p.active AND (p.effective_from IS NULL OR p.effective_from <= _at) AND (p.effective_to IS NULL OR p.effective_to > _at)
      AND (p.scope='corporate' OR (p.scope='department' AND p.department_id IS NOT DISTINCT FROM e.department_id AND e.department_id IS NOT NULL) OR (p.scope='employee' AND p.employee_id=_employee_id))
    ORDER BY p.priority NULLS LAST
  LOOP
    hit := false; msg := NULL;
    CASE r.rule_kind
      WHEN 'ride_type_block' THEN hit := EXISTS (SELECT 1 FROM unnest(coalesce(r.blocked_ride_types,'{}')) x WHERE lower(btrim(x)) = ANY(names));
        msg := coalesce(rt.name,'This car type')||' is not allowed by company policy';
      WHEN 'ride_type_allow' THEN hit := coalesce(array_length(r.allowed_ride_types,1),0)>0 AND NOT EXISTS (SELECT 1 FROM unnest(r.allowed_ride_types) x WHERE lower(btrim(x)) = ANY(names));
        msg := 'Your company allows only: '||array_to_string(r.allowed_ride_types, ', ');
      WHEN 'max_fare_per_trip' THEN hit := r.max_fare_cents IS NOT NULL AND _fare_cents > r.max_fare_cents;
        msg := 'Fare is above the company limit of KES '||(r.max_fare_cents/100)::text||' per trip';
      WHEN 'max_distance_km' THEN hit := r.max_distance_km IS NOT NULL AND coalesce(_distance_km,0) > r.max_distance_km;
        msg := 'Trip is longer than the company limit of '||r.max_distance_km::text||' km';
      WHEN 'time_window' THEN hit := r.time_start IS NOT NULL AND r.time_end IS NOT NULL AND NOT (
          CASE WHEN r.time_start <= r.time_end THEN tod BETWEEN r.time_start AND r.time_end ELSE tod >= r.time_start OR tod <= r.time_end END);
        msg := 'Business trips are allowed between '||to_char(r.time_start,'HH24:MI')||' and '||to_char(r.time_end,'HH24:MI');
      WHEN 'day_of_week' THEN hit := coalesce(array_length(r.days_of_week,1),0)>0 AND NOT (dow = ANY(r.days_of_week));
        msg := 'Business trips are not allowed on this day';
      WHEN 'requires_approval_above' THEN hit := r.threshold_cents IS NOT NULL AND _fare_cents > r.threshold_cents;
        msg := 'Trips above KES '||(r.threshold_cents/100)::text||' need company approval';
      WHEN 'weekly_spend_cap' THEN hit := r.cap_cents IS NOT NULL AND week_spent + _fare_cents > r.cap_cents;
        msg := 'This trip would go over your weekly company allowance of KES '||(r.cap_cents/100)::text;
      WHEN 'monthly_spend_cap' THEN hit := r.cap_cents IS NOT NULL AND month_spent + _fare_cents > r.cap_cents;
        msg := 'This trip would go over your monthly company allowance of KES '||(r.cap_cents/100)::text;
      ELSE hit := false;
    END CASE;
    IF hit THEN
      sev := CASE WHEN r.rule_kind='requires_approval_above' THEN 'approval' ELSE coalesce(r.severity,'block') END;
      rank := CASE sev WHEN 'block' THEN 3 WHEN 'approval' THEN 2 ELSE 1 END;
      worst := greatest(worst, rank);
      reasons := reasons || jsonb_build_object('rule_id', r.id, 'policy_id', r.policy_id, 'policy', r.policy_name, 'rule', r.rule_kind,
        'severity', sev, 'message', msg);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('decision', CASE worst WHEN 3 THEN 'BLOCKED' WHEN 2 THEN 'EXCEPTION' WHEN 1 THEN 'WARNING' ELSE 'COMPLIANT' END, 'reasons', reasons);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_policy_log(_corporate_id uuid, _employee_id uuid, _user uuid, _ride_type_id uuid, _fare bigint, _dist numeric, _ev jsonb, _booking uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE x jsonb;
BEGIN
  FOR x IN SELECT * FROM jsonb_array_elements(_ev->'reasons') LOOP
    INSERT INTO corporate_policy_violations(corporate_id, employee_id, user_id, policy_id, rule_id, decision, reason, ride_type, fare_cents, distance_km, context)
    VALUES (_corporate_id, _employee_id, _user, (x->>'policy_id')::uuid, (x->>'rule_id')::uuid,
      (CASE x->>'severity' WHEN 'block' THEN 'block' WHEN 'approval' THEN 'requires_approval' ELSE 'allow' END)::corporate_decision,
      x->>'message', (SELECT name FROM ride_types WHERE id=_ride_type_id), _fare, _dist,
      jsonb_build_object('booking_id', _booking, 'overall', _ev->>'decision', 'severity', x->>'severity'));
  END LOOP;
END $$;

-- Rider pre-check before confirming.
CREATE OR REPLACE FUNCTION private.corporate_policy_precheck(_corporate_id uuid, _ride_type_id uuid, _fare_cents bigint, _distance_km numeric, _scheduled_for timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT id INTO e FROM corporate_employees WHERE corporate_id=_corporate_id AND user_id=auth.uid() AND status='active' AND removed_at IS NULL;
  IF e IS NULL THEN RETURN jsonb_build_object('decision','BLOCKED','reasons',jsonb_build_array(jsonb_build_object('severity','block','message','You are not an active member of this company'))); END IF;
  RETURN private.corporate_policy_evaluate(_corporate_id, e, _ride_type_id, _fare_cents, _distance_km, coalesce(_scheduled_for, now()));
END $$;

CREATE OR REPLACE FUNCTION private.trip_confirm_booking_ctx(
  _quote_id uuid, _context text DEFAULT 'personal', _payment_method text DEFAULT 'mpesa',
  _corporate_id uuid DEFAULT NULL, _purpose text DEFAULT NULL, _cost_center text DEFAULT NULL,
  _scheduled_for timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u uuid := auth.uid(); v_id uuid; b trip_bookings%ROWTYPE; e corporate_employees%ROWTYPE;
  v_fare bigint; v_month bigint; v_wallet bigint; v_reason text; v_appr uuid; v_dist numeric; v_ev jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF _context = 'personal' THEN
    IF _payment_method NOT IN ('mpesa','cash','wallet') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_PAYMENT_METHOD'); END IF;
    v_id := private.trip_confirm_booking(_quote_id, _payment_method, _scheduled_for);
    RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','confirmed','context','personal');
  ELSIF _context <> 'business' THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_CONTEXT');
  END IF;

  SELECT * INTO e FROM corporate_employees WHERE corporate_id=_corporate_id AND user_id=u AND status='active' AND removed_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_AN_ACTIVE_EMPLOYEE'); END IF;
  IF coalesce((SELECT status::text FROM corporate_accounts WHERE id=_corporate_id),'') <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok',false,'error','COMPANY_NOT_ACTIVE'); END IF;
  IF length(btrim(coalesce(_purpose,''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','PURPOSE_REQUIRED'); END IF;

  v_id := private.trip_confirm_booking(_quote_id, 'wallet', _scheduled_for);
  SELECT * INTO b FROM trip_bookings WHERE id=v_id;
  v_fare := round(b.total_fare*100)::bigint;
  SELECT distance_km INTO v_dist FROM trip_quotes WHERE id=_quote_id;
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint INTO v_month FROM trip_bookings
   WHERE corporate_employee_id=e.id AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected') AND id<>v_id;

  v_ev := private.corporate_policy_evaluate(_corporate_id, e.id, b.ride_type_id, v_fare, v_dist, coalesce(_scheduled_for, now()), v_id);
  IF v_ev->>'decision' <> 'COMPLIANT' THEN
    PERFORM private.corporate_policy_log(_corporate_id, e.id, u, b.ride_type_id, v_fare, v_dist, v_ev, CASE WHEN v_ev->>'decision'='BLOCKED' THEN NULL ELSE v_id END);
  END IF;

  v_wallet := private.corporate_capacity_cents(_corporate_id);
  IF v_ev->>'decision'='BLOCKED' OR v_wallet < v_fare THEN
    DELETE FROM trip_status_history WHERE trip_booking_id=v_id;
    UPDATE trip_requests SET status='quoting' WHERE id=b.trip_request_id;
    DELETE FROM trip_bookings WHERE id=v_id;
    IF v_ev->>'decision'='BLOCKED' THEN
      RETURN jsonb_build_object('ok',false,'error','POLICY_BLOCKED','policy',v_ev,'fare_cents',v_fare);
    END IF;
    RETURN jsonb_build_object('ok',false,'error','COMPANY_FUNDS_INSUFFICIENT','fare_cents',v_fare);
  END IF;

  v_reason := CASE
    WHEN e.per_trip_cap_cents IS NOT NULL AND v_fare > e.per_trip_cap_cents THEN 'OVER_PER_TRIP_LIMIT'
    WHEN e.monthly_cap_cents IS NOT NULL AND v_month + v_fare > e.monthly_cap_cents THEN 'OVER_MONTHLY_LIMIT'
    WHEN coalesce(e.requires_approval,false) THEN 'APPROVAL_REQUIRED_BY_POLICY'
    WHEN v_ev->>'decision'='EXCEPTION' THEN 'POLICY_EXCEPTION' END;

  UPDATE trip_bookings SET booking_context='business', corporate_id=_corporate_id, corporate_employee_id=e.id,
    payment_method='corporate', intent='corporate', trip_purpose=left(btrim(_purpose),200), cost_center_code=nullif(left(btrim(coalesce(_cost_center,'')),40),'')
   WHERE id=v_id;

  IF v_reason IS NOT NULL THEN
    INSERT INTO corporate_ride_approvals(corporate_id, employee_id, department_id, requested_by, trip_request_id, pickup_address, dropoff_address,
      estimated_fare_cents, scheduled_for, justification, status, booking_id, passenger_count, cost_center_code, purpose, expires_at, metadata)
    VALUES (_corporate_id, e.id, e.department_id, u, b.trip_request_id, b.pickup_address, b.dropoff_address,
      v_fare, _scheduled_for, _purpose, 'pending', v_id, b.passenger_count, _cost_center, _purpose, now()+interval '2 hours',
      jsonb_build_object('reason', v_reason, 'policy', v_ev)) RETURNING id INTO v_appr;
    UPDATE trip_bookings SET status='awaiting_approval', corporate_approval_id=v_appr WHERE id=v_id;
    INSERT INTO trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
      VALUES (v_id, b.status, 'awaiting_approval', u, v_reason);
    RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','awaiting_approval','reason',v_reason,'context','business','policy',v_ev);
  END IF;
  RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','confirmed','context','business','policy',v_ev);
END $$;

REVOKE ALL ON FUNCTION private.corporate_policy_evaluate(uuid,uuid,uuid,bigint,numeric,timestamptz,uuid), private.corporate_policy_log(uuid,uuid,uuid,uuid,bigint,numeric,jsonb,uuid), private.corporate_policy_precheck(uuid,uuid,bigint,numeric,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.corporate_policy_precheck(uuid,uuid,bigint,numeric,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.corporate_policy_precheck(_corporate_id uuid, _ride_type_id uuid, _fare_cents bigint, _distance_km numeric, _scheduled_for timestamptz DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_policy_precheck(_corporate_id,_ride_type_id,_fare_cents,_distance_km,_scheduled_for) $$;
REVOKE ALL ON FUNCTION public.corporate_policy_precheck(uuid,uuid,bigint,numeric,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_policy_precheck(uuid,uuid,bigint,numeric,timestamptz) TO authenticated;