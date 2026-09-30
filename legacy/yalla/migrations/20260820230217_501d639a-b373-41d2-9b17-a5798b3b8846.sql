CREATE OR REPLACE FUNCTION public.intern_recruitment_certify_cohort()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM public.intern_cohorts ORDER BY created_at LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  INSERT INTO public.intern_cohorts(programme_id, name, start_date, end_date, duration_weeks, intake_size, status)
  VALUES ((SELECT id FROM public.intern_programmes WHERE code='YMEITA'),
          'TEST/DEMO Certification Cohort', current_date, current_date + 84, 12, 1, 'PLANNED')
  RETURNING id INTO v;
  RETURN v;
END; $$;
REVOKE EXECUTE ON FUNCTION public.intern_recruitment_certify_cohort() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intern_recruitment_certify_cohort() TO service_role;

CREATE OR REPLACE FUNCTION public.intern_recruitment_certify()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  checks jsonb := '[]'::jsonb; gaps jsonb := '[]'::jsonb;
  passed int := 0; total int := 0;
  v_cand uuid; v_app uuid; v_pipe uuid; v_cohort uuid; v_vac uuid;
  v_intern uuid; v_res jsonb; v_stage text; v_count int; v_tag text;
  PROC record;
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to run the internship recruitment certification.';
  END IF;

  v_tag := substr(gen_random_uuid()::text,1,8);

  INSERT INTO public.rec_candidates(candidate_no, full_name, email, source, record_state)
  VALUES ('TEST-CAND-'||v_tag, 'TEST/DEMO Certification Candidate',
          'test.cert.'||v_tag||'@yalla.africa','TEST','active')
  RETURNING id INTO v_cand;

  INSERT INTO public.rec_vacancies(vacancy_no, title, status, publication_status, approval_status)
  VALUES ('TEST-VAC-'||v_tag, 'TEST/DEMO Internship Vacancy', 'on_hold', 'draft', 'pending')
  RETURNING id INTO v_vac;

  INSERT INTO public.rec_applications(application_no, candidate_id, vacancy_id, source, stage, status)
  VALUES ('TEST-APP-'||v_tag, v_cand, v_vac, 'TEST', 'applied', 'active') RETURNING id INTO v_app;

  v_pipe := public.intern_pipeline_open(v_app);
  total := total + 1;
  IF v_pipe IS NOT NULL THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','pipeline_open','pass',true));
  ELSE gaps := gaps || jsonb_build_array('pipeline_open failed'); END IF;

  total := total + 1;
  IF public.intern_pipeline_open(v_app) = v_pipe THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','pipeline_open_idempotent','pass',true));
  ELSE gaps := gaps || jsonb_build_array('pipeline_open created a duplicate'); END IF;

  total := total + 1;
  BEGIN
    PERFORM public.intern_pipeline_transition(v_pipe, 'SELECTED', 'jump');
    gaps := gaps || jsonb_build_array('illegal stage jump was accepted');
  EXCEPTION WHEN others THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','illegal_jump_refused','pass',true));
  END;

  total := total + 1;
  BEGIN
    PERFORM public.intern_pipeline_transition(v_pipe, 'REJECTED', NULL);
    gaps := gaps || jsonb_build_array('terminal outcome accepted without a reason');
  EXCEPTION WHEN others THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','terminal_requires_reason','pass',true));
  END;

  total := total + 1;
  v_res := public.intern_pipeline_transition(v_pipe, 'ELIGIBILITY_SCREENING', 'screening opened');
  IF (v_res->>'stage') = 'ELIGIBILITY_SCREENING' THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','legal_transition','pass',true));
  ELSE gaps := gaps || jsonb_build_array('legal transition failed'); END IF;

  total := total + 1;
  PERFORM public.intern_pipeline_transition(v_pipe, 'ACADEMIC_PROFILE_VALIDATION', 'validate', '{}'::jsonb, 'k1');
  PERFORM public.intern_pipeline_transition(v_pipe, 'ACADEMIC_PROFILE_VALIDATION', 'validate', '{}'::jsonb, 'k1');
  SELECT count(*) INTO v_count FROM public.intern_recruitment_transitions
   WHERE pipeline_id = v_pipe AND idempotency_key = 'k1';
  IF v_count = 1 THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','transition_idempotent','pass',true));
  ELSE gaps := gaps || jsonb_build_array('duplicate transition audit rows written'); END IF;

  total := total + 1;
  v_res := public.intern_pipeline_evaluate(v_pipe);
  IF (v_res->>'eligibility') <> 'ELIGIBLE' AND jsonb_array_length(v_res->'eligibility_reasons') > 0 THEN
    passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','eligibility_fails_closed','pass',true));
  ELSE gaps := gaps || jsonb_build_array('eligibility claimed without an academic profile'); END IF;

  INSERT INTO public.intern_academic_profiles(application_id, candidate_id, qualification_level, programme,
    institution, specialisation, academic_stage, relevant_courses, skills, curriculum_version)
  VALUES (v_app, v_cand, 'DIPLOMA', 'Business Administration', 'TEST/DEMO Institute',
          'Marketing', 'CONTINUING', ARRAY['Sales Management','Digital Marketing'],
          ARRAY['prospecting','copywriting','analytics'], 'yalla-baseline-v1');
  INSERT INTO public.intern_candidate_evidence(application_id, competency, evidence_kind, produced, classification)
  VALUES (v_app, 'Sales Execution', 'PROJECT', 'TEST/DEMO campaign deck', 'REVIEWED');

  total := total + 1;
  v_res := public.intern_pipeline_evaluate(v_pipe);
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_each(v_res->'breakdown') d
     WHERE COALESCE(d.value->>'evidence','') = '' OR COALESCE(d.value->>'source','') = ''
  ) THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','scores_explainable','pass',true));
  ELSE gaps := gaps || jsonb_build_array('a score dimension has no evidence or source'); END IF;

  total := total + 1;
  IF (v_res->'breakdown'->'curriculum_relevance'->>'score')::numeric > 0 THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','curriculum_match','pass',true));
  ELSE gaps := gaps || jsonb_build_array('curriculum relevance did not score recorded courses'); END IF;

  total := total + 1;
  v_res := public.intern_pipeline_recommend_tracks(v_pipe);
  IF (v_res->>'ok')::boolean AND (v_res->>'primary_track_id') IS NOT NULL THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','track_recommendation','pass',true));
  ELSE gaps := gaps || jsonb_build_array('track recommendation produced no primary track'); END IF;

  total := total + 1;
  BEGIN
    PERFORM public.intern_pipeline_decide(v_pipe, 'SELECT', '   ');
    gaps := gaps || jsonb_build_array('selection accepted without a reason');
  EXCEPTION WHEN others THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','selection_requires_reason','pass',true));
  END;

  v_cohort := public.intern_recruitment_certify_cohort();
  total := total + 1;
  BEGIN
    PERFORM public.intern_pipeline_activate(v_pipe, v_cohort);
    gaps := gaps || jsonb_build_array('activation allowed before onboarding');
  EXCEPTION WHEN others THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','activation_gated','pass',true));
  END;

  FOR PROC IN SELECT unnest(ARRAY['CURRICULUM_MATCH','EVIDENCE_REVIEW','CAPABILITY_ASSESSMENT',
      'SHORTLIST_REVIEW','INTERVIEW_INVITED','INTERVIEW_SCHEDULED','INTERVIEW_COMPLETED',
      'SELECTION_REVIEW','SELECTED','OFFER_GENERATED','OFFER_SENT','OFFER_ACCEPTED',
      'DOCUMENT_COLLECTION','ONBOARDING']) AS s LOOP
    PERFORM public.intern_pipeline_transition(v_pipe, PROC.s::public.intern_pipeline_stage, 'certification walk');
  END LOOP;

  total := total + 1;
  v_res := public.intern_pipeline_activate(v_pipe, v_cohort);
  v_intern := (v_res->>'intern_id')::uuid;
  SELECT count(*) INTO v_count FROM public.intern_profiles WHERE application_id = v_app;
  IF v_intern IS NOT NULL AND v_count = 1 THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','activation_no_duplicate_identity','pass',true));
  ELSE gaps := gaps || jsonb_build_array('activation created a duplicate person'); END IF;

  total := total + 1;
  SELECT stage::text INTO v_stage FROM public.intern_recruitment_pipeline WHERE id = v_pipe;
  IF v_stage = 'INTERNS_360' AND EXISTS (
      SELECT 1 FROM public.intern_audit_log WHERE intern_id = v_intern AND action = 'recruitment_handover')
  THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','handover_audited','pass',true));
  ELSE gaps := gaps || jsonb_build_array('hand-over to Interns 360 was not audited'); END IF;

  total := total + 1;
  BEGIN
    UPDATE public.intern_recruitment_transitions SET reason = 'tampered' WHERE pipeline_id = v_pipe;
    gaps := gaps || jsonb_build_array('transition history was editable');
  EXCEPTION WHEN others THEN passed := passed + 1;
    checks := checks || jsonb_build_array(jsonb_build_object('check','transitions_append_only','pass',true));
  END;

  UPDATE public.intern_profiles SET status = 'WITHDRAWN', deleted_at = now() WHERE application_id = v_app;
  UPDATE public.rec_applications SET status = 'closed', stage = 'withdrawn' WHERE id = v_app;
  UPDATE public.rec_candidates SET record_state = 'archived' WHERE id = v_cand;
  UPDATE public.rec_vacancies SET status = 'cancelled' WHERE id = v_vac;

  v_res := jsonb_build_object(
    'verdict', CASE WHEN passed = total THEN 'CERTIFIED' ELSE 'GAPS' END,
    'total_checks', total, 'passed_checks', passed, 'checks', checks, 'gaps', gaps,
    'synthetic', jsonb_build_object('candidate_id', v_cand, 'application_id', v_app,
                                    'vacancy_id', v_vac, 'pipeline_id', v_pipe));

  INSERT INTO public.intern_recruitment_certification_runs(ran_by, verdict, total_checks, passed_checks, gaps, result)
  VALUES (auth.uid(), v_res->>'verdict', total, passed, gaps, v_res);
  RETURN v_res;
END; $$;
REVOKE EXECUTE ON FUNCTION public.intern_recruitment_certify() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intern_recruitment_certify() TO authenticated, service_role;

SELECT public.intern_recruitment_certify();