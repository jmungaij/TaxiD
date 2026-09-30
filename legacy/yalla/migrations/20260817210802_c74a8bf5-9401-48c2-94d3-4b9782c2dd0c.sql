-- ============ band helper ============
CREATE OR REPLACE FUNCTION public.rec_assessment_band(p_score numeric, p_max numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_max IS NULL OR p_max = 0 OR p_score IS NULL THEN 'unassessed'
    WHEN p_score / p_max >= 0.90 THEN 'exceptional'
    WHEN p_score / p_max >= 0.80 THEN 'strong'
    WHEN p_score / p_max >= 0.70 THEN 'competent'
    WHEN p_score / p_max >= 0.60 THEN 'borderline'
    ELSE 'not_recommended' END;
$$;

-- ============ template resolution ============
CREATE OR REPLACE FUNCTION public.rec_assessment_template_resolve(p_vacancy_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title text; v_id uuid;
BEGIN
  SELECT lower(title) INTO v_title FROM public.rec_vacancies WHERE id = p_vacancy_id;

  SELECT id INTO v_id FROM public.rec_assessment_templates
   WHERE vacancy_id = p_vacancy_id AND status IN ('active','pilot')
   ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT id INTO v_id FROM public.rec_assessment_templates
   WHERE vacancy_id IS NULL AND status IN ('active','pilot')
     AND role_family <> 'general' AND v_title LIKE '%' || role_family || '%'
   ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, version DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT id INTO v_id FROM public.rec_assessment_templates
   WHERE vacancy_id IS NULL AND role_family = 'general' AND status IN ('active','pilot')
   ORDER BY version DESC LIMIT 1;
  RETURN v_id;
END;
$$;

-- ============ open a draft assessment ============
CREATE OR REPLACE FUNCTION public.rec_assessment_open(p_interview_id uuid, p_template_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_iv public.rec_interviews; v_tpl public.rec_assessment_templates;
  v_candidate uuid; v_assessment uuid; v_staff uuid; v_name text; v_max numeric;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not_authorized: recruitment write access required';
  END IF;

  SELECT * INTO v_iv FROM public.rec_interviews WHERE id = p_interview_id;
  IF v_iv.id IS NULL THEN RAISE EXCEPTION 'interview not found'; END IF;
  IF v_iv.status IN ('cancelled','no_show') THEN
    RAISE EXCEPTION 'assessment unavailable: interview is %', v_iv.status;
  END IF;

  SELECT id INTO v_assessment FROM public.rec_assessments
   WHERE interview_id = p_interview_id AND assessor_user_id = auth.uid();
  IF v_assessment IS NOT NULL THEN RETURN v_assessment; END IF;

  SELECT a.candidate_id INTO v_candidate FROM public.rec_applications a WHERE a.id = v_iv.application_id;

  SELECT * INTO v_tpl FROM public.rec_assessment_templates
   WHERE id = COALESCE(p_template_id, public.rec_assessment_template_resolve(v_iv.vacancy_id));
  IF v_tpl.id IS NULL THEN
    RAISE EXCEPTION 'no_assessment_template: configure an assessment template for this vacancy first';
  END IF;
  IF v_tpl.status = 'retired' THEN RAISE EXCEPTION 'assessment template is retired'; END IF;

  SELECT id, full_name INTO v_staff, v_name FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  SELECT COALESCE(sum(i.max_marks), 0) INTO v_max
    FROM public.rec_assessment_template_items i WHERE i.template_id = v_tpl.id;

  PERFORM set_config('rec.assessment_engine', 'on', true);

  INSERT INTO public.rec_assessments (
    interview_id, application_id, vacancy_id, candidate_id, template_id,
    template_key, template_version, assessor_user_id, assessor_staff_id, assessor_name,
    status, max_score)
  VALUES (p_interview_id, v_iv.application_id, v_iv.vacancy_id, v_candidate, v_tpl.id,
    v_tpl.template_key, v_tpl.version, auth.uid(), v_staff, v_name, 'draft', v_max)
  RETURNING id INTO v_assessment;

  INSERT INTO public.rec_assessment_answers (
    assessment_id, question_id, question_key, question_version, question_snapshot,
    competency_code, competency_label, max_marks, critical_min, mandatory, sort_order)
  SELECT v_assessment, q.id, q.question_key, q.version,
         jsonb_build_object(
           'prompt', q.prompt, 'scenario', q.scenario, 'question_type', q.question_type,
           'probes', q.probes, 'good_indicators', q.good_indicators,
           'weak_indicators', q.weak_indicators, 'scoring_anchors', q.scoring_anchors,
           'expected_evidence', q.expected_evidence, 'max_marks', i.max_marks,
           'critical_min', i.critical_min),
         q.competency_code, q.competency_label, i.max_marks, i.critical_min, i.mandatory, i.sort_order
    FROM public.rec_assessment_template_items i
    JOIN public.rec_question_bank q ON q.id = i.question_id
   WHERE i.template_id = v_tpl.id;

  PERFORM set_config('rec.assessment_engine', 'off', true);

  IF v_iv.status IN ('scheduled','invited','confirmed','rescheduled') THEN
    UPDATE public.rec_interviews SET status = 'in_progress' WHERE id = p_interview_id;
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, actor_staff_id, new_state, context)
  VALUES ('ASSESSMENT_OPENED', 'rec_assessment', v_assessment, v_staff,
          jsonb_build_object('status','draft','template', v_tpl.template_key, 'version', v_tpl.version),
          jsonb_build_object('interview_id', p_interview_id, 'application_id', v_iv.application_id));

  RETURN v_assessment;
END;
$$;

-- ============ save one answer ============
CREATE OR REPLACE FUNCTION public.rec_assessment_save_answer(
  p_answer_id uuid,
  p_answer text DEFAULT NULL,
  p_evidence text DEFAULT NULL,
  p_verification text DEFAULT NULL,
  p_confidence text DEFAULT NULL,
  p_score numeric DEFAULT NULL,
  p_rationale text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ans public.rec_assessment_answers; v_as public.rec_assessments;
BEGIN
  SELECT * INTO v_ans FROM public.rec_assessment_answers WHERE id = p_answer_id;
  IF v_ans.id IS NULL THEN RAISE EXCEPTION 'answer not found'; END IF;
  SELECT * INTO v_as FROM public.rec_assessments WHERE id = v_ans.assessment_id;

  IF v_as.assessor_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_authorized: only the assigned assessor may score this assessment';
  END IF;
  IF v_as.status <> 'draft' THEN
    RAISE EXCEPTION 'assessment_locked: submitted assessments require a recorded amendment';
  END IF;
  IF p_score IS NOT NULL AND (p_score < 0 OR p_score > v_ans.max_marks) THEN
    RAISE EXCEPTION 'score_out_of_range: % must be between 0 and %', p_score, v_ans.max_marks;
  END IF;

  PERFORM set_config('rec.assessment_engine', 'on', true);
  UPDATE public.rec_assessment_answers SET
    answer_text = COALESCE(p_answer, answer_text),
    evidence_text = COALESCE(p_evidence, evidence_text),
    verification_status = COALESCE(p_verification, verification_status),
    evidence_confidence = COALESCE(p_confidence, evidence_confidence),
    score = COALESCE(p_score, score),
    rationale = COALESCE(p_rationale, rationale),
    updated_at = now()
  WHERE id = p_answer_id;
  PERFORM set_config('rec.assessment_engine', 'off', true);

  RETURN jsonb_build_object('ok', true, 'answer_id', p_answer_id);
END;
$$;

-- ============ submit + lock ============
CREATE OR REPLACE FUNCTION public.rec_assessment_submit(
  p_assessment_id uuid,
  p_recommendation text,
  p_strengths text DEFAULT NULL,
  p_concerns text DEFAULT NULL,
  p_risks text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_as public.rec_assessments; v_missing int; v_total numeric; v_max numeric;
  v_gates jsonb; v_passed boolean; v_band text; v_criteria jsonb; v_eval uuid;
BEGIN
  SELECT * INTO v_as FROM public.rec_assessments WHERE id = p_assessment_id;
  IF v_as.id IS NULL THEN RAISE EXCEPTION 'assessment not found'; END IF;
  IF v_as.assessor_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_authorized: only the assigned assessor may submit this assessment';
  END IF;
  IF v_as.status <> 'draft' THEN RAISE EXCEPTION 'assessment already submitted'; END IF;
  IF p_recommendation NOT IN ('strong_advance','advance','hold','reject','strong_reject') THEN
    RAISE EXCEPTION 'invalid recommendation';
  END IF;

  SELECT count(*) INTO v_missing FROM public.rec_assessment_answers
   WHERE assessment_id = p_assessment_id AND mandatory
     AND (score IS NULL OR coalesce(btrim(evidence_text), '') = '');
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'incomplete_assessment: % required question(s) still need a score and evidence', v_missing;
  END IF;

  SELECT COALESCE(sum(score), 0), COALESCE(sum(max_marks), 0)
    INTO v_total, v_max FROM public.rec_assessment_answers WHERE assessment_id = p_assessment_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'competency', competency_code, 'label', competency_label,
           'score', score, 'minimum', critical_min, 'max_marks', max_marks,
           'passed', COALESCE(score, 0) >= critical_min) ORDER BY sort_order), '[]'::jsonb)
    INTO v_gates FROM public.rec_assessment_answers
   WHERE assessment_id = p_assessment_id AND critical_min IS NOT NULL;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.rec_assessment_answers
     WHERE assessment_id = p_assessment_id AND critical_min IS NOT NULL
       AND COALESCE(score, 0) < critical_min) INTO v_passed;

  v_band := public.rec_assessment_band(v_total, v_max);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', competency_code, 'label', competency_label, 'score', score,
           'max', max_marks, 'verification', verification_status,
           'confidence', evidence_confidence) ORDER BY sort_order), '[]'::jsonb)
    INTO v_criteria FROM public.rec_assessment_answers WHERE assessment_id = p_assessment_id;

  PERFORM set_config('rec.assessment_engine', 'on', true);
  UPDATE public.rec_assessments SET
    status = 'submitted', total_score = v_total, max_score = v_max,
    percentage = CASE WHEN v_max > 0 THEN round(v_total / v_max * 100, 1) ELSE NULL END,
    band = v_band, gate_status = v_gates, gates_passed = v_passed,
    recommendation = p_recommendation, strengths = p_strengths,
    concerns = p_concerns, risks = p_risks, submitted_at = now()
  WHERE id = p_assessment_id;
  PERFORM set_config('rec.assessment_engine', 'off', true);

  -- mirror into the canonical interview evaluation record used by panel review
  SELECT id INTO v_eval FROM public.rec_evaluations
   WHERE interview_id = v_as.interview_id
     AND (evaluator_staff_id IS NOT DISTINCT FROM v_as.assessor_staff_id);
  IF v_eval IS NULL THEN
    INSERT INTO public.rec_evaluations (interview_id, application_id, evaluator_staff_id,
      criteria_scores, overall_score, recommendation, strengths, concerns, evidence, status, submitted_at)
    VALUES (v_as.interview_id, v_as.application_id, v_as.assessor_staff_id,
      v_criteria, v_total, p_recommendation, p_strengths, p_concerns,
      'assessment:' || p_assessment_id::text, 'submitted', now());
  ELSE
    UPDATE public.rec_evaluations SET criteria_scores = v_criteria, overall_score = v_total,
      recommendation = p_recommendation, strengths = p_strengths, concerns = p_concerns,
      evidence = 'assessment:' || p_assessment_id::text, status = 'submitted', submitted_at = now()
     WHERE id = v_eval;
  END IF;

  IF EXISTS (SELECT 1 FROM public.rec_interviews WHERE id = v_as.interview_id AND status = 'in_progress') THEN
    UPDATE public.rec_interviews SET status = 'completed' WHERE id = v_as.interview_id;
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, actor_staff_id, previous_state, new_state, context)
  VALUES ('ASSESSMENT_SUBMITTED', 'rec_assessment', p_assessment_id, v_as.assessor_staff_id,
          jsonb_build_object('status','draft'),
          jsonb_build_object('status','submitted','total', v_total, 'max', v_max,
                             'band', v_band, 'gates_passed', v_passed, 'recommendation', p_recommendation),
          jsonb_build_object('application_id', v_as.application_id, 'interview_id', v_as.interview_id));

  RETURN jsonb_build_object('ok', true, 'total_score', v_total, 'max_score', v_max,
    'band', v_band, 'gates_passed', v_passed, 'gate_status', v_gates);
END;
$$;

-- ============ controlled amendment ============
CREATE OR REPLACE FUNCTION public.rec_assessment_amend(
  p_answer_id uuid, p_reason text,
  p_score numeric DEFAULT NULL, p_answer text DEFAULT NULL,
  p_evidence text DEFAULT NULL, p_verification text DEFAULT NULL,
  p_confidence text DEFAULT NULL, p_rationale text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ans public.rec_assessment_answers; v_as public.rec_assessments; v_total numeric; v_max numeric; v_gates jsonb; v_passed boolean;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'not_authorized: only a hiring authority may amend a locked assessment';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'a reason is required for an amendment'; END IF;

  SELECT * INTO v_ans FROM public.rec_assessment_answers WHERE id = p_answer_id;
  IF v_ans.id IS NULL THEN RAISE EXCEPTION 'answer not found'; END IF;
  SELECT * INTO v_as FROM public.rec_assessments WHERE id = v_ans.assessment_id;
  IF v_as.status = 'draft' THEN RAISE EXCEPTION 'assessment is still a draft; edit it directly'; END IF;
  IF p_score IS NOT NULL AND (p_score < 0 OR p_score > v_ans.max_marks) THEN
    RAISE EXCEPTION 'score_out_of_range: % must be between 0 and %', p_score, v_ans.max_marks;
  END IF;

  INSERT INTO public.rec_assessment_amendments (assessment_id, answer_id, before_value, after_value, reason)
  VALUES (v_ans.assessment_id, p_answer_id,
    jsonb_build_object('score', v_ans.score, 'answer', v_ans.answer_text, 'evidence', v_ans.evidence_text,
      'verification', v_ans.verification_status, 'confidence', v_ans.evidence_confidence, 'rationale', v_ans.rationale),
    jsonb_build_object('score', COALESCE(p_score, v_ans.score), 'answer', COALESCE(p_answer, v_ans.answer_text),
      'evidence', COALESCE(p_evidence, v_ans.evidence_text),
      'verification', COALESCE(p_verification, v_ans.verification_status),
      'confidence', COALESCE(p_confidence, v_ans.evidence_confidence),
      'rationale', COALESCE(p_rationale, v_ans.rationale)),
    p_reason);

  PERFORM set_config('rec.assessment_engine', 'on', true);
  UPDATE public.rec_assessment_answers SET
    score = COALESCE(p_score, score), answer_text = COALESCE(p_answer, answer_text),
    evidence_text = COALESCE(p_evidence, evidence_text),
    verification_status = COALESCE(p_verification, verification_status),
    evidence_confidence = COALESCE(p_confidence, evidence_confidence),
    rationale = COALESCE(p_rationale, rationale), updated_at = now()
  WHERE id = p_answer_id;

  SELECT COALESCE(sum(score), 0), COALESCE(sum(max_marks), 0) INTO v_total, v_max
    FROM public.rec_assessment_answers WHERE assessment_id = v_ans.assessment_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('competency', competency_code, 'label', competency_label,
           'score', score, 'minimum', critical_min, 'max_marks', max_marks,
           'passed', COALESCE(score,0) >= critical_min) ORDER BY sort_order), '[]'::jsonb)
    INTO v_gates FROM public.rec_assessment_answers
   WHERE assessment_id = v_ans.assessment_id AND critical_min IS NOT NULL;
  SELECT NOT EXISTS (SELECT 1 FROM public.rec_assessment_answers
    WHERE assessment_id = v_ans.assessment_id AND critical_min IS NOT NULL
      AND COALESCE(score,0) < critical_min) INTO v_passed;

  UPDATE public.rec_assessments SET status = 'amended', total_score = v_total, max_score = v_max,
    percentage = CASE WHEN v_max > 0 THEN round(v_total / v_max * 100, 1) ELSE NULL END,
    band = public.rec_assessment_band(v_total, v_max), gate_status = v_gates,
    gates_passed = v_passed, amended_at = now()
  WHERE id = v_ans.assessment_id;
  PERFORM set_config('rec.assessment_engine', 'off', true);

  INSERT INTO public.rec_audit_events (action, object_type, object_id, previous_state, new_state, context)
  VALUES ('SCORE_CHANGED', 'rec_assessment', v_ans.assessment_id,
    jsonb_build_object('score', v_ans.score), jsonb_build_object('score', COALESCE(p_score, v_ans.score)),
    jsonb_build_object('answer_id', p_answer_id, 'reason', p_reason));

  RETURN jsonb_build_object('ok', true, 'total_score', v_total, 'gates_passed', v_passed);
END;
$$;

-- ============ CV claims ============
CREATE OR REPLACE FUNCTION public.rec_claim_record(
  p_application_id uuid, p_claim_type text, p_claim_text text,
  p_source_document text DEFAULT NULL, p_source_reference text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_candidate uuid; v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF coalesce(btrim(p_claim_text), '') = '' THEN RAISE EXCEPTION 'claim text is required'; END IF;
  SELECT candidate_id INTO v_candidate FROM public.rec_applications WHERE id = p_application_id;
  IF v_candidate IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  INSERT INTO public.rec_cv_claims (candidate_id, application_id, claim_type, claim_text,
    source_document, source_reference)
  VALUES (v_candidate, p_application_id, p_claim_type, p_claim_text, p_source_document, p_source_reference)
  RETURNING id INTO v_id;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('CV_CLAIM_RECORDED', 'rec_cv_claim', v_id,
    jsonb_build_object('claim_type', p_claim_type, 'verification_status', 'claimed'),
    jsonb_build_object('application_id', p_application_id));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_claim_validate(
  p_claim_id uuid, p_question text, p_response text, p_evidence text,
  p_verification text, p_confidence text, p_assessment_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF coalesce(btrim(p_question), '') = '' THEN RAISE EXCEPTION 'a validation question is required'; END IF;

  PERFORM set_config('rec.assessment_engine', 'on', true);
  INSERT INTO public.rec_claim_validations (claim_id, assessment_id, question_text, response_text,
    evidence_text, verification_status, confidence)
  VALUES (p_claim_id, p_assessment_id, p_question, p_response, p_evidence,
    COALESCE(p_verification, 'unverified'), COALESCE(p_confidence, 'unverified'))
  RETURNING id INTO v_id;

  -- the original claim text is never rewritten; only its verification outcome moves
  UPDATE public.rec_cv_claims
     SET verification_status = COALESCE(p_verification, verification_status),
         confidence = COALESCE(p_confidence, confidence)
   WHERE id = p_claim_id;
  PERFORM set_config('rec.assessment_engine', 'off', true);

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('CV_CLAIM_VALIDATED', 'rec_cv_claim', p_claim_id,
    jsonb_build_object('verification_status', p_verification, 'confidence', p_confidence),
    jsonb_build_object('validation_id', v_id, 'assessment_id', p_assessment_id));
  RETURN v_id;
END;
$$;

-- ============ panel summary with discrepancy detection ============
CREATE OR REPLACE FUNCTION public.rec_assessment_panel_summary(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_count int; v_mean numeric; v_min numeric; v_max numeric; v_scale numeric;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT count(*), round(avg(total_score), 2), min(total_score), max(total_score), max(max_score)
    INTO v_count, v_mean, v_min, v_max, v_scale
    FROM public.rec_assessments
   WHERE application_id = p_application_id AND status IN ('submitted','amended');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'assessment_id', id, 'assessor', COALESCE(assessor_name, 'Assessor'),
           'total_score', total_score, 'max_score', max_score, 'band', band,
           'gates_passed', gates_passed, 'recommendation', recommendation,
           'submitted_at', submitted_at) ORDER BY submitted_at), '[]'::jsonb)
    INTO v FROM public.rec_assessments
   WHERE application_id = p_application_id AND status IN ('submitted','amended');

  RETURN jsonb_build_object(
    'count', COALESCE(v_count, 0), 'mean', v_mean, 'min', v_min, 'max', v_max,
    'scale', v_scale, 'spread', COALESCE(v_max - v_min, 0),
    'discrepancy', COALESCE(v_count, 0) > 1 AND v_scale > 0
                   AND (v_max - v_min) / v_scale >= 0.20,
    'assessors', v);
END;
$$;

-- ============ candidate comparison ============
CREATE OR REPLACE FUNCTION public.rec_candidate_comparison(p_vacancy_id uuid)
RETURNS TABLE (
  application_id uuid, application_no text, candidate_id uuid, candidate_name text,
  application_status text, assessed boolean, assessment_count int,
  total_score numeric, max_score numeric, percentage numeric, band text,
  gates_passed boolean, recommendation text, competencies jsonb,
  evidence_confidence text, tie_break jsonb
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (a.application_id) a.*
      FROM public.rec_assessments a
     WHERE a.vacancy_id = p_vacancy_id AND a.status IN ('submitted','amended')
     ORDER BY a.application_id, a.submitted_at DESC NULLS LAST
  ), comps AS (
    SELECT an.assessment_id,
           jsonb_object_agg(an.competency_code, jsonb_build_object(
             'score', an.score, 'max', an.max_marks,
             'verification', an.verification_status)) AS competencies,
           min(CASE an.evidence_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2
                                            WHEN 'low' THEN 1 ELSE 0 END) AS conf
      FROM public.rec_assessment_answers an
     GROUP BY an.assessment_id
  )
  SELECT app.id, app.application_no, c.id, c.full_name, app.status,
         l.id IS NOT NULL,
         (SELECT count(*)::int FROM public.rec_assessments x
           WHERE x.application_id = app.id AND x.status IN ('submitted','amended')),
         l.total_score, l.max_score, l.percentage, COALESCE(l.band, 'unassessed'),
         l.gates_passed, l.recommendation, COALESCE(cp.competencies, '{}'::jsonb),
         CASE cp.conf WHEN 3 THEN 'high' WHEN 2 THEN 'medium' WHEN 1 THEN 'low' ELSE 'unverified' END,
         jsonb_build_object(
           'solution_selling', (cp.competencies -> 'yalla_solution' ->> 'score')::numeric,
           'objection_handling', (cp.competencies -> 'objection_handling' ->> 'score')::numeric,
           'verified_sales', (cp.competencies -> 'verified_sales' ->> 'score')::numeric,
           'productivity', (cp.competencies -> 'productivity' ->> 'score')::numeric,
           'operational_discipline', (cp.competencies -> 'crm_discipline' ->> 'score')::numeric)
    FROM public.rec_applications app
    JOIN public.rec_candidates c ON c.id = app.candidate_id
    LEFT JOIN latest l ON l.application_id = app.id
    LEFT JOIN comps cp ON cp.assessment_id = l.id
   WHERE app.vacancy_id = p_vacancy_id
   ORDER BY (l.total_score IS NULL), l.total_score DESC NULLS LAST,
            (cp.competencies -> 'yalla_solution' ->> 'score')::numeric DESC NULLS LAST,
            (cp.competencies -> 'objection_handling' ->> 'score')::numeric DESC NULLS LAST,
            (cp.competencies -> 'verified_sales' ->> 'score')::numeric DESC NULLS LAST,
            c.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_assessment_open(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rec_assessment_save_answer(uuid, text, text, text, text, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_assessment_submit(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_assessment_amend(uuid, text, numeric, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_claim_record(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_claim_validate(uuid, text, text, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rec_assessment_panel_summary(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rec_candidate_comparison(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rec_assessment_template_resolve(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.rec_assessment_open(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_save_answer(uuid, text, text, text, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_submit(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_amend(uuid, text, numeric, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_claim_record(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_claim_validate(uuid, text, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_panel_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_candidate_comparison(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_template_resolve(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_band(numeric, numeric) TO authenticated;