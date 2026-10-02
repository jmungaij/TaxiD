-- ===== Helpers =====
CREATE OR REPLACE FUNCTION private.geo_km(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT (6371 * 2 * asin(sqrt(power(sin(radians((b_lat-a_lat)::float8)/2),2)
    + cos(radians(a_lat::float8))*cos(radians(b_lat::float8))*power(sin(radians((b_lng-a_lng)::float8)/2),2))))::numeric
$$;

-- ===== Tables =====
CREATE TABLE public.corporate_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pickup','destination','airport')),
  address text,
  lat numeric NOT NULL, lng numeric NOT NULL,
  radius_m integer NOT NULL DEFAULT 300 CHECK (radius_m BETWEEN 50 AND 20000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.corporate_booking_requirements (
  corporate_id uuid PRIMARY KEY REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  require_project boolean NOT NULL DEFAULT false,
  require_client boolean NOT NULL DEFAULT false,
  require_po boolean NOT NULL DEFAULT false,
  require_accounting boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.corporate_approval_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  min_fare_cents bigint NOT NULL DEFAULT 0 CHECK (min_fare_cents >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.corporate_approval_chain_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id uuid NOT NULL REFERENCES public.corporate_approval_chains(id) ON DELETE CASCADE,
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  step_no integer NOT NULL CHECK (step_no BETWEEN 1 AND 10),
  approver_employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  stand_in_employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  deadline_minutes integer NOT NULL DEFAULT 60 CHECK (deadline_minutes BETWEEN 5 AND 10080),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, step_no)
);
CREATE TABLE public.corporate_guest_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('GB-'||upper(substr(md5(gen_random_uuid()::text),1,8))),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  booked_by uuid NOT NULL,
  booking_kind text NOT NULL CHECK (booking_kind IN ('guest','client','hotel_guest','hotel_transfer','airport_transfer')),
  passenger_name text NOT NULL, passenger_phone text, passenger_email text,
  hotel_room text, flight_number text,
  passengers integer NOT NULL DEFAULT 1, luggage integer NOT NULL DEFAULT 0,
  pickup_address text NOT NULL, pickup_lat numeric NOT NULL, pickup_lng numeric NOT NULL,
  dropoff_address text NOT NULL, dropoff_lat numeric NOT NULL, dropoff_lng numeric NOT NULL,
  ride_type_id uuid NOT NULL REFERENCES public.ride_types(id),
  scheduled_for timestamptz,
  distance_km numeric NOT NULL, estimated_fare_cents bigint NOT NULL,
  project_code text, client_code text, po_code text, accounting_code text, notes text,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','confirmed','rejected','cancelled','completed')),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.corporate_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('guest_booking','trip')),
  subject_id uuid NOT NULL,
  step_no integer NOT NULL,
  approver_employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  stand_in_employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  deadline_minutes integer NOT NULL,
  due_at timestamptz,
  status text NOT NULL CHECK (status IN ('waiting','pending','approved','rejected','skipped')),
  escalated boolean NOT NULL DEFAULT false, escalated_at timestamptz,
  decided_by uuid, decided_at timestamptz, note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, step_no)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_locations, public.corporate_booking_requirements, public.corporate_approval_chains, public.corporate_approval_chain_steps TO authenticated;
GRANT SELECT ON public.corporate_guest_bookings, public.corporate_approval_steps TO authenticated;
GRANT ALL ON public.corporate_locations, public.corporate_booking_requirements, public.corporate_approval_chains, public.corporate_approval_chain_steps, public.corporate_guest_bookings, public.corporate_approval_steps TO service_role;

ALTER TABLE public.corporate_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_booking_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_approval_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_approval_chain_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_guest_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_approval_steps ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['corporate_locations','corporate_booking_requirements','corporate_approval_chains','corporate_approval_chain_steps'] LOOP
    EXECUTE format('CREATE POLICY "Members read own company" ON public.%I FOR SELECT TO authenticated USING (private.is_corporate_member(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::app_role[]))', t);
    EXECUTE format('CREATE POLICY "Managers maintain own company" ON public.%I FOR ALL TO authenticated USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::app_role[])) WITH CHECK (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::app_role[]))', t);
    EXECUTE format('CREATE TRIGGER trg_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['corporate_guest_bookings','corporate_approval_steps'] LOOP
    EXECUTE format('CREATE POLICY "Managers read own company" ON public.%I FOR SELECT TO authenticated USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR private.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'',''finance_admin'']::app_role[]))', t);
    EXECUTE format('CREATE TRIGGER trg_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()', t);
  END LOOP;
END $$;
-- approvers who are not managers can see their own steps
CREATE POLICY "Approvers read assigned steps" ON public.corporate_approval_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corporate_employees ce WHERE ce.user_id = auth.uid() AND ce.id IN (approver_employee_id, stand_in_employee_id)));

-- ===== Rule kinds for locations =====
ALTER TABLE public.corporate_policy_rules DROP CONSTRAINT corporate_policy_rules_rule_kind_check;
ALTER TABLE public.corporate_policy_rules ADD CONSTRAINT corporate_policy_rules_rule_kind_check CHECK (rule_kind = ANY (ARRAY[
 'ride_type_allow','ride_type_block','max_fare_per_trip','max_distance_km','time_window','day_of_week','monthly_spend_cap','weekly_spend_cap',
 'requires_approval_above','geo_allowlist','geo_blocklist','rides_per_day_cap','rides_per_week_cap','rides_per_month_cap','no_weekends','no_holidays',
 'pickup_approved_only','dropoff_approved_only','airport_zone_block','airport_zone_only']));

CREATE OR REPLACE FUNCTION private.corporate_location_evaluate(_corp uuid, _employee_id uuid, _plat numeric, _plng numeric, _dlat numeric, _dlng numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE e corporate_employees%ROWTYPE; r record; reasons jsonb := '[]'::jsonb; hit boolean; msg text; near_airport boolean;
BEGIN
  IF _plat IS NULL OR _dlat IS NULL THEN RETURN reasons; END IF;
  IF _employee_id IS NOT NULL THEN SELECT * INTO e FROM corporate_employees WHERE id=_employee_id AND corporate_id=_corp; END IF;
  near_airport := EXISTS (SELECT 1 FROM corporate_locations l WHERE l.corporate_id=_corp AND l.active AND l.kind='airport'
     AND (private.geo_km(l.lat,l.lng,_plat,_plng)*1000 <= l.radius_m OR private.geo_km(l.lat,l.lng,_dlat,_dlng)*1000 <= l.radius_m));
  FOR r IN SELECT pr.*, p.name AS policy_name FROM corporate_policy_rules pr JOIN corporate_ride_policies p ON p.id=pr.policy_id
    WHERE p.corporate_id=_corp AND p.active AND (p.effective_from IS NULL OR p.effective_from <= now()) AND (p.effective_to IS NULL OR p.effective_to > now())
      AND pr.rule_kind IN ('pickup_approved_only','dropoff_approved_only','airport_zone_block','airport_zone_only')
      AND (p.scope='corporate' OR (p.scope='department' AND e.department_id IS NOT NULL AND p.department_id = e.department_id) OR (p.scope='employee' AND p.employee_id=_employee_id))
      AND (p.group_id IS NULL OR p.group_id = e.group_id)
  LOOP
    hit := false;
    CASE r.rule_kind
      WHEN 'pickup_approved_only' THEN hit := NOT EXISTS (SELECT 1 FROM corporate_locations l WHERE l.corporate_id=_corp AND l.active AND l.kind IN ('pickup','airport') AND private.geo_km(l.lat,l.lng,_plat,_plng)*1000 <= l.radius_m);
        msg := 'Pickup is not one of the company''s approved pickup places';
      WHEN 'dropoff_approved_only' THEN hit := NOT EXISTS (SELECT 1 FROM corporate_locations l WHERE l.corporate_id=_corp AND l.active AND l.kind IN ('destination','airport') AND private.geo_km(l.lat,l.lng,_dlat,_dlng)*1000 <= l.radius_m);
        msg := 'Destination is not one of the company''s approved destinations';
      WHEN 'airport_zone_block' THEN hit := near_airport; msg := 'Airport trips are not allowed by company policy';
      WHEN 'airport_zone_only' THEN hit := NOT near_airport; msg := 'Only trips to or from an approved airport zone are allowed';
    END CASE;
    IF hit THEN
      reasons := reasons || jsonb_build_object('rule_id', r.id, 'policy_id', r.policy_id, 'policy', r.policy_name, 'rule', r.rule_kind, 'severity', coalesce(r.severity,'block'), 'message', msg);
    END IF;
  END LOOP;
  RETURN reasons;
END $$;

CREATE OR REPLACE FUNCTION private.corporate_policy_merge(_base jsonb, _extra jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  WITH a AS (SELECT coalesce(_base->'reasons','[]'::jsonb) || coalesce(_extra,'[]'::jsonb) AS rs)
  SELECT jsonb_build_object('reasons', a.rs, 'decision',
    CASE (SELECT max(CASE x->>'severity' WHEN 'block' THEN 3 WHEN 'approval' THEN 2 ELSE 1 END) FROM jsonb_array_elements(a.rs) x)
      WHEN 3 THEN 'BLOCKED' WHEN 2 THEN 'EXCEPTION' WHEN 1 THEN 'WARNING' ELSE 'COMPLIANT' END) FROM a
$$;

ALTER FUNCTION private.corporate_policy_evaluate(uuid,uuid,uuid,bigint,numeric,timestamptz,uuid) RENAME TO corporate_policy_evaluate_base;
CREATE FUNCTION private.corporate_policy_evaluate(_corporate_id uuid, _employee_id uuid, _ride_type_id uuid, _fare_cents bigint, _distance_km numeric, _at timestamptz DEFAULT now(), _exclude_booking uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE base jsonb := private.corporate_policy_evaluate_base(_corporate_id,_employee_id,_ride_type_id,_fare_cents,_distance_km,_at,_exclude_booking); b record;
BEGIN
  IF _exclude_booking IS NULL THEN RETURN base; END IF;
  SELECT pickup_lat, pickup_lng, dropoff_lat, dropoff_lng INTO b FROM trip_bookings WHERE id=_exclude_booking;
  RETURN private.corporate_policy_merge(base, private.corporate_location_evaluate(_corporate_id,_employee_id,b.pickup_lat,b.pickup_lng,b.dropoff_lat,b.dropoff_lng));
END $$;

-- ===== Multi-step approvals =====
CREATE OR REPLACE FUNCTION private.corporate_approval_start(_corp uuid, _type text, _subject uuid, _fare bigint, _force boolean) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ch uuid; n int := 0;
BEGIN
  SELECT id INTO ch FROM corporate_approval_chains WHERE corporate_id=_corp AND active AND _fare > min_fare_cents ORDER BY min_fare_cents DESC LIMIT 1;
  IF ch IS NOT NULL THEN
    INSERT INTO corporate_approval_steps(corporate_id, subject_type, subject_id, step_no, approver_employee_id, stand_in_employee_id, deadline_minutes, due_at, status)
    SELECT _corp, _type, _subject, row_number() OVER (ORDER BY s.step_no), s.approver_employee_id, s.stand_in_employee_id, s.deadline_minutes,
      CASE WHEN row_number() OVER (ORDER BY s.step_no)=1 THEN now() + make_interval(mins => s.deadline_minutes) END,
      CASE WHEN row_number() OVER (ORDER BY s.step_no)=1 THEN 'pending' ELSE 'waiting' END
    FROM corporate_approval_chain_steps s WHERE s.chain_id=ch;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  IF n = 0 AND _force THEN
    INSERT INTO corporate_approval_steps(corporate_id, subject_type, subject_id, step_no, deadline_minutes, due_at, status)
    VALUES (_corp, _type, _subject, 1, 120, now() + interval '120 minutes', 'pending');
    n := 1;
  END IF;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION private.corporate_ride_approval_chain_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF private.corporate_approval_start(NEW.corporate_id, 'trip', NEW.id, coalesce(NEW.estimated_fare_cents,0), false) > 0 THEN
    UPDATE corporate_ride_approvals SET expires_at = NULL WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_corporate_ride_approval_chain AFTER INSERT ON public.corporate_ride_approvals FOR EACH ROW EXECUTE FUNCTION private.corporate_ride_approval_chain_trg();

-- direct single-step decision is refused once a multi-step chain governs the trip
ALTER FUNCTION private.corporate_trip_decide(uuid, boolean, text) RENAME TO corporate_trip_decide_base;
CREATE FUNCTION private.corporate_trip_decide(_approval_id uuid, _approve boolean, _note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM corporate_approval_steps WHERE subject_type='trip' AND subject_id=_approval_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MULTI_STEP_APPROVAL', 'message', 'This trip uses a multi-step approval chain; decide it from the approval steps.');
  END IF;
  RETURN private.corporate_trip_decide_base(_approval_id, _approve, _note);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_approval_step_decide(_step_id uuid, _approve boolean, _note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s corporate_approval_steps%ROWTYPE; me uuid := auth.uid(); booker uuid; nxt corporate_approval_steps%ROWTYPE; a corporate_ride_approvals%ROWTYPE; allowed boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM corporate_approval_steps WHERE id=_step_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF s.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','NOT_PENDING','status',s.status); END IF;
  IF s.subject_type='guest_booking' THEN SELECT booked_by INTO booker FROM corporate_guest_bookings WHERE id=s.subject_id;
  ELSE SELECT requested_by INTO booker FROM corporate_ride_approvals WHERE id=s.subject_id; END IF;
  IF booker = me THEN RETURN jsonb_build_object('ok',false,'error','MAKER_CHECKER','message','The person who booked a trip cannot approve it.'); END IF;
  allowed := (s.approver_employee_id IS NULL AND private.is_corporate_manager_or_admin(me, s.corporate_id))
    OR EXISTS (SELECT 1 FROM corporate_employees WHERE id=s.approver_employee_id AND user_id=me AND status='active')
    OR (s.escalated AND EXISTS (SELECT 1 FROM corporate_employees WHERE id=s.stand_in_employee_id AND user_id=me AND status='active'));
  IF NOT allowed THEN RETURN jsonb_build_object('ok',false,'error','NOT_YOUR_STEP'); END IF;
  IF EXISTS (SELECT 1 FROM corporate_approval_steps WHERE subject_type=s.subject_type AND subject_id=s.subject_id AND decided_by=me AND status='approved') THEN
    RETURN jsonb_build_object('ok',false,'error','ALREADY_APPROVED_EARLIER_STEP','message','A different person must approve each step.');
  END IF;

  UPDATE corporate_approval_steps SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, decided_by=me, decided_at=now(), note=left(_note,500) WHERE id=s.id;
  IF _approve THEN
    SELECT * INTO nxt FROM corporate_approval_steps WHERE subject_type=s.subject_type AND subject_id=s.subject_id AND status='waiting' ORDER BY step_no LIMIT 1;
    IF FOUND THEN
      UPDATE corporate_approval_steps SET status='pending', due_at = now() + make_interval(mins => deadline_minutes) WHERE id=nxt.id;
      RETURN jsonb_build_object('ok',true,'state','next_step','step_no',nxt.step_no);
    END IF;
  ELSE
    UPDATE corporate_approval_steps SET status='skipped' WHERE subject_type=s.subject_type AND subject_id=s.subject_id AND status='waiting';
  END IF;

  IF s.subject_type='guest_booking' THEN
    UPDATE corporate_guest_bookings SET status = CASE WHEN _approve THEN 'confirmed' ELSE 'rejected' END WHERE id=s.subject_id AND status='pending_approval';
  ELSE
    SELECT * INTO a FROM corporate_ride_approvals WHERE id=s.subject_id FOR UPDATE;
    IF a.status = 'pending' THEN
      UPDATE corporate_ride_approvals SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END::corporate_approval_status,
        decided_by=me, decided_at=now(), decision_note=left(_note,500) WHERE id=a.id;
      UPDATE trip_bookings SET status = CASE WHEN _approve THEN CASE WHEN scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END ELSE 'rejected' END
        WHERE id=a.booking_id AND status='awaiting_approval';
      INSERT INTO trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
        VALUES (a.booking_id, 'awaiting_approval', CASE WHEN _approve THEN 'pending' ELSE 'rejected' END, me, coalesce(_note, CASE WHEN _approve THEN 'Approved by company (all steps)' ELSE 'Rejected by company' END));
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'state', CASE WHEN _approve THEN 'approved' ELSE 'rejected' END);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_approvals_escalate(_corp uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n int;
BEGIN
  IF NOT (private.is_corporate_member(auth.uid(), _corp) OR private.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  UPDATE corporate_approval_steps SET escalated=true, escalated_at=now(), due_at = now() + make_interval(mins => deadline_minutes)
   WHERE corporate_id=_corp AND status='pending' AND NOT escalated AND due_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ===== Guest / client / hotel / airport bookings =====
CREATE OR REPLACE FUNCTION private.corporate_guest_book(_corporate_id uuid, _kind text, _passenger_name text, _passenger_phone text,
  _pickup_address text, _plat numeric, _plng numeric, _dropoff_address text, _dlat numeric, _dlng numeric,
  _ride_type_id uuid, _scheduled_for timestamptz DEFAULT NULL, _details jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := auth.uid(); rt ride_types%ROWTYPE; req corporate_booking_requirements%ROWTYPE; dist numeric; fare bigint; ev jsonb; gid uuid; ref text; n int;
  c_project text := nullif(left(btrim(coalesce(_details->>'project_code','')),60),'');
  c_client text := nullif(left(btrim(coalesce(_details->>'client_code','')),60),'');
  c_po text := nullif(left(btrim(coalesce(_details->>'po_code','')),60),'');
  c_acct text := nullif(left(btrim(coalesce(_details->>'accounting_code','')),60),'');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT private.is_corporate_manager_or_admin(me, _corporate_id) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED','message','Only company admins and managers can book for guests.'); END IF;
  IF coalesce((SELECT status::text FROM corporate_accounts WHERE id=_corporate_id),'') <> 'ACTIVE' THEN RETURN jsonb_build_object('ok',false,'error','COMPANY_NOT_ACTIVE'); END IF;
  IF _kind NOT IN ('guest','client','hotel_guest','hotel_transfer','airport_transfer') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_KIND'); END IF;
  IF length(btrim(coalesce(_passenger_name,''))) < 2 THEN RETURN jsonb_build_object('ok',false,'error','PASSENGER_NAME_REQUIRED'); END IF;
  IF _plat IS NULL OR _plng IS NULL OR _dlat IS NULL OR _dlng IS NULL THEN RETURN jsonb_build_object('ok',false,'error','LOCATIONS_REQUIRED'); END IF;
  IF _kind = 'airport_transfer' AND length(btrim(coalesce(_details->>'flight_number',''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','FLIGHT_NUMBER_REQUIRED'); END IF;
  IF _scheduled_for IS NOT NULL AND _scheduled_for < now() - interval '5 minutes' THEN RETURN jsonb_build_object('ok',false,'error','TIME_IN_PAST'); END IF;
  SELECT * INTO rt FROM ride_types WHERE id=_ride_type_id AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','INVALID_RIDE_TYPE'); END IF;

  SELECT * INTO req FROM corporate_booking_requirements WHERE corporate_id=_corporate_id;
  IF (coalesce(req.require_project,false) AND c_project IS NULL) OR (coalesce(req.require_client,false) AND c_client IS NULL)
     OR (coalesce(req.require_po,false) AND c_po IS NULL) OR (coalesce(req.require_accounting,false) AND c_acct IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'error','BOOKING_CODES_REQUIRED','message','Your company requires project, client, PO or accounting codes on every booking.');
  END IF;

  dist := round(private.geo_km(_plat,_plng,_dlat,_dlng) * 1.3, 2);
  fare := round(greatest(coalesce(rt.minimum_fare,0), coalesce(rt.base_fare,0) + coalesce(rt.per_km_rate,0)*dist + coalesce(rt.per_minute_rate,0)*dist*2) * 100)::bigint;

  ev := private.corporate_policy_merge(
          private.corporate_policy_evaluate_base(_corporate_id, NULL, _ride_type_id, fare, dist, coalesce(_scheduled_for, now()), NULL),
          private.corporate_location_evaluate(_corporate_id, NULL, _plat, _plng, _dlat, _dlng));
  IF ev->>'decision' = 'BLOCKED' THEN RETURN jsonb_build_object('ok',false,'error','POLICY_BLOCKED','policy',ev,'fare_cents',fare); END IF;
  IF private.corporate_capacity_cents(_corporate_id) < fare THEN RETURN jsonb_build_object('ok',false,'error','COMPANY_FUNDS_INSUFFICIENT','fare_cents',fare); END IF;

  INSERT INTO corporate_guest_bookings(corporate_id, booked_by, booking_kind, passenger_name, passenger_phone, passenger_email, hotel_room, flight_number,
    passengers, luggage, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, ride_type_id, scheduled_for,
    distance_km, estimated_fare_cents, project_code, client_code, po_code, accounting_code, notes, policy)
  VALUES (_corporate_id, me, _kind, left(btrim(_passenger_name),120), nullif(left(btrim(coalesce(_passenger_phone,'')),30),''),
    nullif(left(btrim(coalesce(_details->>'passenger_email','')),160),''), nullif(left(btrim(coalesce(_details->>'hotel_room','')),30),''),
    nullif(upper(left(btrim(coalesce(_details->>'flight_number','')),12)),''),
    greatest(1, least(60, coalesce((_details->>'passengers')::int,1))), greatest(0, least(60, coalesce((_details->>'luggage')::int,0))),
    left(_pickup_address,300), _plat, _plng, left(_dropoff_address,300), _dlat, _dlng, _ride_type_id, _scheduled_for,
    dist, fare, c_project, c_client, c_po, c_acct, nullif(left(btrim(coalesce(_details->>'notes','')),500),''), ev)
  RETURNING id, reference INTO gid, ref;

  n := private.corporate_approval_start(_corporate_id, 'guest_booking', gid, fare, ev->>'decision' = 'EXCEPTION');
  IF n = 0 THEN UPDATE corporate_guest_bookings SET status='confirmed' WHERE id=gid; END IF;
  RETURN jsonb_build_object('ok',true,'id',gid,'reference',ref,'fare_cents',fare,'distance_km',dist,'policy',ev,
    'state', CASE WHEN n = 0 THEN 'confirmed' ELSE 'pending_approval' END, 'approval_steps', n);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_guest_cancel(_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g corporate_guest_bookings%ROWTYPE;
BEGIN
  SELECT * INTO g FROM corporate_guest_bookings WHERE id=_id FOR UPDATE;
  IF NOT FOUND OR NOT private.is_corporate_manager_or_admin(auth.uid(), g.corporate_id) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  IF g.status NOT IN ('pending_approval','confirmed') THEN RETURN jsonb_build_object('ok',false,'error','NOT_CANCELLABLE'); END IF;
  UPDATE corporate_guest_bookings SET status='cancelled' WHERE id=_id;
  UPDATE corporate_approval_steps SET status='skipped' WHERE subject_type='guest_booking' AND subject_id=_id AND status IN ('waiting','pending');
  RETURN jsonb_build_object('ok',true);
END $$;

-- ===== Grants + public invoker wrappers =====
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['private.geo_km(numeric,numeric,numeric,numeric)','private.corporate_location_evaluate(uuid,uuid,numeric,numeric,numeric,numeric)',
    'private.corporate_policy_merge(jsonb,jsonb)','private.corporate_policy_evaluate(uuid,uuid,uuid,bigint,numeric,timestamptz,uuid)',
    'private.corporate_approval_start(uuid,text,uuid,bigint,boolean)','private.corporate_ride_approval_chain_trg()',
    'private.corporate_trip_decide(uuid,boolean,text)','private.corporate_approval_step_decide(uuid,boolean,text)',
    'private.corporate_approvals_escalate(uuid)','private.corporate_guest_book(uuid,text,text,text,text,numeric,numeric,text,numeric,numeric,uuid,timestamptz,jsonb)',
    'private.corporate_guest_cancel(uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||f||' TO authenticated, service_role';
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION private.corporate_approval_start(uuid,text,uuid,bigint,boolean) FROM authenticated;

CREATE OR REPLACE FUNCTION public.corporate_guest_book(_corporate_id uuid, _kind text, _passenger_name text, _passenger_phone text,
  _pickup_address text, _plat numeric, _plng numeric, _dropoff_address text, _dlat numeric, _dlng numeric,
  _ride_type_id uuid, _scheduled_for timestamptz DEFAULT NULL, _details jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
  SELECT private.corporate_guest_book(_corporate_id,_kind,_passenger_name,_passenger_phone,_pickup_address,_plat,_plng,_dropoff_address,_dlat,_dlng,_ride_type_id,_scheduled_for,_details) $$;
CREATE OR REPLACE FUNCTION public.corporate_guest_cancel(_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_guest_cancel(_id) $$;
CREATE OR REPLACE FUNCTION public.corporate_approval_step_decide(_step_id uuid, _approve boolean, _note text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_approval_step_decide(_step_id,_approve,_note) $$;
CREATE OR REPLACE FUNCTION public.corporate_approvals_escalate(_corp uuid) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_approvals_escalate(_corp) $$;
REVOKE ALL ON FUNCTION public.corporate_guest_book(uuid,text,text,text,text,numeric,numeric,text,numeric,numeric,uuid,timestamptz,jsonb), public.corporate_guest_cancel(uuid),
  public.corporate_approval_step_decide(uuid,boolean,text), public.corporate_approvals_escalate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_guest_book(uuid,text,text,text,text,numeric,numeric,text,numeric,numeric,uuid,timestamptz,jsonb), public.corporate_guest_cancel(uuid),
  public.corporate_approval_step_decide(uuid,boolean,text), public.corporate_approvals_escalate(uuid) TO authenticated;