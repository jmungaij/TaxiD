-- ============================================================
-- Recruitment 360 — Candidate Document Requirement Engine
-- ============================================================

-- 1. Requirement sets (universal + per vacancy version)
CREATE TABLE IF NOT EXISTS public.rec_document_requirement_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'vacancy' CHECK (scope IN ('universal','vacancy')),
  vacancy_content_version integer,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','superseded')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_docreq_set_scope CHECK ((scope = 'universal' AND vacancy_id IS NULL) OR (scope = 'vacancy' AND vacancy_id IS NOT NULL))
);
GRANT SELECT ON public.rec_document_requirement_sets TO authenticated;
GRANT ALL ON public.rec_document_requirement_sets TO service_role;
ALTER TABLE public.rec_document_requirement_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read requirement sets" ON public.rec_document_requirement_sets
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write requirement sets" ON public.rec_document_requirement_sets
  FOR ALL TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

CREATE UNIQUE INDEX IF NOT EXISTS rec_docreq_universal_active
  ON public.rec_document_requirement_sets (scope) WHERE scope = 'universal' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS rec_docreq_vacancy_active
  ON public.rec_document_requirement_sets (vacancy_id) WHERE status = 'active' AND vacancy_id IS NOT NULL;

-- 2. Requirement rules
CREATE TABLE IF NOT EXISTS public.rec_document_requirement_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.rec_document_requirement_sets(id) ON DELETE CASCADE,
  doc_key text NOT NULL,
  label text NOT NULL,
  doc_class text NOT NULL DEFAULT 'role_specific'
    CHECK (doc_class IN ('universal','education','graduation','role_specific','optional')),
  doc_type text NOT NULL DEFAULT 'certificate'
    CHECK (doc_type IN ('cv','cover_letter','certificate','supporting')),
  mandatory boolean NOT NULL DEFAULT true,
  per_completed_year boolean NOT NULL DEFAULT false,
  allow_consolidated boolean NOT NULL DEFAULT false,
  requires_verification boolean NOT NULL DEFAULT true,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  why_required text,
  ord integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_id, doc_key)
);
GRANT SELECT ON public.rec_document_requirement_rules TO authenticated;
GRANT ALL ON public.rec_document_requirement_rules TO service_role;
ALTER TABLE public.rec_document_requirement_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read requirement rules" ON public.rec_document_requirement_rules
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write requirement rules" ON public.rec_document_requirement_rules
  FOR ALL TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- 3. Append-only document event ledger
CREATE TABLE IF NOT EXISTS public.rec_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid,
  application_id uuid,
  candidate_id uuid,
  vacancy_id uuid,
  doc_key text,
  academic_year integer,
  action text NOT NULL,
  actor_id uuid,
  actor_role text,
  previous_status text,
  new_status text,
  reason text,
  file_hash text,
  document_version integer,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rec_document_events TO authenticated;
GRANT ALL ON public.rec_document_events TO service_role;
ALTER TABLE public.rec_document_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read document events" ON public.rec_document_events
  FOR SELECT TO authenticated USING (public.rec_can_read());

CREATE OR REPLACE FUNCTION public._rec_document_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_document_events is append-only';
END; $$;
DROP TRIGGER IF EXISTS rec_document_events_immutable ON public.rec_document_events;
CREATE TRIGGER rec_document_events_immutable
  BEFORE UPDATE OR DELETE ON public.rec_document_events
  FOR EACH ROW EXECUTE FUNCTION public._rec_document_events_append_only();

CREATE INDEX IF NOT EXISTS rec_document_events_doc_idx ON public.rec_document_events(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rec_document_events_app_idx ON public.rec_document_events(application_id, created_at DESC);

-- 4. Candidate document lifecycle columns
ALTER TABLE public.rec_candidate_documents
  ADD COLUMN IF NOT EXISTS doc_key text,
  ADD COLUMN IF NOT EXISTS academic_year integer,
  ADD COLUMN IF NOT EXISTS consolidated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requirement_rule_id uuid REFERENCES public.rec_document_requirement_rules(id),
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS replaces_document_id uuid REFERENCES public.rec_candidate_documents(id),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE public.rec_candidate_documents
  DROP CONSTRAINT IF EXISTS rec_candidate_documents_verification_status_check;
ALTER TABLE public.rec_candidate_documents
  ADD CONSTRAINT rec_candidate_documents_verification_status_check
  CHECK (verification_status IN ('uploaded','pending_review','under_review','verified','rejected','replacement_required','waived','superseded'));
ALTER TABLE public.rec_candidate_documents
  DROP CONSTRAINT IF EXISTS rec_candidate_documents_upload_status_check;
ALTER TABLE public.rec_candidate_documents
  ADD CONSTRAINT rec_candidate_documents_upload_status_check
  CHECK (upload_status IN ('uploading','complete','failed'));

CREATE INDEX IF NOT EXISTS rec_candidate_documents_app_key_idx
  ON public.rec_candidate_documents(application_id, doc_key, academic_year);

-- 5. Application academic declaration
ALTER TABLE public.rec_applications
  ADD COLUMN IF NOT EXISTS education_status text,
  ADD COLUMN IF NOT EXISTS completed_years integer,
  ADD COLUMN IF NOT EXISTS consolidated_transcript boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qualification_level text,
  ADD COLUMN IF NOT EXISTS document_requirement_set_id uuid REFERENCES public.rec_document_requirement_sets(id),
  ADD COLUMN IF NOT EXISTS document_requirement_version integer;

-- ============================================================
-- 6. Requirement resolution
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_doc_condition_matches(
  p_condition jsonb, p_education_status text, p_qualification_level text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_ok boolean := true;
BEGIN
  IF p_condition ? 'education_status' THEN
    v_ok := v_ok AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_condition->'education_status') x
      WHERE lower(trim(x)) = lower(coalesce(trim(p_education_status),'')));
  END IF;
  IF p_condition ? 'qualification_level' THEN
    v_ok := v_ok AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(p_condition->'qualification_level') x
      WHERE lower(coalesce(p_qualification_level,'')) LIKE '%' || lower(trim(x)) || '%');
  END IF;
  RETURN v_ok;
END; $$;

CREATE OR REPLACE FUNCTION public.rec_document_requirements(
  p_vacancy_id uuid,
  p_education_status text DEFAULT NULL,
  p_qualification_level text DEFAULT NULL,
  p_completed_years integer DEFAULT NULL,
  p_consolidated boolean DEFAULT false)
RETURNS TABLE(
  rule_id uuid, doc_key text, requirement_key text, label text, doc_class text,
  doc_type text, mandatory boolean, academic_year integer, consolidated boolean,
  requires_verification boolean, why_required text, ord integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.rec_document_requirement_rules;
  v_years integer := greatest(coalesce(p_completed_years, 0), 0);
  v_y integer;
BEGIN
  FOR v_rule IN
    SELECT r.* FROM public.rec_document_requirement_rules r
    JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
    WHERE s.status = 'active'
      AND (s.scope = 'universal' OR s.vacancy_id = p_vacancy_id)
    ORDER BY r.ord, r.label
  LOOP
    CONTINUE WHEN NOT public.rec_doc_condition_matches(v_rule.condition, p_education_status, p_qualification_level);

    IF v_rule.per_completed_year THEN
      IF coalesce(p_consolidated, false) AND v_rule.allow_consolidated THEN
        RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':consolidated',
          v_rule.label || ' — consolidated (all completed years)', v_rule.doc_class, v_rule.doc_type,
          v_rule.mandatory, NULL::integer, true, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
      ELSE
        FOR v_y IN 1..v_years LOOP
          RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':' || v_y::text,
            v_rule.label || ' — Year ' || v_y::text, v_rule.doc_class, v_rule.doc_type,
            v_rule.mandatory, v_y, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
        END LOOP;
      END IF;
    ELSE
      RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key,
        v_rule.label, v_rule.doc_class, v_rule.doc_type, v_rule.mandatory,
        NULL::integer, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
    END IF;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_document_requirements(uuid, text, text, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_doc_condition_matches(jsonb, text, text) TO anon, authenticated;

-- Evaluate a candidate-supplied document list against resolved requirements.
CREATE OR REPLACE FUNCTION public.rec_document_evaluate(
  p_vacancy_id uuid, p_education_status text, p_qualification_level text,
  p_completed_years integer, p_consolidated boolean, p_docs jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_req record;
  v_match jsonb;
  v_satisfied boolean;
  v_total integer := 0;
  v_ok integer := 0;
BEGIN
  FOR v_req IN
    SELECT * FROM public.rec_document_requirements(
      p_vacancy_id, p_education_status, p_qualification_level, p_completed_years, p_consolidated)
  LOOP
    SELECT d INTO v_match FROM jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) d
    WHERE d->>'doc_key' = v_req.doc_key
      AND coalesce(nullif(d->>'academic_year','')::integer, -1) = coalesce(v_req.academic_year, -1)
      AND coalesce(nullif(d->>'storage_path',''),'') <> ''
      AND coalesce(nullif(d->>'size_bytes','')::bigint, 1) > 0
      AND coalesce(d->>'upload_status','complete') = 'complete'
    LIMIT 1;

    v_satisfied := v_match IS NOT NULL;
    IF v_req.mandatory THEN
      v_total := v_total + 1;
      IF v_satisfied THEN v_ok := v_ok + 1;
      ELSE v_missing := v_missing || v_req.label; END IF;
    END IF;

    v_items := v_items || jsonb_build_object(
      'requirement_key', v_req.requirement_key, 'rule_id', v_req.rule_id, 'doc_key', v_req.doc_key,
      'label', v_req.label, 'doc_class', v_req.doc_class, 'doc_type', v_req.doc_type,
      'mandatory', v_req.mandatory, 'academic_year', v_req.academic_year,
      'consolidated', v_req.consolidated, 'requires_verification', v_req.requires_verification,
      'why_required', v_req.why_required,
      'state', CASE WHEN v_satisfied THEN 'uploaded' WHEN v_req.mandatory THEN 'missing' ELSE 'not_provided' END,
      'file_name', v_match->>'file_name');
  END LOOP;

  RETURN jsonb_build_object(
    'complete', array_length(v_missing,1) IS NULL,
    'mandatory_total', v_total, 'mandatory_satisfied', v_ok,
    'completion_percent', CASE WHEN v_total = 0 THEN 100 ELSE round((v_ok::numeric / v_total) * 100) END,
    'missing', to_jsonb(v_missing), 'items', v_items);
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_document_evaluate(uuid, text, text, integer, boolean, jsonb) TO anon, authenticated;

-- Public preview: resolved requirement checklist for the application form.
CREATE OR REPLACE FUNCTION public.rec_public_document_check(p_slug text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vac_id uuid;
BEGIN
  SELECT id INTO v_vac_id FROM public.rec_vacancies
  WHERE public_slug = nullif(trim(p_slug),'')
    AND approval_status = 'approved' AND publication_status = 'published'
    AND status = 'open' AND published_at IS NOT NULL;
  IF v_vac_id IS NULL THEN
    RETURN jsonb_build_object('open', false, 'complete', false, 'items', '[]'::jsonb, 'missing', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('open', true) || public.rec_document_evaluate(
    v_vac_id,
    nullif(trim(p_payload->>'education_status'),''),
    nullif(trim(p_payload->>'qualification_level'),''),
    nullif(p_payload->>'completed_years','')::integer,
    coalesce((p_payload->>'consolidated_transcript')::boolean, false),
    coalesce(p_payload->'documents','[]'::jsonb));
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_public_document_check(text, jsonb) TO anon, authenticated;

-- ============================================================
-- 7. Submission gate — wrap rec_public_apply (backend authority)
-- ============================================================
ALTER FUNCTION public.rec_public_apply(jsonb) RENAME TO rec_public_apply_core;

CREATE OR REPLACE FUNCTION public.rec_public_apply(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slug text := nullif(trim(p_payload->>'vacancy_slug'), '');
  v_email text := lower(nullif(trim(p_payload->>'email'), ''));
  v_vac_id uuid;
  v_edu text := nullif(trim(p_payload->>'education_status'),'');
  v_qual text := nullif(trim(p_payload->>'qualification_level'),'');
  v_years integer := nullif(p_payload->>'completed_years','')::integer;
  v_cons boolean := coalesce((p_payload->>'consolidated_transcript')::boolean, false);
  v_check jsonb;
  v_result jsonb;
  v_app uuid;
  v_doc jsonb;
  v_set uuid;
  v_set_version integer;
BEGIN
  SELECT id INTO v_vac_id FROM public.rec_vacancies
  WHERE public_slug = v_slug AND approval_status = 'approved'
    AND publication_status = 'published' AND status = 'open' AND published_at IS NOT NULL;

  -- Backend-authoritative document completeness gate. Client checks are a mirror.
  IF v_vac_id IS NOT NULL THEN
    v_check := public.rec_document_evaluate(
      v_vac_id, v_edu, v_qual, v_years, v_cons, coalesce(p_payload->'documents','[]'::jsonb));

    IF NOT (v_check->>'complete')::boolean THEN
      INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
      VALUES (v_email, v_slug, 'rejected',
              'documents_incomplete:' || left(coalesce(v_check->>'missing',''), 300));
      RAISE EXCEPTION 'Application cannot be submitted — missing mandatory documents: %',
        (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(v_check->'missing') x);
    END IF;
  END IF;

  v_result := public.rec_public_apply_core(p_payload);
  v_app := nullif(v_result->>'application_id','')::uuid;
  IF v_app IS NULL OR coalesce((v_result->>'duplicate')::boolean, false) THEN
    RETURN v_result;
  END IF;

  SELECT id, version INTO v_set, v_set_version FROM public.rec_document_requirement_sets
  WHERE status = 'active' AND vacancy_id = v_vac_id LIMIT 1;

  UPDATE public.rec_applications
     SET education_status = v_edu, qualification_level = v_qual,
         completed_years = v_years, consolidated_transcript = v_cons,
         document_requirement_set_id = v_set, document_requirement_version = v_set_version
   WHERE id = v_app;

  -- Bind persisted documents to their requirement identity + open the ledger.
  FOR v_doc IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'documents','[]'::jsonb)) LOOP
    UPDATE public.rec_candidate_documents d
       SET doc_key = coalesce(nullif(trim(v_doc->>'doc_key'),''), d.doc_type),
           academic_year = nullif(v_doc->>'academic_year','')::integer,
           consolidated = coalesce((v_doc->>'consolidated')::boolean, false),
           requirement_rule_id = nullif(v_doc->>'rule_id','')::uuid,
           upload_status = 'complete',
           verification_status = 'uploaded'
     WHERE d.application_id = v_app AND d.storage_path = v_doc->>'storage_path';
  END LOOP;

  INSERT INTO public.rec_document_events (
    document_id, application_id, candidate_id, vacancy_id, doc_key, academic_year,
    action, previous_status, new_status, file_hash, document_version, context)
  SELECT d.id, d.application_id, d.candidate_id, v_vac_id, d.doc_key, d.academic_year,
         'DOCUMENT_UPLOADED', NULL, 'uploaded', d.file_hash, d.version_no,
         jsonb_build_object('source','public_careers','file_name', d.file_name)
  FROM public.rec_candidate_documents d WHERE d.application_id = v_app;

  INSERT INTO public.rec_document_events (
    application_id, action, new_status, context)
  VALUES (v_app, 'DOCUMENT_REQUIREMENT_EVALUATED', v_check->>'completion_percent',
          jsonb_build_object('education_status', v_edu, 'qualification_level', v_qual,
                             'completed_years', v_years, 'consolidated', v_cons,
                             'checklist', v_check->'items'));

  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_public_apply(jsonb) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rec_public_apply_core(jsonb) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_apply_core(jsonb) TO service_role;

-- ============================================================
-- 8. Staff screening surface
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_application_document_status(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.rec_applications;
  v_docs jsonb;
  v_check jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_key', coalesce(d.doc_key, d.doc_type), 'doc_type', d.doc_type,
    'academic_year', d.academic_year, 'consolidated', d.consolidated,
    'file_name', d.file_name, 'storage_path', d.storage_path, 'mime_type', d.mime_type,
    'size_bytes', d.size_bytes, 'upload_status', d.upload_status,
    'verification_status', d.verification_status, 'verified_at', d.verified_at,
    'verified_by', d.verified_by, 'review_reason', d.review_reason,
    'version_no', d.version_no, 'superseded_at', d.superseded_at,
    'replaces_document_id', d.replaces_document_id,
    'file_hash', d.file_hash, 'uploaded_at', d.created_at) ORDER BY d.created_at), '[]'::jsonb)
  INTO v_docs FROM public.rec_candidate_documents d WHERE d.application_id = p_application_id;

  v_check := public.rec_document_evaluate(
    v_app.vacancy_id, v_app.education_status, v_app.qualification_level,
    v_app.completed_years, v_app.consolidated_transcript,
    (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(v_docs) x
      WHERE x->>'superseded_at' IS NULL AND x->>'verification_status' <> 'rejected'));

  RETURN v_check || jsonb_build_object(
    'application_id', p_application_id,
    'education_status', v_app.education_status,
    'qualification_level', v_app.qualification_level,
    'completed_years', v_app.completed_years,
    'consolidated_transcript', v_app.consolidated_transcript,
    'documents', v_docs,
    'verified_count', (SELECT count(*) FROM jsonb_array_elements(v_docs) x WHERE x->>'verification_status' = 'verified'),
    'pending_verification', (SELECT count(*) FROM jsonb_array_elements(v_docs) x WHERE x->>'verification_status' IN ('uploaded','pending_review','under_review')),
    'rejected_count', (SELECT count(*) FROM jsonb_array_elements(v_docs) x WHERE x->>'verification_status' IN ('rejected','replacement_required')),
    'document_state', CASE
      WHEN NOT (v_check->>'complete')::boolean THEN 'INCOMPLETE'
      WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_docs) x WHERE x->>'verification_status' IN ('rejected','replacement_required') AND x->>'superseded_at' IS NULL) THEN 'REQUIRES_ACTION'
      WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_docs) x WHERE x->>'verification_status' NOT IN ('verified','waived') AND x->>'superseded_at' IS NULL) THEN 'VERIFIED'
      ELSE 'COMPLETE_PENDING_VERIFICATION' END);
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_application_document_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_document_review(
  p_document_id uuid, p_action text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc public.rec_candidate_documents;
  v_prev text;
  v_next text;
  v_reason text := nullif(trim(p_reason),'');
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_doc FROM public.rec_candidate_documents WHERE id = p_document_id;
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'document_not_found'; END IF;

  v_prev := v_doc.verification_status;
  v_next := CASE lower(p_action)
    WHEN 'verify' THEN 'verified'
    WHEN 'reject' THEN 'rejected'
    WHEN 'request_replacement' THEN 'replacement_required'
    WHEN 'under_review' THEN 'under_review'
    WHEN 'waive' THEN 'waived'
    ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'unsupported_action'; END IF;

  IF lower(p_action) IN ('reject','request_replacement','waive') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  IF lower(p_action) = 'waive' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'waiver_requires_platform_admin';
  END IF;

  UPDATE public.rec_candidate_documents
     SET verification_status = v_next,
         verified_by = CASE WHEN v_next IN ('verified','waived') THEN auth.uid() ELSE verified_by END,
         verified_at = CASE WHEN v_next IN ('verified','waived') THEN now() ELSE verified_at END,
         review_reason = v_reason,
         updated_at = now()
   WHERE id = p_document_id;

  INSERT INTO public.rec_document_events (
    document_id, application_id, candidate_id, doc_key, academic_year, action,
    actor_id, previous_status, new_status, reason, file_hash, document_version)
  VALUES (v_doc.id, v_doc.application_id, v_doc.candidate_id, v_doc.doc_key, v_doc.academic_year,
    CASE lower(p_action)
      WHEN 'verify' THEN 'DOCUMENT_VERIFIED'
      WHEN 'reject' THEN 'DOCUMENT_REJECTED'
      WHEN 'request_replacement' THEN 'DOCUMENT_REPLACEMENT_REQUESTED'
      WHEN 'waive' THEN 'DOCUMENT_WAIVED'
      ELSE 'DOCUMENT_UNDER_REVIEW' END,
    auth.uid(), v_prev, v_next, v_reason, v_doc.file_hash, v_doc.version_no);

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'recruitment_document_review', 'candidate_document', v_doc.id,
          jsonb_build_object('verification_status', v_prev),
          jsonb_build_object('verification_status', v_next, 'reason', v_reason), 'recruitment_360');

  RETURN jsonb_build_object('document_id', v_doc.id, 'previous_status', v_prev, 'verification_status', v_next);
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_document_review(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_document_access_log(p_document_id uuid, p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc public.rec_candidate_documents;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF upper(p_action) NOT IN ('DOCUMENT_VIEWED','DOCUMENT_DOWNLOADED') THEN
    RAISE EXCEPTION 'unsupported_action';
  END IF;
  SELECT * INTO v_doc FROM public.rec_candidate_documents WHERE id = p_document_id;
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'document_not_found'; END IF;
  INSERT INTO public.rec_document_events (
    document_id, application_id, candidate_id, doc_key, academic_year, action,
    actor_id, previous_status, new_status, document_version)
  VALUES (v_doc.id, v_doc.application_id, v_doc.candidate_id, v_doc.doc_key, v_doc.academic_year,
          upper(p_action), auth.uid(), v_doc.verification_status, v_doc.verification_status, v_doc.version_no);
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_document_access_log(uuid, text) TO authenticated;

-- Screening decision gate
CREATE OR REPLACE FUNCTION public.rec_screening_document_gate(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status jsonb;
BEGIN
  v_status := public.rec_application_document_status(p_application_id);
  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'document_state', v_status->>'document_state',
    'allowed', (v_status->>'document_state') NOT IN ('INCOMPLETE','REQUIRES_ACTION'),
    'completion_percent', v_status->'completion_percent',
    'outstanding', v_status->'missing');
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_screening_document_gate(uuid) TO authenticated;

-- ============================================================
-- 9. Seed — universal package + internship vacancy sets
-- ============================================================
INSERT INTO public.rec_document_requirement_sets (scope, version, status, notes)
SELECT 'universal', 1, 'active', 'Universal Yalla Mobility application document package'
WHERE NOT EXISTS (SELECT 1 FROM public.rec_document_requirement_sets WHERE scope = 'universal' AND status = 'active');

INSERT INTO public.rec_document_requirement_rules (
  set_id, doc_key, label, doc_class, doc_type, mandatory, requires_verification, why_required, ord)
SELECT s.id, v.doc_key, v.label, v.doc_class, v.doc_type, true, true, v.why, v.ord
FROM public.rec_document_requirement_sets s
CROSS JOIN (VALUES
  ('cv','CV / Curriculum Vitae','universal','cv','Your career and academic record in one document.',10),
  ('kcse_certificate','KCSE Certificate','universal','certificate','Secondary school certification is required for every Yalla Mobility vacancy.',20),
  ('kcpe_certificate','KCPE Certificate','universal','certificate','Primary school certification is required for every Yalla Mobility vacancy.',30)
) AS v(doc_key,label,doc_class,doc_type,why,ord)
WHERE s.scope = 'universal' AND s.status = 'active'
ON CONFLICT (set_id, doc_key) DO NOTHING;

INSERT INTO public.rec_document_requirement_sets (vacancy_id, scope, version, status, vacancy_content_version, notes)
SELECT v.id, 'vacancy', 1, 'active', v.content_version, 'Internship academic document package'
FROM public.rec_vacancies v
JOIN public.rec_internship_specs sp ON sp.vacancy_id = v.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.rec_document_requirement_sets s WHERE s.vacancy_id = v.id AND s.status = 'active');

INSERT INTO public.rec_document_requirement_rules (
  set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year,
  allow_consolidated, requires_verification, condition, why_required, ord)
SELECT s.id, 'transcript', 'Original academic transcript', 'education', 'certificate',
       true, true, true, true, '{}'::jsonb,
       'An original transcript is required for every academic year you have completed.', 40
FROM public.rec_document_requirement_sets s
WHERE s.scope = 'vacancy' AND s.status = 'active'
  AND EXISTS (SELECT 1 FROM public.rec_internship_specs sp WHERE sp.vacancy_id = s.vacancy_id)
ON CONFLICT (set_id, doc_key) DO NOTHING;

INSERT INTO public.rec_document_requirement_rules (
  set_id, doc_key, label, doc_class, doc_type, mandatory, requires_verification, condition, why_required, ord)
SELECT s.id, 'degree_certificate', 'Degree Certificate', 'graduation', 'certificate', true, true,
       '{"education_status":["graduated"],"qualification_level":["degree","bachelor","master","postgraduate"]}'::jsonb,
       'Required because you indicated that you have graduated with a degree.', 50
FROM public.rec_document_requirement_sets s
WHERE s.scope = 'vacancy' AND s.status = 'active'
  AND EXISTS (SELECT 1 FROM public.rec_internship_specs sp WHERE sp.vacancy_id = s.vacancy_id)
ON CONFLICT (set_id, doc_key) DO NOTHING;

INSERT INTO public.rec_document_requirement_rules (
  set_id, doc_key, label, doc_class, doc_type, mandatory, requires_verification, condition, why_required, ord)
SELECT s.id, 'diploma_certificate', 'Diploma Certificate', 'graduation', 'certificate', true, true,
       '{"education_status":["graduated"],"qualification_level":["diploma","certificate"]}'::jsonb,
       'Required because you indicated that you have graduated with a diploma.', 51
FROM public.rec_document_requirement_sets s
WHERE s.scope = 'vacancy' AND s.status = 'active'
  AND EXISTS (SELECT 1 FROM public.rec_internship_specs sp WHERE sp.vacancy_id = s.vacancy_id)
ON CONFLICT (set_id, doc_key) DO NOTHING;

UPDATE public.rec_candidate_documents SET doc_key = doc_type WHERE doc_key IS NULL;