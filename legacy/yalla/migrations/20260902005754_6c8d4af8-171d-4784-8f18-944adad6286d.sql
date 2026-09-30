CREATE OR REPLACE FUNCTION public.rec_requirement_set_provision(p_vacancy uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.rec_vacancies;
  v_universal uuid;
  v_set uuid;
  v_version integer;
  v_rules integer := 0;
  v_configured uuid;
  v_configured_status text;
  v_configured_version integer;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  -- 1. An active contract already bound to the current vacancy content version.
  SELECT id, version INTO v_set, v_version
    FROM public.rec_document_requirement_sets
   WHERE vacancy_id = p_vacancy AND status = 'active'
     AND coalesce(vacancy_content_version, -1) = coalesce(v.content_version, -1)
   ORDER BY version DESC LIMIT 1;
  IF v_set IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'activated', false,
                              'set_id', v_set, 'version', v_version);
  END IF;

  -- 2. Requirements the recruitment team configured for THIS vacancy take
  --    precedence over the generic template. Activate that version through the
  --    lifecycle instead of overwriting the configured contract.
  SELECT s.id, s.status, s.version
    INTO v_configured, v_configured_status, v_configured_version
    FROM public.rec_document_requirement_sets s
   WHERE s.vacancy_id = p_vacancy
     AND s.status IN ('draft','review','approved')
     AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id)
   ORDER BY s.version DESC LIMIT 1;

  IF v_configured IS NOT NULL THEN
    UPDATE public.rec_document_requirement_sets
       SET status = 'superseded', effective_until = now(),
           superseded_by_set_id = v_configured, updated_at = now()
     WHERE vacancy_id = p_vacancy AND status = 'active';

    UPDATE public.rec_document_requirement_sets
       SET status = 'active',
           vacancy_content_version = v.content_version,
           published_by = coalesce(published_by, auth.uid()),
           published_at = coalesce(published_at, now()),
           updated_at = now()
     WHERE id = v_configured;

    INSERT INTO public.rec_requirement_lifecycle_events(
      set_id, vacancy_id, version, action, status_before, status_after, note, detail, actor_id)
    VALUES (v_configured, p_vacancy, v_configured_version, 'publish', v_configured_status, 'active',
            'Activated during publication provisioning — the vacancy''s own configured requirements were used.',
            jsonb_build_object('source','rec_requirement_set_provision',
                               'vacancy_content_version', v.content_version),
            auth.uid());

    SELECT count(*) INTO v_rules FROM public.rec_document_requirement_rules WHERE set_id = v_configured;
    RETURN jsonb_build_object('ok', true, 'created', false, 'activated', true,
                              'set_id', v_configured, 'version', v_configured_version,
                              'rules', v_rules, 'vacancy_content_version', v.content_version);
  END IF;

  -- 3. No vacancy-specific configuration: fall back to the universal template.
  SELECT id INTO v_universal FROM public.rec_document_requirement_sets
   WHERE scope = 'universal' AND status = 'active' LIMIT 1;
  IF v_universal IS NULL THEN
    RAISE EXCEPTION 'No active universal document requirement template exists — configure the universal set first.';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.rec_document_requirement_sets WHERE vacancy_id = p_vacancy;

  UPDATE public.rec_document_requirement_sets
     SET status = 'superseded', effective_until = now(), updated_at = now()
   WHERE vacancy_id = p_vacancy AND status = 'active';

  INSERT INTO public.rec_document_requirement_sets(
    vacancy_id, scope, vacancy_content_version, version, status, notes, created_by, published_by, published_at)
  VALUES (p_vacancy, 'vacancy', v.content_version, v_version, 'active',
          coalesce(p_notes, format('Provisioned from the universal requirement template for content v%s.',
                                   coalesce(v.content_version, 0))),
          auth.uid(), auth.uid(), now())
  RETURNING id INTO v_set;

  INSERT INTO public.rec_document_requirement_rules(
    set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year,
    allow_consolidated, requires_verification, condition, why_required, ord,
    requirement_text, hard_requirement, evidence_kind, accepted_evidence_types,
    declaration_prompt, response_required)
  SELECT v_set, r.doc_key, r.label, r.doc_class, r.doc_type, r.mandatory, r.per_completed_year,
         r.allow_consolidated, r.requires_verification, r.condition, r.why_required, r.ord,
         r.requirement_text, r.hard_requirement, r.evidence_kind, r.accepted_evidence_types,
         r.declaration_prompt, r.response_required
    FROM public.rec_document_requirement_rules r
   WHERE r.set_id = v_universal;
  SELECT count(*) INTO v_rules FROM public.rec_document_requirement_rules WHERE set_id = v_set;

  INSERT INTO public.rec_requirement_lifecycle_events(
    set_id, vacancy_id, version, action, status_before, status_after, note, detail, actor_id)
  VALUES (v_set, p_vacancy, v_version, 'publish', NULL, 'active',
          'Provisioned from the universal requirement template.',
          jsonb_build_object('source','rec_requirement_set_provision','template_set_id', v_universal),
          auth.uid());

  RETURN jsonb_build_object('ok', true, 'created', true, 'activated', true, 'set_id', v_set,
                            'version', v_version, 'rules', v_rules,
                            'vacancy_content_version', v.content_version);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_requirement_set_provision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_set_provision(uuid, text) TO authenticated, service_role;