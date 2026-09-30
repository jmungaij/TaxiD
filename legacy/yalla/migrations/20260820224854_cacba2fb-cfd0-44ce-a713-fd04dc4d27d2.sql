-- extra tracks required by the capability map
INSERT INTO public.intern_tracks (programme_id, code, name, focus, sequence, performance_weights, matching_weights, kpis)
SELECT t.programme_id, v.code, v.name, v.focus, 10 + v.seq, t.performance_weights, t.matching_weights, t.kpis
FROM public.intern_tracks t
CROSS JOIN (VALUES
  ('TECH_OPS','Digital & Technology Operations','Systems, data and technical operations',1),
  ('PROCUREMENT','Procurement & Supplier Operations','Sourcing, supplier management and cost control',2)
) AS v(code,name,focus,seq)
WHERE t.code = 'DIGITAL'
  AND NOT EXISTS (SELECT 1 FROM public.intern_tracks x WHERE x.code = v.code);

INSERT INTO public.intern_curriculum_sources (institution, institution_type, programme, qualification_level, specialisation, curriculum_version, source, verification_status)
SELECT 'YALLA CAPABILITY BASELINE','INTERNAL','ANY','ANY',NULL,'yalla-baseline-v1','Yalla capability map','VERIFIED'
WHERE NOT EXISTS (SELECT 1 FROM public.intern_curriculum_sources WHERE curriculum_version='yalla-baseline-v1');

INSERT INTO public.intern_course_competencies (source_id, course, competency, competency_category, yalla_capability, track_code, proficiency_signal, match_kind, curriculum_version)
SELECT s.id, v.course, v.competency, v.category, v.capability, v.track, 'EXPOSURE', v.kind, 'yalla-baseline-v1'
FROM public.intern_curriculum_sources s
CROSS JOIN (VALUES
  ('Sales Management','Sales Planning','Commercial','Sales & Commercial Growth','SALES','PRIMARY'),
  ('Sales Management','Sales Execution','Commercial','Sales & Commercial Growth','SALES','PRIMARY'),
  ('Sales Management','Sales Performance','Commercial','Sales & Commercial Growth','SALES','PRIMARY'),
  ('Digital Marketing','Digital Acquisition','Marketing','Digital Marketing & Communications','DIGITAL','PRIMARY'),
  ('Digital Marketing','Campaign Management','Marketing','Digital Marketing & Communications','DIGITAL','PRIMARY'),
  ('Digital Marketing','Marketing Analytics','Marketing','Digital Marketing & Communications','DIGITAL','SECONDARY'),
  ('Travel Agency Operations','Booking Operations','Travel','Travel & Mobility Operations','TRAVEL_OPS','PRIMARY'),
  ('Travel Agency Operations','Supplier Coordination','Travel','Travel & Mobility Operations','TRAVEL_OPS','PRIMARY'),
  ('Tour Operations','Travel Operations','Travel','Travel & Mobility Operations','TRAVEL_OPS','PRIMARY'),
  ('Customer Service Management','Customer Handling','Service','Customer Experience','CX','PRIMARY'),
  ('Front Office Operations','Service Recovery','Service','Customer Experience','CX','PRIMARY'),
  ('Events Management','Event Activation','Events','Events & Business Activation','EVENTS','PRIMARY'),
  ('Database Management','Data Management','Technology','Digital & Technology Operations','TECH_OPS','PRIMARY'),
  ('Database Management','Querying','Technology','Digital & Technology Operations','TECH_OPS','PRIMARY'),
  ('Systems Analysis','Systems Thinking','Technology','Digital & Technology Operations','TECH_OPS','PRIMARY'),
  ('Inventory Management','Stock Control','Supply Chain','Logistics & Supply Chain','LOGISTICS','PRIMARY'),
  ('Inventory Management','Inventory Analysis','Supply Chain','Logistics & Supply Chain','LOGISTICS','PRIMARY'),
  ('Transport and Distribution','Routing & Planning','Supply Chain','Logistics & Supply Chain','LOGISTICS','PRIMARY'),
  ('Procurement Management','Sourcing','Procurement','Procurement & Supplier Operations','PROCUREMENT','PRIMARY'),
  ('Procurement Management','Supplier Management','Procurement','Procurement & Supplier Operations','PROCUREMENT','PRIMARY'),
  ('Stores and Supplies Management','Procurement Process','Procurement','Procurement & Supplier Operations','PROCUREMENT','SECONDARY'),
  ('Business Communication','Written Communication','Communication','Digital Marketing & Communications','DIGITAL','SECONDARY'),
  ('Public Relations','Communication Judgement','Communication','Digital Marketing & Communications','DIGITAL','SECONDARY')
) AS v(course,competency,category,capability,track,kind)
WHERE s.curriculum_version = 'yalla-baseline-v1'
ON CONFLICT (course, competency, curriculum_version) DO NOTHING;

/* --------------------------------------------------------- state machine */
CREATE OR REPLACE FUNCTION public.intern_pipeline_rank(p_stage public.intern_pipeline_stage)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE p_stage
    WHEN 'DRAFT' THEN 1 WHEN 'PUBLISHED' THEN 2 WHEN 'APPLICATION_OPEN' THEN 3
    WHEN 'APPLICATION_RECEIVED' THEN 4 WHEN 'ELIGIBILITY_SCREENING' THEN 5
    WHEN 'ACADEMIC_PROFILE_VALIDATION' THEN 6 WHEN 'CURRICULUM_MATCH' THEN 7
    WHEN 'EVIDENCE_REVIEW' THEN 8 WHEN 'CAPABILITY_ASSESSMENT' THEN 9
    WHEN 'SHORTLIST_REVIEW' THEN 10 WHEN 'INTERVIEW_INVITED' THEN 11
    WHEN 'INTERVIEW_SCHEDULED' THEN 12 WHEN 'INTERVIEW_COMPLETED' THEN 13
    WHEN 'SELECTION_REVIEW' THEN 14 WHEN 'SELECTED' THEN 15
    WHEN 'OFFER_GENERATED' THEN 16 WHEN 'OFFER_SENT' THEN 17 WHEN 'OFFER_ACCEPTED' THEN 18
    WHEN 'DOCUMENT_COLLECTION' THEN 19 WHEN 'ONBOARDING' THEN 20
    WHEN 'INTERN_ACTIVATED' THEN 21 WHEN 'INTERNS_360' THEN 22
    ELSE -1 END;
$$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_rank(public.intern_pipeline_stage) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.intern_pipeline_can_transition(
  p_from public.intern_pipeline_stage, p_to public.intern_pipeline_stage, p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN public.intern_pipeline_rank(p_from) = -1 THEN false                       -- terminal is final
    WHEN public.intern_pipeline_rank(p_to) = -1 THEN COALESCE(btrim(p_reason),'') <> ''
    WHEN public.intern_pipeline_rank(p_to) = public.intern_pipeline_rank(p_from) + 1 THEN true
    WHEN public.intern_pipeline_rank(p_to) = public.intern_pipeline_rank(p_from) - 1
      THEN COALESCE(btrim(p_reason),'') <> ''
    ELSE false END;
$$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_can_transition(public.intern_pipeline_stage, public.intern_pipeline_stage, text) TO authenticated, service_role;

/* -------------------------------------------------------------- open row */
CREATE OR REPLACE FUNCTION public.intern_pipeline_open(
  p_application uuid, p_programme uuid DEFAULT NULL, p_sla_hours integer DEFAULT 72)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_candidate uuid; v_vacancy uuid;
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to open an internship pipeline.';
  END IF;
  SELECT id INTO v_id FROM public.intern_recruitment_pipeline WHERE application_id = p_application;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT a.candidate_id, a.vacancy_id INTO v_candidate, v_vacancy
  FROM public.rec_applications a WHERE a.id = p_application;
  IF v_candidate IS NULL THEN
    RAISE EXCEPTION 'Application % not found or has no candidate.', p_application;
  END IF;

  INSERT INTO public.intern_recruitment_pipeline(
    application_id, candidate_id, vacancy_id, programme_id, sla_target_hours, created_by,
    scoring_weight_set_id)
  VALUES (p_application, v_candidate, v_vacancy,
          COALESCE(p_programme, (SELECT id FROM public.intern_programmes WHERE code='YMEITA')),
          COALESCE(p_sla_hours,72), auth.uid(),
          (SELECT id FROM public.intern_recruitment_weight_sets
            WHERE COALESCE(vacancy_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = COALESCE(v_vacancy, '00000000-0000-0000-0000-000000000000'::uuid)
              AND status='ACTIVE' ORDER BY version DESC LIMIT 1))
  RETURNING id INTO v_id;

  INSERT INTO public.intern_recruitment_transitions(pipeline_id, from_stage, to_stage, actor_id, reason, idempotency_key)
  VALUES (v_id, NULL, 'APPLICATION_RECEIVED', auth.uid(), 'pipeline opened', 'open:'||p_application::text);
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_open(uuid, uuid, integer) TO authenticated, service_role;

/* ------------------------------------------------------------ transition */
CREATE OR REPLACE FUNCTION public.intern_pipeline_transition(
  p_pipeline uuid, p_to public.intern_pipeline_stage, p_reason text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from public.intern_pipeline_stage; v_key text;
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to move internship recruitment work.';
  END IF;
  SELECT stage INTO v_from FROM public.intern_recruitment_pipeline WHERE id = p_pipeline FOR UPDATE;
  IF v_from IS NULL THEN RAISE EXCEPTION 'Pipeline % not found.', p_pipeline; END IF;

  v_key := COALESCE(p_idempotency_key, v_from::text||'->'||p_to::text);
  IF v_from = p_to THEN
    RETURN jsonb_build_object('ok', true, 'stage', v_from, 'idempotent', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.intern_recruitment_transitions
              WHERE pipeline_id = p_pipeline AND idempotency_key = v_key) THEN
    RETURN jsonb_build_object('ok', true, 'stage', (SELECT stage FROM public.intern_recruitment_pipeline WHERE id=p_pipeline), 'idempotent', true);
  END IF;
  IF NOT public.intern_pipeline_can_transition(v_from, p_to, p_reason) THEN
    RAISE EXCEPTION 'Illegal transition % -> % (a reason is required for rework and terminal outcomes).', v_from, p_to;
  END IF;

  UPDATE public.intern_recruitment_pipeline
     SET stage = p_to, stage_entered_at = now(), last_action_at = now()
   WHERE id = p_pipeline;

  INSERT INTO public.intern_recruitment_transitions(pipeline_id, from_stage, to_stage, actor_id, actor_email, reason, evidence, idempotency_key)
  VALUES (p_pipeline, v_from, p_to, auth.uid(),
          (SELECT email FROM auth.users WHERE id = auth.uid()), p_reason, COALESCE(p_evidence,'{}'::jsonb), v_key);

  RETURN jsonb_build_object('ok', true, 'from', v_from, 'stage', p_to, 'idempotent', false);
END; $$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_transition(uuid, public.intern_pipeline_stage, text, jsonb, text) TO authenticated, service_role;

/* -------------------------------------------------- eligibility + scoring */
CREATE OR REPLACE FUNCTION public.intern_pipeline_evaluate(p_pipeline uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  p record; ap record; w jsonb; ws uuid;
  v_courses int := 0; v_matched int := 0; v_skills int := 0;
  v_evidence numeric := 0; v_ev_rows int := 0;
  b jsonb := '{}'::jsonb; total numeric := 0;
  reasons jsonb := '[]'::jsonb; elig text; rec text;
  fn record;
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to evaluate internship applications.';
  END IF;
  SELECT * INTO p FROM public.intern_recruitment_pipeline WHERE id = p_pipeline;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pipeline % not found.', p_pipeline; END IF;
  SELECT * INTO ap FROM public.intern_academic_profiles WHERE application_id = p.application_id;

  SELECT id, weights INTO ws, w FROM public.intern_recruitment_weight_sets
   WHERE COALESCE(vacancy_id,'00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p.vacancy_id,'00000000-0000-0000-0000-000000000000'::uuid)
     AND status='ACTIVE' ORDER BY version DESC LIMIT 1;
  IF w IS NULL THEN
    SELECT id, weights INTO ws, w FROM public.intern_recruitment_weight_sets
     WHERE vacancy_id IS NULL AND status='ACTIVE' ORDER BY version DESC LIMIT 1;
  END IF;

  -- eligibility gates (separate from merit)
  IF ap.id IS NULL THEN
    reasons := reasons || jsonb_build_array('No academic profile on record.');
  ELSE
    IF ap.qualification_level IS NULL OR btrim(ap.qualification_level) = '' THEN
      reasons := reasons || jsonb_build_array('Qualification level missing.');
    END IF;
    IF ap.academic_stage IS NULL THEN
      reasons := reasons || jsonb_build_array('Academic stage not stated.');
    END IF;
  END IF;
  elig := CASE
    WHEN jsonb_array_length(reasons) = 0 THEN 'ELIGIBLE'
    WHEN jsonb_array_length(reasons) = 1 THEN 'CONDITIONALLY_ELIGIBLE'
    ELSE 'REVIEW_REQUIRED' END;

  -- curriculum match from recorded courses only
  IF ap.id IS NOT NULL THEN
    v_courses := COALESCE(array_length(ap.relevant_courses,1),0);
    v_skills  := COALESCE(array_length(ap.skills,1),0);
    SELECT count(DISTINCT c.course) INTO v_matched
      FROM public.intern_course_competencies c
     WHERE c.course = ANY (ap.relevant_courses);
  END IF;

  SELECT count(*), COALESCE(avg(CASE classification
            WHEN 'VERIFIED' THEN 1.0 WHEN 'ASSESSED' THEN 0.8 WHEN 'REVIEWED' THEN 0.6
            WHEN 'UPLOADED' THEN 0.4 ELSE 0.2 END),0)
    INTO v_ev_rows, v_evidence
    FROM public.intern_candidate_evidence WHERE application_id = p.application_id;

  b := jsonb_build_object(
    'academic_relevance', jsonb_build_object(
      'score', ROUND(CASE WHEN ap.id IS NULL THEN 0
                          WHEN ap.specialisation IS NOT NULL THEN (w->>'academic_relevance')::numeric
                          ELSE (w->>'academic_relevance')::numeric * 0.7 END, 2),
      'max', (w->>'academic_relevance')::numeric,
      'evidence', COALESCE(ap.programme,'none') || COALESCE(' / '||ap.specialisation,''),
      'source', 'intern_academic_profiles'),
    'curriculum_relevance', jsonb_build_object(
      'score', ROUND(CASE WHEN v_courses = 0 THEN 0
                     ELSE (w->>'curriculum_relevance')::numeric * LEAST(1, v_matched::numeric / v_courses) END, 2),
      'max', (w->>'curriculum_relevance')::numeric,
      'evidence', v_matched || ' of ' || v_courses || ' recorded courses map to a Yalla capability',
      'source', 'intern_course_competencies@' || COALESCE(ap.curriculum_version,'yalla-baseline-v1')),
    'skills', jsonb_build_object(
      'score', ROUND((w->>'skills')::numeric * LEAST(1, v_skills::numeric / 5), 2),
      'max', (w->>'skills')::numeric,
      'evidence', v_skills || ' declared skills', 'source', 'intern_academic_profiles.skills'),
    'evidence', jsonb_build_object(
      'score', ROUND((w->>'evidence')::numeric * v_evidence, 2),
      'max', (w->>'evidence')::numeric,
      'evidence', v_ev_rows || ' evidence records, mean strength ' || ROUND(v_evidence,2),
      'source', 'intern_candidate_evidence'),
    'assessment', jsonb_build_object(
      'score', ROUND((w->>'assessment')::numeric * COALESCE(p.assessment_score,0)/100, 2),
      'max', (w->>'assessment')::numeric,
      'evidence', COALESCE(p.assessment_score::text,'not assessed'), 'source', 'capability assessment'),
    'interview', jsonb_build_object(
      'score', ROUND((w->>'interview')::numeric * COALESCE(p.interview_score,0)/100, 2),
      'max', (w->>'interview')::numeric,
      'evidence', COALESCE(p.interview_score::text,'no interview record'), 'source', 'structured interview'),
    'learning_agility', jsonb_build_object('score', 0, 'max', (w->>'learning_agility')::numeric,
      'evidence', 'no assessed record', 'source', 'pending assessment'),
    'communication', jsonb_build_object('score', 0, 'max', (w->>'communication')::numeric,
      'evidence', 'no assessed record', 'source', 'pending assessment'),
    'problem_solving', jsonb_build_object('score', 0, 'max', (w->>'problem_solving')::numeric,
      'evidence', 'no assessed record', 'source', 'pending assessment'));

  FOR fn IN SELECT value->>'score' AS s FROM jsonb_each(b) LOOP
    total := total + COALESCE(fn.s::numeric, 0);
  END LOOP;

  rec := CASE
    WHEN elig = 'INELIGIBLE' THEN 'REJECT'
    WHEN elig = 'ELIGIBLE' AND total >= 70 THEN 'ADVANCE'
    WHEN total >= 55 THEN 'REVIEW'
    ELSE 'HOLD' END;

  UPDATE public.intern_recruitment_pipeline
     SET eligibility_status = elig, eligibility_reasons = reasons,
         curriculum_score = ROUND((b->'curriculum_relevance'->>'score')::numeric, 2),
         evidence_score = ROUND((b->'evidence'->>'score')::numeric, 2),
         match_score = ROUND(total,2), score_breakdown = b,
         scoring_weight_set_id = ws, screening_recommendation = rec, last_action_at = now()
   WHERE id = p_pipeline;

  RETURN jsonb_build_object('ok', true, 'eligibility', elig, 'eligibility_reasons', reasons,
                            'match_score', ROUND(total,2), 'recommendation', rec, 'breakdown', b,
                            'weight_set_id', ws);
END; $$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_evaluate(uuid) TO authenticated, service_role;

/* --------------------------------------------------- track recommendation */
CREATE OR REPLACE FUNCTION public.intern_pipeline_recommend_tracks(p_pipeline uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; ap record; ranked jsonb; ids uuid[];
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to recommend internship tracks.';
  END IF;
  SELECT * INTO p FROM public.intern_recruitment_pipeline WHERE id = p_pipeline;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pipeline % not found.', p_pipeline; END IF;
  SELECT * INTO ap FROM public.intern_academic_profiles WHERE application_id = p.application_id;
  IF ap.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No academic profile — track cannot be derived from a degree title alone.');
  END IF;

  WITH hits AS (
    SELECT c.track_code,
           sum(CASE c.match_kind WHEN 'PRIMARY' THEN 2 ELSE 1 END) AS weight,
           count(*) AS signals,
           array_agg(DISTINCT c.course) AS courses
      FROM public.intern_course_competencies c
     WHERE c.course = ANY (ap.relevant_courses)
     GROUP BY c.track_code
  )
  SELECT jsonb_agg(jsonb_build_object('track_code', h.track_code, 'track_id', t.id,
                   'weight', h.weight, 'signals', h.signals, 'courses', h.courses)
                   ORDER BY h.weight DESC),
         array_agg(t.id ORDER BY h.weight DESC)
    INTO ranked, ids
    FROM hits h LEFT JOIN public.intern_tracks t ON t.code = h.track_code;

  IF ranked IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No recorded course maps to a Yalla capability yet.');
  END IF;

  UPDATE public.intern_recruitment_pipeline
     SET primary_track_id = ids[1], secondary_track_id = ids[2], development_track_id = ids[3],
         last_action_at = now()
   WHERE id = p_pipeline;

  RETURN jsonb_build_object('ok', true, 'ranked', ranked,
    'primary_track_id', ids[1], 'secondary_track_id', ids[2], 'development_track_id', ids[3]);
END; $$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_recommend_tracks(uuid) TO authenticated, service_role;

/* ------------------------------------------------------------- selection */
CREATE OR REPLACE FUNCTION public.intern_pipeline_decide(
  p_pipeline uuid, p_decision text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_from public.intern_pipeline_stage;
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to record a selection decision.';
  END IF;
  IF p_decision NOT IN ('SELECT','RESERVE','HOLD','REJECT') THEN
    RAISE EXCEPTION 'Unknown selection decision %.', p_decision;
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A recorded reason is required for every selection decision.';
  END IF;
  SELECT stage INTO v_from FROM public.intern_recruitment_pipeline WHERE id = p_pipeline;
  IF v_from IS NULL THEN RAISE EXCEPTION 'Pipeline % not found.', p_pipeline; END IF;

  UPDATE public.intern_recruitment_pipeline
     SET selection_decision = p_decision, selection_reason = p_reason,
         decided_by = auth.uid(), decided_at = now(), last_action_at = now()
   WHERE id = p_pipeline;

  IF p_decision = 'SELECT' AND v_from = 'SELECTION_REVIEW' THEN
    PERFORM public.intern_pipeline_transition(p_pipeline, 'SELECTED', p_reason,
      jsonb_build_object('decision', p_decision), 'decide:'||p_pipeline::text||':SELECT');
  ELSIF p_decision = 'REJECT' THEN
    PERFORM public.intern_pipeline_transition(p_pipeline, 'REJECTED', p_reason,
      jsonb_build_object('decision', p_decision), 'decide:'||p_pipeline::text||':REJECT');
  END IF;
  RETURN jsonb_build_object('ok', true, 'decision', p_decision,
    'stage', (SELECT stage FROM public.intern_recruitment_pipeline WHERE id = p_pipeline));
END; $$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_decide(uuid, text, text) TO authenticated, service_role;

/* ------------------------------------------------- activation into Interns 360 */
CREATE OR REPLACE FUNCTION public.intern_pipeline_activate(
  p_pipeline uuid, p_cohort uuid, p_mentor uuid DEFAULT NULL, p_supervisor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p record; ap record; v_intern uuid;
BEGIN
  IF NOT public.intern_recruitment_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to activate an intern.';
  END IF;
  SELECT * INTO p FROM public.intern_recruitment_pipeline WHERE id = p_pipeline FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Pipeline % not found.', p_pipeline; END IF;
  IF p.stage <> 'ONBOARDING' AND p.intern_id IS NULL THEN
    RAISE EXCEPTION 'Onboarding must be complete before activation (stage is %).', p.stage;
  END IF;
  IF p.primary_track_id IS NULL THEN
    RAISE EXCEPTION 'A primary track is required before activation.';
  END IF;

  v_intern := COALESCE(p.intern_id, public.intern_enrol_from_application(
                p.application_id, p_cohort, p.primary_track_id, p_mentor, p_supervisor));

  SELECT * INTO ap FROM public.intern_academic_profiles WHERE application_id = p.application_id;
  UPDATE public.intern_profiles i
     SET institution = COALESCE(i.institution, ap.institution),
         programme_of_study = COALESCE(i.programme_of_study, ap.programme),
         qualification = COALESCE(i.qualification, ap.qualification_level),
         qualification_level = COALESCE(i.qualification_level, ap.qualification_level),
         year_of_study = COALESCE(i.year_of_study, ap.year_of_study),
         secondary_track_ids = COALESCE(i.secondary_track_ids,
           ARRAY(SELECT x FROM unnest(ARRAY[p.secondary_track_id, p.development_track_id]) x WHERE x IS NOT NULL)),
         status = 'ACTIVE', updated_at = now()
   WHERE i.id = v_intern;

  UPDATE public.intern_recruitment_pipeline
     SET intern_id = v_intern, cohort_id = COALESCE(cohort_id, p_cohort), last_action_at = now()
   WHERE id = p_pipeline;

  PERFORM public.intern_pipeline_transition(p_pipeline, 'INTERN_ACTIVATED', 'onboarding gates satisfied',
    jsonb_build_object('intern_id', v_intern), 'activate:'||p_pipeline::text);
  PERFORM public.intern_pipeline_transition(p_pipeline, 'INTERNS_360', 'intern profile live',
    jsonb_build_object('intern_id', v_intern), 'handover:'||p_pipeline::text);

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, after_state)
  VALUES (v_intern, auth.uid(), 'recruitment_handover', 'intern_recruitment_pipeline', p_pipeline,
          jsonb_build_object('application_id', p.application_id, 'candidate_id', p.candidate_id,
                             'cohort_id', COALESCE(p.cohort_id, p_cohort), 'track_id', p.primary_track_id));

  RETURN jsonb_build_object('ok', true, 'intern_id', v_intern);
END; $$;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_activate(uuid, uuid, uuid, uuid) TO authenticated, service_role;