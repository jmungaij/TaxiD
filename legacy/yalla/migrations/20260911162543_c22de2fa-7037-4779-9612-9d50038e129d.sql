CREATE OR REPLACE FUNCTION public.sales_lead_desk_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := public._my_staff_member_id(); _all boolean := public.has_staff_permission('staff.crm.read'); _rows jsonb;
BEGIN
  IF _me IS NULL AND NOT _all THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'staff_name'), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'sales_staff_id', l.sales_staff_id,
      'staff_name', COALESCE(sm.full_name, 'Unassigned desk'),
      'allocated', count(*),
      'not_contacted', count(*) FILTER (WHERE l.contact_state = 'NOT_CONTACTED'),
      'contacted', count(*) FILTER (WHERE l.contact_state <> 'NOT_CONTACTED'),
      'awaiting_reply', count(*) FILTER (WHERE l.contact_state = 'CONTACTED'),
      'replied', count(*) FILTER (WHERE l.contact_state = 'REPLIED'),
      'not_interested', count(*) FILTER (WHERE l.contact_state = 'NOT_INTERESTED'),
      'reply_rate', CASE WHEN count(*) FILTER (WHERE l.contact_state <> 'NOT_CONTACTED') > 0
        THEN round(100.0 * count(*) FILTER (WHERE l.first_reply_at IS NOT NULL)
             / count(*) FILTER (WHERE l.contact_state <> 'NOT_CONTACTED'), 1) END,
      'avg_days_to_first_reply', round(
        (avg(EXTRACT(EPOCH FROM (l.first_reply_at - l.first_outreach_at)) / 86400.0)
         FILTER (WHERE l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL))::numeric, 1),
      'avg_hours_to_first_reply', round(
        (avg(EXTRACT(EPOCH FROM (l.first_reply_at - l.first_outreach_at)) / 3600.0)
         FILTER (WHERE l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL))::numeric, 1),
      'median_hours_to_first_reply', round(
        (percentile_cont(0.5) WITHIN GROUP (
           ORDER BY CASE WHEN l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (l.first_reply_at - l.first_outreach_at)) / 3600.0 END))::numeric, 1),
      'replies_measured', count(*) FILTER (WHERE l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL),
      'awaiting_over_72h', count(*) FILTER (
        WHERE l.contact_state = 'CONTACTED' AND l.first_outreach_at IS NOT NULL
          AND l.first_outreach_at < now() - interval '72 hours'),
      'longest_wait_hours', round(
        (max(EXTRACT(EPOCH FROM (now() - l.first_outreach_at)) / 3600.0)
         FILTER (WHERE l.contact_state = 'CONTACTED' AND l.first_outreach_at IS NOT NULL))::numeric, 1),
      'followups_open', (SELECT count(*) FROM public.sales_lead_followups f
         JOIN public.sales_leads fl ON fl.id = f.lead_id
         WHERE f.status = 'OPEN' AND fl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id),
      'followups_overdue', (SELECT count(*) FROM public.sales_lead_followups f
         JOIN public.sales_leads fl ON fl.id = f.lead_id
         WHERE f.status = 'OPEN' AND fl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id
           AND f.due_date < (now() AT TIME ZONE 'Africa/Nairobi')::date),
      'open_client_requests', (SELECT count(*) FROM public.sales_lead_service_requests sr
         JOIN public.sales_leads rl ON rl.id = sr.lead_id
         WHERE rl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id
           AND sr.status IN ('SUBMITTED','RECEIVED','IN_REVIEW','QUOTED')),
      -- Conversion is measured against the movement record itself, never a
      -- manually typed label: a lead only counts as converted when the order
      -- it produced is marked delivered (or closed after delivery).
      'booked_movements', count(*) FILTER (WHERE l.order_id IS NOT NULL),
      'deliveries_completed', count(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM public.delivery_orders o
                      WHERE o.id = l.order_id AND o.status IN ('delivered','closed'))),
      'deliveries_in_progress', count(*) FILTER (
        WHERE EXISTS (SELECT 1 FROM public.delivery_orders o
                      WHERE o.id = l.order_id
                        AND o.status IN ('pending','confirmed','dispatched','in_transit','compliance_review'))),
      'delivery_conversion_rate', CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (
               WHERE EXISTS (SELECT 1 FROM public.delivery_orders o
                             WHERE o.id = l.order_id AND o.status IN ('delivered','closed')))
             / count(*), 1) END,
      'no_email', count(*) FILTER (WHERE COALESCE(btrim(l.contact_email),'') = '')
    ) AS r
    FROM public.sales_leads l
    LEFT JOIN public.staff_members sm ON sm.id = l.sales_staff_id
    WHERE l.is_test = false AND (_all OR l.sales_staff_id = _me)
    GROUP BY l.sales_staff_id, sm.full_name
  ) q;

  RETURN jsonb_build_object('ok', true, 'scope', CASE WHEN _all THEN 'DESK' ELSE 'SELF' END, 'desks', _rows);
END $function$;

CREATE OR REPLACE FUNCTION public.sales_lead_delivery_tracking()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := public._my_staff_member_id(); _all boolean := public.has_staff_permission('staff.crm.read'); _rows jsonb;
BEGIN
  IF _me IS NULL AND NOT _all THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'organisation_name'), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'lead_id', l.id,
      'lead_ref', l.lead_ref,
      'organisation_name', l.organisation_name,
      'contact_name', l.contact_name,
      'contact_email', l.contact_email,
      'contact_state', l.contact_state,
      'stage', l.stage,
      'sales_staff_id', l.sales_staff_id,
      'staff_name', COALESCE(sm.full_name, 'Unassigned desk'),
      'first_outreach_at', l.first_outreach_at,
      'first_reply_at', l.first_reply_at,
      'last_reply_at', l.last_reply_at,
      'booking_ref', l.booking_ref,
      'order_id', l.order_id,
      'order_number', o.order_number,
      'order_status', o.status,
      'payment_status', o.payment_status,
      'order_total', o.total_amount,
      'currency', o.currency,
      'sla_deadline', o.sla_deadline,
      'delivered_at', (SELECT max(p.delivered_at) FROM public.carrier_pod_submissions p
                       WHERE p.order_id = o.id AND p.state = 'APPROVED'),
      'legs_total', (SELECT count(*) FROM public.logistics_order_legs g WHERE g.order_id = o.id),
      'legs_completed', (SELECT count(*) FROM public.logistics_order_legs g
                         WHERE g.order_id = o.id AND g.status = 'COMPLETED'),
      'open_followups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', f.id, 'next_action', f.next_action, 'due_date', f.due_date,
                 'logged_note', f.logged_note, 'contact_date', f.contact_date)
               ORDER BY f.due_date)
        FROM public.sales_lead_followups f
        WHERE f.lead_id = l.id AND f.status = 'OPEN'), '[]'::jsonb),
      'requests_total', (SELECT count(*) FROM public.sales_lead_service_requests sr WHERE sr.lead_id = l.id),
      'open_requests', (SELECT count(*) FROM public.sales_lead_service_requests sr
                        WHERE sr.lead_id = l.id
                          AND sr.status IN ('SUBMITTED','RECEIVED','IN_REVIEW','QUOTED','SCHEDULED'))
    ) AS r
    FROM public.sales_leads l
    LEFT JOIN public.staff_members sm ON sm.id = l.sales_staff_id
    LEFT JOIN public.delivery_orders o ON o.id = l.order_id
    WHERE l.is_test = false AND (_all OR l.sales_staff_id = _me)
  ) q;

  RETURN jsonb_build_object('ok', true, 'scope', CASE WHEN _all THEN 'DESK' ELSE 'SELF' END, 'leads', _rows);
END $function$;

REVOKE ALL ON FUNCTION public.sales_lead_delivery_tracking() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_delivery_tracking() TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'trip_status_history'
                   AND policyname = 'Admins read trip status history') THEN
    CREATE POLICY "Admins read trip status history" ON public.trip_status_history
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'trip_waypoints'
                   AND policyname = 'Admins read trip waypoints') THEN
    CREATE POLICY "Admins read trip waypoints" ON public.trip_waypoints
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
  END IF;
END $$;