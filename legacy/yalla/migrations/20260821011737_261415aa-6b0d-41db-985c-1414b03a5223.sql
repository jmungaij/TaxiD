ALTER TABLE public.rec_internship_specs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS rec_internship_specs_idempotency_key_uidx
  ON public.rec_internship_specs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rec_internship_create(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_vac uuid; v_no text; v_spec uuid; v_key text;
BEGIN
  IF NOT (public.rec_is_hiring_authority() OR public.intern_recruitment_authority(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to create an internship programme.';
  END IF;
  IF COALESCE(btrim(p->>'title'),'') = '' THEN RAISE EXCEPTION 'A programme title is required.'; END IF;

  v_key := NULLIF(btrim(COALESCE(p->>'idempotency_key','')),'');

  IF v_key IS NOT NULL THEN
    SELECT s.id, s.vacancy_id, v.vacancy_no INTO v_spec, v_vac, v_no
    FROM public.rec_internship_specs s
    JOIN public.rec_vacancies v ON v.id = s.vacancy_id
    WHERE s.idempotency_key = v_key
    LIMIT 1;
    IF v_spec IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'vacancy_id', v_vac,
                                'vacancy_no', v_no, 'spec_id', v_spec,
                                'validation', public.rec_internship_validate(v_vac));
    END IF;
  END IF;

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
    development_plan, public_preview, application_questions, position_exception_reason,
    idempotency_key, created_by)
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
    v_key,
    auth.uid())
  RETURNING id INTO v_spec;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  VALUES (auth.uid(), 'internship_programme_created', 'rec_vacancies', v_vac,
          jsonb_build_object('vacancy_no', v_no, 'spec_id', v_spec, 'title', p->>'title',
                             'idempotency_key', v_key));

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'vacancy_id', v_vac, 'vacancy_no', v_no,
                            'spec_id', v_spec, 'validation', public.rec_internship_validate(v_vac));
EXCEPTION
  WHEN unique_violation THEN
    SELECT s.id, s.vacancy_id, v.vacancy_no INTO v_spec, v_vac, v_no
    FROM public.rec_internship_specs s
    JOIN public.rec_vacancies v ON v.id = s.vacancy_id
    WHERE s.idempotency_key = v_key
    LIMIT 1;
    IF v_spec IS NULL THEN RAISE; END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'vacancy_id', v_vac,
                              'vacancy_no', v_no, 'spec_id', v_spec,
                              'validation', public.rec_internship_validate(v_vac));
END; $$;
REVOKE EXECUTE ON FUNCTION public.rec_internship_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_internship_create(jsonb) TO authenticated, service_role;