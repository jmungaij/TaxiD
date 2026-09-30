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
         year_of_study = COALESCE(i.year_of_study, ap.year_of_study::text),
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
REVOKE EXECUTE ON FUNCTION public.intern_pipeline_activate(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.intern_pipeline_activate(uuid, uuid, uuid, uuid) TO authenticated, service_role;

SELECT public.intern_recruitment_certify();