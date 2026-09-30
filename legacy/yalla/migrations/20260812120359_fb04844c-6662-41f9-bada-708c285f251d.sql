CREATE TABLE IF NOT EXISTS public.staff_focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  actor_user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  planned_minutes integer,
  actual_minutes integer,
  interrupted boolean NOT NULL DEFAULT false,
  outcome_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_work ON public.staff_focus_sessions(work_item_id);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_staff_day ON public.staff_focus_sessions(staff_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.staff_focus_sessions TO authenticated;
GRANT ALL ON public.staff_focus_sessions TO service_role;

ALTER TABLE public.staff_focus_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read focus sessions" ON public.staff_focus_sessions
  FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id) OR public.is_platform_admin());

CREATE POLICY "own focus sessions insert" ON public.staff_focus_sessions
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid() AND (public.is_my_staff_record(staff_id) OR staff_id IS NULL));

CREATE POLICY "own focus sessions update" ON public.staff_focus_sessions
  FOR UPDATE TO authenticated
  USING (actor_user_id = auth.uid())
  WITH CHECK (actor_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.focus_session_start(_work_item_id uuid, _planned_minutes integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid;
  v_session uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.staff_focus_sessions (work_item_id, staff_id, actor_user_id, planned_minutes)
  VALUES (_work_item_id, v_staff, auth.uid(), _planned_minutes)
  RETURNING id INTO v_session;

  UPDATE public.staff_work_items
     SET started_at = COALESCE(started_at, now()),
         lifecycle_state = CASE WHEN lifecycle_state IN ('new','assigned') THEN 'in_progress' ELSE lifecycle_state END,
         status = CASE WHEN status IN ('open','new','assigned') THEN 'in_progress' ELSE status END,
         updated_at = now()
   WHERE id = _work_item_id;

  INSERT INTO public.ops_work_audit (work_item_id, actor_role, action, reason, metadata)
  VALUES (_work_item_id, 'staff', 'focus_started', 'Focus mode entered', jsonb_build_object('session_id', v_session, 'planned_minutes', _planned_minutes));

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.focus_session_end(
  _session_id uuid,
  _outcome_note text DEFAULT NULL,
  _completed boolean DEFAULT false,
  _interrupted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work uuid;
  v_actual integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  UPDATE public.staff_focus_sessions
     SET ended_at = now(),
         actual_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (now() - started_at)) / 60.0))::int,
         outcome_note = _outcome_note,
         interrupted = _interrupted
   WHERE id = _session_id
     AND actor_user_id = auth.uid()
     AND ended_at IS NULL
  RETURNING work_item_id, actual_minutes INTO v_work, v_actual;

  IF v_work IS NULL THEN
    RAISE EXCEPTION 'no open focus session for this user';
  END IF;

  IF _completed THEN
    UPDATE public.staff_work_items
       SET lifecycle_state = 'done',
           status = 'done',
           completed_at = COALESCE(completed_at, now()),
           closed_at = COALESCE(closed_at, now()),
           resolution_notes = COALESCE(_outcome_note, resolution_notes),
           updated_at = now()
     WHERE id = v_work;
  END IF;

  INSERT INTO public.ops_work_audit (work_item_id, actor_role, action, reason, metadata)
  VALUES (v_work, 'staff', 'focus_ended', COALESCE(_outcome_note, 'Focus mode exited'),
          jsonb_build_object('session_id', _session_id, 'actual_minutes', v_actual, 'completed', _completed, 'interrupted', _interrupted));

  RETURN jsonb_build_object('work_item_id', v_work, 'actual_minutes', v_actual, 'completed', _completed);
END;
$$;

REVOKE ALL ON FUNCTION public.focus_session_start(uuid, integer) FROM public;
REVOKE ALL ON FUNCTION public.focus_session_end(uuid, text, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.focus_session_start(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.focus_session_end(uuid, text, boolean, boolean) TO authenticated;

UPDATE public.crm_customer_commitments
   SET work_item_id = '398bc8f1-22c9-4741-8da0-a9813f394096'
 WHERE account_id = 'be1755ae-6372-43d3-a3d0-ec2c1c7fad0f'
   AND work_item_id IS NULL;

UPDATE public.crm_customer_commitments
   SET due_at = (now() + interval '1 day')
 WHERE account_id = 'be1755ae-6372-43d3-a3d0-ec2c1c7fad0f'
   AND status IN ('open','in_progress')
   AND due_at IS NULL;