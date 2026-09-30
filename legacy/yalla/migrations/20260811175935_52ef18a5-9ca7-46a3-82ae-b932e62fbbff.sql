CREATE OR REPLACE FUNCTION public.ops_ingest_event(
  _event_type   text,
  _source_portal text,
  _chain_stage  text,
  _entity_type  text,
  _entity_id    uuid,
  _disposition  text,
  _priority     text,
  _sla_minutes  integer,
  _dedupe_key   text,
  _title        text,
  _required_action text DEFAULT NULL,
  _ops_queue    text DEFAULT NULL,
  _work_kind    text DEFAULT NULL,
  _needs_approval boolean DEFAULT false,
  _escalate     boolean DEFAULT false,
  _service_line text DEFAULT NULL,
  _entity_ref   text DEFAULT NULL,
  _signals      jsonb DEFAULT '{}'::jsonb,
  _payload      jsonb DEFAULT '{}'::jsonb,
  _reasons      text[] DEFAULT ARRAY[]::text[],
  _occurred_at  timestamptz DEFAULT now(),
  _seed_batch   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev public.ops_events;
  wi public.staff_work_items;
  existing_event uuid;
  creates_work boolean;
  start_at timestamptz;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
          OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorised to record platform events';
  END IF;

  SELECT id INTO existing_event FROM public.ops_events WHERE dedupe_key = _dedupe_key;
  IF existing_event IS NOT NULL THEN
    SELECT * INTO wi FROM public.staff_work_items WHERE source_event_id = existing_event LIMIT 1;
    RETURN jsonb_build_object('event_id', existing_event, 'work_item_id', wi.id, 'idempotent_replay', true);
  END IF;

  INSERT INTO public.ops_events (
    event_type, source_portal, service_line, chain_stage, entity_type, entity_id, entity_ref,
    occurred_at, signals, payload, disposition, ops_queue, priority, sla_minutes, decision_reasons, dedupe_key
  ) VALUES (
    _event_type, _source_portal, _service_line, _chain_stage, _entity_type, _entity_id, _entity_ref,
    _occurred_at, coalesce(_signals,'{}'::jsonb), coalesce(_payload,'{}'::jsonb), _disposition, _ops_queue,
    _priority, _sla_minutes, coalesce(_reasons, ARRAY[]::text[]), _dedupe_key
  ) RETURNING * INTO ev;

  creates_work := _disposition IN ('staff_work','approval','escalate') AND _ops_queue IS NOT NULL;

  IF creates_work THEN
    start_at := _occurred_at;
    INSERT INTO public.staff_work_items (
      work_kind, title, description, source_table, source_id, priority, status,
      source_event_id, ops_queue, entity_type, entity_id, entity_ref, service_line,
      lifecycle_state, required_action, needs_approval, escalation_level,
      sla_started_at, sla_minutes, sla_due_at, next_action, seed_batch
    ) VALUES (
      coalesce(_work_kind,'operations_task'), _title,
      array_to_string(coalesce(_reasons, ARRAY[]::text[]), E'\n'),
      'ops_events', ev.id, _priority, CASE WHEN _escalate THEN 'blocked' ELSE 'todo' END,
      ev.id, _ops_queue, _entity_type, _entity_id, _entity_ref, _service_line,
      CASE WHEN _escalate THEN 'escalated' ELSE 'new' END,
      _required_action, _needs_approval, CASE WHEN _escalate THEN 1 ELSE 0 END,
      start_at, _sla_minutes, start_at + (_sla_minutes * interval '1 minute'),
      _required_action, _seed_batch
    ) RETURNING * INTO wi;

    INSERT INTO public.ops_work_audit (
      work_item_id, actor_user_id, actor_role, action, state_before, state_after,
      reason, entity_type, entity_id, metadata
    ) VALUES (
      wi.id, auth.uid(), 'system', 'work_created_from_event', NULL, wi.lifecycle_state,
      array_to_string(coalesce(_reasons, ARRAY[]::text[]), '; '), _entity_type, _entity_id,
      jsonb_build_object('event_type', _event_type, 'source_portal', _source_portal,
                         'queue', _ops_queue, 'disposition', _disposition, 'sla_minutes', _sla_minutes)
    );
  END IF;

  RETURN jsonb_build_object(
    'event_id', ev.id,
    'work_item_id', wi.id,
    'disposition', _disposition,
    'queue', _ops_queue,
    'idempotent_replay', false
  );
END; $$;

REVOKE ALL ON FUNCTION public.ops_ingest_event(text,text,text,text,uuid,text,text,integer,text,text,text,text,text,boolean,boolean,text,text,jsonb,jsonb,text[],timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ops_ingest_event(text,text,text,text,uuid,text,text,integer,text,text,text,text,text,boolean,boolean,text,text,jsonb,jsonb,text[],timestamptz,text) TO authenticated, service_role;