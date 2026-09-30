-- Internship programme blueprint: a specialised configuration attached 1:1 to an
-- existing rec_vacancies row. The vacancy stays the single hiring entity.
CREATE TABLE IF NOT EXISTS public.rec_internship_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL UNIQUE REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  programme_id uuid REFERENCES public.intern_programmes(id),
  cohort_id uuid REFERENCES public.intern_cohorts(id),
  primary_track_id uuid REFERENCES public.intern_tracks(id),
  secondary_track_id uuid REFERENCES public.intern_tracks(id),
  development_track_id uuid REFERENCES public.intern_tracks(id),
  internship_type text NOT NULL DEFAULT 'ACADEMIC'
    CHECK (internship_type IN ('ACADEMIC','INDUSTRIAL_ATTACHMENT','PROFESSIONAL','GRADUATE','STRUCTURED_TALENT')),
  duration_weeks integer NOT NULL DEFAULT 12 CHECK (duration_weeks BETWEEN 1 AND 104),
  start_date date,
  end_date date,
  application_deadline date,
  host_function text,
  department text,
  business_unit text,
  supervisor_staff_id uuid,
  mentor_staff_id uuid,
  approving_manager_staff_id uuid,
  programme_purpose text,
  learning_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  learning_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
  productivity_mandate jsonb NOT NULL DEFAULT '[]'::jsonb,
  kpis jsonb NOT NULL DEFAULT '[]'::jsonb,
  academic_eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_documents text[] NOT NULL DEFAULT '{}',
  curriculum_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  competencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  practical_capabilities text[] NOT NULL DEFAULT '{}',
  experience_equivalency text[] NOT NULL DEFAULT '{}',
  assessment_design jsonb NOT NULL DEFAULT '[]'::jsonb,
  interview_framework jsonb NOT NULL DEFAULT '[]'::jsonb,
  selection_weights jsonb NOT NULL DEFAULT
    '{"academic_relevance":15,"curriculum_relevance":15,"competencies":10,"evidence":15,"assessment":20,"learning_agility":10,"communication":5,"problem_solving":5,"interview":5}'::jsonb,
  weights_version integer NOT NULL DEFAULT 1,
  talent_attributes text[] NOT NULL DEFAULT '{}',
  commercial_objective jsonb NOT NULL DEFAULT '{}'::jsonb,
  success_profile text[] NOT NULL DEFAULT '{}',
  development_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  application_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  position_exception_reason text,
  spec_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (spec_status IN ('DRAFT','REVIEW','APPROVED','PUBLISHED','CLOSED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_internship_specs TO authenticated;
GRANT ALL ON public.rec_internship_specs TO service_role;

ALTER TABLE public.rec_internship_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internship_spec_read ON public.rec_internship_specs;
CREATE POLICY internship_spec_read ON public.rec_internship_specs
  FOR SELECT TO authenticated
  USING (public.rec_is_hiring_authority() OR public.intern_recruitment_authority(auth.uid()));

DROP POLICY IF EXISTS internship_spec_write ON public.rec_internship_specs;
CREATE POLICY internship_spec_write ON public.rec_internship_specs
  FOR ALL TO authenticated
  USING (public.rec_is_hiring_authority() OR public.intern_recruitment_authority(auth.uid()))
  WITH CHECK (public.rec_is_hiring_authority() OR public.intern_recruitment_authority(auth.uid()));

CREATE INDEX IF NOT EXISTS rec_internship_specs_vacancy_idx ON public.rec_internship_specs(vacancy_id);
CREATE INDEX IF NOT EXISTS rec_internship_specs_cohort_idx ON public.rec_internship_specs(cohort_id);

CREATE OR REPLACE FUNCTION public._touch_rec_internship_specs()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS touch_rec_internship_specs ON public.rec_internship_specs;
CREATE TRIGGER touch_rec_internship_specs BEFORE UPDATE ON public.rec_internship_specs
  FOR EACH ROW EXECUTE FUNCTION public._touch_rec_internship_specs();

-- Readiness validator: returns READY or BLOCKED with the exact missing gates.
CREATE OR REPLACE FUNCTION public.rec_internship_validate(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v record; s record; blockers text[] := '{}'; w numeric;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy % not found.', p_vacancy; END IF;
  SELECT * INTO s FROM public.rec_internship_specs WHERE vacancy_id = p_vacancy;
  IF s.id IS NULL THEN
    RETURN jsonb_build_object('verdict','BLOCKED','blockers',
      to_jsonb(ARRAY['No internship programme blueprint is attached to this vacancy.']));
  END IF;

  IF COALESCE(btrim(v.title),'') = '' THEN blockers := blockers || 'Programme title is required.'; END IF;
  IF COALESCE(btrim(COALESCE(v.location,'')),'') = '' THEN blockers := blockers || 'Location is required.'; END IF;
  IF COALESCE(v.headcount,0) < 1 THEN blockers := blockers || 'Headcount must be at least 1.'; END IF;
  IF v.position_id IS NULL AND COALESCE(btrim(COALESCE(s.position_exception_reason, v.position_exception_reason,'')),'') = ''
    THEN blockers := blockers || 'Link an approved org position, or record a position exception reason.'; END IF;

  IF COALESCE(btrim(COALESCE(s.host_function,'')),'') = '' THEN blockers := blockers || 'Host function is required.'; END IF;
  IF COALESCE(btrim(COALESCE(s.department,'')),'') = '' THEN blockers := blockers || 'Department is required.'; END IF;
  IF s.supervisor_staff_id IS NULL THEN blockers := blockers || 'A supervisor must be assigned.'; END IF;
  IF s.mentor_staff_id IS NULL THEN blockers := blockers || 'A mentor or learning owner must be assigned.'; END IF;
  IF s.approving_manager_staff_id IS NULL THEN blockers := blockers || 'An approving manager must be named.'; END IF;
  IF s.primary_track_id IS NULL THEN blockers := blockers || 'A primary internship track is required.'; END IF;
  IF s.cohort_id IS NULL THEN blockers := blockers || 'A cohort must be selected or created.'; END IF;
  IF s.start_date IS NULL OR s.end_date IS NULL THEN blockers := blockers || 'Start and end dates are required.';
  ELSIF s.end_date <= s.start_date THEN blockers := blockers || 'The end date must fall after the start date.'; END IF;
  IF s.application_deadline IS NULL THEN blockers := blockers || 'An application deadline is required.';
  ELSIF s.start_date IS NOT NULL AND s.application_deadline > s.start_date
    THEN blockers := blockers || 'The application deadline must fall on or before the start date.'; END IF;
  IF COALESCE(s.duration_weeks,0) < 1 THEN blockers := blockers || 'Programme duration is required.'; END IF;

  IF length(COALESCE(btrim(s.programme_purpose),'')) < 40
    THEN blockers := blockers || 'State the programme purpose: the capability Yalla is developing (at least 40 characters).'; END IF;
  IF jsonb_array_length(s.learning_objectives) = 0 THEN blockers := blockers || 'At least one learning objective is required.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.learning_objectives) o
              WHERE COALESCE(btrim(o->>'competency'),'') = '' OR COALESCE(btrim(o->>'evidence'),'') = ''
                 OR COALESCE(btrim(o->>'assessment'),'') = '')
    THEN blockers := blockers || 'Every learning objective needs a competency, expected evidence and an assessment method.'; END IF;
  IF jsonb_array_length(s.learning_outcomes) = 0 THEN blockers := blockers || 'At least one measurable learning outcome is required.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.learning_outcomes) o
              WHERE COALESCE(btrim(o->>'action'),'') = '' OR COALESCE(btrim(o->>'competency'),'') = ''
                 OR COALESCE(btrim(o->>'context'),'') = '' OR COALESCE(btrim(o->>'evidence'),'') = '')
    THEN blockers := blockers || 'Each learning outcome must carry an action, competency, context and evidence.'; END IF;
  IF jsonb_array_length(s.productivity_mandate) = 0 THEN blockers := blockers || 'Define the measurable work the intern will perform.'; END IF;
  IF jsonb_array_length(s.kpis) = 0 THEN blockers := blockers || 'At least one KPI with a target is required.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.kpis) k
              WHERE COALESCE(btrim(k->>'kpi'),'') = '' OR COALESCE(btrim(k->>'target'),'') = ''
                 OR COALESCE(btrim(k->>'evidence_source'),'') = '')
    THEN blockers := blockers || 'Every KPI needs a target and an authoritative evidence source.'; END IF;

  IF COALESCE(btrim(COALESCE(s.academic_eligibility->>'qualification_level','')),'') = ''
    THEN blockers := blockers || 'Academic eligibility needs a qualification level.'; END IF;
  IF COALESCE(jsonb_array_length(COALESCE(s.academic_eligibility->'programme_families','[]'::jsonb)),0) = 0
    THEN blockers := blockers || 'Name at least one relevant academic programme family.'; END IF;
  IF COALESCE(array_length(s.required_documents,1),0) = 0
    THEN blockers := blockers || 'Configure the required academic documents.'; END IF;
  IF jsonb_array_length(s.curriculum_map) = 0
    THEN blockers := blockers || 'Map courses to Yalla capabilities: a degree title alone is not capability.'; END IF;

  IF jsonb_array_length(s.competencies) = 0 THEN blockers := blockers || 'Define the required competencies.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.competencies) c
              WHERE COALESCE(btrim(c->>'competency'),'') = '' OR COALESCE(btrim(c->>'evidence'),'') = '')
    THEN blockers := blockers || 'Every competency needs the evidence that demonstrates it.'; END IF;
  IF COALESCE(array_length(s.practical_capabilities,1),0) = 0
    THEN blockers := blockers || 'State observable practical capabilities, not qualities such as "hardworking".'; END IF;
  IF jsonb_array_length(s.assessment_design) = 0 THEN blockers := blockers || 'Assessment design is required.'; END IF;
  IF jsonb_array_length(s.interview_framework) = 0 THEN blockers := blockers || 'An interview rubric is required.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(s.interview_framework) q
              WHERE COALESCE(btrim(q->>'question'),'') = '' OR COALESCE(btrim(q->>'rubric'),'') = ''
                 OR COALESCE((q->>'max_marks')::numeric, 0) <= 0)
    THEN blockers := blockers || 'Every interview question needs a scoring rubric and maximum marks.'; END IF;
  IF COALESCE(array_length(s.success_profile,1),0) = 0
    THEN blockers := blockers || 'Define the successful intern profile.'; END IF;
  IF jsonb_array_length(s.development_plan) = 0
    THEN blockers := blockers || 'Define the intern development plan (week one through completion).'; END IF;
  IF jsonb_array_length(s.application_questions) = 0
    THEN blockers := blockers || 'Configure the application questions.'; END IF;

  SELECT COALESCE(sum((value)::numeric), 0) INTO w FROM jsonb_each_text(s.selection_weights);
  IF round(w) <> 100 THEN blockers := blockers || format('Selection weights must total 100%% (currently %s).', round(w)); END IF;

  RETURN jsonb_build_object(
    'verdict', CASE WHEN array_length(blockers,1) IS NULL THEN 'READY' ELSE 'BLOCKED' END,
    'blockers', to_jsonb(COALESCE(blockers, '{}'::text[])),
    'vacancy_no', v.vacancy_no,
    'spec_status', s.spec_status);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rec_internship_validate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_internship_validate(uuid) TO authenticated, service_role;

-- Publication gate: an internship vacancy cannot be published until it is READY.
CREATE OR REPLACE FUNCTION public._rec_internship_publication_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NEW.publication_status = 'published' AND COALESCE(OLD.publication_status,'') <> 'published'
     AND NEW.employment_type = 'internship' THEN
    v := public.rec_internship_validate(NEW.id);
    IF (v->>'verdict') <> 'READY' THEN
      RAISE EXCEPTION 'Internship programme is not ready to publish: %',
        array_to_string(ARRAY(SELECT jsonb_array_elements_text(v->'blockers')), ' | ');
    END IF;
    UPDATE public.rec_internship_specs SET spec_status = 'PUBLISHED' WHERE vacancy_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS rec_internship_publication_gate ON public.rec_vacancies;
CREATE TRIGGER rec_internship_publication_gate BEFORE UPDATE ON public.rec_vacancies
  FOR EACH ROW EXECUTE FUNCTION public._rec_internship_publication_gate();

-- Governed creation: one vacancy + its internship blueprint, audited.
CREATE OR REPLACE FUNCTION public.rec_internship_create(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_vac uuid; v_no text; v_spec uuid;
BEGIN
  IF NOT (public.rec_is_hiring_authority() OR public.intern_recruitment_authority(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to create an internship programme.';
  END IF;
  IF COALESCE(btrim(p->>'title'),'') = '' THEN RAISE EXCEPTION 'A programme title is required.'; END IF;

  v_no := 'INT-' || to_char(now(), 'YYMM') || '-' || upper(substr(gen_random_uuid()::text, 1, 6));

  INSERT INTO public.rec_vacancies(
    vacancy_no, title, location, position_id, position_exception_reason, employment_type,
    work_arrangement, priority, headcount, sla_days, min_years_experience,
    status, publication_status, approval_status)
  VALUES (v_no, btrim(p->>'title'), NULLIF(btrim(COALESCE(p->>'location','')),''),
          NULLIF(p->>'position_id','')::uuid, NULLIF(btrim(COALESCE(p->>'position_exception_reason','')),''),
          'internship', COALESCE(NULLIF(p->>'work_arrangement',''),'onsite'),
          COALESCE(NULLIF(p->>'priority',''),'normal'),
          GREATEST(1, COALESCE((p->>'headcount')::int, 1)),
          GREATEST(1, COALESCE((p->>'sla_days')::int, 30)), 0,
          'open', 'draft', 'pending')
  RETURNING id INTO v_vac;

  INSERT INTO public.rec_internship_specs(
    vacancy_id, programme_id, cohort_id, primary_track_id, secondary_track_id, development_track_id,
    internship_type, duration_weeks, start_date, end_date, application_deadline,
    host_function, department, business_unit,
    supervisor_staff_id, mentor_staff_id, approving_manager_staff_id,
    programme_purpose, learning_objectives, learning_outcomes, productivity_mandate, kpis,
    academic_eligibility, required_documents, curriculum_map, competencies, practical_capabilities,
    experience_equivalency, assessment_design, interview_framework,
    selection_weights, talent_attributes, commercial_objective, success_profile,
    development_plan, public_preview, application_questions, position_exception_reason, created_by)
  VALUES (
    v_vac,
    COALESCE(NULLIF(p->>'programme_id','')::uuid, (SELECT id FROM public.intern_programmes WHERE code='YMEITA')),
    NULLIF(p->>'cohort_id','')::uuid,
    NULLIF(p->>'primary_track_id','')::uuid,
    NULLIF(p->>'secondary_track_id','')::uuid,
    NULLIF(p->>'development_track_id','')::uuid,
    COALESCE(NULLIF(p->>'internship_type',''),'ACADEMIC'),
    GREATEST(1, COALESCE((p->>'duration_weeks')::int, 12)),
    NULLIF(p->>'start_date','')::date, NULLIF(p->>'end_date','')::date,
    NULLIF(p->>'application_deadline','')::date,
    NULLIF(btrim(COALESCE(p->>'host_function','')),''),
    NULLIF(btrim(COALESCE(p->>'department','')),''),
    NULLIF(btrim(COALESCE(p->>'business_unit','')),''),
    NULLIF(p->>'supervisor_staff_id','')::uuid,
    NULLIF(p->>'mentor_staff_id','')::uuid,
    NULLIF(p->>'approving_manager_staff_id','')::uuid,
    NULLIF(btrim(COALESCE(p->>'programme_purpose','')),''),
    COALESCE(p->'learning_objectives','[]'::jsonb), COALESCE(p->'learning_outcomes','[]'::jsonb),
    COALESCE(p->'productivity_mandate','[]'::jsonb), COALESCE(p->'kpis','[]'::jsonb),
    COALESCE(p->'academic_eligibility','{}'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'required_documents','[]'::jsonb))), '{}'),
    COALESCE(p->'curriculum_map','[]'::jsonb), COALESCE(p->'competencies','[]'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'practical_capabilities','[]'::jsonb))), '{}'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'experience_equivalency','[]'::jsonb))), '{}'),
    COALESCE(p->'assessment_design','[]'::jsonb), COALESCE(p->'interview_framework','[]'::jsonb),
    COALESCE(p->'selection_weights',
      '{"academic_relevance":15,"curriculum_relevance":15,"competencies":10,"evidence":15,"assessment":20,"learning_agility":10,"communication":5,"problem_solving":5,"interview":5}'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'talent_attributes','[]'::jsonb))), '{}'),
    COALESCE(p->'commercial_objective','{}'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'success_profile','[]'::jsonb))), '{}'),
    COALESCE(p->'development_plan','[]'::jsonb), COALESCE(p->'public_preview','{}'::jsonb),
    COALESCE(p->'application_questions','[]'::jsonb),
    NULLIF(btrim(COALESCE(p->>'position_exception_reason','')),''),
    auth.uid())
  RETURNING id INTO v_spec;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  VALUES (auth.uid(), 'internship_programme_created', 'rec_vacancies', v_vac,
          jsonb_build_object('vacancy_no', v_no, 'spec_id', v_spec, 'title', p->>'title'));

  RETURN jsonb_build_object('ok', true, 'vacancy_id', v_vac, 'vacancy_no', v_no, 'spec_id', v_spec,
                            'validation', public.rec_internship_validate(v_vac));
END; $$;
REVOKE EXECUTE ON FUNCTION public.rec_internship_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_internship_create(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rec_internship_update(p_vacancy uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.rec_is_hiring_authority() OR public.intern_recruitment_authority(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to change an internship programme.';
  END IF;
  UPDATE public.rec_internship_specs SET
    cohort_id = COALESCE(NULLIF(p->>'cohort_id','')::uuid, cohort_id),
    primary_track_id = COALESCE(NULLIF(p->>'primary_track_id','')::uuid, primary_track_id),
    secondary_track_id = COALESCE(NULLIF(p->>'secondary_track_id','')::uuid, secondary_track_id),
    development_track_id = COALESCE(NULLIF(p->>'development_track_id','')::uuid, development_track_id),
    supervisor_staff_id = COALESCE(NULLIF(p->>'supervisor_staff_id','')::uuid, supervisor_staff_id),
    mentor_staff_id = COALESCE(NULLIF(p->>'mentor_staff_id','')::uuid, mentor_staff_id),
    approving_manager_staff_id = COALESCE(NULLIF(p->>'approving_manager_staff_id','')::uuid, approving_manager_staff_id),
    programme_purpose = COALESCE(NULLIF(btrim(COALESCE(p->>'programme_purpose','')),''), programme_purpose),
    learning_objectives = COALESCE(p->'learning_objectives', learning_objectives),
    learning_outcomes = COALESCE(p->'learning_outcomes', learning_outcomes),
    productivity_mandate = COALESCE(p->'productivity_mandate', productivity_mandate),
    kpis = COALESCE(p->'kpis', kpis),
    academic_eligibility = COALESCE(p->'academic_eligibility', academic_eligibility),
    curriculum_map = COALESCE(p->'curriculum_map', curriculum_map),
    competencies = COALESCE(p->'competencies', competencies),
    assessment_design = COALESCE(p->'assessment_design', assessment_design),
    interview_framework = COALESCE(p->'interview_framework', interview_framework),
    selection_weights = COALESCE(p->'selection_weights', selection_weights),
    weights_version = CASE WHEN p ? 'selection_weights' THEN weights_version + 1 ELSE weights_version END,
    commercial_objective = COALESCE(p->'commercial_objective', commercial_objective),
    development_plan = COALESCE(p->'development_plan', development_plan),
    public_preview = COALESCE(p->'public_preview', public_preview),
    application_questions = COALESCE(p->'application_questions', application_questions),
    spec_status = COALESCE(NULLIF(p->>'spec_status',''), spec_status)
  WHERE vacancy_id = p_vacancy;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  VALUES (auth.uid(), 'internship_programme_updated', 'rec_vacancies', p_vacancy, p);

  RETURN public.rec_internship_validate(p_vacancy);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rec_internship_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_internship_update(uuid, jsonb) TO authenticated, service_role;