CREATE OR REPLACE FUNCTION public._sales_work_ensure(
  _staff uuid, _kind text, _title text, _description text,
  _source_table text, _source_id uuid, _entity_ref text,
  _priority text, _sla_minutes int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF _staff IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.staff_work_items
   WHERE source_table = _source_table AND source_id = _source_id
     AND work_kind = _kind AND staff_id = _staff
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.staff_work_items
       SET title = _title, description = _description, entity_ref = coalesce(_entity_ref, entity_ref),
           priority = coalesce(_priority, priority),
           status = CASE WHEN status IN ('done','cancelled') THEN 'open' ELSE status END,
           lifecycle_state = CASE WHEN lifecycle_state IN ('resolved','closed') THEN 'assigned' ELSE lifecycle_state END,
           closed_at = NULL, resolution = NULL,
           sla_minutes = coalesce(_sla_minutes, sla_minutes),
           sla_due_at = CASE WHEN _sla_minutes IS NOT NULL THEN now() + make_interval(mins => _sla_minutes) ELSE sla_due_at END,
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.staff_work_items
    (staff_id, work_kind, title, description, source_table, source_id, entity_type, entity_id,
     entity_ref, priority, status, lifecycle_state, ops_queue, sla_started_at, sla_minutes,
     sla_due_at, next_action_due)
  VALUES (_staff, _kind, _title, _description, _source_table, _source_id, 'sales_lead', _source_id,
     _entity_ref, coalesce(_priority,'medium'), 'open', 'assigned', 'commercial', now(), _sla_minutes,
     CASE WHEN _sla_minutes IS NOT NULL THEN now() + make_interval(mins => _sla_minutes) END,
     CASE WHEN _sla_minutes IS NOT NULL THEN (now() + make_interval(mins => _sla_minutes))::date END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public._sales_work_ensure(uuid,text,text,text,text,uuid,text,text,int) FROM PUBLIC, anon, authenticated;
