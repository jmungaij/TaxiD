CREATE OR REPLACE FUNCTION public.rec_vacancy_prepare_publication(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_steps jsonb := '[]'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_req jsonb;
  v_bp jsonb;
  v_cert jsonb;
  v_comp integer;
  v_tmpl integer;
  v_readiness jsonb;
  v_ready integer := 0;
  v_total integer := 0;
  d jsonb;
BEGIN
  IF NOT (public.rec_can_write() OR public.rec_is_hiring_authority()) THEN
    RAISE EXCEPTION 'Not authorised to prepare a vacancy for publication.';
  END IF;

  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('rec_prepare_publication:' || p_vacancy::text, 0));

  SELECT * INTO c FROM public.rec_application_contract WHERE id;

  v_req := public.rec_requirement_set_provision(p_vacancy, 'Resolved by publication preparation.');
  v_steps := v_steps || jsonb_build_object('step','requirement_contract','result', v_req);
  IF NOT coalesce((v_req->>'ok')::boolean, false) THEN
    v_actions := v_actions || jsonb_build_object(
      'key', coalesce(v_req->>'blocked','REQUIREMENT_CONTRACT'),
      'label', coalesce(v_req->>'reason','The requirement contract could not be resolved.'),
      'owner', coalesce(v_req->>'owner','Recruitment lead'),
      'route', '/staff/recruitment/requirements',
      'set_id', v_req->>'set_id');
  END IF;

  v_bp := public.rec_blueprint_provision(p_vacancy);
  v_steps := v_steps || jsonb_build_object('step','application_blueprint','result', v_bp);
  IF NOT coalesce((v_bp->>'ok')::boolean, false) THEN
    v_actions := v_actions || jsonb_build_object(
      'key', coalesce(v_bp->>'blocked','APPLICATION_BLUEPRINT'),
      'label', coalesce(v_bp->>'reason','The application blueprint could not be provisioned.'),
      'owner', coalesce(v_bp->>'owner','Recruitment lead'),
      'route', '/staff/recruitment/requirements');
  END IF;

  SELECT count(*) INTO v_comp FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy;
  SELECT count(*) INTO v_tmpl FROM public.rec_assessment_templates
   WHERE vacancy_id = p_vacancy AND status = 'active';
  v_steps := v_steps || jsonb_build_object('step','assessment_contract','result',
    jsonb_build_object('competencies', v_comp, 'active_papers', v_tmpl,
      'state', CASE WHEN v_comp = 0 THEN 'NOT_APPLICABLE' WHEN v_tmpl > 0 THEN 'RESOLVED' ELSE 'PENDING' END));

  v_steps := v_steps || jsonb_build_object('step','careers_build','result',
    jsonb_build_object('build_id', c.careers_build_id,
                       'state', CASE WHEN coalesce(c.careers_build_id,'') <> '' THEN 'REGISTERED' ELSE 'MISSING' END));
  IF coalesce(c.careers_build_id,'') = '' THEN
    v_actions := v_actions || jsonb_build_object('key','CAREERS_BUILD',
      'label','No deployed careers build is registered as authoritative.',
      'owner','Platform engineering','route','/staff/recruitment/publication-health');
  END IF;

  IF coalesce((v_req->>'ok')::boolean,false) AND coalesce((v_bp->>'ok')::boolean,false)
     AND coalesce(c.careers_build_id,'') <> '' THEN
    v_cert := public.rec_vacancy_certify_application(p_vacancy);
    v_steps := v_steps || jsonb_build_object('step','certification','result', v_cert);
    IF coalesce(v_cert->>'outcome','') <> 'PASS' THEN
      v_actions := v_actions || jsonb_build_object('key','CERTIFICATION',
        'label', format('End-to-end certification returned %s (%s of %s cases passed).',
                        coalesce(v_cert->>'outcome','FAIL'), coalesce(v_cert->>'cases_passed','0'),
                        coalesce(v_cert->>'cases_total','0')),
        'owner','Recruitment engineering','route','/staff/recruitment/publication-health');
    END IF;
  ELSE
    v_steps := v_steps || jsonb_build_object('step','certification','result',
      jsonb_build_object('skipped', true,
        'reason','Prerequisites are not satisfied; certification would test an incomplete contract.'));
  END IF;

  v_readiness := public.rec_publication_readiness(p_vacancy);
  FOR d IN SELECT * FROM jsonb_array_elements(v_readiness->'domains') LOOP
    IF (d->>'state') <> 'NOT_APPLICABLE' THEN
      v_total := v_total + 1;
      IF (d->>'state') = 'PASS' THEN v_ready := v_ready + 1; END IF;
    END IF;
  END LOOP;

  INSERT INTO public.rec_audit_events(actor_id, action, object_type, object_id, new_state, context, source)
  VALUES (auth.uid(), 'prepare_publication', 'vacancy', p_vacancy,
          jsonb_build_object('verdict', v_readiness->>'verdict'),
          jsonb_build_object('steps', v_steps, 'actions_required', v_actions),
          'publication_readiness_console');

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_actions) = 0,
    'vacancy_id', p_vacancy,
    'steps', v_steps,
    'actions_required', v_actions,
    'readiness_percent', CASE WHEN v_total = 0 THEN 0 ELSE round((v_ready::numeric / v_total) * 100) END,
    'readiness', v_readiness,
    'verdict', v_readiness->>'verdict');
END; $$;

REVOKE ALL ON FUNCTION public.rec_vacancy_prepare_publication(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_vacancy_prepare_publication(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_vacancy_prepare_publication(uuid) TO authenticated, service_role;