CREATE OR REPLACE FUNCTION public.sales_day_close(_staff uuid DEFAULT NULL, _materialise boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid; v_target uuid; v_allowed boolean := false;
  v_name text; v_pos text;
  v_day_start timestamptz; v_day_end timestamptz;
  v_month_start date;
  v_created int := 0; v_advanced int := 0; v_info int := 0; v_notes int := 0;
  v_won_today numeric := 0; v_won_today_n int := 0;
  v_clocks_done int := 0;
  v_figures jsonb; v_target_row jsonb;
  v_target_kes numeric; v_attain numeric;
  v_sla jsonb; v_open int := 0; v_appr int := 0; v_breach int := 0; v_esc int := 0;
  v_actions jsonb; v_moves jsonb; v_created_tasks int := 0; r record;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  v_target := coalesce(_staff, v_me);

  IF v_target = v_me THEN
    v_allowed := true;
  ELSIF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    v_allowed := true;
  ELSE
    WITH RECURSIVE line AS (
      SELECT id, 1 d FROM public.staff_members WHERE manager_staff_id = v_me
      UNION ALL SELECT c.id, l.d+1 FROM public.staff_members c JOIN line l ON c.manager_staff_id = l.id WHERE l.d < 8)
    SELECT EXISTS (SELECT 1 FROM line WHERE id = v_target) INTO v_allowed;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'NOT_IN_YOUR_REPORTING_LINE'; END IF;

  SELECT coalesce(sm.preferred_name, sm.full_name), p.title
    INTO v_name, v_pos
    FROM public.staff_members sm
    LEFT JOIN public.org_positions p ON p.id = sm.position_id
   WHERE sm.id = v_target;

  v_day_start := (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')) AT TIME ZONE 'Africa/Nairobi';
  v_day_end   := v_day_start + interval '1 day';
  v_month_start := date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi')::date;

  SELECT
    count(*) FILTER (WHERE e.action = 'CREATED'),
    count(*) FILTER (WHERE e.stage_to IS NOT NULL AND e.stage_from IS DISTINCT FROM e.stage_to),
    count(*) FILTER (WHERE e.action = 'INFORMATION_REQUESTED'),
    count(*) FILTER (WHERE e.action NOT IN ('CREATED','INFORMATION_REQUESTED') AND e.stage_to IS NULL)
  INTO v_created, v_advanced, v_info, v_notes
  FROM public.sales_lead_events e
  JOIN public.sales_leads l ON l.id = e.lead_id
  WHERE l.sales_staff_id = v_target AND NOT l.is_test
    AND e.created_at >= v_day_start AND e.created_at < v_day_end;

  SELECT count(*), coalesce(sum(estimated_value_kes),0)
    INTO v_won_today_n, v_won_today
    FROM public.sales_leads
   WHERE sales_staff_id = v_target AND NOT is_test AND stage = 'CLOSED_WON'
     AND closed_at >= v_day_start AND closed_at < v_day_end;

  SELECT count(*) INTO v_clocks_done
    FROM public.sales_sla_clocks
   WHERE staff_member_id = v_target AND NOT is_test
     AND completed_at >= v_day_start AND completed_at < v_day_end;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lead_ref', l.lead_ref, 'organisation', l.organisation_name,
           'action', e.action, 'stage_from', e.stage_from, 'stage_to', e.stage_to,
           'note', e.note, 'at', e.created_at) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_moves
    FROM public.sales_lead_events e
    JOIN public.sales_leads l ON l.id = e.lead_id
   WHERE l.sales_staff_id = v_target AND NOT l.is_test
     AND e.created_at >= v_day_start AND e.created_at < v_day_end;

  v_figures := public._sales_person_figures(v_target, v_month_start::timestamptz,
                 (v_month_start + interval '1 month')::timestamptz, false);
  v_target_row := public.sales_target_for(v_target, v_month_start);
  v_target_kes := nullif((v_target_row->>'target_kes')::numeric, 0);
  IF v_target_kes IS NOT NULL THEN
    v_attain := round((v_figures->>'revenue_won_kes')::numeric * 100 / v_target_kes, 1);
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE c.breached_at IS NULL AND c.due_at <= now() + make_interval(mins => greatest(1, round(c.sla_minutes * 0.25)::int))),
         count(*) FILTER (WHERE c.breached_at IS NOT NULL),
         count(*) FILTER (WHERE c.escalation_level > 0)
    INTO v_open, v_appr, v_breach, v_esc
    FROM public.sales_sla_clocks c
   WHERE c.staff_member_id = v_target AND NOT c.is_test AND c.completed_at IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'process', c.process, 'entity_ref', c.entity_ref, 'organisation', l.organisation_name,
           'due_at', c.due_at, 'breached', c.breached_at IS NOT NULL,
           'escalation_level', c.escalation_level,
           'minutes_remaining', round(EXTRACT(epoch FROM (c.due_at - now()))/60)::int
         ) ORDER BY c.due_at), '[]'::jsonb)
    INTO v_sla
    FROM public.sales_sla_clocks c
    LEFT JOIN public.sales_leads l ON l.id = c.entity_id AND c.entity_type = 'sales_lead'
   WHERE c.staff_member_id = v_target AND NOT c.is_test AND c.completed_at IS NULL;

  WITH open_leads AS (
    SELECT l.*,
           coalesce(l.estimated_value_kes,0) * public._sales_stage_probability(l.stage) AS weighted,
           (SELECT min(c.due_at) FROM public.sales_sla_clocks c
             WHERE c.entity_id = l.id AND c.entity_type='sales_lead' AND c.completed_at IS NULL) AS due_at,
           (SELECT bool_or(c.breached_at IS NOT NULL) FROM public.sales_sla_clocks c
             WHERE c.entity_id = l.id AND c.entity_type='sales_lead' AND c.completed_at IS NULL) AS breached,
           EXTRACT(day FROM now() - l.updated_at)::int AS idle_days
      FROM public.sales_leads l
     WHERE l.sales_staff_id = v_target AND NOT l.is_test
       AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
  ), ranked AS (
    SELECT o.*,
      CASE
        WHEN o.breached THEN 'Response time already breached — clear it first'
        WHEN o.due_at IS NOT NULL AND o.due_at <= now() + interval '4 hours' THEN 'Response due within four hours'
        WHEN coalesce(o.information_request,'') <> '' THEN 'Waiting on information you asked the customer for'
        WHEN o.stage IN ('QUOTED','ACCEPTED') AND o.weighted > 0 THEN 'Closest to a decision and carries value'
        WHEN o.idle_days >= 7 THEN 'No movement for ' || o.idle_days || ' days'
        WHEN o.stage = 'NEW' THEN 'New enquiry not yet qualified'
        ELSE 'Open in your pipeline'
      END AS why,
      (CASE WHEN o.breached THEN 1000 ELSE 0 END
       + CASE WHEN o.due_at IS NOT NULL AND o.due_at <= now() + interval '4 hours' THEN 600 ELSE 0 END
       + CASE WHEN o.stage IN ('QUOTED','ACCEPTED') THEN 250 ELSE 0 END
       + least(300, coalesce(o.weighted,0)/10000)
       + least(120, o.idle_days * 8)
       + CASE WHEN coalesce(o.information_request,'') <> '' THEN 80 ELSE 0 END) AS score
      FROM open_leads o
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', id, 'lead_ref', lead_ref, 'organisation', organisation_name,
           'stage', stage, 'value_kes', estimated_value_kes,
           'weighted_kes', round(weighted,0), 'why', why, 'due_at', due_at,
           'breached', coalesce(breached,false), 'idle_days', idle_days,
           'score', round(score)) ORDER BY rn), '[]'::jsonb)
    INTO v_actions
    FROM (
      SELECT *, row_number() OVER (
               ORDER BY score DESC,
                        due_at ASC NULLS LAST,
                        coalesce(weighted,0) DESC,
                        created_at ASC) AS rn
        FROM ranked
    ) t
   WHERE rn <= 10;

  IF _materialise THEN
    FOR r IN SELECT * FROM jsonb_array_elements(v_actions) WITH ORDINALITY AS x(a, n) WHERE x.n <= 3
    LOOP
      PERFORM public._sales_work_ensure(
        v_target, 'sales_next_best_action',
        'Next best action: ' || coalesce(r.a->>'organisation','a customer'),
        (r.a->>'why') || ' — ' || coalesce(r.a->>'lead_ref',''),
        'sales_leads', (r.a->>'lead_id')::uuid, r.a->>'lead_ref',
        CASE WHEN (r.a->>'breached')::boolean THEN 'high' ELSE 'medium' END,
        NULL);
      v_created_tasks := v_created_tasks + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'staff_id', v_target, 'staff_name', v_name, 'position', v_pos,
    'date', (now() AT TIME ZONE 'Africa/Nairobi')::date,
    'today', jsonb_build_object(
      'leads_created', v_created, 'stages_advanced', v_advanced,
      'information_requests', v_info, 'notes_recorded', v_notes,
      'clocks_completed', v_clocks_done,
      'won_count', v_won_today_n, 'revenue_won_kes', v_won_today,
      'movements', v_moves),
    'month', jsonb_build_object(
      'period_start', v_month_start,
      'target_kes', v_target_kes, 'target_source', v_target_row->>'source',
      'currency', v_target_row->>'currency',
      'attainment_pct', v_attain,
      'remaining_kes', CASE WHEN v_target_kes IS NOT NULL
        THEN greatest(0, v_target_kes - (v_figures->>'revenue_won_kes')::numeric) END,
      'figures', v_figures),
    'sla', jsonb_build_object('open', v_open, 'approaching', v_appr, 'breached', v_breach,
                              'escalated', v_esc, 'clocks', v_sla),
    'next_actions', v_actions,
    'tasks_placed', v_created_tasks
  );
END $function$;

REVOKE ALL ON FUNCTION public.sales_day_close(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_day_close(uuid, boolean) TO authenticated;