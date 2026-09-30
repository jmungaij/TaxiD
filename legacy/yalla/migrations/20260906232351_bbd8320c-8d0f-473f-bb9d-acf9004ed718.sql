CREATE OR REPLACE FUNCTION public.staff_personal_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_staff  uuid;
  v_tiles  jsonb := '[]'::jsonb;
  v_series jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_tasks  jsonb := '[]'::jsonb;
  v_pipeline numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = v_uid LIMIT 1;
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'STAFF_IDENTITY_REQUIRED';
  END IF;

  SELECT coalesce(sum(l.estimated_value_kes), 0) INTO v_pipeline
  FROM public.sales_leads l
  WHERE l.sales_staff_id = v_staff
    AND coalesce(l.stage::text, 'new') NOT IN ('lost', 'closed_lost', 'won', 'closed_won');

  SELECT jsonb_build_array(
    jsonb_build_object('key','my_open','label','My open work','value',
      (SELECT count(*) FROM public.staff_work_items w
        WHERE w.staff_id = v_staff AND w.completed_at IS NULL
          AND coalesce(w.status,'open') NOT IN ('completed','closed','cancelled')),
      'unit','items'),
    jsonb_build_object('key','my_overdue','label','Past due','value',
      (SELECT count(*) FROM public.staff_work_items w
        WHERE w.staff_id = v_staff AND w.completed_at IS NULL
          AND w.next_action_due IS NOT NULL AND w.next_action_due < now()),
      'unit','items','tone','critical'),
    jsonb_build_object('key','my_done','label','Completed (30 days)','value',
      (SELECT count(*) FROM public.staff_work_items w
        WHERE w.staff_id = v_staff AND w.completed_at > now() - interval '30 days'),
      'unit','items','tone','positive'),
    jsonb_build_object('key','my_pipeline','label','My open pipeline','value',
      round(v_pipeline)::numeric,'unit','KES')
  ) INTO v_tiles;

  SELECT coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'value', (
    SELECT count(*) FROM public.staff_work_items w
     WHERE w.staff_id = v_staff AND w.created_at::date = d::date)) ORDER BY d), '[]'::jsonb)
  INTO v_series
  FROM generate_series(current_date - 13, current_date, interval '1 day') d;

  SELECT coalesce(jsonb_agg(a ORDER BY a->>'at'), '[]'::jsonb) INTO v_alerts
  FROM (
    SELECT jsonb_build_object(
             'id', w.id,
             'severity', CASE WHEN w.next_action_due < now() - interval '3 days' THEN 'critical' ELSE 'warning' END,
             'title', coalesce(w.title,'Work item past due'),
             'detail', w.next_action,
             'at', w.next_action_due) AS a
    FROM public.staff_work_items w
    WHERE w.staff_id = v_staff
      AND w.completed_at IS NULL
      AND w.next_action_due IS NOT NULL
      AND w.next_action_due < now()
    ORDER BY w.next_action_due
    LIMIT 8
  ) s;

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

  RETURN jsonb_build_object(
    'lens','personal',
    'generated_at', now(),
    'staff_id', v_staff,
    'tiles', v_tiles,
    'series', v_series,
    'alerts', v_alerts,
    'my_tasks', v_tasks
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_personal_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_personal_snapshot() FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_personal_snapshot() TO authenticated;