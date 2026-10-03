-- Policy versioning & audit trail
CREATE OR REPLACE FUNCTION private.corporate_policy_audit_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE corp uuid; tgt uuid; rec jsonb; old_j jsonb := CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END; new_j jsonb := CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  rec := coalesce(new_j, old_j);
  IF TG_TABLE_NAME='corporate_policy_rules' THEN
    SELECT corporate_id INTO corp FROM corporate_ride_policies WHERE id=(rec->>'policy_id')::uuid;
  ELSE corp := (rec->>'corporate_id')::uuid; END IF;
  tgt := (rec->>'id')::uuid;
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, target_id, before, after, metadata)
  VALUES (corp, auth.uid(), lower(TG_OP), TG_TABLE_NAME, tgt, old_j, new_j,
    jsonb_build_object('policy_id', coalesce(rec->>'policy_id', CASE WHEN TG_TABLE_NAME='corporate_ride_policies' THEN rec->>'id' END)));
  IF TG_TABLE_NAME='corporate_ride_policies' AND TG_OP='UPDATE' THEN
    NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object('version', coalesce((OLD.metadata->>'version')::int,1)+1);
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION private.corporate_policy_audit_trg() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER corporate_ride_policies_audit BEFORE UPDATE ON public.corporate_ride_policies FOR EACH ROW EXECUTE FUNCTION private.corporate_policy_audit_trg();
CREATE TRIGGER corporate_ride_policies_audit_id AFTER INSERT OR DELETE ON public.corporate_ride_policies FOR EACH ROW EXECUTE FUNCTION private.corporate_policy_audit_trg();
CREATE TRIGGER corporate_policy_rules_audit AFTER INSERT OR UPDATE OR DELETE ON public.corporate_policy_rules FOR EACH ROW EXECUTE FUNCTION private.corporate_policy_audit_trg();
CREATE TRIGGER corporate_locations_audit AFTER INSERT OR UPDATE OR DELETE ON public.corporate_locations FOR EACH ROW EXECUTE FUNCTION private.corporate_policy_audit_trg();

-- Executive summary: more KPIs, groupings, drill-down records, access audit
DROP FUNCTION IF EXISTS public.corporate_executive_summary(uuid,date,date,text);
DROP FUNCTION IF EXISTS private.corporate_executive_summary(uuid,date,date,text);
CREATE FUNCTION private.corporate_executive_summary(_corp uuid, _from date, _to date, _group text DEFAULT 'cost_center')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := auth.uid(); out jsonb; allowed boolean;
BEGIN
  allowed := private.is_corporate_manager_or_admin(me, _corp) OR public.has_role(me,'super_admin');
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, metadata)
  VALUES (_corp, me, CASE WHEN allowed THEN 'executive_view' ELSE 'executive_view_denied' END, 'executive_dashboard',
          jsonb_build_object('from',_from,'to',_to,'group',_group));
  IF NOT allowed THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  IF _group NOT IN ('cost_center','department','employee','month','invoice','program','period','status','trip') THEN _group := 'cost_center'; END IF;
  WITH items AS (
    SELECT ii.id, ii.description, ii.employee_name, ii.cost_center, ii.department dep_text, ii.trip_origin, ii.trip_destination, ii.trip_ended_at, ii.total_cents,
           i.invoice_number, i.status::text inv_status, i.issued_at, e.department_id, b.booking_number, gb.program_id
    FROM corporate_invoice_items ii JOIN corporate_invoices i ON i.id=ii.invoice_id
    LEFT JOIN trip_bookings b ON b.id = nullif(ii.metadata->>'booking_id','')::uuid
    LEFT JOIN corporate_employees e ON e.id = b.corporate_employee_id
    LEFT JOIN corporate_guest_bookings gb ON gb.trip_booking_id = b.id
    WHERE i.corporate_id=_corp AND coalesce(ii.trip_ended_at, i.created_at)::date BETWEEN _from AND _to
  ), g AS (
    SELECT CASE _group WHEN 'cost_center' THEN coalesce(cost_center,'Unassigned') WHEN 'employee' THEN coalesce(employee_name,'Guest / unassigned')
      WHEN 'month' THEN to_char(coalesce(trip_ended_at, issued_at),'YYYY-MM') WHEN 'invoice' THEN coalesce(invoice_number,'Draft')
      WHEN 'period' THEN to_char(date_trunc('week',coalesce(trip_ended_at, issued_at)),'"Week of" YYYY-MM-DD')
      WHEN 'status' THEN coalesce(inv_status,'draft') WHEN 'trip' THEN coalesce(booking_number, description, 'Trip')
      WHEN 'program' THEN coalesce((SELECT name FROM corporate_programs p WHERE p.id=items.program_id),'No program')
      ELSE coalesce((SELECT name FROM corporate_departments d WHERE d.id=items.department_id), dep_text, 'Unassigned') END k,
      count(*) trips, sum(total_cents) total_cents
    FROM items GROUP BY 1
  )
  SELECT jsonb_build_object('ok',true,
    'groups', coalesce((SELECT jsonb_agg(jsonb_build_object('key',k,'trips',trips,'total_cents',total_cents) ORDER BY total_cents DESC) FROM g),'[]'),
    'items', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.trip_ended_at DESC NULLS LAST) FROM (SELECT * FROM items LIMIT 500) x),'[]'),
    'totals', (SELECT jsonb_build_object('trips',count(*),'total_cents',coalesce(sum(total_cents),0)) FROM items),
    'invoices', (SELECT jsonb_build_object('open_cents',coalesce(sum(balance_cents) FILTER (WHERE status::text NOT IN ('paid','void','voided')),0),'count',count(*) FILTER (WHERE status::text NOT IN ('paid','void','voided'))) FROM corporate_invoices WHERE corporate_id=_corp),
    'exceptions', (SELECT count(*) FROM corporate_trip_settlements WHERE corporate_id=_corp AND status='EXCEPTION'),
    'pending_approvals', (SELECT count(*) FROM corporate_approval_steps WHERE corporate_id=_corp AND status='pending')
        + (SELECT count(*) FROM corporate_guest_bookings WHERE corporate_id=_corp AND status ILIKE 'pending%'),
    'compliance', (SELECT jsonb_build_object('total',count(*),'compliant',count(*) FILTER (WHERE decision='COMPLIANT'),
        'warnings',count(*) FILTER (WHERE decision='WARNING'),'exceptions',count(*) FILTER (WHERE decision='EXCEPTION'),'blocked',count(*) FILTER (WHERE decision='BLOCKED'))
        FROM corporate_policy_violations WHERE corporate_id=_corp AND created_at::date BETWEEN _from AND _to),
    'active_travellers', (SELECT count(DISTINCT corporate_employee_id) FROM trip_bookings WHERE corporate_id=_corp AND created_at::date BETWEEN _from AND _to AND status NOT IN ('cancelled','rejected')),
    'wallet', jsonb_build_object('balance_cents', private.corporate_wallet_balance_cents(_corp),
        'credit_limit_cents', (SELECT credit_limit_cents FROM corporate_accounts WHERE id=_corp),
        'mode', (SELECT mode FROM corporate_billing_arrangements WHERE corporate_id=_corp AND status='ACTIVE' LIMIT 1)),
    'safety', (SELECT jsonb_build_object('open',count(*) FILTER (WHERE s.resolved_at IS NULL),'total',count(*),
        'recent', coalesce(jsonb_agg(jsonb_build_object('reference',s.reference,'type',s.incident_type,'severity',s.severity,'status',s.status,'at',s.created_at,'trip',s.booking_number) ORDER BY s.created_at DESC) FILTER (WHERE s.id IS NOT NULL),'[]'))
      FROM safety_incidents s JOIN trip_bookings b ON b.id=s.trip_booking_id WHERE b.corporate_id=_corp AND s.created_at::date BETWEEN _from AND _to),
    'delays', (SELECT count(*) FROM trip_delay_alerts a JOIN trip_bookings b ON b.id=a.trip_booking_id WHERE b.corporate_id=_corp AND a.created_at::date BETWEEN _from AND _to),
    'live_trips', (SELECT count(*) FROM trip_bookings WHERE corporate_id=_corp AND status IN ('accepted','arrived','in_progress')),
    'trips_today', (SELECT count(*) FROM trip_bookings WHERE corporate_id=_corp AND (created_at AT TIME ZONE 'Africa/Nairobi')::date = (now() AT TIME ZONE 'Africa/Nairobi')::date)
  ) INTO out;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION private.corporate_executive_summary(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.corporate_executive_summary(uuid,date,date,text) TO authenticated;
CREATE FUNCTION public.corporate_executive_summary(_corp uuid, _from date, _to date, _group text DEFAULT 'cost_center')
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_executive_summary(_corp,_from,_to,_group) $$;
GRANT EXECUTE ON FUNCTION public.corporate_executive_summary(uuid,date,date,text) TO authenticated;

-- Duty of care: live company trips with driver/vehicle/ETA/route/risk
CREATE OR REPLACE FUNCTION private.corporate_duty_of_care(_corp uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF NOT (private.is_corporate_manager_or_admin(me, _corp) OR public.has_role(me,'super_admin')) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  RETURN jsonb_build_object('ok',true,'trips', coalesce((SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC) FROM (
    SELECT b.id, b.booking_number, b.status, b.created_at, b.pickup_address, b.dropoff_address, b.pickup_eta, b.started_at, b.scheduled_for,
      e.full_name traveller, nullif(trim(coalesce(d.first_name,'')||' '||coalesce(d.last_name,'')),'') driver_name, v.plate_number,
      nullif(trim(coalesce(v.make,'')||' '||coalesce(v.model,'')),'') vehicle,
      (SELECT max(minutes_late) FROM trip_delay_alerts a WHERE a.trip_booking_id=b.id) minutes_late,
      (SELECT count(*) FROM safety_incidents s WHERE s.trip_booking_id=b.id AND s.resolved_at IS NULL) open_incidents,
      CASE WHEN EXISTS (SELECT 1 FROM safety_incidents s WHERE s.trip_booking_id=b.id AND s.resolved_at IS NULL) THEN 'high'
           WHEN EXISTS (SELECT 1 FROM trip_delay_alerts a WHERE a.trip_booking_id=b.id) THEN 'medium'
           WHEN b.status IN ('pending','searching','requested') AND b.created_at < now() - interval '15 minutes' THEN 'medium'
           WHEN extract(hour FROM b.created_at AT TIME ZONE 'Africa/Nairobi') NOT BETWEEN 6 AND 21 THEN 'medium' ELSE 'low' END risk
    FROM trip_bookings b LEFT JOIN corporate_employees e ON e.id=b.corporate_employee_id
    LEFT JOIN drivers d ON d.id=b.driver_id LEFT JOIN vehicles v ON v.id=b.vehicle_id
    WHERE b.corporate_id=_corp AND b.status NOT IN ('completed','cancelled','rejected') ORDER BY b.created_at DESC LIMIT 100) t),'[]'));
END $$;
REVOKE ALL ON FUNCTION private.corporate_duty_of_care(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.corporate_duty_of_care(uuid) TO authenticated;
CREATE FUNCTION public.corporate_duty_of_care(_corp uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$ SELECT private.corporate_duty_of_care(_corp) $$;
GRANT EXECUTE ON FUNCTION public.corporate_duty_of_care(uuid) TO authenticated;