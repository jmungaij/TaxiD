CREATE OR REPLACE FUNCTION public.rec_hiring_approval(
  p_application_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL,
  p_reason_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_app record;
  v_a record;
  v_failed text;
  v_id uuid;
  v_stage_result jsonb := NULL;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'hiring approval requires hiring authority';
  END IF;
  IF p_decision NOT IN ('selected','not_selected') THEN
    RAISE EXCEPTION 'decision must be selected or not_selected';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_app.stage IN ('rejected','withdrawn') THEN
    RAISE EXCEPTION 'this application is already closed (%)', v_app.stage;
  END IF;

  SELECT * INTO v_a
    FROM public.rec_assessments
   WHERE application_id = p_application_id
     AND status <> 'draft'
     AND submitted_at IS NOT NULL
   ORDER BY submitted_at DESC
   LIMIT 1;

  IF p_decision = 'selected' THEN
    IF v_a.id IS NULL THEN
      RAISE EXCEPTION 'no submitted competency assessment on record — score the candidate against the published requirements first';
    END IF;
    IF coalesce(v_a.gates_passed, false) IS NOT TRUE THEN
      SELECT string_agg(g->>'label', ', ')
        INTO v_failed
        FROM jsonb_array_elements(coalesce(v_a.gate_status, '[]'::jsonb)) g
       WHERE (g->>'passed')::boolean IS NOT TRUE;
      RAISE EXCEPTION 'candidate is below the required minimum on: %',
        coalesce(v_failed, 'one or more required competencies');
    END IF;
    IF coalesce(v_a.recommendation, '') NOT IN ('advance','strong_advance') THEN
      RAISE EXCEPTION 'the assessor recommendation (%) does not support a job offer',
        coalesce(nullif(v_a.recommendation, ''), 'not recorded');
    END IF;
  ELSIF p_reason_code IS NULL THEN
    RAISE EXCEPTION 'a decline requires a reason code';
  END IF;

  INSERT INTO public.rec_selection_decisions (
    application_id, vacancy_id, candidate_id, decision, stage_at_decision,
    ai_recommendation, is_override, reason_code, reason_notes, evidence,
    decision_maker, decision_role
  ) VALUES (
    p_application_id, v_app.vacancy_id, v_app.candidate_id, p_decision, v_app.stage,
    v_a.recommendation,
    (p_decision = 'not_selected' AND coalesce(v_a.recommendation,'') IN ('advance','strong_advance')),
    p_reason_code, p_notes,
    jsonb_build_object(
      'basis', 'competency_assessment',
      'assessment_id', v_a.id,
      'total_score', v_a.total_score,
      'max_score', v_a.max_score,
      'percentage', v_a.percentage,
      'band', v_a.band,
      'gates_passed', v_a.gates_passed,
      'gate_status', v_a.gate_status,
      'recommendation', v_a.recommendation
    ),
    auth.uid(), 'hiring_authority'
  ) RETURNING id INTO v_id;

  IF p_decision = 'selected' AND v_app.stage = 'interview' THEN
    v_stage_result := public.rec_application_transition(p_application_id, 'offer', 'hiring approval');
  ELSIF p_decision = 'not_selected' AND v_app.stage IN ('applied','received','screening','shortlisted','evaluation','interview','offer') THEN
    v_stage_result := public.rec_application_transition(p_application_id, 'rejected', p_reason_code);
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'application.hiring_approval', 'rec_application', p_application_id,
          jsonb_build_object('stage', v_app.stage),
          jsonb_build_object('decision', p_decision, 'decision_id', v_id,
                             'assessment_id', v_a.id, 'stage_change', v_stage_result),
          'rec_hiring_approval');

  RETURN jsonb_build_object(
    'ok', true,
    'decision_id', v_id,
    'decision', p_decision,
    'assessment_id', v_a.id,
    'stage_change', v_stage_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rec_hiring_approval(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_hiring_approval(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_hiring_approval(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_hiring_approval(uuid, text, text, text) TO service_role;
