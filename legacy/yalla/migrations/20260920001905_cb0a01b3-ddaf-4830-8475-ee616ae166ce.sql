CREATE OR REPLACE FUNCTION public.sales_manager_operations_board(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public._my_staff_member_id();
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
    SELECT sm.id, sm.full_name, sm.user_id
      FROM public.staff_members sm
     WHERE sm.employment_status IN ('active','onboarding')
       AND (sm.manager_staff_id = v_me OR sm.id = v_me OR public.has_staff_permission('staff.crm.manage'))
  ),
  team_accounts AS (
    SELECT DISTINCT l.account_id, l.sales_staff_id, t.full_name
      FROM public.sales_leads l
      JOIN team t ON t.id = l.sales_staff_id
     WHERE l.account_id IS NOT NULL AND NOT coalesce(l.is_test,false)
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'today', v_today,
    'exceptions', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
        SELECT jsonb_build_object(
          'signal_id', s.id,
          'account_id', s.account_id,
          'customer_label', s.customer_label,
          'headline', s.headline,
          'severity', s.severity,
          'status', s.status,
          'source', s.source,
          'recommended_action', s.recommended_action,
          'evidence', s.evidence,
          'created_at', s.created_at,
          'owner_name', ta.full_name
        ) AS x
          FROM public.commercial_signals s
          LEFT JOIN team_accounts ta ON ta.account_id = s.account_id
         WHERE s.signal_type = 'service_exception'
           AND s.status IN ('open','acknowledged')
           AND (ta.account_id IS NOT NULL OR public.has_staff_permission('staff.crm.manage'))
         ORDER BY s.created_at DESC
         LIMIT 100
      ) q
    ), '[]'::jsonb),
    'services_today', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'scheduled_at' DESC) FROM (
        SELECT jsonb_build_object(
          'execution_id', e.id,
          'execution_ref', e.execution_ref,
          'account_id', e.account_id,
          'service_type', e.service_type,
          'status', e.status,
          'scheduled_at', e.scheduled_at,
          'value_kes', e.value_kes,
          'exception_reason', e.exception_reason,
          'owner_name', (SELECT full_name FROM public.staff_members WHERE id = e.owner_staff_id)
        ) AS x
          FROM public.commercial_service_executions e
         WHERE (e.scheduled_at AT TIME ZONE 'Africa/Nairobi')::date = v_today
         ORDER BY e.scheduled_at DESC
         LIMIT 200
      ) q
    ), '[]'::jsonb),
    'activation', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'start_date' NULLS LAST) FROM (
        SELECT jsonb_build_object(
          'assignment_id', a.id,
          'account_id', a.account_id,
          'contract_id', a.contract_id,
          'assignment_role', a.assignment_role,
          'person_label', a.person_label,
          'vehicle_label', a.vehicle_label,
          'start_date', a.start_date,
          'end_date', a.end_date,
          'status', a.status,
          'owner_name', (SELECT full_name FROM public.staff_members WHERE id = a.staff_member_id)
        ) AS x
          FROM public.commercial_activation_assignments a
         WHERE a.status IN ('PLANNED','ACTIVE')
         ORDER BY a.start_date NULLS LAST
         LIMIT 200
      ) q
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.sales_manager_operations_board(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_manager_operations_board(jsonb) TO authenticated;