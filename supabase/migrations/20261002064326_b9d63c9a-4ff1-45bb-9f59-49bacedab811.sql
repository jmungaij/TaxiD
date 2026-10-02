ALTER TABLE public.trip_bookings
  ADD COLUMN IF NOT EXISTS booking_context text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corporate_employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_purpose text,
  ADD COLUMN IF NOT EXISTS cost_center_code text,
  ADD COLUMN IF NOT EXISTS corporate_approval_id uuid;
CREATE INDEX IF NOT EXISTS trip_bookings_corp_idx ON public.trip_bookings(corporate_id, created_at) WHERE corporate_id IS NOT NULL;

-- Profiles available to the signed-in rider.
CREATE OR REPLACE FUNCTION private.rider_booking_profiles() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'personal', jsonb_build_object('methods', jsonb_build_array('mpesa','cash','wallet')),
    'business', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'corporate_id', a.id, 'employee_id', e.id,
        'name', coalesce(a.trading_name, a.legal_name), 'role', e.role,
        'per_trip_cap_cents', e.per_trip_cap_cents, 'monthly_cap_cents', e.monthly_cap_cents,
        'requires_approval', coalesce(e.requires_approval,false),
        'month_spent_cents', (SELECT coalesce(sum(round(b.total_fare*100)),0)::bigint FROM trip_bookings b
           WHERE b.corporate_employee_id=e.id AND b.created_at >= date_trunc('month', now())
             AND b.status NOT IN ('cancelled','rejected')),
        'wallet_cents', coalesce((SELECT balance_after_cents FROM corporate_cash_ledger l WHERE l.corporate_id=a.id
           ORDER BY occurred_at DESC, created_at DESC LIMIT 1),0),
        'company_status', a.status) ORDER BY coalesce(a.trading_name, a.legal_name))
      FROM corporate_employees e JOIN corporate_accounts a ON a.id=e.corporate_id
      WHERE e.user_id=u AND e.status='active' AND e.removed_at IS NULL), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION private.trip_confirm_booking_ctx(
  _quote_id uuid, _context text DEFAULT 'personal', _payment_method text DEFAULT 'mpesa',
  _corporate_id uuid DEFAULT NULL, _purpose text DEFAULT NULL, _cost_center text DEFAULT NULL,
  _scheduled_for timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE u uuid := auth.uid(); v_id uuid; b trip_bookings%ROWTYPE; e corporate_employees%ROWTYPE;
  v_fare bigint; v_month bigint; v_wallet bigint; v_reason text; v_appr uuid;
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
  IF (SELECT status FROM corporate_accounts WHERE id=_corporate_id) NOT IN ('active','approved','verified') THEN
    RETURN jsonb_build_object('ok',false,'error','COMPANY_NOT_ACTIVE'); END IF;
  IF length(btrim(coalesce(_purpose,''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','PURPOSE_REQUIRED'); END IF;

  -- Fare comes only from the existing authoritative pricing in trip_confirm_booking.
  v_id := private.trip_confirm_booking(_quote_id, 'wallet', _scheduled_for);
  SELECT * INTO b FROM trip_bookings WHERE id=v_id;
  v_fare := round(b.total_fare*100)::bigint;
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint INTO v_month FROM trip_bookings
   WHERE corporate_employee_id=e.id AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected') AND id<>v_id;
  v_wallet := coalesce((SELECT balance_after_cents FROM corporate_cash_ledger WHERE corporate_id=_corporate_id ORDER BY occurred_at DESC, created_at DESC LIMIT 1),0);

  IF v_wallet < v_fare THEN
    DELETE FROM trip_status_history WHERE trip_booking_id=v_id;
    UPDATE trip_requests SET status='quoting' WHERE id=b.trip_request_id;
    DELETE FROM trip_bookings WHERE id=v_id;
    RETURN jsonb_build_object('ok',false,'error','COMPANY_WALLET_INSUFFICIENT','fare_cents',v_fare);
  END IF;

  v_reason := CASE
    WHEN e.per_trip_cap_cents IS NOT NULL AND v_fare > e.per_trip_cap_cents THEN 'OVER_PER_TRIP_LIMIT'
    WHEN e.monthly_cap_cents IS NOT NULL AND v_month + v_fare > e.monthly_cap_cents THEN 'OVER_MONTHLY_LIMIT'
    WHEN coalesce(e.requires_approval,false) THEN 'APPROVAL_REQUIRED_BY_POLICY' END;

  UPDATE trip_bookings SET booking_context='business', corporate_id=_corporate_id, corporate_employee_id=e.id,
    payment_method='corporate', intent='corporate', trip_purpose=left(btrim(_purpose),200), cost_center_code=nullif(left(btrim(coalesce(_cost_center,'')),40),'')
   WHERE id=v_id;

  IF v_reason IS NOT NULL THEN
    INSERT INTO corporate_ride_approvals(corporate_id, employee_id, department_id, requested_by, trip_request_id, pickup_address, dropoff_address,
      estimated_fare_cents, scheduled_for, justification, status, booking_id, passenger_count, cost_center_code, purpose, expires_at, metadata)
    VALUES (_corporate_id, e.id, e.department_id, u, b.trip_request_id, b.pickup_address, b.dropoff_address,
      v_fare, _scheduled_for, _purpose, 'pending', v_id, b.passenger_count, _cost_center, _purpose, now()+interval '2 hours',
      jsonb_build_object('reason', v_reason)) RETURNING id INTO v_appr;
    UPDATE trip_bookings SET status='awaiting_approval', corporate_approval_id=v_appr WHERE id=v_id;
    INSERT INTO trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
      VALUES (v_id, b.status, 'awaiting_approval', u, v_reason);
    RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','awaiting_approval','reason',v_reason,'context','business');
  END IF;
  RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','confirmed','context','business');
END $$;

CREATE OR REPLACE FUNCTION private.corporate_trip_decide(_approval_id uuid, _approve boolean, _note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a corporate_ride_approvals%ROWTYPE;
BEGIN
  SELECT * INTO a FROM corporate_ride_approvals WHERE id=_approval_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF NOT private.is_corporate_manager_or_admin(auth.uid(), a.corporate_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  IF a.requested_by = auth.uid() THEN RETURN jsonb_build_object('ok',false,'error','CANNOT_APPROVE_OWN_TRIP'); END IF;
  IF a.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_DECIDED','status',a.status); END IF;
  UPDATE corporate_ride_approvals SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END::corporate_approval_status,
    decided_by=auth.uid(), decided_at=now(), decision_note=left(_note,500) WHERE id=a.id;
  UPDATE trip_bookings SET status = CASE WHEN _approve THEN CASE WHEN scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END ELSE 'rejected' END
   WHERE id=a.booking_id AND status='awaiting_approval';
  INSERT INTO trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
    VALUES (a.booking_id, 'awaiting_approval', CASE WHEN _approve THEN 'pending' ELSE 'rejected' END, auth.uid(), coalesce(_note, CASE WHEN _approve THEN 'Approved by company' ELSE 'Rejected by company' END));
  RETURN jsonb_build_object('ok',true,'booking_id',a.booking_id,'approved',_approve);
END $$;

REVOKE ALL ON FUNCTION private.rider_booking_profiles(), private.trip_confirm_booking_ctx(uuid,text,text,uuid,text,text,timestamptz), private.corporate_trip_decide(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rider_booking_profiles(), private.trip_confirm_booking_ctx(uuid,text,text,uuid,text,text,timestamptz), private.corporate_trip_decide(uuid,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rider_booking_profiles() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
  AS $$ SELECT private.rider_booking_profiles() $$;
CREATE OR REPLACE FUNCTION public.trip_confirm_booking_ctx(_quote_id uuid, _context text DEFAULT 'personal', _payment_method text DEFAULT 'mpesa',
  _corporate_id uuid DEFAULT NULL, _purpose text DEFAULT NULL, _cost_center text DEFAULT NULL, _scheduled_for timestamptz DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
  AS $$ SELECT private.trip_confirm_booking_ctx(_quote_id,_context,_payment_method,_corporate_id,_purpose,_cost_center,_scheduled_for) $$;
CREATE OR REPLACE FUNCTION public.corporate_trip_decide(_approval_id uuid, _approve boolean, _note text DEFAULT NULL) RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_trip_decide(_approval_id,_approve,_note) $$;
REVOKE ALL ON FUNCTION public.rider_booking_profiles(), public.trip_confirm_booking_ctx(uuid,text,text,uuid,text,text,timestamptz), public.corporate_trip_decide(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rider_booking_profiles(), public.trip_confirm_booking_ctx(uuid,text,text,uuid,text,text,timestamptz), public.corporate_trip_decide(uuid,boolean,text) TO authenticated;