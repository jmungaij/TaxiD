CREATE TABLE public.corporate_employee_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_employee_groups TO authenticated;
GRANT ALL ON public.corporate_employee_groups TO service_role;
ALTER TABLE public.corporate_employee_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own company groups" ON public.corporate_employee_groups FOR SELECT TO authenticated
  USING (private.is_corporate_member(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Managers maintain own company groups" ON public.corporate_employee_groups FOR ALL TO authenticated
  USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE public.corporate_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, holiday_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_holidays TO authenticated;
GRANT ALL ON public.corporate_holidays TO service_role;
ALTER TABLE public.corporate_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own company holidays" ON public.corporate_holidays FOR SELECT TO authenticated
  USING (private.is_corporate_member(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Managers maintain own company holidays" ON public.corporate_holidays FOR ALL TO authenticated
  USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE OR REPLACE FUNCTION private.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_ceg_touch BEFORE UPDATE ON public.corporate_employee_groups FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER trg_ch_touch BEFORE UPDATE ON public.corporate_holidays FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

ALTER TABLE public.corporate_employees ADD COLUMN group_id uuid REFERENCES public.corporate_employee_groups(id) ON DELETE SET NULL;
ALTER TABLE public.corporate_ride_policies ADD COLUMN group_id uuid REFERENCES public.corporate_employee_groups(id) ON DELETE CASCADE;

-- group must belong to the same company
CREATE OR REPLACE FUNCTION private.corporate_group_same_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM corporate_employee_groups g WHERE g.id=NEW.group_id AND g.corporate_id=NEW.corporate_id) THEN
    RAISE EXCEPTION 'GROUP_COMPANY_MISMATCH' USING HINT='The group belongs to a different company';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_emp_group_company BEFORE INSERT OR UPDATE OF group_id ON public.corporate_employees FOR EACH ROW EXECUTE FUNCTION private.corporate_group_same_company();
CREATE TRIGGER trg_pol_group_company BEFORE INSERT OR UPDATE OF group_id ON public.corporate_ride_policies FOR EACH ROW EXECUTE FUNCTION private.corporate_group_same_company();

ALTER TABLE public.corporate_policy_rules DROP CONSTRAINT corporate_policy_rules_rule_kind_check;
ALTER TABLE public.corporate_policy_rules ADD CONSTRAINT corporate_policy_rules_rule_kind_check CHECK (rule_kind = ANY (ARRAY[
 'ride_type_allow','ride_type_block','max_fare_per_trip','max_distance_km','time_window','day_of_week','monthly_spend_cap','weekly_spend_cap',
 'requires_approval_above','geo_allowlist','geo_blocklist','rides_per_day_cap','rides_per_week_cap','rides_per_month_cap','no_weekends','no_holidays']));

CREATE OR REPLACE FUNCTION private.corporate_policy_evaluate(_corporate_id uuid, _employee_id uuid, _ride_type_id uuid, _fare_cents bigint, _distance_km numeric, _at timestamp with time zone DEFAULT now(), _exclude_booking uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE e corporate_employees%ROWTYPE; rt ride_types%ROWTYPE; r record; reasons jsonb := '[]'::jsonb;
  lt timestamp := (_at AT TIME ZONE 'Africa/Nairobi'); tod time := lt::time; dow int := extract(dow FROM lt)::int;
  week_spent bigint; month_spent bigint; day_n int; week_n int; month_n int; hol text;
  hit boolean; msg text; sev text; worst int := 0; rank int; names text[];
BEGIN
  SELECT * INTO e FROM corporate_employees WHERE id=_employee_id AND corporate_id=_corporate_id;
  SELECT * INTO rt FROM ride_types WHERE id=_ride_type_id;
  names := ARRAY[lower(coalesce(rt.code,'')), lower(coalesce(rt.name,'')), lower(regexp_replace(coalesce(rt.name,''),'^(SAFARID|TaxiD)\s+','','i'))];
  SELECT coalesce(sum(round(total_fare*100)) FILTER (WHERE created_at >= date_trunc('week', now())),0)::bigint,
         coalesce(sum(round(total_fare*100)),0)::bigint,
         count(*) FILTER (WHERE (created_at AT TIME ZONE 'Africa/Nairobi')::date = lt::date),
         count(*) FILTER (WHERE created_at >= date_trunc('week', now())),
         count(*)
    INTO week_spent, month_spent, day_n, week_n, month_n
    FROM trip_bookings WHERE corporate_employee_id=_employee_id
     AND created_at >= least(date_trunc('month', now()), date_trunc('week', now()))
     AND status NOT IN ('cancelled','rejected') AND id IS DISTINCT FROM _exclude_booking;
  -- month figures must only count this month
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint, count(*) INTO month_spent, month_n FROM trip_bookings WHERE corporate_employee_id=_employee_id
    AND created_at >= date_trunc('month', now()) AND status NOT IN ('cancelled','rejected') AND id IS DISTINCT FROM _exclude_booking;
  SELECT name INTO hol FROM corporate_holidays WHERE corporate_id=_corporate_id AND holiday_date = lt::date;

  FOR r IN SELECT pr.*, p.name AS policy_name FROM corporate_policy_rules pr JOIN corporate_ride_policies p ON p.id=pr.policy_id
    WHERE p.corporate_id=_corporate_id AND p.active AND (p.effective_from IS NULL OR p.effective_from <= _at) AND (p.effective_to IS NULL OR p.effective_to > _at)
      AND (p.scope='corporate' OR (p.scope='department' AND p.department_id IS NOT DISTINCT FROM e.department_id AND e.department_id IS NOT NULL) OR (p.scope='employee' AND p.employee_id=_employee_id))
      AND (p.group_id IS NULL OR p.group_id = e.group_id)
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
      WHEN 'rides_per_day_cap' THEN hit := r.max_trips IS NOT NULL AND day_n + 1 > r.max_trips;
        msg := 'You have reached your company limit of '||r.max_trips||' business rides per day';
      WHEN 'rides_per_week_cap' THEN hit := r.max_trips IS NOT NULL AND week_n + 1 > r.max_trips;
        msg := 'You have reached your company limit of '||r.max_trips||' business rides per week';
      WHEN 'rides_per_month_cap' THEN hit := r.max_trips IS NOT NULL AND month_n + 1 > r.max_trips;
        msg := 'You have reached your company limit of '||r.max_trips||' business rides per month';
      WHEN 'no_weekends' THEN hit := dow IN (0,6);
        msg := 'Business trips on weekends are restricted by company policy';
      WHEN 'no_holidays' THEN hit := hol IS NOT NULL;
        msg := 'Business trips on company holidays ('||coalesce(hol,'')||') are restricted by company policy';
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
END $function$;