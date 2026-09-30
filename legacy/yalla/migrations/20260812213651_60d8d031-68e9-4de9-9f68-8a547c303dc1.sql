CREATE OR REPLACE FUNCTION public.ops_work_request_approval(_work_item_id uuid, _reason text)
 RETURNS staff_work_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w public.staff_work_items;
  actor_role text; actor_name text;
BEGIN
  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A justification is required to request approval'; END IF;
  IF w.ops_queue IS NOT NULL
     AND NOT public.ops_can_work_queue(auth.uid(), w.ops_queue)
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised to action work in the % queue', w.ops_queue;
  END IF;
  IF w.approval_state IN ('approved','declined') THEN
    RAISE EXCEPTION 'This work already carries an authority decision';
  END IF;

  SELECT ur.role::text INTO actor_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  SELECT s.full_name INTO actor_name FROM public.staff_members s WHERE s.user_id = auth.uid() LIMIT 1;

  UPDATE public.staff_work_items SET
    needs_approval = true,
    approval_state = 'requested',
    approval_requested_by = auth.uid(),
    approval_requested_at = now(),
    approval_reason = _reason,
    updated_at = now()
  WHERE id = _work_item_id
  RETURNING * INTO w;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, actor_role, actor_name, action,
    state_before, state_after, reason, entity_type, entity_id, metadata
  ) VALUES (
    _work_item_id, auth.uid(), actor_role, actor_name, 'approval_requested',
    w.lifecycle_state, w.lifecycle_state, _reason, w.entity_type, w.entity_id,
    jsonb_build_object('queue', w.ops_queue)
  );

  -- Alert every authorised decision owner for this queue (never the requester).
  INSERT INTO public.ops_propagation_outbox (
    work_item_id, audience, channel, subject, message,
    recipient_user_id, entity_type, entity_id, payload
  )
  SELECT
    _work_item_id, 'staff', c.channel,
    'Decision requested: ' || coalesce(w.title, 'Operational work'),
    coalesce(actor_name, 'A colleague') || ' needs a decision — ' || _reason,
    ur.user_id, w.entity_type, w.entity_id,
    jsonb_build_object(
      'queue', w.ops_queue,
      'priority', w.priority,
      'requested_by', auth.uid(),
      'requested_by_name', actor_name,
      'work_title', w.title,
      'reason', _reason
    )
  FROM public.user_roles ur
  CROSS JOIN (
    SELECT 'portal'::text AS channel
    UNION ALL
    SELECT 'email'::text WHERE w.priority IN ('high','critical')
  ) c
  WHERE ur.user_id <> auth.uid()
    AND (
      (w.ops_queue IS NOT NULL AND ur.role::text = ANY (public.ops_queue_roles(w.ops_queue)))
      OR ur.role::text IN ('super_admin','admin')
    );

  RETURN w;
END; $function$;