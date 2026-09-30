ALTER TABLE public.rec_interviews
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  ADD COLUMN IF NOT EXISTS candidate_response text,
  ADD COLUMN IF NOT EXISTS candidate_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS candidate_response_note text,
  ADD COLUMN IF NOT EXISTS previous_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS conflict_override_reason text;

ALTER TABLE public.rec_interviews DROP CONSTRAINT IF EXISTS rec_interviews_status_check;
ALTER TABLE public.rec_interviews ADD CONSTRAINT rec_interviews_status_check
  CHECK (status = ANY (ARRAY['draft','scheduled','invited','confirmed','reschedule_requested','rescheduled','in_progress','completed','cancelled','no_show']));

ALTER TABLE public.rec_interviews DROP CONSTRAINT IF EXISTS rec_interviews_candidate_response_check;
ALTER TABLE public.rec_interviews ADD CONSTRAINT rec_interviews_candidate_response_check
  CHECK (candidate_response IS NULL OR candidate_response = ANY (ARRAY['confirmed','reschedule_requested','declined']));

CREATE INDEX IF NOT EXISTS rec_interviews_sched_idx ON public.rec_interviews (scheduled_at);
CREATE INDEX IF NOT EXISTS rec_interviews_app_idx ON public.rec_interviews (application_id);

-- ---------------------------------------------------------------- conflicts
CREATE OR REPLACE FUNCTION public.rec_interview_conflicts(
  p_interview_id uuid,
  p_application_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_panel uuid[]
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH win AS (
    SELECT p_scheduled_at AS s, p_scheduled_at + make_interval(mins => COALESCE(p_duration_minutes, 45)) AS e
  ),
  live AS (
    SELECT i.id, i.application_id, i.scheduled_at,
           i.scheduled_at + make_interval(mins => i.duration_minutes) AS ends_at
    FROM public.rec_interviews i, win w
    WHERE i.status NOT IN ('cancelled','completed','no_show')
      AND (p_interview_id IS NULL OR i.id <> p_interview_id)
      AND i.scheduled_at IS NOT NULL
      AND i.scheduled_at < w.e
      AND i.scheduled_at + make_interval(mins => i.duration_minutes) > w.s
  )
  SELECT jsonb_build_object(
    'candidate', COALESCE((SELECT jsonb_agg(l.id) FROM live l WHERE l.application_id = p_application_id), '[]'::jsonb),
    'panel', COALESCE((
      SELECT jsonb_agg(DISTINCT pnl.staff_id)
      FROM public.rec_interview_panel pnl
      JOIN live l ON l.id = pnl.interview_id
      WHERE pnl.staff_id = ANY (COALESCE(p_panel, ARRAY[]::uuid[]))
    ), '[]'::jsonb)
  );
$$;

-- ------------------------------------------------------- schedule with panel
CREATE OR REPLACE FUNCTION public.rec_schedule_interview_v2(
  p_application_id uuid,
  p_scheduled_at timestamptz,
  p_timezone text DEFAULT 'Africa/Nairobi',
  p_interview_stage text DEFAULT 'first',
  p_interview_type text DEFAULT 'competency',
  p_mode text DEFAULT 'virtual',
  p_duration_minutes integer DEFAULT 45,
  p_location text DEFAULT NULL,
  p_meeting_link text DEFAULT NULL,
  p_instructions text DEFAULT NULL,
  p_panel jsonb DEFAULT '[]'::jsonb,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_app record; v_id uuid; v_conf jsonb; v_panel uuid[]; v_member jsonb;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() THEN
    RAISE EXCEPTION 'interview must be scheduled in the future';
  END IF;
  IF COALESCE(p_duration_minutes, 45) NOT BETWEEN 10 AND 480 THEN
    RAISE EXCEPTION 'interview duration must be between 10 and 480 minutes';
  END IF;
  IF p_mode = 'virtual' AND COALESCE(p_meeting_link, '') = '' THEN
    RAISE EXCEPTION 'a virtual interview needs a meeting link';
  END IF;
  IF p_mode = 'onsite' AND COALESCE(p_location, '') = '' THEN
    RAISE EXCEPTION 'an onsite interview needs a location';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_app.status <> 'active' THEN RAISE EXCEPTION 'application is closed'; END IF;
  IF v_app.stage NOT IN ('shortlisted','interview','evaluation') THEN
    RAISE EXCEPTION 'candidate must be shortlisted before interview scheduling (stage %)', v_app.stage;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rec_vacancies v WHERE v.id = v_app.vacancy_id AND v.status = 'open'
  ) THEN
    RAISE EXCEPTION 'vacancy is not open — cannot schedule interviews against it';
  END IF;

  SELECT COALESCE(array_agg((e->>'staff_id')::uuid), ARRAY[]::uuid[]) INTO v_panel
  FROM jsonb_array_elements(COALESCE(p_panel, '[]'::jsonb)) e
  WHERE e ? 'staff_id' AND COALESCE(e->>'staff_id','') <> '';

  v_conf := public.rec_interview_conflicts(NULL, p_application_id, p_scheduled_at, p_duration_minutes, v_panel);
  IF (jsonb_array_length(v_conf->'candidate') > 0 OR jsonb_array_length(v_conf->'panel') > 0)
     AND COALESCE(p_override_reason, '') = '' THEN
    RAISE EXCEPTION 'scheduling_conflict: %', v_conf::text;
  END IF;

  INSERT INTO public.rec_interviews (
    application_id, vacancy_id, interview_stage, interview_type, mode, scheduled_at, timezone,
    duration_minutes, location, meeting_link, instructions, status, feedback_due_at, conflict_override_reason
  ) VALUES (
    p_application_id, v_app.vacancy_id, p_interview_stage, p_interview_type, p_mode, p_scheduled_at,
    COALESCE(NULLIF(p_timezone, ''), 'Africa/Nairobi'), COALESCE(p_duration_minutes, 45),
    p_location, p_meeting_link, p_instructions, 'scheduled',
    p_scheduled_at + interval '2 days', NULLIF(p_override_reason, '')
  ) RETURNING id INTO v_id;

  FOR v_member IN SELECT * FROM jsonb_array_elements(COALESCE(p_panel, '[]'::jsonb)) LOOP
    IF COALESCE(v_member->>'staff_id','') <> '' THEN
      INSERT INTO public.rec_interview_panel (interview_id, staff_id, panel_role)
      VALUES (v_id, (v_member->>'staff_id')::uuid, COALESCE(NULLIF(v_member->>'panel_role',''), 'interviewer'))
      ON CONFLICT (interview_id, staff_id) DO NOTHING;
    END IF;
  END LOOP;

  IF v_app.stage = 'shortlisted' THEN
    PERFORM public.rec_application_transition(p_application_id, 'interview', 'interview scheduled');
  END IF;

  PERFORM public.rec_enqueue_notification(
    p_application_id, 'interview:' || v_id::text, 'candidate_interview_invite', 'email',
    'Interview invitation — Yalla Mobility', NULL,
    jsonb_build_object('interview_id', v_id, 'scheduled_at', p_scheduled_at, 'timezone', p_timezone,
                       'mode', p_mode, 'meeting_link', p_meeting_link, 'location', p_location));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, context, source)
  VALUES (auth.uid(), 'interview.scheduled', 'rec_interview', v_id,
          jsonb_build_object('application_id', p_application_id, 'scheduled_at', p_scheduled_at,
                             'timezone', p_timezone, 'panel', to_jsonb(v_panel)),
          jsonb_build_object('conflicts', v_conf, 'override_reason', p_override_reason), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'interview_id', v_id, 'conflicts', v_conf);
END; $$;

-- ------------------------------------------------------- status state machine
CREATE OR REPLACE FUNCTION public.rec_interview_transition(
  p_interview_id uuid,
  p_next_status text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_iv public.rec_interviews; v_allowed text[];
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;
  SELECT * INTO v_iv FROM public.rec_interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL THEN RAISE EXCEPTION 'interview not found'; END IF;

  v_allowed := CASE v_iv.status
    WHEN 'draft'                THEN ARRAY['scheduled','cancelled']
    WHEN 'scheduled'            THEN ARRAY['invited','confirmed','reschedule_requested','rescheduled','in_progress','cancelled','no_show']
    WHEN 'invited'              THEN ARRAY['confirmed','reschedule_requested','rescheduled','in_progress','cancelled','no_show']
    WHEN 'confirmed'            THEN ARRAY['in_progress','reschedule_requested','rescheduled','cancelled','no_show']
    WHEN 'reschedule_requested' THEN ARRAY['rescheduled','cancelled']
    WHEN 'rescheduled'          THEN ARRAY['invited','confirmed','in_progress','cancelled','no_show']
    WHEN 'in_progress'          THEN ARRAY['completed','cancelled','no_show']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_next_status = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'invalid interview transition % -> %', v_iv.status, p_next_status;
  END IF;
  IF p_next_status IN ('cancelled','no_show') AND COALESCE(p_reason,'') = '' THEN
    RAISE EXCEPTION 'a reason is required to % an interview', p_next_status;
  END IF;

  UPDATE public.rec_interviews
     SET status = p_next_status,
         cancellation_reason = CASE WHEN p_next_status IN ('cancelled','no_show') THEN p_reason ELSE cancellation_reason END,
         updated_at = now()
   WHERE id = p_interview_id;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
  VALUES (auth.uid(), 'interview.status_changed', 'rec_interview', p_interview_id,
          jsonb_build_object('status', v_iv.status), jsonb_build_object('status', p_next_status),
          jsonb_build_object('reason', p_reason), 'recruitment_360');

  IF p_next_status = 'invited' THEN
    PERFORM public.rec_enqueue_notification(v_iv.application_id, 'interview_invite:' || p_interview_id::text,
      'candidate_interview_invite', 'email', 'Interview invitation — Yalla Mobility', NULL,
      jsonb_build_object('interview_id', p_interview_id, 'scheduled_at', v_iv.scheduled_at, 'timezone', v_iv.timezone));
  END IF;

  RETURN jsonb_build_object('ok', true, 'from', v_iv.status, 'to', p_next_status);
END; $$;

-- ------------------------------------------------------------- reschedule
CREATE OR REPLACE FUNCTION public.rec_interview_reschedule(
  p_interview_id uuid,
  p_scheduled_at timestamptz,
  p_reason text,
  p_timezone text DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_iv public.rec_interviews; v_conf jsonb; v_panel uuid[]; v_dur integer;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'a reason is required to reschedule'; END IF;
  SELECT * INTO v_iv FROM public.rec_interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL THEN RAISE EXCEPTION 'interview not found'; END IF;
  IF v_iv.status IN ('completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'a % interview cannot be rescheduled', v_iv.status;
  END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() THEN
    RAISE EXCEPTION 'interview must be rescheduled to a future time';
  END IF;

  v_dur := COALESCE(p_duration_minutes, v_iv.duration_minutes);
  SELECT COALESCE(array_agg(staff_id), ARRAY[]::uuid[]) INTO v_panel
  FROM public.rec_interview_panel WHERE interview_id = p_interview_id AND staff_id IS NOT NULL;

  v_conf := public.rec_interview_conflicts(p_interview_id, v_iv.application_id, p_scheduled_at, v_dur, v_panel);
  IF (jsonb_array_length(v_conf->'candidate') > 0 OR jsonb_array_length(v_conf->'panel') > 0)
     AND COALESCE(p_override_reason, '') = '' THEN
    RAISE EXCEPTION 'scheduling_conflict: %', v_conf::text;
  END IF;

  UPDATE public.rec_interviews
     SET previous_scheduled_at = scheduled_at,
         scheduled_at = p_scheduled_at,
         timezone = COALESCE(NULLIF(p_timezone,''), timezone),
         duration_minutes = v_dur,
         reschedule_count = reschedule_count + 1,
         status = 'rescheduled',
         candidate_response = NULL,
         candidate_responded_at = NULL,
         feedback_due_at = p_scheduled_at + interval '2 days',
         conflict_override_reason = COALESCE(NULLIF(p_override_reason,''), conflict_override_reason),
         updated_at = now()
   WHERE id = p_interview_id;

  PERFORM public.rec_enqueue_notification(v_iv.application_id, 'interview_reschedule:' || p_interview_id::text || ':' || (v_iv.reschedule_count + 1),
    'candidate_interview_invite', 'email', 'Your interview has been rescheduled — Yalla Mobility', NULL,
    jsonb_build_object('interview_id', p_interview_id, 'scheduled_at', p_scheduled_at, 'reason', p_reason));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
  VALUES (auth.uid(), 'interview.rescheduled', 'rec_interview', p_interview_id,
          jsonb_build_object('scheduled_at', v_iv.scheduled_at, 'status', v_iv.status),
          jsonb_build_object('scheduled_at', p_scheduled_at),
          jsonb_build_object('reason', p_reason, 'conflicts', v_conf, 'override_reason', p_override_reason), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'interview_id', p_interview_id, 'conflicts', v_conf);
END; $$;

-- --------------------------------------------------- candidate confirmation
CREATE OR REPLACE FUNCTION public.rec_interview_candidate_response(
  p_interview_id uuid,
  p_response text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_iv public.rec_interviews;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;
  IF p_response NOT IN ('confirmed','reschedule_requested','declined') THEN
    RAISE EXCEPTION 'invalid candidate response %', p_response;
  END IF;
  SELECT * INTO v_iv FROM public.rec_interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL THEN RAISE EXCEPTION 'interview not found'; END IF;
  IF v_iv.status NOT IN ('scheduled','invited','rescheduled','confirmed','reschedule_requested') THEN
    RAISE EXCEPTION 'candidate response cannot be recorded on a % interview', v_iv.status;
  END IF;

  UPDATE public.rec_interviews
     SET candidate_response = p_response,
         candidate_responded_at = now(),
         candidate_response_note = p_note,
         status = CASE p_response
                    WHEN 'confirmed' THEN 'confirmed'
                    WHEN 'reschedule_requested' THEN 'reschedule_requested'
                    ELSE 'cancelled' END,
         cancellation_reason = CASE WHEN p_response = 'declined'
                                    THEN COALESCE(p_note, 'candidate declined the interview')
                                    ELSE cancellation_reason END,
         updated_at = now()
   WHERE id = p_interview_id;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
  VALUES (auth.uid(), 'interview.candidate_response', 'rec_interview', p_interview_id,
          jsonb_build_object('status', v_iv.status), jsonb_build_object('response', p_response),
          jsonb_build_object('note', p_note), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'response', p_response);
END; $$;

-- ------------------------------------------------------------ panel updates
CREATE OR REPLACE FUNCTION public.rec_interview_set_panel(
  p_interview_id uuid,
  p_panel jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_member jsonb; v_iv public.rec_interviews; v_count integer := 0;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;
  SELECT * INTO v_iv FROM public.rec_interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL THEN RAISE EXCEPTION 'interview not found'; END IF;
  IF v_iv.status IN ('completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'the panel of a % interview is locked', v_iv.status;
  END IF;

  DELETE FROM public.rec_interview_panel
   WHERE interview_id = p_interview_id
     AND staff_id NOT IN (
       SELECT (e->>'staff_id')::uuid FROM jsonb_array_elements(COALESCE(p_panel,'[]'::jsonb)) e
       WHERE COALESCE(e->>'staff_id','') <> ''
     );

  FOR v_member IN SELECT * FROM jsonb_array_elements(COALESCE(p_panel, '[]'::jsonb)) LOOP
    IF COALESCE(v_member->>'staff_id','') <> '' THEN
      INSERT INTO public.rec_interview_panel (interview_id, staff_id, panel_role)
      VALUES (p_interview_id, (v_member->>'staff_id')::uuid, COALESCE(NULLIF(v_member->>'panel_role',''), 'interviewer'))
      ON CONFLICT (interview_id, staff_id)
      DO UPDATE SET panel_role = EXCLUDED.panel_role, updated_at = now();
      v_count := v_count + 1;
    END IF;
  END LOOP;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'interview.panel_set', 'rec_interview', p_interview_id, p_panel, 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'members', v_count);
END; $$;

GRANT EXECUTE ON FUNCTION public.rec_interview_conflicts(uuid, uuid, timestamptz, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_schedule_interview_v2(uuid, timestamptz, text, text, text, text, integer, text, text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_interview_transition(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_interview_reschedule(uuid, timestamptz, text, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_interview_candidate_response(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_interview_set_panel(uuid, jsonb) TO authenticated;