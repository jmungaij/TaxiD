-- ============ paper (physical) interview assessment capture ============
CREATE TABLE public.rec_paper_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  interview_id uuid REFERENCES public.rec_interviews(id) ON DELETE SET NULL,
  evaluation_id uuid REFERENCES public.rec_evaluations(id) ON DELETE SET NULL,
  form_reference text NOT NULL,
  scan_path text,
  name_as_written text NOT NULL,
  position_as_written text,
  interview_date date,
  id_no_as_written text,
  highest_education_as_written text,
  experience_as_written text,
  location_as_written text,
  criteria_ratings jsonb NOT NULL DEFAULT '[]'::jsonb,
  unrated_criteria text[] NOT NULL DEFAULT '{}'::text[],
  recommendation_as_marked text,
  interviewer_comments text,
  interviewer_signature_present boolean NOT NULL DEFAULT false,
  transcription_confidence text NOT NULL DEFAULT 'medium',
  transcription_notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_paper_conf_ck CHECK (transcription_confidence = ANY (ARRAY['high','medium','low'])),
  CONSTRAINT rec_paper_form_uk UNIQUE (application_id, form_reference)
);

GRANT SELECT ON public.rec_paper_assessments TO authenticated;
GRANT ALL ON public.rec_paper_assessments TO service_role;
ALTER TABLE public.rec_paper_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read paper assessments" ON public.rec_paper_assessments
  FOR SELECT TO authenticated USING (public.rec_can_read());

CREATE OR REPLACE FUNCTION public.rec_paper_assessment_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_paper_assessments is append-only';
END; $$;

CREATE TRIGGER trg_rec_paper_assessments_immutable
  BEFORE UPDATE OR DELETE ON public.rec_paper_assessments
  FOR EACH ROW EXECUTE FUNCTION public.rec_paper_assessment_immutable();

-- ============ suitability determinations ============
CREATE TABLE public.rec_suitability_determinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  verdict text NOT NULL,
  evidence_status text NOT NULL,
  average_form_score numeric,
  score_scale text,
  evidence_basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence text[] NOT NULL DEFAULT '{}'::text[],
  conflicts text[] NOT NULL DEFAULT '{}'::text[],
  rationale text NOT NULL,
  requires_hr_action text,
  determined_by uuid,
  determined_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true,
  CONSTRAINT rec_suit_verdict_ck CHECK (verdict = ANY (ARRAY['SUITABLE','NOT_SUITABLE','EVIDENCE_INSUFFICIENT','CONFLICTING_EVIDENCE'])),
  CONSTRAINT rec_suit_evidence_ck CHECK (evidence_status = ANY (ARRAY['COMPLETE','INCOMPLETE','ASSESSMENT_DATA_MISSING']))
);

CREATE INDEX rec_suit_app_idx ON public.rec_suitability_determinations (application_id, determined_at DESC);
CREATE UNIQUE INDEX rec_suit_current_uk ON public.rec_suitability_determinations (application_id) WHERE is_current;

GRANT SELECT ON public.rec_suitability_determinations TO authenticated;
GRANT ALL ON public.rec_suitability_determinations TO service_role;
ALTER TABLE public.rec_suitability_determinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read suitability" ON public.rec_suitability_determinations
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- ============ record a paper form + retrospective interview + scorecard ============
CREATE OR REPLACE FUNCTION public.rec_paper_assessment_record(
  p_application_id uuid,
  p_form_reference text,
  p_name_as_written text,
  p_interview_date date,
  p_criteria jsonb,
  p_overall_score numeric,
  p_recommendation text,
  p_position_as_written text DEFAULT NULL,
  p_id_no text DEFAULT NULL,
  p_highest_education text DEFAULT NULL,
  p_experience text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_unrated text[] DEFAULT '{}'::text[],
  p_recommendation_as_marked text DEFAULT NULL,
  p_comments text DEFAULT NULL,
  p_signature_present boolean DEFAULT false,
  p_confidence text DEFAULT 'medium',
  p_transcription_notes text DEFAULT NULL,
  p_scan_path text DEFAULT NULL,
  p_strengths text DEFAULT NULL,
  p_concerns text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_int uuid; v_eval uuid; v_paper uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized: platform admin required to record a paper assessment';
  END IF;
  IF p_recommendation NOT IN ('advance','hold','reject') THEN
    RAISE EXCEPTION 'recommendation must be advance, hold or reject';
  END IF;
  IF p_overall_score IS NOT NULL AND (p_overall_score < 1 OR p_overall_score > 5) THEN
    RAISE EXCEPTION 'overall score must be on the canonical 1-5 scale';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  INSERT INTO public.rec_interviews (
    application_id, vacancy_id, interview_stage, interview_type, mode, scheduled_at, timezone,
    duration_minutes, location, instructions, status
  ) VALUES (
    p_application_id, v_app.vacancy_id, 'first', 'paper_panel_form', 'onsite',
    COALESCE(p_interview_date, current_date)::timestamptz, 'Africa/Nairobi', 45,
    COALESCE(NULLIF(p_location, ''), 'Nairobi office'),
    'Retrospective record of a physical interview evaluation form. Form reference: ' || p_form_reference,
    'completed'
  ) RETURNING id INTO v_int;

  INSERT INTO public.rec_evaluations (
    interview_id, application_id, evaluator_staff_id, criteria_scores, overall_score,
    recommendation, strengths, concerns, comments, status, submitted_at
  ) VALUES (
    v_int, p_application_id,
    (SELECT id FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1),
    COALESCE(p_criteria, '[]'::jsonb), p_overall_score, p_recommendation,
    p_strengths, p_concerns,
    'Transcribed from physical interview evaluation form ' || p_form_reference ||
      COALESCE(' — position applied for as written: ' || p_position_as_written, '') ||
      COALESCE(E'\nInterviewer comments: ' || p_comments, ''),
    'submitted', now()
  ) RETURNING id INTO v_eval;

  INSERT INTO public.rec_paper_assessments (
    application_id, candidate_id, vacancy_id, interview_id, evaluation_id, form_reference, scan_path,
    name_as_written, position_as_written, interview_date, id_no_as_written, highest_education_as_written,
    experience_as_written, location_as_written, criteria_ratings, unrated_criteria,
    recommendation_as_marked, interviewer_comments, interviewer_signature_present,
    transcription_confidence, transcription_notes, recorded_by
  ) VALUES (
    p_application_id, v_app.candidate_id, v_app.vacancy_id, v_int, v_eval, p_form_reference, p_scan_path,
    p_name_as_written, p_position_as_written, p_interview_date, p_id_no, p_highest_education,
    p_experience, p_location, COALESCE(p_criteria, '[]'::jsonb), COALESCE(p_unrated, '{}'::text[]),
    p_recommendation_as_marked, p_comments, COALESCE(p_signature_present, false),
    COALESCE(p_confidence, 'medium'), p_transcription_notes, auth.uid()
  ) RETURNING id INTO v_paper;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'assessment.paper_form_recorded', 'rec_paper_assessment', v_paper,
          jsonb_build_object('application_id', p_application_id, 'form_reference', p_form_reference,
                             'recommendation', p_recommendation, 'overall_score', p_overall_score),
          'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'paper_assessment_id', v_paper,
                            'interview_id', v_int, 'evaluation_id', v_eval);
END; $$;

REVOKE ALL ON FUNCTION public.rec_paper_assessment_record(uuid,text,text,date,jsonb,numeric,text,text,text,text,text,text,text[],text,text,boolean,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_paper_assessment_record(uuid,text,text,date,jsonb,numeric,text,text,text,text,text,text,text[],text,text,boolean,text,text,text,text,text) TO authenticated;

-- ============ record a suitability determination ============
CREATE OR REPLACE FUNCTION public.rec_suitability_determine(
  p_application_id uuid,
  p_verdict text,
  p_evidence_status text,
  p_rationale text,
  p_average_form_score numeric DEFAULT NULL,
  p_score_scale text DEFAULT NULL,
  p_evidence_basis jsonb DEFAULT '[]'::jsonb,
  p_missing_evidence text[] DEFAULT '{}'::text[],
  p_conflicts text[] DEFAULT '{}'::text[],
  p_requires_hr_action text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized: platform admin required to record a suitability determination';
  END IF;
  IF COALESCE(btrim(p_rationale), '') = '' THEN
    RAISE EXCEPTION 'a rationale is required';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  UPDATE public.rec_suitability_determinations
     SET is_current = false
   WHERE application_id = p_application_id AND is_current;

  INSERT INTO public.rec_suitability_determinations (
    application_id, candidate_id, vacancy_id, verdict, evidence_status, average_form_score,
    score_scale, evidence_basis, missing_evidence, conflicts, rationale, requires_hr_action, determined_by
  ) VALUES (
    p_application_id, v_app.candidate_id, v_app.vacancy_id, p_verdict, p_evidence_status,
    p_average_form_score, p_score_scale, COALESCE(p_evidence_basis, '[]'::jsonb),
    COALESCE(p_missing_evidence, '{}'::text[]), COALESCE(p_conflicts, '{}'::text[]),
    p_rationale, p_requires_hr_action, auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'assessment.suitability_determined', 'rec_suitability_determination', v_id,
          jsonb_build_object('application_id', p_application_id, 'verdict', p_verdict,
                             'evidence_status', p_evidence_status),
          'recruitment_360');

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.rec_suitability_determine(uuid,text,text,text,numeric,text,jsonb,text[],text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_suitability_determine(uuid,text,text,text,numeric,text,jsonb,text[],text[],text) TO authenticated;