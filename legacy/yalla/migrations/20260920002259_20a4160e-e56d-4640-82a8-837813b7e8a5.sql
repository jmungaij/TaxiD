CREATE OR REPLACE FUNCTION public.sales_manager_desk(p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_month_start date := date_trunc('month', now())::date;
  v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_me IS NULL AND NOT public.has_staff_permission('staff.crm.manage') THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF NOT public.has_staff_permission('staff.crm.manage')
     AND NOT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) THEN
    RAISE EXCEPTION 'NOT_A_SALES_MANAGER';
  END IF;

  WITH team AS (
    SELECT sm.id, sm.full_name, sm.user_id, op.title AS position_title
      FROM public.staff_members sm
      LEFT JOIN public.org_positions op ON op.id = sm.position_id
     WHERE sm.employment_status IN ('active','onboarding')
       AND (sm.manager_staff_id = v_me OR (public.has_staff_permission('staff.crm.manage')
            AND op.code IN ('YML-SAL-CSS-001','SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')))
  )
  SELECT jsonb_build_object(
    'manager_staff_id', v_me,
    'generated_at', now(),
    'month_start', v_month_start,
    'today', v_today,
    'team_target_kes', coalesce((SELECT sum((public.sales_target_for(t.id, v_month_start)->>'target_kes')::numeric) FROM team t), 0),
    'my_kpis', jsonb_build_object(
      'staff_id', v_me,
      'full_name', (SELECT full_name FROM public.staff_members WHERE id = v_me),
      'own_target_kes', (public.sales_target_for(v_me, v_month_start)->>'target_kes')::numeric,
      'team_size', (SELECT count(*) FROM team),
      'team_leads_open', (SELECT count(*) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false)
                              AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')),
      'team_new_customers_today', (SELECT count(*) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false)
                              AND (l.created_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
      'team_outreach_today', (SELECT count(*) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false)
                              AND (l.last_outreach_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
      'team_won_month_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false) AND l.stage = 'CLOSED_WON' AND l.closed_at >= v_month_start), 0),
      'team_collected_month_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                            JOIN public.tax_invoices i ON i.id = r.invoice_id
                            JOIN team t ON t.id = i.owner_staff_id
                            WHERE coalesce(r.status,'recorded') <> 'void' AND r.received_on >= v_month_start), 0),
      'team_outstanding_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
                            JOIN team t ON t.id = i.owner_staff_id
                            WHERE i.status IN ('issued','sent','part_paid')), 0),
      'team_exceptions_open', (SELECT count(*) FROM public.commercial_signals s
                            WHERE s.signal_type = 'service_exception' AND s.status IN ('open','acknowledged')
                              AND (s.owner_user_id IN (SELECT user_id FROM team) OR s.owner_user_id IS NULL)),
      'team_services_completed_today', (SELECT count(*) FROM public.commercial_service_executions e
                            JOIN team t ON t.id = e.owner_staff_id
                            WHERE e.status = 'COMPLETED'
                              AND (coalesce(e.completed_at, e.scheduled_at) AT TIME ZONE 'Africa/Nairobi')::date = v_today),
      'team_contracts_awaiting_signature', (SELECT count(*) FROM public.commercial_contract_instances c
                            JOIN team t ON t.id = c.owner_staff_id
                            WHERE NOT coalesce(c.is_test,false) AND c.signature_date IS NULL AND c.execution_date IS NULL),
      'team_day_closes_month', (SELECT count(*) FROM public.sales_kpi_closes k JOIN team t ON t.id = k.staff_member_id
                            WHERE k.grain = 'DAY' AND k.period_start >= v_month_start),
      'team_closed_revenue_month_kes', coalesce((SELECT sum(k.revenue_kes) FROM public.sales_kpi_closes k
                            JOIN team t ON t.id = k.staff_member_id
                            WHERE k.grain = 'DAY' AND k.period_start >= v_month_start), 0),
      'team_closes_today', (SELECT count(*) FROM public.sales_kpi_closes k JOIN team t ON t.id = k.staff_member_id
                            WHERE k.grain = 'DAY' AND k.period_start = v_today)
    ),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id', t.id, 'full_name', t.full_name, 'position', t.position_title,
        'target_kes', (public.sales_target_for(t.id, v_month_start)->>'target_kes')::numeric,
        'leads_total', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)),
        'leads_open', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false) AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')),
        'leads_untouched', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false) AND l.stage = 'NEW'),
        'open_pipeline_kes', coalesce((SELECT sum(l.estimated_value_kes) FROM public.sales_leads l
                         WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)
                           AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), 0),
        'won_month_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l
                         WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)
                           AND l.stage = 'CLOSED_WON' AND l.closed_at >= v_month_start), 0),
        'invoiced_month_cents', coalesce((SELECT sum(i.total_cents) FROM public.tax_invoices i
                         WHERE i.owner_staff_id = t.id AND i.status <> 'cancelled' AND i.issued_at >= v_month_start), 0),
        'collected_month_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                         JOIN public.tax_invoices i ON i.id = r.invoice_id
                         WHERE i.owner_staff_id = t.id AND coalesce(r.status,'recorded') <> 'void'
                           AND r.received_on >= v_month_start), 0),
        'outstanding_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
                         WHERE i.owner_staff_id = t.id AND i.status IN ('issued','sent','part_paid')), 0),
        'service_exceptions_open', (SELECT count(*) FROM public.commercial_signals s
                         WHERE s.signal_type = 'service_exception' AND s.status IN ('open','acknowledged')
                           AND s.owner_user_id = t.user_id),
        'contracts_awaiting_signature', (SELECT count(*) FROM public.commercial_contract_instances c
                         WHERE c.owner_staff_id = t.id AND NOT coalesce(c.is_test,false)
                           AND c.signature_date IS NULL AND c.execution_date IS NULL),
        'day_closes_month', (SELECT count(*) FROM public.sales_kpi_closes k
                         WHERE k.staff_member_id = t.id AND k.grain = 'DAY' AND k.period_start >= v_month_start),
        'closed_revenue_month_kes', coalesce((SELECT sum(k.revenue_kes) FROM public.sales_kpi_closes k
                         WHERE k.staff_member_id = t.id AND k.grain = 'DAY' AND k.period_start >= v_month_start), 0),
        'last_close_on', (SELECT max(k.period_start) FROM public.sales_kpi_closes k
                         WHERE k.staff_member_id = t.id AND k.grain = 'DAY'),
        'closed_today', EXISTS (SELECT 1 FROM public.sales_kpi_closes k
                         WHERE k.staff_member_id = t.id AND k.grain = 'DAY' AND k.period_start = v_today),
        'today', jsonb_build_object(
          'new_customers', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false)
                         AND (l.created_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'outreach', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND (l.last_outreach_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'replies', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND (l.last_reply_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'won_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND l.stage = 'CLOSED_WON'
                         AND (l.closed_at AT TIME ZONE 'Africa/Nairobi')::date = v_today), 0),
          'collected_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                         JOIN public.tax_invoices i ON i.id = r.invoice_id
                         WHERE i.owner_staff_id = t.id AND coalesce(r.status,'recorded') <> 'void'
                           AND r.received_on = v_today), 0),
          'services_completed', (SELECT count(*) FROM public.commercial_service_executions e
                         WHERE e.owner_staff_id = t.id AND e.status = 'COMPLETED'
                           AND (coalesce(e.completed_at, e.scheduled_at) AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'service_issues', (SELECT count(*) FROM public.commercial_service_executions e
                         WHERE e.owner_staff_id = t.id AND e.status IN ('DELAYED','FAILED','CANCELLED')
                           AND (e.updated_at AT TIME ZONE 'Africa/Nairobi')::date = v_today)
        ),
        'last_activity_at', (SELECT max(l.updated_at) FROM public.sales_leads l WHERE l.sales_staff_id = t.id)
      ) ORDER BY t.full_name) FROM team t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $function$;