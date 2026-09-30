CREATE OR REPLACE FUNCTION public.rec_blueprint_provision(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $wrap$
DECLARE
  v_cfg record;
  v_active_id uuid;
BEGIN
  -- Governance guard: when this vacancy has its OWN configured requirement version
  -- that is not yet approved, the form must NOT be mirrored from the universal
  -- template. Publication waits for the approval decision.
  SELECT s.id INTO v_active_id
    FROM public.rec_document_requirement_sets s
   WHERE s.vacancy_id = p_vacancy AND s.status = 'active'
   ORDER BY s.version DESC LIMIT 1;

  IF v_active_id IS NULL THEN
    SELECT s.version, s.status, s.id INTO v_cfg
      FROM public.rec_document_requirement_sets s
     WHERE s.vacancy_id = p_vacancy
       AND s.status IN ('draft','review')
       AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id)
     ORDER BY s.version DESC LIMIT 1;

    IF v_cfg.version IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'blocked','REQUIREMENT_VERSION_NOT_APPROVED',
        'owner','Hiring authority',
        'set_id', v_cfg.id,
        'version', v_cfg.version,
        'status', v_cfg.status,
        'reason', format('This vacancy defines its own requirement version v%s (%s). Approve it — the application form may not be mirrored from the universal template instead.',
                         v_cfg.version, upper(v_cfg.status)));
    END IF;
  END IF;

  RETURN public.rec_blueprint_provision_resolved(p_vacancy);
END;
$wrap$;

-- The original resolution/creation logic, unchanged in behaviour, moved behind the guard.
CREATE OR REPLACE FUNCTION public.rec_blueprint_provision_resolved(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v public.rec_vacancies;
  v_intern boolean;
  v_bp public.rec_blueprints;
  v_version integer;
  v_docs jsonb;
  v_sections jsonb;
  v_new uuid;
  v_req record;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  SELECT s.id, s.version, s.scope INTO v_req
    FROM public.rec_document_requirement_sets s
   WHERE s.status = 'active' AND s.vacancy_id = p_vacancy
   ORDER BY s.version DESC LIMIT 1;
  IF v_req.id IS NULL THEN
    SELECT s.id, s.version, s.scope INTO v_req
      FROM public.rec_document_requirement_sets s
     WHERE s.status = 'active' AND s.scope = 'universal'
     ORDER BY s.version DESC LIMIT 1;
  END IF;
  IF v_req.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blocked','NO_REQUIREMENT_CONTRACT',
      'owner','Recruitment lead',
      'reason','No active requirement contract resolves for this vacancy — the form has nothing to mirror.');
  END IF;

  SELECT * INTO v_bp FROM public.rec_blueprints
   WHERE vacancy_id = p_vacancy AND status = 'active';

  IF v_bp.id IS NOT NULL
     AND v_bp.requirement_set_id = v_req.id
     AND coalesce(v_bp.vacancy_content_version, -1) = coalesce(v.content_version, -1) THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'blueprint_id', v_bp.id,
                              'version', v_bp.version, 'requirement_version', v_bp.requirement_version,
                              'source','existing_active');
  END IF;

  v_intern := v.employment_type = 'internship'
              OR EXISTS (SELECT 1 FROM public.rec_internship_specs s WHERE s.vacancy_id = p_vacancy);

  v_sections := CASE WHEN v_intern
    THEN '{"education": true, "attachment": true, "employment": false, "qualifications": false, "skills": false}'::jsonb
    ELSE '{"education": true, "employment": true, "qualifications": true, "skills": true}'::jsonb END;

  v_docs := coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'doc_type', r.doc_key, 'doc_key', r.doc_key, 'label', r.label,
             'required', r.mandatory, 'hard_requirement', coalesce(r.hard_requirement, false),
             'requirement_text', r.requirement_text,
             'evidence_kind', r.evidence_kind,
             'accepted_evidence_types', r.accepted_evidence_types,
             'declaration_prompt', r.declaration_prompt,
             'response_required', coalesce(r.response_required, false))
             ORDER BY r.sort_order NULLS LAST, r.label)
      FROM public.rec_document_requirement_rules r
     WHERE r.set_id = v_req.id), '[]'::jsonb);

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.rec_blueprints WHERE vacancy_id = p_vacancy;

  IF v_bp.id IS NOT NULL THEN
    UPDATE public.rec_blueprints SET status = 'retired', updated_at = now() WHERE id = v_bp.id;
  END IF;

  INSERT INTO public.rec_blueprints(vacancy_id, version, status, content,
                                    requirement_set_id, requirement_version, vacancy_content_version)
  VALUES (p_vacancy, v_version, 'active',
          jsonb_build_object('sections', v_sections, 'documents', v_docs,
                             'requirement_set_id', v_req.id, 'requirement_version', v_req.version),
          v_req.id, v_req.version, v.content_version)
  RETURNING id INTO v_new;

  RETURN jsonb_build_object('ok', true, 'created', true, 'blueprint_id', v_new,
                            'version', v_version, 'internship', v_intern,
                            'requirement_set_id', v_req.id, 'requirement_version', v_req.version,
                            'document_requirements', jsonb_array_length(v_docs),
                            'superseded_blueprint_id', v_bp.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_blueprint_provision_resolved(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_blueprint_provision_resolved(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_blueprint_provision_resolved(uuid) TO service_role;

-- Withdraw the blueprint that was mirrored from the universal template while this
-- vacancy's own requirement version is still awaiting approval.
UPDATE public.rec_blueprints
   SET status = 'retired', updated_at = now()
 WHERE vacancy_id = 'c1ef4b1e-6ff1-469f-b7e5-3d15b9a9e4d4'
   AND status = 'active'
   AND requirement_set_id = '9f959ee0-97cc-48e6-ae24-e4d97c9cf271';