CREATE OR REPLACE FUNCTION public.rec_role_assessment_session_open(
  p_application_id uuid,
  p_basis text DEFAULT NULL,
  p_held_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_app public.rec_applications;
  v_interview uuid;
  v_assessment uuid;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;
  IF COALESCE(btrim(p_basis), '') = '' THEN
    RAISE EXCEPTION 'a basis for the assessment session is required';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  -- Reuse this assessor's existing session for the application if one exists.
  SELECT a.id, a.interview_id INTO v_assessment, v_interview
    FROM public.rec_assessments a
   WHERE a.application_id = p_application_id AND a.assessor_user_id = auth.uid()
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_assessment IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'interview_id', v_interview, 'assessment_id', v_assessment, 'reused', true);
  END IF;

  SELECT i.id INTO v_interview
    FROM public.rec_interviews i
   WHERE i.application_id = p_application_id
     AND i.interview_type = 'competency'
     AND i.status NOT IN ('cancelled','no_show')
   ORDER BY i.created_at DESC LIMIT 1;

  IF v_interview IS NULL THEN
    INSERT INTO public.rec_interviews (
      application_id, vacancy_id, interview_stage, interview_type, mode,
      scheduled_at, timezone, duration_minutes, location, instructions, status)
    VALUES (
      p_application_id, v_app.vacancy_id, 'evaluation', 'competency', 'onsite',
      COALESCE(p_held_at, now()), 'Africa/Nairobi', 45, 'Yalla Mobility office',
      btrim(p_basis), 'completed')
    RETURNING id INTO v_interview;

    INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, context, source)
    VALUES (auth.uid(), 'ROLE_ASSESSMENT_SESSION_OPENED', 'rec_interview', v_interview,
            jsonb_build_object('application_id', p_application_id, 'status', 'completed'),
            jsonb_build_object('basis', btrim(p_basis), 'invitation_sent', false), 'recruitment_360');
  END IF;

  v_assessment := public.rec_assessment_open(v_interview, NULL);

  RETURN jsonb_build_object('ok', true, 'interview_id', v_interview, 'assessment_id', v_assessment, 'reused', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.rec_role_assessment_session_open(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_role_assessment_session_open(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_role_assessment_session_open(uuid, text, timestamptz) TO service_role;