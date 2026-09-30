CREATE OR REPLACE FUNCTION public.staff_dashboard_snapshot(_lens text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_roles  text[];
  v_staff  uuid;
  v_allow  text[];
  v_tiles  jsonb := '[]'::jsonb;
  v_series jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_tasks  jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  SELECT coalesce(array_agg(role::text), '{}') INTO v_roles
  FROM public.user_roles WHERE user_id = v_uid;

  v_allow := CASE _lens
    WHEN 'admin'       THEN ARRAY['admin','super_admin']
    WHEN 'finance'     THEN ARRAY['admin','super_admin','finance_admin']
    WHEN 'logistics'   THEN ARRAY['admin','super_admin','operations_admin','operations_manager','fleet_manager']
    WHEN 'recruitment' THEN ARRAY['admin','super_admin','operations_admin','general_manager','director']
    ELSE NULL
  END;

  IF v_allow IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_LENS';
  END IF;
  IF NOT (v_roles && v_allow) THEN
    RAISE EXCEPTION 'LENS_NOT_AUTHORISED';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = v_uid LIMIT 1;

  -- The caller's OWN open work only. Never another person's queue.
  IF v_staff IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(t ORDER BY t->>'due' NULLS LAST), '[]'::jsonb) INTO v_tasks
    FROM (
      SELECT jsonb_build_object(
               'id', w.id,
               'title', w.title,
               'kind', w.work_kind,
               'priority', w.priority,
               'status', w.status,
               'due', w.next_action_due,
               'next_action', w.next_action,
               'overdue', (w.next_action_due IS NOT NULL AND w.next_action_due < now())
             ) AS t
      FROM public.staff_work_items w
      WHERE w.staff_id = v_staff
        AND w.completed_at IS NULL
        AND coalesce(w.status,'open') NOT IN ('completed','closed','cancelled')
      ORDER BY w.next_action_due NULLS LAST, w.created_at DESC
      LIMIT 12
    ) s;
  END IF;

  IF _lens = 'admin' THEN
    SELECT jsonb_build_array(
      jsonb_build_object('key','staff','label','Active staff','value',(SELECT count(*) FROM public.staff_members WHERE coalesce(employment_status,'active') <> 'exited'),'unit','people'),
      jsonb_build_object('key','open_work','label','Open work items','value',(SELECT count(*) FROM public.staff_work_items WHERE completed_at IS NULL),'unit','items'),
      jsonb_build_object('key','overdue','label','Overdue work','value',(SELECT count(*) FROM public.staff_work_items WHERE completed_at IS NULL AND next_action_due < now()),'unit','items','tone','critical'),
      jsonb_build_object('key','denials','label','Access denials (7d)','value',(SELECT count(*) FROM public.access_denials WHERE created_at > now() - interval '7 days'),'unit','events','tone','warning')
    ) INTO v_tiles;

    SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'value', (
      SELECT count(*) FROM public.staff_work_items w WHERE w.created_at::date = d::date))ORDER BY d), '[]'::jsonb)
    INTO v_series
    FROM generate_series(current_date - 13, current_date, interval '1 day') d;

    SELECT coalesce(jsonb_agg(a ORDER BY a->>'at' DESC), '[]'::jsonb) INTO v_alerts
    FROM (
      SELECT jsonb_build_object('id', e.id, 'severity', lower(coalesce(e.severity,'info')), 'title', coalesce(e.rule_name,'Platform alert'),
                                'detail', e.message, 'at', e.created_at) AS a
      FROM public.alerts_events e
      WHERE e.acknowledged_at IS NULL AND coalesce(e.is_test,false) = false
      ORDER BY e.created_at DESC LIMIT 8
    ) s;

  ELSIF _lens = 'finance' THEN
    SELECT jsonb_build_array(
      jsonb_build_object('key','wd_pending','label','Withdrawals awaiting review','value',(SELECT count(*) FROM public.carrier_withdrawal_requests WHERE state::text IN ('requested','under_review','pending')),'unit','requests','tone','warning'),
      jsonb_build_object('key','inv_open','label','Unpaid freight invoices','value',(SELECT count(*) FROM public.freight_invoices WHERE coalesce(paid_total,0) < total AND voided_at IS NULL),'unit','invoices'),
      jsonb_build_object('key','inv_value','label','Freight receivable','value',(SELECT round(coalesce(sum(total - coalesce(paid_total,0)),0))::numeric FROM public.freight_invoices WHERE voided_at IS NULL),'unit','KES'),
      jsonb_build_object('key','corp_due','label','Corporate balance due','value',(SELECT round(coalesce(sum(balance_cents),0)/100.0)::numeric FROM public.corporate_invoices WHERE voided_at IS NULL),'unit','KES')
    ) INTO v_tiles;

    SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'value', (
      SELECT round(coalesce(sum(i.total),0))::numeric FROM public.freight_invoices i WHERE i.created_at::date = d::date))ORDER BY d), '[]'::jsonb)
    INTO v_series
    FROM generate_series(current_date - 13, current_date, interval '1 day') d;

    SELECT coalesce(jsonb_agg(a ORDER BY a->>'at' DESC), '[]'::jsonb) INTO v_alerts
    FROM (
      SELECT jsonb_build_object('id', r.id, 'severity', 'warning', 'title', 'Withdrawal ' || r.request_reference,
                                'detail', 'KES ' || r.amount_kes || ' awaiting finance decision', 'at', r.requested_at) AS a
      FROM public.carrier_withdrawal_requests r
      WHERE r.state::text IN ('requested','under_review','pending')
      ORDER BY r.requested_at DESC LIMIT 8
    ) s;

  ELSIF _lens = 'logistics' THEN
    SELECT jsonb_build_array(
      jsonb_build_object('key','live','label','Bookings in flight','value',(SELECT count(*) FROM public.freight_bookings WHERE completed_at IS NULL AND cancelled_at IS NULL),'unit','bookings'),
      jsonb_build_object('key','delivered','label','Completed (7d)','value',(SELECT count(*) FROM public.freight_bookings WHERE completed_at > now() - interval '7 days'),'unit','bookings','tone','positive'),
      jsonb_build_object('key','pod','label','Proof awaiting review','value',(SELECT count(*) FROM public.carrier_pod_submissions WHERE state::text IN ('submitted','under_review','pending')),'unit','submissions','tone','warning'),
      jsonb_build_object('key','unassigned','label','Awaiting carrier acceptance','value',(SELECT count(*) FROM public.freight_bookings WHERE carrier_accepted_at IS NULL AND cancelled_at IS NULL AND completed_at IS NULL),'unit','bookings','tone','critical')
    ) INTO v_tiles;

    SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'value', (
      SELECT count(*) FROM public.freight_bookings b WHERE b.created_at::date = d::date))ORDER BY d), '[]'::jsonb)
    INTO v_series
    FROM generate_series(current_date - 13, current_date, interval '1 day') d;

    SELECT coalesce(jsonb_agg(a ORDER BY a->>'at' DESC), '[]'::jsonb) INTO v_alerts
    FROM (
      SELECT jsonb_build_object('id', p.id, 'severity', 'info', 'title', 'Delivery proof ' || p.submission_reference,
                                'detail', 'Submitted ' || to_char(p.submitted_at,'DD Mon HH24:MI') || ' — awaiting approval', 'at', p.submitted_at) AS a
      FROM public.carrier_pod_submissions p
      WHERE p.state::text IN ('submitted','under_review','pending')
      ORDER BY p.submitted_at DESC LIMIT 8
    ) s;

  ELSE
    SELECT jsonb_build_array(
      jsonb_build_object('key','open_apps','label','Applications in progress','value',(SELECT count(*) FROM public.rec_applications WHERE coalesce(status,'open') NOT IN ('rejected','withdrawn','hired','closed')),'unit','applications'),
      jsonb_build_object('key','new7','label','New applications (7d)','value',(SELECT count(*) FROM public.rec_applications WHERE applied_at > now() - interval '7 days'),'unit','applications','tone','positive'),
      jsonb_build_object('key','overdue','label','Overdue recruiter actions','value',(SELECT count(*) FROM public.rec_applications WHERE next_action_due < now() AND coalesce(status,'open') NOT IN ('rejected','withdrawn','hired','closed')),'unit','actions','tone','critical'),
      jsonb_build_object('key','flagged','label','Flagged for review','value',(SELECT count(*) FROM public.rec_applications WHERE coalesce(review_flagged,false)),'unit','applications','tone','warning')
    ) INTO v_tiles;

    SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'value', (
      SELECT count(*) FROM public.rec_applications a WHERE a.applied_at::date = d::date))ORDER BY d), '[]'::jsonb)
    INTO v_series
    FROM generate_series(current_date - 13, current_date, interval '1 day') d;

    SELECT coalesce(jsonb_agg(a ORDER BY a->>'at' DESC), '[]'::jsonb) INTO v_alerts
    FROM (
      SELECT jsonb_build_object('id', r.id, 'severity', CASE WHEN r.next_action_due < now() THEN 'critical' ELSE 'info' END,
                                'title', 'Application ' || r.application_no,
                                'detail', coalesce(r.next_action,'Stage: ' || coalesce(r.stage::text,'unknown')), 'at', coalesce(r.next_action_due, r.applied_at)) AS a
      FROM public.rec_applications r
      WHERE coalesce(r.status,'open') NOT IN ('rejected','withdrawn','hired','closed')
        AND (r.next_action_due IS NOT NULL OR coalesce(r.review_flagged,false))
      ORDER BY r.next_action_due NULLS LAST LIMIT 8
    ) s;
  END IF;

  RETURN jsonb_build_object(
    'lens', _lens,
    'generated_at', now(),
    'staff_id', v_staff,
    'tiles', v_tiles,
    'series', v_series,
    'alerts', v_alerts,
    'my_tasks', v_tasks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_dashboard_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_dashboard_snapshot(text) TO authenticated;