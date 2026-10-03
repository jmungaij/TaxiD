-- ===== Programs =====
CREATE TABLE public.corporate_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  eligible_group_ids uuid[] NOT NULL DEFAULT '{}',
  allows_guests boolean NOT NULL DEFAULT true,
  default_cost_center text,
  require_purpose boolean NOT NULL DEFAULT true,
  administrator_employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  active_from date, active_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_programs TO authenticated;
GRANT ALL ON public.corporate_programs TO service_role;
ALTER TABLE public.corporate_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own company" ON public.corporate_programs FOR SELECT TO authenticated
  USING (private.is_corporate_member(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Managers maintain own company" ON public.corporate_programs FOR ALL TO authenticated
  USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE TRIGGER trg_touch BEFORE UPDATE ON public.corporate_programs FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

ALTER TABLE public.corporate_ride_policies ADD COLUMN program_id uuid REFERENCES public.corporate_programs(id) ON DELETE CASCADE;
ALTER TABLE public.corporate_guest_bookings
  ADD COLUMN program_id uuid REFERENCES public.corporate_programs(id) ON DELETE SET NULL,
  ADD COLUMN employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  ADD COLUMN cost_center_code text,
  ADD COLUMN purpose text;
ALTER TABLE public.corporate_guest_bookings DROP CONSTRAINT corporate_guest_bookings_booking_kind_check;
ALTER TABLE public.corporate_guest_bookings ADD CONSTRAINT corporate_guest_bookings_booking_kind_check
  CHECK (booking_kind IN ('employee','guest','client','hotel_guest','hotel_transfer','airport_transfer'));

-- Program-scoped policies apply only when a booking runs under that program (session setting set by the booking routine).
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('private.corporate_policy_evaluate_base(uuid,uuid,uuid,bigint,numeric,timestamptz,uuid)'::regprocedure);
  d := replace(d, 'AND (p.group_id IS NULL OR p.group_id = e.group_id)',
    'AND (p.group_id IS NULL OR p.group_id = e.group_id) AND (p.program_id IS NULL OR p.program_id = nullif(current_setting(''taxid.program_id'', true), '''')::uuid)');
  IF position('taxid.program_id' in d) = 0 THEN RAISE EXCEPTION 'base patch failed'; END IF;
  EXECUTE d;
  d := pg_get_functiondef('private.corporate_location_evaluate(uuid,uuid,numeric,numeric,numeric,numeric)'::regprocedure);
  d := replace(d, 'AND (p.group_id IS NULL OR p.group_id = e.group_id)',
    'AND (p.group_id IS NULL OR p.group_id = e.group_id) AND (p.program_id IS NULL OR p.program_id = nullif(current_setting(''taxid.program_id'', true), '''')::uuid)');
  IF position('taxid.program_id' in d) = 0 THEN RAISE EXCEPTION 'location patch failed'; END IF;
  EXECUTE d;
END $$;

-- ===== Program eligibility =====
CREATE OR REPLACE FUNCTION private.corporate_program_check(_corp uuid, _program uuid, _employee uuid, _at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE pg corporate_programs%ROWTYPE; g uuid; d date := (_at AT TIME ZONE 'Africa/Nairobi')::date;
BEGIN
  IF _program IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO pg FROM corporate_programs WHERE id=_program AND corporate_id=_corp;
  IF NOT FOUND THEN RETURN jsonb_build_array(jsonb_build_object('rule','program','severity','block','message','Unknown travel program')); END IF;
  IF NOT pg.active OR (pg.active_from IS NOT NULL AND d < pg.active_from) OR (pg.active_to IS NOT NULL AND d > pg.active_to) THEN
    RETURN jsonb_build_array(jsonb_build_object('rule','program','policy',pg.name,'severity','block','message','The '||pg.name||' program is not active on this date'));
  END IF;
  IF _employee IS NULL THEN
    IF NOT pg.allows_guests THEN RETURN jsonb_build_array(jsonb_build_object('rule','program','policy',pg.name,'severity','block','message','The '||pg.name||' program is for employees only')); END IF;
    RETURN '[]'::jsonb;
  END IF;
  SELECT group_id INTO g FROM corporate_employees WHERE id=_employee;
  IF coalesce(array_length(pg.eligible_group_ids,1),0) > 0 AND (g IS NULL OR NOT g = ANY(pg.eligible_group_ids)) THEN
    RETURN jsonb_build_array(jsonb_build_object('rule','program','policy',pg.name,'severity','block','message','This traveller''s group is not eligible for the '||pg.name||' program'));
  END IF;
  RETURN '[]'::jsonb;
END $$;

-- ===== One evaluation used by TravelDesk booking and the simulator =====
CREATE OR REPLACE FUNCTION private.corporate_evaluate_full(_corp uuid, _employee uuid, _program uuid, _ride_type uuid, _fare bigint, _dist numeric, _at timestamptz,
  _plat numeric, _plng numeric, _dlat numeric, _dlng numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ev jsonb; e corporate_employees%ROWTYPE; extra jsonb := '[]'::jsonb; mspent bigint;
BEGIN
  PERFORM set_config('taxid.program_id', coalesce(_program::text,''), true);
  ev := private.corporate_policy_merge(
          private.corporate_policy_evaluate_base(_corp, _employee, _ride_type, _fare, _dist, _at, NULL),
          private.corporate_location_evaluate(_corp, _employee, _plat, _plng, _dlat, _dlng) || private.corporate_program_check(_corp, _program, _employee, _at));
  PERFORM set_config('taxid.program_id', '', true);
  IF _employee IS NOT NULL THEN
    SELECT * INTO e FROM corporate_employees WHERE id=_employee;
    SELECT coalesce(sum(round(total_fare*100)),0)::bigint INTO mspent FROM trip_bookings WHERE corporate_employee_id=_employee AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected');
    mspent := mspent + coalesce((SELECT sum(estimated_fare_cents) FROM corporate_guest_bookings WHERE employee_id=_employee AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected')),0);
    IF e.per_trip_cap_cents IS NOT NULL AND _fare > e.per_trip_cap_cents THEN
      extra := extra || jsonb_build_object('rule','per_trip_limit','severity','approval','message','Above this traveller''s per-trip limit of KES '||(e.per_trip_cap_cents/100));
    END IF;
    IF e.monthly_cap_cents IS NOT NULL AND mspent + _fare > e.monthly_cap_cents THEN
      extra := extra || jsonb_build_object('rule','monthly_limit','severity','approval','message','Would exceed this traveller''s monthly limit of KES '||(e.monthly_cap_cents/100));
    END IF;
    IF coalesce(e.requires_approval,false) THEN
      extra := extra || jsonb_build_object('rule','always_approve','severity','approval','message','This traveller always needs approval');
    END IF;
    ev := private.corporate_policy_merge(ev, extra);
  END IF;
  RETURN ev;
END $$;

CREATE OR REPLACE FUNCTION private.corporate_estimate_fare(_ride_type uuid, _plat numeric, _plng numeric, _dlat numeric, _dlng numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE rt ride_types%ROWTYPE; dist numeric;
BEGIN
  SELECT * INTO rt FROM ride_types WHERE id=_ride_type AND is_active;
  IF NOT FOUND THEN RETURN NULL; END IF;
  dist := round(private.geo_km(_plat,_plng,_dlat,_dlng) * 1.3, 2);
  RETURN jsonb_build_object('distance_km', dist, 'fare_cents',
    round(greatest(coalesce(rt.minimum_fare,0), coalesce(rt.base_fare,0) + coalesce(rt.per_km_rate,0)*dist + coalesce(rt.per_minute_rate,0)*dist*2) * 100)::bigint);
END $$;

-- ===== Policy simulator (read-only) =====
CREATE OR REPLACE FUNCTION private.corporate_policy_simulate(_corp uuid, _employee uuid, _program uuid, _ride_type uuid, _at timestamptz,
  _plat numeric, _plng numeric, _dlat numeric, _dlng numeric, _fare_cents bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE est jsonb; fare bigint; dist numeric;
BEGIN
  IF NOT (private.is_corporate_manager_or_admin(auth.uid(), _corp) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  IF _employee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM corporate_employees WHERE id=_employee AND corporate_id=_corp) THEN
    RETURN jsonb_build_object('ok',false,'error','NOT_YOUR_EMPLOYEE'); END IF;
  est := private.corporate_estimate_fare(_ride_type,_plat,_plng,_dlat,_dlng);
  IF est IS NULL THEN RETURN jsonb_build_object('ok',false,'error','INVALID_INPUT'); END IF;
  dist := (est->>'distance_km')::numeric; fare := coalesce(_fare_cents, (est->>'fare_cents')::bigint);
  RETURN jsonb_build_object('ok',true,'fare_cents',fare,'distance_km',dist,
    'policy', private.corporate_evaluate_full(_corp,_employee,_program,_ride_type,fare,dist,coalesce(_at,now()),_plat,_plng,_dlat,_dlng));
END $$;

-- ===== TravelDesk traveller panel =====
CREATE OR REPLACE FUNCTION private.corporate_traveller_profile(_corp uuid, _employee uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e corporate_employees%ROWTYPE; spent bigint; pend int; trips int;
BEGIN
  IF NOT (private.is_corporate_manager_or_admin(auth.uid(), _corp) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM corporate_employees WHERE id=_employee AND corporate_id=_corp;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint, count(*) INTO spent, trips FROM trip_bookings
    WHERE corporate_employee_id=_employee AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected');
  spent := spent + coalesce((SELECT sum(estimated_fare_cents) FROM corporate_guest_bookings WHERE employee_id=_employee AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected')),0);
  SELECT count(*) INTO pend FROM corporate_ride_approvals WHERE employee_id=_employee AND status='pending';
  pend := pend + (SELECT count(*) FROM corporate_guest_bookings WHERE employee_id=_employee AND status='pending_approval');
  RETURN jsonb_build_object(
    'name', e.full_name, 'email', e.email, 'role', e.role, 'status', e.status, 'employee_code', e.employee_code,
    'department', (SELECT name FROM corporate_departments WHERE id=e.department_id),
    'manager', (SELECT full_name FROM corporate_employees WHERE user_id=e.manager_user_id AND corporate_id=_corp LIMIT 1),
    'group', (SELECT name FROM corporate_employee_groups WHERE id=e.group_id),
    'per_trip_cap_cents', e.per_trip_cap_cents, 'monthly_cap_cents', e.monthly_cap_cents, 'requires_approval', coalesce(e.requires_approval,false),
    'month_spend_cents', spent, 'month_trips', trips, 'pending_approvals', pend,
    'available_cents', CASE WHEN e.monthly_cap_cents IS NULL THEN NULL ELSE greatest(0, e.monthly_cap_cents - spent) END,
    'policies', coalesce((SELECT jsonb_agg(p.name ORDER BY p.priority) FROM corporate_ride_policies p WHERE p.corporate_id=_corp AND p.active
       AND (p.scope='corporate' OR (p.scope='department' AND p.department_id=e.department_id) OR (p.scope='employee' AND p.employee_id=e.id))
       AND (p.group_id IS NULL OR p.group_id=e.group_id)), '[]'::jsonb),
    'programs', coalesce((SELECT jsonb_agg(jsonb_build_object('id',pg.id,'name',pg.name)) FROM corporate_programs pg WHERE pg.corporate_id=_corp AND pg.active
       AND (coalesce(array_length(pg.eligible_group_ids,1),0)=0 OR e.group_id = ANY(pg.eligible_group_ids))), '[]'::jsonb));
END $$;

-- ===== Live TravelDesk board (company trips + desk bookings, managers only) =====
CREATE OR REPLACE FUNCTION private.corporate_traveldesk_board(_corp uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT (private.is_corporate_manager_or_admin(auth.uid(), _corp) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (
    SELECT jsonb_build_object('source','trip','id',b.id,'ref',b.booking_number,'traveller',coalesce(ce.full_name,'Employee'),
      'pickup',b.pickup_address,'dropoff',b.dropoff_address,'status',b.status,'eta',b.pickup_eta,
      'driver_assigned', b.driver_id IS NOT NULL,'vehicle',(SELECT plate_number FROM vehicles v WHERE v.id=b.vehicle_id),
      'cost_cents',round(b.total_fare*100),'at',coalesce(b.scheduled_for,b.created_at),'purpose',b.trip_purpose,'cost_center',b.cost_center_code) x
    FROM trip_bookings b LEFT JOIN corporate_employees ce ON ce.id=b.corporate_employee_id
    WHERE b.corporate_id=_corp AND b.created_at > now() - interval '30 days'
    UNION ALL
    SELECT jsonb_build_object('source','desk','id',g.id,'ref',g.reference,'traveller',g.passenger_name,'kind',g.booking_kind,
      'pickup',g.pickup_address,'dropoff',g.dropoff_address,'status',g.status,'eta',NULL,'driver_assigned',false,'vehicle',NULL,
      'cost_cents',g.estimated_fare_cents,'at',coalesce(g.scheduled_for,g.created_at),'purpose',g.purpose,'cost_center',g.cost_center_code,
      'project',g.project_code,'client',g.client_code,'po',g.po_code)
    FROM corporate_guest_bookings g WHERE g.corporate_id=_corp AND g.created_at > now() - interval '30 days'
    LIMIT 500) s), '[]'::jsonb);
END $$;

-- ===== TravelDesk booking: employees + guests, programs, cost centre, purpose =====
CREATE OR REPLACE FUNCTION private.corporate_guest_book(_corporate_id uuid, _kind text, _passenger_name text, _passenger_phone text,
  _pickup_address text, _plat numeric, _plng numeric, _dropoff_address text, _dlat numeric, _dlng numeric,
  _ride_type_id uuid, _scheduled_for timestamptz DEFAULT NULL, _details jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := auth.uid(); req corporate_booking_requirements%ROWTYPE; est jsonb; dist numeric; fare bigint; ev jsonb; gid uuid; ref text; n int;
  emp corporate_employees%ROWTYPE; v_emp uuid := nullif(_details->>'employee_id','')::uuid; v_prog uuid := nullif(_details->>'program_id','')::uuid;
  pname text := btrim(coalesce(_passenger_name,''));
  c_project text := nullif(left(btrim(coalesce(_details->>'project_code','')),60),'');
  c_client text := nullif(left(btrim(coalesce(_details->>'client_code','')),60),'');
  c_po text := nullif(left(btrim(coalesce(_details->>'po_code','')),60),'');
  c_acct text := nullif(left(btrim(coalesce(_details->>'accounting_code','')),60),'');
  c_cc text := nullif(left(btrim(coalesce(_details->>'cost_center_code','')),40),'');
  c_purpose text := nullif(left(btrim(coalesce(_details->>'purpose','')),200),'');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT private.is_corporate_manager_or_admin(me, _corporate_id) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED','message','Only company admins and managers can use the TravelDesk.'); END IF;
  IF coalesce((SELECT status::text FROM corporate_accounts WHERE id=_corporate_id),'') <> 'ACTIVE' THEN RETURN jsonb_build_object('ok',false,'error','COMPANY_NOT_ACTIVE'); END IF;
  IF _kind NOT IN ('employee','guest','client','hotel_guest','hotel_transfer','airport_transfer') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_KIND'); END IF;
  IF _kind = 'employee' THEN
    SELECT * INTO emp FROM corporate_employees WHERE id=v_emp AND corporate_id=_corporate_id AND status='active' AND removed_at IS NULL;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_AN_ACTIVE_EMPLOYEE'); END IF;
    pname := coalesce(emp.full_name, emp.email, 'Employee');
  ELSE v_emp := NULL; END IF;
  IF length(pname) < 2 THEN RETURN jsonb_build_object('ok',false,'error','PASSENGER_NAME_REQUIRED'); END IF;
  IF _plat IS NULL OR _plng IS NULL OR _dlat IS NULL OR _dlng IS NULL THEN RETURN jsonb_build_object('ok',false,'error','LOCATIONS_REQUIRED'); END IF;
  IF _kind = 'airport_transfer' AND length(btrim(coalesce(_details->>'flight_number',''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','FLIGHT_NUMBER_REQUIRED'); END IF;
  IF _scheduled_for IS NOT NULL AND _scheduled_for < now() - interval '5 minutes' THEN RETURN jsonb_build_object('ok',false,'error','TIME_IN_PAST'); END IF;
  IF v_prog IS NOT NULL THEN
    IF coalesce((SELECT require_purpose FROM corporate_programs WHERE id=v_prog AND corporate_id=_corporate_id), false) AND c_purpose IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','PURPOSE_REQUIRED'); END IF;
    c_cc := coalesce(c_cc, (SELECT default_cost_center FROM corporate_programs WHERE id=v_prog));
  END IF;

  SELECT * INTO req FROM corporate_booking_requirements WHERE corporate_id=_corporate_id;
  IF (coalesce(req.require_project,false) AND c_project IS NULL) OR (coalesce(req.require_client,false) AND c_client IS NULL)
     OR (coalesce(req.require_po,false) AND c_po IS NULL) OR (coalesce(req.require_accounting,false) AND c_acct IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'error','BOOKING_CODES_REQUIRED','message','Your company requires project, client, PO or accounting codes on every booking.');
  END IF;

  est := private.corporate_estimate_fare(_ride_type_id,_plat,_plng,_dlat,_dlng);
  IF est IS NULL THEN RETURN jsonb_build_object('ok',false,'error','INVALID_RIDE_TYPE'); END IF;
  dist := (est->>'distance_km')::numeric; fare := (est->>'fare_cents')::bigint;

  ev := private.corporate_evaluate_full(_corporate_id, v_emp, v_prog, _ride_type_id, fare, dist, coalesce(_scheduled_for, now()), _plat, _plng, _dlat, _dlng);
  IF ev->>'decision' = 'BLOCKED' THEN RETURN jsonb_build_object('ok',false,'error','POLICY_BLOCKED','policy',ev,'fare_cents',fare); END IF;
  IF private.corporate_capacity_cents(_corporate_id) < fare THEN RETURN jsonb_build_object('ok',false,'error','COMPANY_FUNDS_INSUFFICIENT','fare_cents',fare); END IF;

  INSERT INTO corporate_guest_bookings(corporate_id, booked_by, booking_kind, employee_id, program_id, passenger_name, passenger_phone, passenger_email, hotel_room, flight_number,
    passengers, luggage, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, ride_type_id, scheduled_for,
    distance_km, estimated_fare_cents, project_code, client_code, po_code, accounting_code, cost_center_code, purpose, notes, policy)
  VALUES (_corporate_id, me, _kind, v_emp, v_prog, left(pname,120), nullif(left(btrim(coalesce(_passenger_phone, emp.phone, '')),30),''),
    nullif(left(btrim(coalesce(_details->>'passenger_email', emp.email, '')),160),''), nullif(left(btrim(coalesce(_details->>'hotel_room','')),30),''),
    nullif(upper(left(btrim(coalesce(_details->>'flight_number','')),12)),''),
    greatest(1, least(60, coalesce((_details->>'passengers')::int,1))), greatest(0, least(60, coalesce((_details->>'luggage')::int,0))),
    left(_pickup_address,300), _plat, _plng, left(_dropoff_address,300), _dlat, _dlng, _ride_type_id, _scheduled_for,
    dist, fare, c_project, c_client, c_po, c_acct, c_cc, c_purpose, nullif(left(btrim(coalesce(_details->>'notes','')),500),''), ev)
  RETURNING id, reference INTO gid, ref;

  n := private.corporate_approval_start(_corporate_id, 'guest_booking', gid, fare, ev->>'decision' = 'EXCEPTION');
  IF n = 0 THEN UPDATE corporate_guest_bookings SET status='confirmed' WHERE id=gid; END IF;
  RETURN jsonb_build_object('ok',true,'id',gid,'reference',ref,'fare_cents',fare,'distance_km',dist,'policy',ev,
    'state', CASE WHEN n = 0 THEN 'confirmed' ELSE 'pending_approval' END, 'approval_steps', n);
END $$;

-- ===== Grants + public wrappers =====
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['private.corporate_program_check(uuid,uuid,uuid,timestamptz)',
    'private.corporate_evaluate_full(uuid,uuid,uuid,uuid,bigint,numeric,timestamptz,numeric,numeric,numeric,numeric)',
    'private.corporate_estimate_fare(uuid,numeric,numeric,numeric,numeric)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO service_role';
  END LOOP;
  FOREACH f IN ARRAY ARRAY['private.corporate_policy_simulate(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,numeric,bigint)',
    'private.corporate_traveller_profile(uuid,uuid)','private.corporate_traveldesk_board(uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated, service_role';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.corporate_policy_simulate(_corp uuid, _employee uuid, _program uuid, _ride_type uuid, _at timestamptz,
  _plat numeric, _plng numeric, _dlat numeric, _dlng numeric, _fare_cents bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_policy_simulate(_corp,_employee,_program,_ride_type,_at,_plat,_plng,_dlat,_dlng,_fare_cents) $$;
CREATE OR REPLACE FUNCTION public.corporate_traveller_profile(_corp uuid, _employee uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_traveller_profile(_corp,_employee) $$;
CREATE OR REPLACE FUNCTION public.corporate_traveldesk_board(_corp uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_traveldesk_board(_corp) $$;
REVOKE ALL ON FUNCTION public.corporate_policy_simulate(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,numeric,bigint), public.corporate_traveller_profile(uuid,uuid), public.corporate_traveldesk_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_policy_simulate(uuid,uuid,uuid,uuid,timestamptz,numeric,numeric,numeric,numeric,bigint), public.corporate_traveller_profile(uuid,uuid), public.corporate_traveldesk_board(uuid) TO authenticated;