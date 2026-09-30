-- =====================================================================
-- Recruitment 360 — publication provisioning & readiness orchestration
-- Root cause: vacancy creation never provisioned the two authoritative
-- dependent artefacts (application blueprint, vacancy-scoped document
-- requirement set) and no mechanism ever registered a careers build.
-- =====================================================================

-- 1. Requirement contract provisioning (clone of the approved universal set)
CREATE OR REPLACE FUNCTION public.rec_requirement_set_provision(p_vacancy uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.rec_vacancies;
  v_universal uuid;
  v_set uuid;
  v_version integer;
  v_rules integer := 0;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  SELECT id INTO v_universal FROM public.rec_document_requirement_sets
   WHERE scope = 'universal' AND status = 'active' LIMIT 1;
  IF v_universal IS NULL THEN
    RAISE EXCEPTION 'No active universal document requirement template exists — configure the universal set first.';
  END IF;

  -- Already bound to the current vacancy content version? Nothing to do.
  SELECT id, version INTO v_set, v_version
    FROM public.rec_document_requirement_sets
   WHERE vacancy_id = p_vacancy AND status = 'active'
     AND coalesce(vacancy_content_version, -1) = coalesce(v.content_version, -1)
   ORDER BY version DESC LIMIT 1;
  IF v_set IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'set_id', v_set, 'version', v_version);
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.rec_document_requirement_sets WHERE vacancy_id = p_vacancy;

  UPDATE public.rec_document_requirement_sets
     SET status = 'superseded', updated_at = now()
   WHERE vacancy_id = p_vacancy AND status = 'active';

  INSERT INTO public.rec_document_requirement_sets(
    vacancy_id, scope, vacancy_content_version, version, status, notes, created_by)
  VALUES (p_vacancy, 'vacancy', v.content_version, v_version, 'active',
          coalesce(p_notes, format('Provisioned from the universal requirement template for content v%s.',
                                   coalesce(v.content_version, 0))),
          auth.uid())
  RETURNING id INTO v_set;

  INSERT INTO public.rec_document_requirement_rules(
    set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year,
    allow_consolidated, requires_verification, condition, why_required, ord)
  SELECT v_set, r.doc_key, r.label, r.doc_class, r.doc_type, r.mandatory, r.per_completed_year,
         r.allow_consolidated, r.requires_verification, r.condition, r.why_required, r.ord
    FROM public.rec_document_requirement_rules r
   WHERE r.set_id = v_universal;
  SELECT count(*) INTO v_rules FROM public.rec_document_requirement_rules WHERE set_id = v_set;

  RETURN jsonb_build_object('ok', true, 'created', true, 'set_id', v_set,
                           'version', v_version, 'rules', v_rules,
                           'vacancy_content_version', v.content_version);
END; $$;

-- 2. Application blueprint provisioning, derived from vacancy configuration
CREATE OR REPLACE FUNCTION public.rec_blueprint_provision(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.rec_vacancies;
  v_intern boolean;
  v_bp uuid;
  v_version integer;
  v_docs jsonb;
  v_sections jsonb;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  SELECT id, version INTO v_bp, v_version
    FROM public.rec_blueprints WHERE vacancy_id = p_vacancy AND status = 'active';
  IF v_bp IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'blueprint_id', v_bp, 'version', v_version);
  END IF;

  v_intern := v.employment_type = 'internship'
              OR EXISTS (SELECT 1 FROM public.rec_internship_specs s WHERE s.vacancy_id = p_vacancy);

  -- Interns are assessed on academic evidence and industrial attachment, not on
  -- professional history; permanent roles keep the full section set.
  v_sections := CASE WHEN v_intern
    THEN '{"education": true, "attachment": true, "employment": false, "qualifications": false, "skills": false}'::jsonb
    ELSE '{"education": true, "employment": true, "qualifications": true, "skills": true}'::jsonb END;

  v_docs := coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'doc_type', r.doc_key, 'label', r.label, 'required', r.mandatory) ORDER BY r.ord)
      FROM public.rec_document_requirement_rules r
      JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
     WHERE s.status = 'active' AND (s.vacancy_id = p_vacancy OR s.scope = 'universal')),
    '[{"doc_type": "cv", "label": "CV / Curriculum Vitae", "required": true}]'::jsonb);

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.rec_blueprints WHERE vacancy_id = p_vacancy;

  INSERT INTO public.rec_blueprints(vacancy_id, version, status, cover_letter_mode,
                                    sections, document_requirements)
  VALUES (p_vacancy, v_version, 'active',
          CASE WHEN v_intern THEN 'optional' ELSE 'required' END,
          v_sections, v_docs)
  RETURNING id INTO v_bp;

  RETURN jsonb_build_object('ok', true, 'created', true, 'blueprint_id', v_bp,
                           'version', v_version, 'internship', v_intern,
                           'document_requirements', jsonb_array_length(v_docs));
END; $$;

-- 3. One orchestration entry point for the two prerequisites
CREATE OR REPLACE FUNCTION public.rec_vacancy_provision_prerequisites(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req jsonb; v_bp jsonb;
BEGIN
  IF NOT (public.rec_can_write() OR public.rec_is_hiring_authority()) THEN
    RAISE EXCEPTION 'Not authorised to provision publication prerequisites.';
  END IF;
  v_req := public.rec_requirement_set_provision(p_vacancy);
  v_bp := public.rec_blueprint_provision(p_vacancy);
  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  VALUES (auth.uid(), 'vacancy_prerequisites_provisioned', 'rec_vacancies', p_vacancy,
          jsonb_build_object('requirement_set', v_req, 'blueprint', v_bp));
  RETURN jsonb_build_object('ok', true, 'requirement_set', v_req, 'blueprint', v_bp);
END; $$;

-- 4. Auto-provision on vacancy creation — closes the systemic gap
CREATE OR REPLACE FUNCTION public.rec_vacancy_autoprovision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.rec_requirement_set_provision(NEW.id, 'Auto-provisioned at vacancy creation.');
    PERFORM public.rec_blueprint_provision(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Provisioning must never destroy the vacancy record; the readiness model
    -- will report the missing artefact instead.
    RAISE WARNING 'Vacancy % auto-provisioning failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_vacancy_autoprovision ON public.rec_vacancies;
CREATE TRIGGER trg_rec_vacancy_autoprovision
AFTER INSERT ON public.rec_vacancies
FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_autoprovision();

-- 5. Careers build registration (the missing registration mechanism)
CREATE OR REPLACE FUNCTION public.rec_careers_build_register(p_build_id text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_build text := nullif(btrim(p_build_id), '');
BEGIN
  IF NOT (public.rec_can_write() OR public.rec_is_hiring_authority()) THEN
    RAISE EXCEPTION 'Not authorised to register a careers build.';
  END IF;
  IF v_build IS NULL OR lower(v_build) IN ('dev', 'unknown') THEN
    RAISE EXCEPTION 'A real deployed build identifier is required (received %).', coalesce(p_build_id, 'null');
  END IF;

  UPDATE public.rec_application_contract
     SET careers_build_id = v_build,
         notes = coalesce(p_notes, notes),
         updated_at = now()
   WHERE id;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, after_data)
  VALUES (auth.uid(), 'careers_build_registered', 'rec_application_contract', NULL,
          jsonb_build_object('build_id', v_build, 'notes', p_notes));

  RETURN jsonb_build_object('ok', true, 'build_id', v_build, 'registered_at', now());
END; $$;

-- 6. Executable pre-publication certification.
--    Every case runs the live authoritative engine; nothing is asserted.
CREATE OR REPLACE FUNCTION public.rec_vacancy_certify_application(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_bp public.rec_blueprints;
  v_req record;
  v_cases jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_pass integer := 0;
  v_eval jsonb;
  v_docs jsonb;
  v_policy jsonb;
  v_handshake jsonb;
  v_public jsonb;
  v_ok boolean;
  v_detail text;
  v_run jsonb;

  PROCEDURE_PLACEHOLDER boolean;
BEGIN
  IF NOT (public.rec_can_write() OR public.rec_is_hiring_authority()) THEN
    RAISE EXCEPTION 'Not authorised to run application certification.';
  END IF;

  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;
  SELECT * INTO c FROM public.rec_application_contract WHERE id;
  SELECT * INTO v_bp FROM public.rec_blueprints WHERE vacancy_id = p_vacancy AND status = 'active';
  SELECT rs.id, rs.version, rs.vacancy_content_version INTO v_req
    FROM public.rec_document_requirement_sets rs
   WHERE rs.vacancy_id = p_vacancy AND rs.status = 'active'
   ORDER BY rs.version DESC LIMIT 1;

  -- Case A — the application form resolves and offers a document contract.
  v_ok := v_bp.id IS NOT NULL AND jsonb_array_length(coalesce(v_bp.document_requirements, '[]'::jsonb)) > 0;
  v_detail := CASE WHEN v_ok THEN format('Blueprint v%s with %s document requirements.', v_bp.version,
                                          jsonb_array_length(v_bp.document_requirements))
                   ELSE 'No active application blueprint resolved for this vacancy.' END;
  v_cases := v_cases || jsonb_build_object('case','A','name','Application blueprint resolves','passed',v_ok,'detail',v_detail);
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case B — requirement contract is bound to the current vacancy version.
  v_ok := v_req.version IS NOT NULL
          AND coalesce(v_req.vacancy_content_version, -1) = coalesce(v.content_version, -1);
  v_detail := CASE WHEN v_ok THEN format('Requirement set v%s bound to content v%s.', v_req.version, v.content_version)
                   ELSE 'No active requirement set bound to the current vacancy content version.' END;
  v_cases := v_cases || jsonb_build_object('case','B','name','Document requirement contract bound','passed',v_ok,'detail',v_detail);
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case C — the education policy resolves for this vacancy.
  v_policy := public.rec_education_policy(p_vacancy);
  v_ok := v_policy IS NOT NULL AND v_policy <> '{}'::jsonb;
  v_cases := v_cases || jsonb_build_object('case','C','name','Education policy resolves','passed',v_ok,
    'detail', CASE WHEN v_ok THEN 'Education policy returned an executable contract.'
                   ELSE 'The education policy engine returned nothing for this vacancy.' END);
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case D — the live requirement engine refuses an empty document set.
  v_eval := public.rec_document_evaluate(p_vacancy, 'graduated', 'bachelors', 4, true, '[]'::jsonb);
  v_ok := (v_eval->>'complete')::boolean IS FALSE AND jsonb_array_length(coalesce(v_eval->'missing','[]'::jsonb)) > 0;
  v_cases := v_cases || jsonb_build_object('case','D','name','Missing mandatory documents are refused','passed',v_ok,
    'detail', format('%s mandatory requirements, %s reported missing.',
                     coalesce(v_eval->>'mandatory_total','0'),
                     jsonb_array_length(coalesce(v_eval->'missing','[]'::jsonb))));
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case E — a complete synthetic document set is accepted by the same engine.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'doc_key', d.doc_key,
           'academic_year', d.academic_year,
           'storage_path', 'synthetic/certification/' || d.requirement_key,
           'size_bytes', 1024,
           'upload_status', 'complete',
           'file_name', d.requirement_key || '.pdf')), '[]'::jsonb)
    INTO v_docs
    FROM public.rec_document_requirements(p_vacancy, 'graduated', 'bachelors', 4, true) d
   WHERE d.mandatory;
  v_eval := public.rec_document_evaluate(p_vacancy, 'graduated', 'bachelors', 4, true, v_docs);
  v_ok := (v_eval->>'complete')::boolean IS TRUE;
  v_cases := v_cases || jsonb_build_object('case','E','name','Complete document set is accepted','passed',v_ok,
    'detail', format('%s of %s mandatory requirements satisfied by the synthetic set.',
                     coalesce(v_eval->>'mandatory_satisfied','0'), coalesce(v_eval->>'mandatory_total','0')));
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case F — the current careers bundle passes the handshake.
  v_handshake := public.rec_public_application_contract(v.public_slug, jsonb_build_object(
    'build_id', c.careers_build_id,
    'api_contract_version', c.api_contract_version,
    'application_schema_version', c.application_schema_version));
  v_ok := coalesce(c.careers_build_id, '') <> '' AND (v_handshake->>'verdict') = 'COMPATIBLE';
  v_cases := v_cases || jsonb_build_object('case','F','name','Current careers build passes the handshake','passed',v_ok,
    'detail', format('Registered build %s, verdict %s.', coalesce(c.careers_build_id,'(none)'),
                     coalesce(v_handshake->>'verdict','(none)')));
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case G — a stale bundle is actively refused (protection proven, not assumed).
  v_handshake := public.rec_public_application_contract(v.public_slug, jsonb_build_object(
    'build_id', 'synthetic-stale-bundle',
    'api_contract_version', 0,
    'application_schema_version', 0));
  v_ok := (v_handshake->>'verdict') IN ('BUILD_TOO_OLD', 'APPLICATION_CONTRACT_INCOMPATIBLE');
  v_cases := v_cases || jsonb_build_object('case','G','name','Stale bundle is refused','passed',v_ok,
    'detail', format('Stale client verdict: %s.', coalesce(v_handshake->>'verdict','(none)')));
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  -- Case H — an unpublished vacancy is invisible to the public reader.
  v_public := public.rec_public_application_blueprint(v.public_slug);
  v_ok := (v.publication_status = 'published') = coalesce((v_public->>'open')::boolean, false);
  v_cases := v_cases || jsonb_build_object('case','H','name','Public visibility matches publication state','passed',v_ok,
    'detail', format('publication_status=%s, public reader open=%s.', v.publication_status,
                     coalesce(v_public->>'open','false')));
  v_total := v_total + 1; IF v_ok THEN v_pass := v_pass + 1; END IF;

  v_run := public.rec_record_publication_gate_run(
    p_vacancy, 'E2E',
    CASE WHEN v_pass = v_total THEN 'PASS' ELSE 'FAIL' END,
    'rec_vacancy_certify_application', v_total, v_pass, c.careers_build_id,
    jsonb_build_object(
      'cases', v_cases,
      'bindings', jsonb_build_object(
        'vacancy_id', v.id,
        'vacancy_content_version', v.content_version,
        'blueprint_id', v_bp.id,
        'blueprint_version', v_bp.version,
        'requirement_set_id', v_req.id,
        'requirement_version', v_req.version,
        'careers_build_id', c.careers_build_id,
        'api_contract_version', c.api_contract_version,
        'application_schema_version', c.application_schema_version,
        'executed_at', now())));

  RETURN jsonb_build_object('ok', true, 'outcome', CASE WHEN v_pass = v_total THEN 'PASS' ELSE 'FAIL' END,
                           'cases_total', v_total, 'cases_passed', v_pass, 'cases', v_cases, 'run', v_run);
END; $$;

-- 7. Gate status — bind E2E evidence to requirement version and careers build
CREATE OR REPLACE FUNCTION public.rec_publication_gate_status(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_req record;
  v_e2e public.rec_publication_gate_runs;
  v_val text[] := '{}';
  v_con text[] := '{}';
  v_e2e_block text[] := '{}';
  v_has_blueprint boolean;
  v_max_age interval := interval '14 days';
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN
    RETURN jsonb_build_object('verdict','UNKNOWN','reason','Vacancy not found.');
  END IF;

  IF v.approval_status <> 'approved' THEN
    v_val := v_val || format('Approval is %s — the vacancy must be approved.', v.approval_status)::text;
  END IF;
  IF v.status <> 'open' THEN
    v_val := v_val || format('Vacancy status is %s — only an open vacancy can be published.', v.status)::text;
  END IF;
  IF coalesce(btrim(v.public_slug), '') = '' THEN
    v_val := v_val || 'The vacancy has no public link (slug).'::text;
  END IF;
  IF v.position_id IS NULL AND coalesce(btrim(v.position_exception_reason), '') = '' THEN
    v_val := v_val || 'Link an approved org position, or record a position exception reason.'::text;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.rec_blueprints b WHERE b.vacancy_id = v.id AND b.status = 'active')
    INTO v_has_blueprint;
  IF NOT v_has_blueprint THEN
    v_val := v_val || 'No active application blueprint — candidates would have no form to complete.'::text;
  END IF;

  SELECT rs.version, rs.vacancy_content_version INTO v_req
  FROM public.rec_document_requirement_sets rs
  WHERE rs.vacancy_id = v.id AND rs.status = 'active'
  ORDER BY rs.version DESC LIMIT 1;

  SELECT * INTO c FROM public.rec_application_contract WHERE id;

  IF v_req.version IS NULL THEN
    v_con := v_con || 'No active document requirement set — the requirement contract is undefined.'::text;
  ELSIF coalesce(v_req.vacancy_content_version, -1) <> coalesce(v.content_version, -1) THEN
    v_con := v_con || format(
      'The requirement set was built for vacancy content v%s but the vacancy is now v%s — republish the requirement set.',
      coalesce(v_req.vacancy_content_version, 0), coalesce(v.content_version, 0))::text;
  END IF;
  IF c.id IS NULL THEN
    v_con := v_con || 'No authoritative careers application contract is configured.'::text;
  ELSIF coalesce(c.careers_build_id, '') = '' THEN
    v_con := v_con || 'No careers build is registered as current — the stale-bundle handshake cannot be evaluated.'::text;
  END IF;

  SELECT * INTO v_e2e
  FROM public.rec_publication_gate_runs r
  WHERE r.vacancy_id = v.id AND r.gate = 'E2E'
  ORDER BY r.created_at DESC LIMIT 1;

  IF v_e2e.id IS NULL THEN
    v_e2e_block := v_e2e_block || 'No end-to-end application run has been recorded for this vacancy.'::text;
  ELSE
    IF v_e2e.outcome <> 'PASS' THEN
      v_e2e_block := v_e2e_block || format('The last end-to-end run failed (%s of %s cases passed).',
        coalesce(v_e2e.cases_passed, 0), coalesce(v_e2e.cases_total, 0))::text;
    END IF;
    IF coalesce(v_e2e.content_version, -1) <> coalesce(v.content_version, -1) THEN
      v_e2e_block := v_e2e_block || format(
        'The end-to-end run covered vacancy content v%s; the vacancy is now v%s — rerun the matrix.',
        coalesce(v_e2e.content_version, 0), coalesce(v.content_version, 0))::text;
    END IF;
    IF v_req.version IS NOT NULL AND coalesce(v_e2e.requirement_version, -1) <> v_req.version THEN
      v_e2e_block := v_e2e_block || format(
        'The end-to-end run covered requirement contract v%s; the active contract is v%s — rerun the matrix.',
        coalesce(v_e2e.requirement_version, 0), v_req.version)::text;
    END IF;
    IF coalesce(c.careers_build_id, '') <> '' AND coalesce(v_e2e.build_id, '') <> coalesce(c.careers_build_id, '') THEN
      v_e2e_block := v_e2e_block || format(
        'The end-to-end run executed against careers build %s; the registered build is now %s — rerun the matrix.',
        coalesce(v_e2e.build_id, '(none)'), c.careers_build_id)::text;
    END IF;
    IF v_e2e.created_at < now() - v_max_age THEN
      v_e2e_block := v_e2e_block || format('The end-to-end evidence is older than %s.', v_max_age::text)::text;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'vacancy_id', v.id,
    'vacancy_no', v.vacancy_no,
    'title', v.title,
    'public_slug', v.public_slug,
    'content_version', v.content_version,
    'publication_status', v.publication_status,
    'checked_at', now(),
    'gates', jsonb_build_object(
      'validation', jsonb_build_object('passed', array_length(v_val,1) IS NULL, 'blockers', to_jsonb(v_val)),
      'contract', jsonb_build_object(
        'passed', array_length(v_con,1) IS NULL,
        'blockers', to_jsonb(v_con),
        'requirement_version', v_req.version,
        'authoritative_build_id', c.careers_build_id),
      'e2e', jsonb_build_object(
        'passed', array_length(v_e2e_block,1) IS NULL,
        'blockers', to_jsonb(v_e2e_block),
        'run_id', v_e2e.id,
        'suite', v_e2e.suite,
        'cases_total', v_e2e.cases_total,
        'cases_passed', v_e2e.cases_passed,
        'executed_at', v_e2e.created_at)
    ),
    'blockers', to_jsonb(v_val || v_con || v_e2e_block),
    'verdict', CASE WHEN array_length(v_val || v_con || v_e2e_block, 1) IS NULL THEN 'READY' ELSE 'BLOCKED' END
  );
END; $$;

-- 8. Ten-domain publication readiness model
CREATE OR REPLACE FUNCTION public.rec_publication_readiness(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_spec public.rec_internship_specs;
  v_bp public.rec_blueprints;
  v_req record;
  v_e2e public.rec_publication_gate_runs;
  v_gate jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_comp integer;
  v_tmpl integer;
  v_prereq_ok boolean;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RETURN jsonb_build_object('verdict','UNKNOWN','reason','Vacancy not found.'); END IF;

  SELECT * INTO c FROM public.rec_application_contract WHERE id;
  SELECT * INTO v_spec FROM public.rec_internship_specs WHERE vacancy_id = p_vacancy;
  SELECT * INTO v_bp FROM public.rec_blueprints WHERE vacancy_id = p_vacancy AND status = 'active';
  SELECT rs.version, rs.vacancy_content_version INTO v_req
    FROM public.rec_document_requirement_sets rs
   WHERE rs.vacancy_id = p_vacancy AND rs.status = 'active' ORDER BY rs.version DESC LIMIT 1;
  SELECT * INTO v_e2e FROM public.rec_publication_gate_runs
   WHERE vacancy_id = p_vacancy AND gate = 'E2E' ORDER BY created_at DESC LIMIT 1;
  v_gate := public.rec_publication_gate_status(p_vacancy);

  SELECT count(*) INTO v_comp FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy;
  SELECT count(*) INTO v_tmpl FROM public.rec_assessment_templates
   WHERE vacancy_id = p_vacancy AND status = 'active';

  -- 1 Programme configuration
  v_domains := v_domains || jsonb_build_object(
    'key','programme','label','Programme configuration',
    'state', CASE WHEN v.employment_type = 'internship' AND v_spec.id IS NULL THEN 'FAIL' ELSE 'PASS' END,
    'reason', CASE WHEN v.employment_type = 'internship' AND v_spec.id IS NULL
                   THEN 'The internship has no programme specification.' ELSE 'Vacancy configuration is present.' END,
    'dependency', null, 'owner','Recruitment lead','action','Open the internship builder');

  -- 2 Education requirements
  v_domains := v_domains || jsonb_build_object(
    'key','education','label','Education requirements',
    'state', CASE WHEN public.rec_education_policy(p_vacancy) <> '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END,
    'reason','The education policy engine resolves an executable contract for this vacancy.',
    'dependency','programme','owner','Recruitment lead','action','Configure education requirements');

  -- 3 Document requirement contract
  v_domains := v_domains || jsonb_build_object(
    'key','document_contract','label','Document requirement contract',
    'state', CASE WHEN v_req.version IS NULL THEN 'FAIL'
                  WHEN coalesce(v_req.vacancy_content_version,-1) <> coalesce(v.content_version,-1) THEN 'FAIL'
                  ELSE 'PASS' END,
    'reason', CASE WHEN v_req.version IS NULL THEN 'No vacancy-scoped requirement contract exists.'
                   WHEN coalesce(v_req.vacancy_content_version,-1) <> coalesce(v.content_version,-1)
                     THEN format('Contract is bound to content v%s; the vacancy is v%s.',
                                 v_req.vacancy_content_version, v.content_version)
                   ELSE format('Requirement contract v%s bound to content v%s.', v_req.version, v.content_version) END,
    'dependency','education','owner','Recruitment lead','action','Provision requirement contract');

  -- 4 Application blueprint
  v_domains := v_domains || jsonb_build_object(
    'key','blueprint','label','Application blueprint',
    'state', CASE WHEN v_bp.id IS NULL THEN 'FAIL' ELSE 'PASS' END,
    'reason', CASE WHEN v_bp.id IS NULL THEN 'No active application form exists for this vacancy.'
                   ELSE format('Blueprint v%s active.', v_bp.version) END,
    'dependency','document_contract','owner','Recruitment lead','action','Provision application blueprint');

  -- 5 Competency configuration
  v_domains := v_domains || jsonb_build_object(
    'key','competencies','label','Competency framework',
    'state', CASE WHEN v_comp > 0 THEN 'PASS' ELSE 'PENDING' END,
    'reason', format('%s competencies mapped to this vacancy.', v_comp),
    'dependency','programme','owner','SME / Hiring manager','action','Map competencies');

  -- 6 Assessment blueprint (not applicable until competencies exist)
  v_domains := v_domains || jsonb_build_object(
    'key','assessment','label','Assessment blueprint',
    'state', CASE WHEN v_comp = 0 THEN 'NOT_APPLICABLE' WHEN v_tmpl > 0 THEN 'PASS' ELSE 'PENDING' END,
    'reason', CASE WHEN v_comp = 0 THEN 'No competency map — an assessment paper cannot be composed yet.'
                   WHEN v_tmpl > 0 THEN 'An active assessment paper is bound to this vacancy.'
                   ELSE 'Competencies are mapped but no paper has been activated.' END,
    'dependency','competencies','owner','SME / HR','action','Compose assessment paper');

  -- 7 Careers build
  v_domains := v_domains || jsonb_build_object(
    'key','careers_build','label','Careers build registration',
    'state', CASE WHEN coalesce(c.careers_build_id,'') <> '' THEN 'PASS' ELSE 'FAIL' END,
    'reason', CASE WHEN coalesce(c.careers_build_id,'') <> ''
                   THEN format('Build %s registered as authoritative.', c.careers_build_id)
                   ELSE 'No deployed careers build is registered — the stale-bundle handshake cannot be evaluated.' END,
    'dependency', null, 'owner','Platform engineering','action','Register current deployment');

  -- 8 Security / structural validation
  v_domains := v_domains || jsonb_build_object(
    'key','security','label','Validation & access control',
    'state', CASE WHEN (v_gate->'gates'->'validation'->>'passed')::boolean THEN 'PASS' ELSE 'FAIL' END,
    'reason', coalesce(nullif((v_gate->'gates'->'validation'->'blockers')::text,'[]'),
                       'Approval, status, public link and org position are all in order.'),
    'dependency','programme','owner','Recruitment lead','action','Resolve validation blockers');

  -- 9 Synthetic end-to-end run (derived: cannot run before prerequisites pass)
  v_prereq_ok := v_bp.id IS NOT NULL AND v_req.version IS NOT NULL AND coalesce(c.careers_build_id,'') <> '';
  v_domains := v_domains || jsonb_build_object(
    'key','e2e','label','Synthetic end-to-end run',
    'state', CASE WHEN NOT v_prereq_ok THEN 'PENDING'
                  WHEN (v_gate->'gates'->'e2e'->>'passed')::boolean THEN 'PASS' ELSE 'FAIL' END,
    'reason', CASE WHEN NOT v_prereq_ok
                     THEN 'Cannot run until the blueprint, requirement contract and careers build exist.'
                   ELSE coalesce(nullif((v_gate->'gates'->'e2e'->'blockers')::text,'[]'),
                                 format('%s of %s cases passed.', v_e2e.cases_passed, v_e2e.cases_total)) END,
    'dependency','blueprint','owner','Recruitment engineering','action','Run certification');

  -- 10 Publication approval
  v_domains := v_domains || jsonb_build_object(
    'key','publication','label','Publication approval',
    'state', CASE WHEN v.publication_status = 'published' THEN 'PASS'
                  WHEN (v_gate->>'verdict') = 'READY' THEN 'PENDING' ELSE 'PENDING' END,
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

REVOKE ALL ON FUNCTION public.rec_requirement_set_provision(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_blueprint_provision(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_vacancy_provision_prerequisites(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_careers_build_register(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_vacancy_certify_application(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_publication_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_vacancy_provision_prerequisites(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_careers_build_register(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_vacancy_certify_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_publication_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_requirement_set_provision(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_blueprint_provision(uuid) TO service_role;

-- 9. Backfill: provision every approved, open vacancy that is missing artefacts
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.rec_vacancies
            WHERE approval_status = 'approved' AND status = 'open'
  LOOP
    BEGIN
      PERFORM public.rec_requirement_set_provision(r.id, 'Backfilled by publication provisioning remediation.');
      PERFORM public.rec_blueprint_provision(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Backfill failed for vacancy %: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;