-- ============================================================================
-- Publication contract orchestration — consolidation
-- Provisioning ≠ Approval ≠ Publication ≠ Certification.
-- ============================================================================

-- 1. Blueprints become requirement-version aware -------------------------------
ALTER TABLE public.rec_blueprints
  ADD COLUMN IF NOT EXISTS requirement_set_id uuid REFERENCES public.rec_document_requirement_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requirement_version integer,
  ADD COLUMN IF NOT EXISTS vacancy_content_version integer;

COMMENT ON COLUMN public.rec_blueprints.requirement_set_id IS
  'Requirement contract this form version was compiled from. A change of contract produces a NEW blueprint version, never an edit.';

-- A blueprint that applications are bound to is historical evidence.
CREATE OR REPLACE FUNCTION public._rec_blueprint_bound_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_bound integer;
BEGIN
  IF (NEW.sections, NEW.document_requirements, NEW.assessment, NEW.cover_letter_mode,
      NEW.requirement_set_id, NEW.version)
     IS NOT DISTINCT FROM
     (OLD.sections, OLD.document_requirements, OLD.assessment, OLD.cover_letter_mode,
      OLD.requirement_set_id, OLD.version) THEN
    RETURN NEW; -- status / provenance movement only
  END IF;

  SELECT count(*) INTO v_bound FROM public.rec_applications WHERE blueprint_id = OLD.id;
  IF v_bound > 0 THEN
    RAISE EXCEPTION 'blueprint % is bound to % application(s) and cannot be edited; provision a new version instead', OLD.id, v_bound;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_blueprint_bound_immutable ON public.rec_blueprints;
CREATE TRIGGER trg_rec_blueprint_bound_immutable
  BEFORE UPDATE ON public.rec_blueprints
  FOR EACH ROW EXECUTE FUNCTION public._rec_blueprint_bound_immutable();

-- 2. Requirement provisioning — provisioning is not approval -------------------
CREATE OR REPLACE FUNCTION public.rec_requirement_set_provision(p_vacancy uuid, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.rec_vacancies;
  v_universal uuid;
  v_set uuid;
  v_version integer;
  v_rules integer := 0;
  v_cfg record;
  v_any_cfg record;
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
                            'version', v_version, 'rules', v_rules, 'source','universal_template',
                            'vacancy_content_version', v.content_version);
END; $$;

-- 3. Blueprint provisioning — bound to the resolved contract, versioned ---------
CREATE OR REPLACE FUNCTION public.rec_blueprint_provision(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- The contract the form must mirror: the vacancy's own active set, else universal.
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

  -- Display mirror of the resolved contract only. The requirement engine, not this
  -- list, decides completeness (`owned_by`).
  v_docs := coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'doc_type', r.doc_key, 'doc_key', r.doc_key, 'label', r.label,
             'required', r.mandatory, 'hard_requirement', coalesce(r.hard_requirement, false),
             'requirement_text', r.requirement_text,
             'owned_by', 'requirement_engine') ORDER BY r.ord)
      FROM public.rec_document_requirement_rules r
     WHERE r.set_id = v_req.id), '[]'::jsonb);

  IF jsonb_array_length(v_docs) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'blocked','EMPTY_REQUIREMENT_CONTRACT',
      'owner','Recruitment lead',
      'reason', format('Requirement contract v%s has no rules — the application form would ask for nothing.', v_req.version));
  END IF;

  -- Never mutate a blueprint: retire and supersede with a new version.
  IF v_bp.id IS NOT NULL THEN
    UPDATE public.rec_blueprints SET status = 'retired', updated_at = now() WHERE id = v_bp.id;
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.rec_blueprints WHERE vacancy_id = p_vacancy;

  INSERT INTO public.rec_blueprints(vacancy_id, version, status, cover_letter_mode,
                                    sections, document_requirements,
                                    requirement_set_id, requirement_version, vacancy_content_version)
  VALUES (p_vacancy, v_version, 'active',
          CASE WHEN v_intern THEN 'optional' ELSE 'required' END,
          v_sections, v_docs, v_req.id, v_req.version, v.content_version)
  RETURNING id INTO v_new;

  RETURN jsonb_build_object('ok', true, 'created', true, 'blueprint_id', v_new,
                            'version', v_version, 'internship', v_intern,
                            'requirement_set_id', v_req.id, 'requirement_version', v_req.version,
                            'superseded_blueprint_id', v_bp.id,
                            'document_requirements', jsonb_array_length(v_docs));
END; $$;

-- 4. Auto-provisioning at creation: independent steps, no shared swallow --------
CREATE OR REPLACE FUNCTION public.rec_vacancy_autoprovision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    PERFORM public.rec_requirement_set_provision(NEW.id, 'Auto-provisioned at vacancy creation.');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Vacancy % requirement provisioning failed: %', NEW.id, SQLERRM;
  END;
  -- Independent block: a requirement failure must never skip the blueprint.
  BEGIN
    PERFORM public.rec_blueprint_provision(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Vacancy % blueprint provisioning failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END; $$;

-- 5. The orchestrator — one deterministic, idempotent preparation ---------------
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

  -- Two administrators preparing the same vacancy serialise here; no duplicates.
  PERFORM pg_advisory_xact_lock(hashtextextended('rec_prepare_publication', 0), hashtextextended(p_vacancy::text, 0));

  SELECT * INTO c FROM public.rec_application_contract WHERE id;

  -- Step 1 — requirement contract (provisioning never approves).
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

  -- Step 2 — application blueprint, bound to whatever contract is active.
  v_bp := public.rec_blueprint_provision(p_vacancy);
  v_steps := v_steps || jsonb_build_object('step','application_blueprint','result', v_bp);
  IF NOT coalesce((v_bp->>'ok')::boolean, false) THEN
    v_actions := v_actions || jsonb_build_object(
      'key', coalesce(v_bp->>'blocked','APPLICATION_BLUEPRINT'),
      'label', coalesce(v_bp->>'reason','The application blueprint could not be provisioned.'),
      'owner', coalesce(v_bp->>'owner','Recruitment lead'),
      'route', '/staff/recruitment/requirements');
  END IF;

  -- Step 3 — assessment contract: resolved, never invented.
  SELECT count(*) INTO v_comp FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy;
  SELECT count(*) INTO v_tmpl FROM public.rec_assessment_templates
   WHERE vacancy_id = p_vacancy AND status = 'active';
  v_steps := v_steps || jsonb_build_object('step','assessment_contract','result',
    jsonb_build_object('competencies', v_comp, 'active_papers', v_tmpl,
      'state', CASE WHEN v_comp = 0 THEN 'NOT_APPLICABLE' WHEN v_tmpl > 0 THEN 'RESOLVED' ELSE 'PENDING' END));

  -- Step 4 — careers build: registered by the deployed bundle, not derivable here.
  v_steps := v_steps || jsonb_build_object('step','careers_build','result',
    jsonb_build_object('build_id', c.careers_build_id,
                       'state', CASE WHEN coalesce(c.careers_build_id,'') <> '' THEN 'REGISTERED' ELSE 'MISSING' END));
  IF coalesce(c.careers_build_id,'') = '' THEN
    v_actions := v_actions || jsonb_build_object('key','CAREERS_BUILD',
      'label','No deployed careers build is registered as authoritative.',
      'owner','Platform engineering','route','/staff/recruitment/publication-health');
  END IF;

  -- Step 5 — certification, executed for real once prerequisites hold.
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

  INSERT INTO public.rec_audit_log(entity_type, entity_id, action, detail, actor_id)
  VALUES ('vacancy', p_vacancy, 'prepare_publication',
          jsonb_build_object('steps', v_steps, 'actions_required', v_actions,
                             'verdict', v_readiness->>'verdict'), auth.uid());

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

REVOKE ALL ON FUNCTION public.rec_requirement_set_provision(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_requirement_set_provision(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_set_provision(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.rec_blueprint_provision(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_blueprint_provision(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_blueprint_provision(uuid) TO authenticated, service_role;

-- 6. Readiness names the approval blocker explicitly ---------------------------
CREATE OR REPLACE FUNCTION public.rec_publication_readiness(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_spec public.rec_internship_specs;
  v_bp public.rec_blueprints;
  v_req record;
  v_cfg record;
  v_e2e public.rec_publication_gate_runs;
  v_gate jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_comp integer;
  v_tmpl integer;
  v_prereq_ok boolean;
  v_doc_state text;
  v_doc_reason text;
  v_doc_action text;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RETURN jsonb_build_object('verdict','UNKNOWN','reason','Vacancy not found.'); END IF;

  SELECT * INTO c FROM public.rec_application_contract WHERE id;
  SELECT * INTO v_spec FROM public.rec_internship_specs WHERE vacancy_id = p_vacancy;
  SELECT * INTO v_bp FROM public.rec_blueprints WHERE vacancy_id = p_vacancy AND status = 'active';
  SELECT rs.id, rs.version, rs.vacancy_content_version INTO v_req
    FROM public.rec_document_requirement_sets rs
   WHERE rs.vacancy_id = p_vacancy AND rs.status = 'active' ORDER BY rs.version DESC LIMIT 1;
  SELECT rs.version, rs.status INTO v_cfg
    FROM public.rec_document_requirement_sets rs
   WHERE rs.vacancy_id = p_vacancy AND rs.status IN ('draft','review','approved')
     AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = rs.id)
   ORDER BY rs.version DESC LIMIT 1;
  SELECT * INTO v_e2e FROM public.rec_publication_gate_runs
   WHERE vacancy_id = p_vacancy AND gate = 'E2E' ORDER BY created_at DESC LIMIT 1;
  v_gate := public.rec_publication_gate_status(p_vacancy);

  SELECT count(*) INTO v_comp FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy;
  SELECT count(*) INTO v_tmpl FROM public.rec_assessment_templates
   WHERE vacancy_id = p_vacancy AND status = 'active';

  v_domains := v_domains || jsonb_build_object(
    'key','programme','label','Programme configuration',
    'state', CASE WHEN v.employment_type = 'internship' AND v_spec.id IS NULL THEN 'FAIL' ELSE 'PASS' END,
    'reason', CASE WHEN v.employment_type = 'internship' AND v_spec.id IS NULL
                   THEN 'The internship has no programme specification.' ELSE 'Vacancy configuration is present.' END,
    'dependency', null, 'owner','Recruitment lead','action','Open the internship builder');

  v_domains := v_domains || jsonb_build_object(
    'key','education','label','Education requirements',
    'state', CASE WHEN public.rec_education_policy(p_vacancy) <> '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END,
    'reason','The education policy engine resolves an executable contract for this vacancy.',
    'dependency','programme','owner','Recruitment lead','action','Configure education requirements');

  -- Document requirement contract, with the approval blocker named explicitly.
  IF v_req.version IS NOT NULL
     AND coalesce(v_req.vacancy_content_version,-1) = coalesce(v.content_version,-1) THEN
    v_doc_state := 'PASS';
    v_doc_reason := format('Requirement contract v%s bound to content v%s.', v_req.version, v.content_version);
    v_doc_action := 'Review requirement contract';
  ELSIF v_cfg.version IS NOT NULL AND v_cfg.status IN ('draft','review') THEN
    v_doc_state := 'FAIL';
    v_doc_reason := format('Requirement version v%s is %s. Approve it — automated provisioning may not publish an unapproved contract.',
                           v_cfg.version, upper(v_cfg.status));
    v_doc_action := 'Approve requirement version';
  ELSIF v_req.version IS NULL THEN
    v_doc_state := 'FAIL';
    v_doc_reason := 'No vacancy-scoped requirement contract is active.';
    v_doc_action := 'Prepare publication contract';
  ELSE
    v_doc_state := 'FAIL';
    v_doc_reason := format('Contract is bound to content v%s; the vacancy is v%s.',
                           v_req.vacancy_content_version, v.content_version);
    v_doc_action := 'Prepare publication contract';
  END IF;

  v_domains := v_domains || jsonb_build_object(
    'key','document_contract','label','Document requirement contract',
    'state', v_doc_state, 'reason', v_doc_reason,
    'dependency','education','owner','Recruitment lead','action', v_doc_action);

  v_domains := v_domains || jsonb_build_object(
    'key','blueprint','label','Application blueprint',
    'state', CASE WHEN v_bp.id IS NULL THEN 'FAIL'
                  WHEN v_req.id IS NOT NULL AND v_bp.requirement_set_id IS DISTINCT FROM v_req.id THEN 'FAIL'
                  ELSE 'PASS' END,
    'reason', CASE WHEN v_bp.id IS NULL THEN 'No active application form exists for this vacancy.'
                   WHEN v_req.id IS NOT NULL AND v_bp.requirement_set_id IS DISTINCT FROM v_req.id
                     THEN format('Blueprint v%s was compiled from a different requirement version — it must be re-provisioned.', v_bp.version)
                   ELSE format('Blueprint v%s active, compiled from requirement v%s.',
                               v_bp.version, coalesce(v_bp.requirement_version, v_req.version)) END,
    'dependency','document_contract','owner','Recruitment lead','action','Prepare publication contract');

  v_domains := v_domains || jsonb_build_object(
    'key','competencies','label','Competency framework',
    'state', CASE WHEN v_comp > 0 THEN 'PASS' ELSE 'PENDING' END,
    'reason', format('%s competencies mapped to this vacancy.', v_comp),
    'dependency','programme','owner','SME / Hiring manager','action','Map competencies');

  v_domains := v_domains || jsonb_build_object(
    'key','assessment','label','Assessment blueprint',
    'state', CASE WHEN v_comp = 0 THEN 'NOT_APPLICABLE' WHEN v_tmpl > 0 THEN 'PASS' ELSE 'PENDING' END,
    'reason', CASE WHEN v_comp = 0 THEN 'No competency map — an assessment paper cannot be composed yet.'
                   WHEN v_tmpl > 0 THEN 'An active assessment paper is bound to this vacancy.'
                   ELSE 'Competencies are mapped but no paper has been activated.' END,
    'dependency','competencies','owner','SME / HR','action','Compose assessment paper');

  v_domains := v_domains || jsonb_build_object(
    'key','careers_build','label','Careers build registration',
    'state', CASE WHEN coalesce(c.careers_build_id,'') <> '' THEN 'PASS' ELSE 'FAIL' END,
    'reason', CASE WHEN coalesce(c.careers_build_id,'') <> ''
                   THEN format('Build %s registered as authoritative.', c.careers_build_id)
                   ELSE 'No deployed careers build is registered — the stale-bundle handshake cannot be evaluated.' END,
    'dependency', null, 'owner','Platform engineering','action','Register current deployment');

  v_domains := v_domains || jsonb_build_object(
    'key','security','label','Validation & access control',
    'state', CASE WHEN (v_gate->'gates'->'validation'->>'passed')::boolean THEN 'PASS' ELSE 'FAIL' END,
    'reason', coalesce(nullif((v_gate->'gates'->'validation'->'blockers')::text,'[]'),
                       'Approval, status, public link and org position are all in order.'),
    'dependency','programme','owner','Recruitment lead','action','Resolve validation blockers');

  v_prereq_ok := v_bp.id IS NOT NULL AND v_req.version IS NOT NULL AND coalesce(c.careers_build_id,'') <> '';
  v_domains := v_domains || jsonb_build_object(
    'key','e2e','label','Synthetic end-to-end run',
    'state', CASE WHEN NOT v_prereq_ok THEN 'PENDING'
                  WHEN (v_gate->'gates'->'e2e'->>'passed')::boolean THEN 'PASS' ELSE 'FAIL' END,
    'reason', CASE WHEN NOT v_prereq_ok
                     THEN 'Cannot run until the blueprint, requirement contract and careers build exist.'
                   ELSE coalesce(nullif((v_gate->'gates'->'e2e'->'blockers')::text,'[]'),
                                 format('%s of %s cases passed.', v_e2e.cases_passed, v_e2e.cases_total)) END,
    'dependency','blueprint','owner','Recruitment engineering','action','Prepare publication contract');

  v_domains := v_domains || jsonb_build_object(
    'key','publication','label','Publication approval',
    'state', CASE WHEN v.publication_status = 'published' THEN 'PASS' ELSE 'PENDING' END,
    'reason', format('Publication status is %s; gate verdict is %s.', v.publication_status, v_gate->>'verdict'),
    'dependency','e2e','owner','Hiring authority','action','Publish vacancy');

  RETURN jsonb_build_object(
    'vacancy_id', v.id, 'vacancy_no', v.vacancy_no, 'title', v.title,
    'employment_type', v.employment_type, 'content_version', v.content_version,
    'publication_status', v.publication_status, 'checked_at', now(),
    'domains', v_domains,
    'gate', v_gate,
    'verdict', v_gate->>'verdict');
END; $$;