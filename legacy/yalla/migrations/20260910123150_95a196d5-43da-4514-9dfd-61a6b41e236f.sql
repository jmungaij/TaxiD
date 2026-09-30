ALTER TABLE public.corporate_policy_rules
  ADD COLUMN IF NOT EXISTS max_trips integer;

CREATE OR REPLACE FUNCTION public.evaluate_corporate_ride_policy(
  _employee_id uuid,
  _ride_type text,
  _fare_cents bigint,
  _distance_km numeric DEFAULT NULL,
  _scheduled_for timestamptz DEFAULT now()
)
RETURNS TABLE (
  decision public.corporate_decision,
  reason text,
  policy_id uuid,
  rule_id uuid,
  rule_kind text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_corp uuid;
  v_dept uuid;
  v_user uuid;
  v_emp_cap bigint;
  v_emp_trip_cap bigint;
  v_month_spend bigint;
  v_week_spend bigint;
  v_dept_budget bigint;
  v_dept_spend bigint;
  v_trip_count integer;
  v_dow int := EXTRACT(DOW FROM _scheduled_for)::int;
  v_t time := _scheduled_for::time;
  r record;
  v_best public.corporate_decision := 'allow';
  v_best_reason text := 'within policy';
  v_best_policy uuid;
  v_best_rule uuid;
  v_best_kind text;
BEGIN
  SELECT corporate_id, department_id, monthly_cap_cents, per_trip_cap_cents, user_id
    INTO v_corp, v_dept, v_emp_cap, v_emp_trip_cap, v_user
  FROM public.corporate_employees WHERE id = _employee_id;
  IF v_corp IS NULL THEN
    RETURN QUERY SELECT 'block'::public.corporate_decision, 'employee not found'::text,
                        NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Employee-level hard caps
  IF v_emp_trip_cap IS NOT NULL AND _fare_cents > v_emp_trip_cap THEN
    v_best := 'block';
    v_best_reason := format('Trip fare %s exceeds per-trip cap %s', _fare_cents, v_emp_trip_cap);
    v_best_kind := 'per_trip_cap';
  END IF;

  IF v_emp_cap IS NOT NULL THEN
    SELECT COALESCE(SUM(estimated_fare_cents),0) INTO v_month_spend
      FROM public.corporate_ride_approvals
      WHERE employee_id = _employee_id AND status='approved'
        AND created_at >= date_trunc('month', now());
    IF (v_month_spend + _fare_cents) > v_emp_cap THEN
      v_best := 'block';
      v_best_reason := format('Monthly spend %s would exceed cap %s', v_month_spend + _fare_cents, v_emp_cap);
      v_best_kind := 'employee_monthly_cap';
    END IF;
  END IF;

  -- Department monthly budget: route to approval rather than refusing
  IF v_dept IS NOT NULL THEN
    SELECT monthly_budget_cents INTO v_dept_budget
      FROM public.corporate_departments WHERE id = v_dept;
    IF v_dept_budget IS NOT NULL AND v_dept_budget > 0 THEN
      SELECT COALESCE(SUM(ROUND(b.total_fare * 100)), 0)::bigint INTO v_dept_spend
        FROM public.trip_bookings b
        JOIN public.corporate_employees e ON e.user_id = b.rider_user_id
       WHERE e.corporate_id = v_corp
         AND e.department_id = v_dept
         AND b.intent = 'corporate'
         AND b.status <> 'cancelled'
         AND b.created_at >= date_trunc('month', now());
      IF (COALESCE(v_dept_spend,0) + _fare_cents) > v_dept_budget THEN
        IF v_best <> 'block' THEN
          v_best := 'requires_approval';
          v_best_reason := format('Department monthly budget %s would be exceeded', v_dept_budget);
          v_best_kind := 'department_monthly_budget';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Iterate matching active rules across all relevant policies
  FOR r IN
    SELECT pr.*, p.id AS pid
    FROM public.corporate_policy_rules pr
    JOIN public.corporate_ride_policies p ON p.id = pr.policy_id
    WHERE p.corporate_id = v_corp
      AND p.active
      AND (p.effective_to IS NULL OR p.effective_to > now())
      AND p.effective_from <= now()
      AND (
        p.scope = 'corporate'
        OR (p.scope = 'department' AND p.department_id = v_dept)
        OR (p.scope = 'employee'   AND p.employee_id  = _employee_id)
      )
    ORDER BY p.priority ASC
  LOOP
    DECLARE
      v_hit boolean := false;
      v_reason text;
      v_dec public.corporate_decision;
    BEGIN
      IF r.rule_kind = 'ride_type_block' AND _ride_type = ANY(COALESCE(r.blocked_ride_types,'{}')) THEN
        v_hit := true; v_reason := format('Ride type "%s" is blocked', _ride_type);
      ELSIF r.rule_kind = 'ride_type_allow' AND r.allowed_ride_types IS NOT NULL
            AND NOT (_ride_type = ANY(r.allowed_ride_types)) THEN
        v_hit := true; v_reason := format('Ride type "%s" not in allowed list', _ride_type);
      ELSIF r.rule_kind = 'max_fare_per_trip' AND r.max_fare_cents IS NOT NULL AND _fare_cents > r.max_fare_cents THEN
        v_hit := true; v_reason := format('Fare %s exceeds max %s', _fare_cents, r.max_fare_cents);
      ELSIF r.rule_kind = 'max_distance_km' AND r.max_distance_km IS NOT NULL AND _distance_km IS NOT NULL AND _distance_km > r.max_distance_km THEN
        v_hit := true; v_reason := format('Distance %s km exceeds max %s km', _distance_km, r.max_distance_km);
      ELSIF r.rule_kind = 'time_window' AND r.time_start IS NOT NULL AND r.time_end IS NOT NULL
            AND NOT (v_t BETWEEN r.time_start AND r.time_end) THEN
        v_hit := true; v_reason := format('Ride at %s outside allowed window %s-%s', v_t, r.time_start, r.time_end);
      ELSIF r.rule_kind = 'day_of_week' AND r.days_of_week IS NOT NULL AND NOT (v_dow = ANY(r.days_of_week)) THEN
        v_hit := true; v_reason := 'Day not allowed by policy';
      ELSIF r.rule_kind = 'requires_approval_above' AND r.threshold_cents IS NOT NULL AND _fare_cents > r.threshold_cents THEN
        v_hit := true; v_reason := format('Fare %s above approval threshold %s', _fare_cents, r.threshold_cents);
      ELSIF r.rule_kind = 'max_trips_per_day' AND r.max_trips IS NOT NULL AND v_user IS NOT NULL THEN
        SELECT COUNT(*) INTO v_trip_count
          FROM public.trip_bookings b
         WHERE b.rider_user_id = v_user
           AND b.intent = 'corporate'
           AND b.status <> 'cancelled'
           AND b.created_at >= date_trunc('day', now());
        IF (COALESCE(v_trip_count,0) + 1) > r.max_trips THEN
          v_hit := true; v_reason := format('Daily ride limit of %s reached', r.max_trips);
        END IF;
      ELSIF r.rule_kind = 'max_trips_per_month' AND r.max_trips IS NOT NULL AND v_user IS NOT NULL THEN
        SELECT COUNT(*) INTO v_trip_count
          FROM public.trip_bookings b
         WHERE b.rider_user_id = v_user
           AND b.intent = 'corporate'
           AND b.status <> 'cancelled'
           AND b.created_at >= date_trunc('month', now());
        IF (COALESCE(v_trip_count,0) + 1) > r.max_trips THEN
          v_hit := true; v_reason := format('Monthly ride limit of %s reached', r.max_trips);
        END IF;
      ELSIF r.rule_kind = 'monthly_spend_cap' AND r.cap_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_fare_cents),0) INTO v_month_spend
          FROM public.corporate_ride_approvals
          WHERE employee_id = _employee_id AND status='approved'
            AND created_at >= date_trunc('month', now());
        IF (v_month_spend + _fare_cents) > r.cap_cents THEN
          v_hit := true; v_reason := format('Monthly spend would exceed policy cap %s', r.cap_cents);
        END IF;
      ELSIF r.rule_kind = 'weekly_spend_cap' AND r.cap_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_fare_cents),0) INTO v_week_spend
          FROM public.corporate_ride_approvals
          WHERE employee_id = _employee_id AND status='approved'
            AND created_at >= date_trunc('week', now());
        IF (v_week_spend + _fare_cents) > r.cap_cents THEN
          v_hit := true; v_reason := format('Weekly spend would exceed policy cap %s', r.cap_cents);
        END IF;
      END IF;

      IF v_hit THEN
        v_dec := CASE r.severity
                   WHEN 'block' THEN 'block'::public.corporate_decision
                   WHEN 'approval' THEN 'requires_approval'::public.corporate_decision
                   ELSE 'allow'::public.corporate_decision
                 END;
        IF v_dec = 'block'
           OR (v_dec = 'requires_approval' AND v_best <> 'block') THEN
          v_best := v_dec; v_best_reason := v_reason;
          v_best_policy := r.pid; v_best_rule := r.id; v_best_kind := r.rule_kind;
        END IF;
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_best, v_best_reason, v_best_policy, v_best_rule, v_best_kind;
END $$;

REVOKE ALL ON FUNCTION public.evaluate_corporate_ride_policy(uuid,text,bigint,numeric,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_corporate_ride_policy(uuid,text,bigint,numeric,timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.corporate_department_budget_report(_corporate_id uuid)
RETURNS TABLE (
  department_id uuid,
  department_name text,
  monthly_budget_cents bigint,
  spend_cents bigint,
  trip_count integer,
  employee_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_corporate_member(_caller, _corporate_id)
          OR public.has_role(_caller, 'admin'::app_role)
          OR public.has_role(_caller, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorised for this organisation' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT d.id,
         d.name,
         COALESCE(d.monthly_budget_cents, 0)::bigint,
         COALESCE(s.spend_cents, 0)::bigint,
         COALESCE(s.trips, 0)::integer,
         COALESCE(e.headcount, 0)::integer
    FROM public.corporate_departments d
    LEFT JOIN (
      SELECT e2.department_id,
             SUM(ROUND(b.total_fare * 100))::bigint AS spend_cents,
             COUNT(*)::integer AS trips
        FROM public.trip_bookings b
        JOIN public.corporate_employees e2 ON e2.user_id = b.rider_user_id
       WHERE e2.corporate_id = _corporate_id
         AND b.intent = 'corporate'
         AND b.status <> 'cancelled'
         AND b.created_at >= date_trunc('month', now())
       GROUP BY e2.department_id
    ) s ON s.department_id = d.id
    LEFT JOIN (
      SELECT department_id, COUNT(*)::integer AS headcount
        FROM public.corporate_employees
       WHERE corporate_id = _corporate_id AND status = 'active'
       GROUP BY department_id
    ) e ON e.department_id = d.id
   WHERE d.corporate_id = _corporate_id
   ORDER BY d.name;
END $$;

REVOKE ALL ON FUNCTION public.corporate_department_budget_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corporate_department_budget_report(uuid) TO authenticated, service_role;