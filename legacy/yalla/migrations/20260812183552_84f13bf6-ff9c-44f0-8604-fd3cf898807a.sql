-- Carry-forward RPC: records that unfinished work is deliberately carried into tomorrow
CREATE OR REPLACE FUNCTION public.ops_work_carry_forward(_work_item_id uuid, _reason text DEFAULT NULL)
RETURNS public.staff_work_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  w public.staff_work_items;
  actor_role text;
  actor_name text;
  target date := (now() + interval '1 day')::date;
BEGIN
  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found'; END IF;

  IF w.ops_queue IS NOT NULL
     AND NOT public.ops_can_work_queue(auth.uid(), w.ops_queue)
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised to action work in the % queue', w.ops_queue;
  END IF;

  IF w.lifecycle_state IN ('resolved','closed') THEN
    RAISE EXCEPTION 'Completed work cannot be carried forward';
  END IF;

  SELECT ur.role::text INTO actor_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  SELECT s.full_name INTO actor_name FROM public.staff_members s WHERE s.user_id = auth.uid() LIMIT 1;

  UPDATE public.staff_work_items
     SET next_action_due = target,
         next_action = coalesce(nullif(btrim(_reason), ''), next_action, required_action),
         updated_at = now()
   WHERE id = _work_item_id
  RETURNING * INTO w;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, actor_role, actor_name, action,
    state_before, state_after, reason, entity_type, entity_id, metadata
  ) VALUES (
    _work_item_id, auth.uid(), actor_role, actor_name, 'work_carried_forward',
    w.lifecycle_state, w.lifecycle_state, _reason, w.entity_type, w.entity_id,
    jsonb_build_object('next_action_due', target, 'queue', w.ops_queue)
  );

  RETURN w;
END; $$;

GRANT EXECUTE ON FUNCTION public.ops_work_carry_forward(uuid, text) TO authenticated;

-- Realtime for the cockpit's canonical sources
ALTER TABLE public.staff_work_items REPLICA IDENTITY FULL;
ALTER TABLE public.crm_customer_commitments REPLICA IDENTITY FULL;
ALTER TABLE public.crm_next_actions REPLICA IDENTITY FULL;
ALTER TABLE public.staff_focus_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_work_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_customer_commitments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_next_actions; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_focus_sessions; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;