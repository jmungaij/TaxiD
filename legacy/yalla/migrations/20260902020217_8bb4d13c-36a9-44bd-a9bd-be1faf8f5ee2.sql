CREATE OR REPLACE FUNCTION public.rec_requirement_set_provision(p_vacancy uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.rec_vacancies;
  v_universal uuid;
  v_set uuid;
  v_version integer;
  v_rules integer := 0;
  v_cfg record;
  v_any_cfg record;
  v_stale record;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  -- (a) An active contract already bound to the current vacancy content version.
  SELECT id, version INTO v_set, v_version
    FROM public.rec_document_requirement_sets
   WHERE vacancy_id = p_vacancy AND status = 'active'
     AND coalesce(vacancy_content_version, -1) = coalesce(v.content_version, -1)
   ORDER BY version DESC LIMIT 1;
  IF v_set IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'activated', false,
                              'set_id', v_set, 'version', v_version, 'source', 'existing_active');
  END IF;

  -- (b) An APPROVED vacancy-specific version may be activated. Draft / review
  --     configurations are never published by an automated provisioner: that is a
  --     separate, authorised lifecycle transition (rec_requirement_lifecycle_action).
  SELECT s.id, s.status, s.version INTO v_cfg
    FROM public.rec_document_requirement_sets s
   WHERE s.vacancy_id = p_vacancy AND s.status = 'approved'
     AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id)
   ORDER BY s.version DESC LIMIT 1;

  IF v_cfg.id IS NOT NULL THEN
    UPDATE public.rec_document_requirement_sets
       SET status = 'superseded', effective_until = now(),
           superseded_by_set_id = v_cfg.id, updated_at = now()
     WHERE vacancy_id = p_vacancy AND status = 'active';

    UPDATE public.rec_document_requirement_sets
       SET status = 'active',
           vacancy_content_version = v.content_version,
           published_by = coalesce(published_by, auth.uid()),
           published_at = coalesce(published_at, now()),
           updated_at = now()
     WHERE id = v_cfg.id;

    INSERT INTO public.rec_requirement_lifecycle_events(
      set_id, vacancy_id, version, action, status_before, status_after, note, detail, actor_id)
    VALUES (v_cfg.id, p_vacancy, v_cfg.version, 'publish', v_cfg.status, 'active',
            'Approved vacancy requirement version activated as the publication contract.',
            jsonb_build_object('source','rec_requirement_set_provision',
                               'vacancy_content_version', v.content_version),
            auth.uid());

    SELECT count(*) INTO v_rules FROM public.rec_document_requirement_rules WHERE set_id = v_cfg.id;
    RETURN jsonb_build_object('ok', true, 'created', false, 'activated', true,
                              'set_id', v_cfg.id, 'version', v_cfg.version, 'rules', v_rules,
                              'source', 'vacancy_approved',
                              'vacancy_content_version', v.content_version);
  END IF;

  -- (c) A vacancy-specific configuration exists but is not approved. The generic
  --     template must NOT override it — that was the original defect.
  SELECT s.id, s.status, s.version INTO v_any_cfg
    FROM public.rec_document_requirement_sets s
   WHERE s.vacancy_id = p_vacancy AND s.status IN ('draft','review')
     AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id)
   ORDER BY s.version DESC LIMIT 1;

  IF v_any_cfg.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'created', false, 'activated', false,
      'blocked', 'REQUIREMENT_VERSION_NOT_APPROVED',
      'set_id', v_any_cfg.id, 'version', v_any_cfg.version, 'status', v_any_cfg.status,
      'owner', 'Hiring authority',
      'reason', format('This vacancy''s requirement version v%s is %s. Approve it before it can become the publication contract.',
                       v_any_cfg.version, upper(v_any_cfg.status)));
  END IF;

  -- (a2) CONTENT-VERSION DRIFT. An enforced requirement contract exists, but it
  --      was bound to an earlier vacancy content version (the vacancy text was
  --      edited after publication). The requirement statements themselves are
  --      unchanged, so they are carried forward verbatim into a NEW immutable
  --      version bound to the current content version; the old version is
  --      superseded, never mutated, and the carry-forward is recorded in the
  --      requirement lifecycle history. Certification is re-executed by the
  --      caller against the new binding, so no evidence is inherited.
  SELECT s.id, s.version, s.vacancy_content_version INTO v_stale
    FROM public.rec_document_requirement_sets s
   WHERE s.vacancy_id = p_vacancy AND s.status = 'active'
     AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id)
   ORDER BY s.version DESC LIMIT 1;

  IF v_stale.id IS NOT NULL THEN
    SELECT coalesce(max(version), 0) + 1 INTO v_version
      FROM public.rec_document_requirement_sets WHERE vacancy_id = p_vacancy;

    INSERT INTO public.rec_document_requirement_sets(
      vacancy_id, scope, vacancy_content_version, version, status, notes,
      created_by, supersedes_set_id)
    VALUES (p_vacancy, 'vacancy', v.content_version, v_version, 'draft',
            coalesce(p_notes, format('Carried forward from requirement v%s (content v%s) after the vacancy advanced to content v%s. Requirement statements unchanged.',
                                     v_stale.version, coalesce(v_stale.vacancy_content_version, 0), coalesce(v.content_version, 0))),
            auth.uid(), v_stale.id)
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
     WHERE r.set_id = v_stale.id;
    SELECT count(*) INTO v_rules FROM public.rec_document_requirement_rules WHERE set_id = v_set;

    UPDATE public.rec_document_requirement_sets
       SET status = 'superseded', effective_until = now(),
           superseded_by_set_id = v_set, updated_at = now()
     WHERE id = v_stale.id;

    UPDATE public.rec_document_requirement_sets
       SET status = 'active',
           published_by = auth.uid(), published_at = now(), updated_at = now()
     WHERE id = v_set;

    INSERT INTO public.rec_requirement_lifecycle_events(
      set_id, vacancy_id, version, action, status_before, status_after, note, detail, actor_id)
    VALUES (v_set, p_vacancy, v_version, 'publish', 'draft', 'active',
            format('Re-bound to vacancy content v%s. Requirement statements copied verbatim from v%s; no requirement was added, removed or altered.',
                   coalesce(v.content_version, 0), v_stale.version),
            jsonb_build_object('source','rec_requirement_set_provision',
                               'rebind', true,
                               'supersedes_set_id', v_stale.id,
                               'previous_version', v_stale.version,
                               'previous_content_version', v_stale.vacancy_content_version,
                               'vacancy_content_version', v.content_version,
                               'rules_copied', v_rules),
            auth.uid());

    RETURN jsonb_build_object('ok', true, 'created', true, 'activated', true, 'rebound', true,
                              'set_id', v_set, 'version', v_version, 'rules', v_rules,
                              'source','content_version_rebind',
                              'supersedes_set_id', v_stale.id,
                              'vacancy_content_version', v.content_version);
  END IF;

  -- (d) No vacancy-specific configuration at all: derive from the universal template.
  SELECT id INTO v_universal FROM public.rec_document_requirement_sets
   WHERE scope = 'universal' AND status = 'active' LIMIT 1;
  IF v_universal IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'blocked','NO_UNIVERSAL_TEMPLATE',
      'owner','Recruitment lead',
      'reason','No active universal document requirement template exists and this vacancy has no requirements of its own.');
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.rec_document_requirement_sets WHERE vacancy_id = p_vacancy;

  UPDATE public.rec_document_requirement_sets
     SET status = 'superseded', effective_until = now(), updated_at = now()
   WHERE vacancy_id = p_vacancy AND status = 'active';

  INSERT INTO public.rec_document_requirement_sets(
    vacancy_id, scope, vacancy_content_version, version, status, notes, created_by)
  VALUES (p_vacancy, 'vacancy', v.content_version, v_version, 'draft',
          coalesce(p_notes, format('Provisioned from the universal requirement template for content v%s.',
                                   coalesce(v.content_version, 0))),
          auth.uid())
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

  UPDATE public.rec_document_requirement_sets
     SET status = 'active', published_by = auth.uid(), published_at = now(), updated_at = now()
   WHERE id = v_set;

  INSERT INTO public.rec_requirement_lifecycle_events(
    set_id, vacancy_id, version, action, status_before, status_after, note, detail, actor_id)
  VALUES (v_set, p_vacancy, v_version, 'publish', 'draft', 'active',
          'Provisioned from the universal requirement template.',
          jsonb_build_object('source','rec_requirement_set_provision','template_set_id', v_universal),
          auth.uid());

  RETURN jsonb_build_object('ok', true, 'created', true, 'activated', true, 'set_id', v_set,
                            'version', v_version, 'rules', v_rules, 'source','universal_template',
                            'vacancy_content_version', v.content_version);
END; $function$;

REVOKE ALL ON FUNCTION public.rec_requirement_set_provision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_set_provision(uuid, text) TO authenticated, service_role;