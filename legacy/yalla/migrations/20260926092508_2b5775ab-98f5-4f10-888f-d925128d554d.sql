CREATE OR REPLACE FUNCTION public.yalla_unified_calendar(_from timestamptz, _to timestamptz, _team boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _me uuid; _mgr boolean; _ids uuid[]; _out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT id INTO _me FROM staff_members WHERE user_id = auth.uid() LIMIT 1;
  IF _me IS NULL THEN RAISE EXCEPTION 'staff only' USING ERRCODE = '42501'; END IF;
  _mgr := coalesce(public.meetings_is_manager(), false) IS TRUE;
  IF _to - _from > interval '93 days' THEN _to := _from + interval '93 days'; END IF;
  IF _team AND _mgr THEN SELECT array_agg(id) INTO _ids FROM staff_members; ELSE _ids := ARRAY[_me]; END IF;
  WITH ev AS (
    SELECT 'meeting'::text kind, b.id::text ref, coalesce(b.topic,'Meeting with '||b.client_name)::text title,
           b.starts_at, b.starts_at + make_interval(mins => coalesce(b.duration_minutes,30)) ends_at,
           b.status::text status, b.host_staff_id staff_id, b.join_url::text url, b.lead_id::text lead_id, b.client_name::text subject, NULL::bigint amount_cents
      FROM public_meeting_bookings b WHERE b.host_staff_id = ANY(_ids) AND b.starts_at >= _from AND b.starts_at < _to
    UNION ALL
    SELECT 'block', k.id::text, k.title::text, k.starts_at, k.ends_at, k.kind::text, k.staff_id, NULL, NULL, NULL, NULL
      FROM staff_calendar_blocks k WHERE k.staff_id = ANY(_ids) AND k.starts_at < _to AND k.ends_at >= _from
    UNION ALL
    SELECT 'follow_up', f.id::text, coalesce(f.next_action,'Follow up')||' — '||l.organisation_name,
           f.due_date::timestamptz, NULL, f.status::text, f.sales_staff_id, NULL, l.id::text, l.organisation_name::text, NULL
      FROM sales_lead_followups f JOIN sales_leads l ON l.id = f.lead_id
     WHERE f.sales_staff_id = ANY(_ids) AND f.due_date >= _from::date AND f.due_date < _to::date AND coalesce(l.is_test,false) = false
    UNION ALL
    SELECT 'lead_service', l.id::text, coalesce(l.service_interest::text,'Service')||' — '||l.organisation_name,
           l.service_date::timestamptz, NULL, l.stage::text, l.sales_staff_id, NULL, l.id::text, l.organisation_name::text, NULL
      FROM sales_leads l WHERE l.sales_staff_id = ANY(_ids) AND l.service_date >= _from::date AND l.service_date < _to::date AND coalesce(l.is_test,false) = false
    UNION ALL
    SELECT 'invoice_due', t.id::text, 'Invoice '||coalesce(t.invoice_no,'draft')||' due — '||coalesce(t.customer_company,''),
           t.due_date::timestamptz, NULL, t.status::text, t.owner_staff_id, NULL, t.lead_id::text, t.customer_company::text, (t.total_cents - coalesce(t.paid_cents,0))::bigint
      FROM tax_invoices t WHERE t.owner_staff_id = ANY(_ids) AND t.due_date >= _from::date AND t.due_date < _to::date AND coalesce(t.is_test,false) = false
    UNION ALL
    SELECT 'payment', m.id::text, 'M-Pesa payment '||coalesce(m.mpesa_receipt,''), m.created_at, NULL, m.status::text, NULL, NULL, NULL, NULL, m.amount_cents::bigint
      FROM mpesa_transactions m WHERE _mgr AND _team AND m.status::text = 'SUCCESS' AND m.deleted_at IS NULL AND m.created_at >= _from AND m.created_at < _to
  )
  SELECT jsonb_build_object('manager', _mgr, 'team', _team AND _mgr,
    'events', coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'ref',e.ref,'title',e.title,'starts_at',e.starts_at,'ends_at',e.ends_at,
      'status',e.status,'staff_id',e.staff_id,'staff_name',s.full_name,'url',e.url,'lead_id',e.lead_id,'subject',e.subject,'amount_cents',e.amount_cents) ORDER BY e.starts_at),'[]'::jsonb))
  INTO _out FROM ev e LEFT JOIN staff_members s ON s.id = e.staff_id;
  RETURN _out;
END $function$;