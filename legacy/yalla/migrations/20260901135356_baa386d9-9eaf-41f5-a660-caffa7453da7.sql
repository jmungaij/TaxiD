-- 1. Application-bound requirement version (immutability of obligations)
ALTER TABLE public.rec_applications
  ADD COLUMN IF NOT EXISTS document_requirement_universal_set_id uuid
    REFERENCES public.rec_document_requirement_sets(id);

CREATE INDEX IF NOT EXISTS idx_rec_applications_req_set
  ON public.rec_applications (document_requirement_set_id);

-- 2. Candidate attestation is NOT verification
ALTER TABLE public.rec_candidate_documents
  ADD COLUMN IF NOT EXISTS attested_at timestamptz,
  ADD COLUMN IF NOT EXISTS attested_by uuid;

CREATE OR REPLACE FUNCTION public._rec_document_verification_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.verification_status IN ('verified','waived')
     AND (TG_OP = 'INSERT' OR NEW.verification_status IS DISTINCT FROM OLD.verification_status) THEN
    IF NEW.verified_by IS NULL OR NEW.verified_at IS NULL THEN
      RAISE EXCEPTION 'verification_requires_reviewer'
        USING HINT = 'A document can only become verified through an authorised reviewer decision.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.attested_at IS DISTINCT FROM OLD.attested_at
     AND NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    RAISE EXCEPTION 'attestation_is_not_verification'
      USING HINT = 'Candidate attestation must never change verification state.';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_document_verification_authority ON public.rec_candidate_documents;
CREATE TRIGGER trg_rec_document_verification_authority
  BEFORE INSERT OR UPDATE ON public.rec_candidate_documents
  FOR EACH ROW EXECUTE FUNCTION public._rec_document_verification_authority();

-- 3. Version-aware requirement resolution
CREATE OR REPLACE FUNCTION public.rec_document_requirements_versioned(
  p_vacancy_id uuid,
  p_set_ids uuid[] DEFAULT NULL,
  p_education_status text DEFAULT NULL,
  p_qualification_level text DEFAULT NULL,
  p_completed_years integer DEFAULT NULL,
  p_consolidated boolean DEFAULT false)
RETURNS TABLE(rule_id uuid, doc_key text, requirement_key text, label text, doc_class text,
              doc_type text, mandatory boolean, academic_year integer, consolidated boolean,
              requires_verification boolean, why_required text, ord integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rule record;
  v_years integer := greatest(coalesce(p_completed_years, 0), 0);
  v_y integer;
  v_seen text[] := '{}';
BEGIN
  FOR v_rule IN
    SELECT DISTINCT ON (r.doc_key, lower(btrim(r.label)))
           r.*, (s.vacancy_id IS NOT NULL) AS vacancy_scoped
      FROM public.rec_document_requirement_rules r
      JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
     WHERE (
             (p_set_ids IS NULL
               AND s.status = 'active'
               AND (s.scope = 'universal' OR s.vacancy_id = p_vacancy_id))
             OR (p_set_ids IS NOT NULL AND s.id = ANY (p_set_ids))
           )
     ORDER BY r.doc_key, lower(btrim(r.label)),
              (s.vacancy_id IS NOT NULL) DESC, s.version DESC
  LOOP
    CONTINUE WHEN NOT public.rec_doc_condition_matches(v_rule.condition, p_education_status, p_qualification_level);

    IF v_rule.per_completed_year THEN
      IF coalesce(p_consolidated, false) AND v_rule.allow_consolidated THEN
        IF NOT (v_rule.doc_key || ':consolidated' = ANY (v_seen)) THEN
          v_seen := v_seen || (v_rule.doc_key || ':consolidated');
          RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':consolidated',
            v_rule.label || ' — consolidated (all completed years)', v_rule.doc_class, v_rule.doc_type,
            v_rule.mandatory, NULL::integer, true, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
        END IF;
      ELSE
        FOR v_y IN 1..v_years LOOP
          IF NOT (v_rule.doc_key || ':' || v_y::text = ANY (v_seen)) THEN
            v_seen := v_seen || (v_rule.doc_key || ':' || v_y::text);
            RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':' || v_y::text,
              v_rule.label || ' — Year ' || v_y::text, v_rule.doc_class, v_rule.doc_type,
              v_rule.mandatory, v_y, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
          END IF;
        END LOOP;
      END IF;
    ELSE
      IF NOT (v_rule.doc_key = ANY (v_seen)) THEN
        v_seen := v_seen || v_rule.doc_key;
        RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key,
          v_rule.label, v_rule.doc_class, v_rule.doc_type, v_rule.mandatory,
          NULL::integer, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
      END IF;
    END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.rec_document_requirements(
  p_vacancy_id uuid,
  p_education_status text DEFAULT NULL,
  p_qualification_level text DEFAULT NULL,
  p_completed_years integer DEFAULT NULL,
  p_consolidated boolean DEFAULT false)
RETURNS TABLE(rule_id uuid, doc_key text, requirement_key text, label text, doc_class text,
              doc_type text, mandatory boolean, academic_year integer, consolidated boolean,
              requires_verification boolean, why_required text, ord integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.rec_document_requirements_versioned(
    p_vacancy_id, NULL::uuid[], p_education_status, p_qualification_level,
    p_completed_years, p_consolidated);
$$;

-- 4. Version-aware evaluation
CREATE OR REPLACE FUNCTION public.rec_document_evaluate_versioned(
  p_vacancy_id uuid,
  p_set_ids uuid[],
  p_education_status text,
  p_qualification_level text,
  p_completed_years integer,
  p_consolidated boolean,
  p_docs jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    SELECT * FROM public.rec_document_requirements_versioned(
      p_vacancy_id, p_set_ids, p_education_status, p_qualification_level,
      p_completed_years, p_consolidated)
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
      'file_name', v_match->>'file_name',
      'document_id', v_match->>'id',
      'verification_status', v_match->>'verification_status',
      'verified_at', v_match->>'verified_at',
      'attested_at', v_match->>'attested_at');
  END LOOP;

  RETURN jsonb_build_object(
    'complete', array_length(v_missing,1) IS NULL,
    'mandatory_total', v_total, 'mandatory_satisfied', v_ok,
    'completion_percent', CASE WHEN v_total = 0 THEN 100 ELSE round((v_ok::numeric / v_total) * 100) END,
    'missing', to_jsonb(v_missing), 'items', v_items,
    'requirement_set_ids', coalesce(to_jsonb(p_set_ids), 'null'::jsonb),
    'requirement_binding', CASE WHEN p_set_ids IS NULL THEN 'latest_active' ELSE 'application_bound' END);
END; $$;

CREATE OR REPLACE FUNCTION public.rec_document_evaluate(
  p_vacancy_id uuid, p_education_status text, p_qualification_level text,
  p_completed_years integer, p_consolidated boolean, p_docs jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.rec_document_evaluate_versioned(
    p_vacancy_id, NULL::uuid[], p_education_status, p_qualification_level,
    p_completed_years, p_consolidated, p_docs);
$$;

-- 5. Staff status view assesses each application against its own bound version
CREATE OR REPLACE FUNCTION public.rec_application_document_status(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_app public.rec_applications;
  v_docs jsonb;
  v_check jsonb;
  v_sets uuid[];
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;

  SELECT array_agg(x) INTO v_sets FROM (
    SELECT unnest(ARRAY[v_app.document_requirement_set_id,
                        v_app.document_requirement_universal_set_id]) AS x) s
   WHERE x IS NOT NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_key', coalesce(d.doc_key, d.doc_type), 'doc_type', d.doc_type,
    'academic_year', d.academic_year, 'consolidated', d.consolidated,
    'file_name', d.file_name, 'storage_path', d.storage_path, 'mime_type', d.mime_type,
    'size_bytes', d.size_bytes, 'upload_status', d.upload_status,
    'verification_status', d.verification_status, 'verified_at', d.verified_at,
    'verified_by', d.verified_by, 'review_reason', d.review_reason,
    'attested_at', d.attested_at,
    'version_no', d.version_no, 'superseded_at', d.superseded_at,
    'replaces_document_id', d.replaces_document_id,
    'file_hash', d.file_hash, 'uploaded_at', d.created_at) ORDER BY d.created_at), '[]'::jsonb)
  INTO v_docs FROM public.rec_candidate_documents d WHERE d.application_id = p_application_id;

  v_check := public.rec_document_evaluate_versioned(
    v_app.vacancy_id, v_sets, v_app.education_status, v_app.qualification_level,
    v_app.completed_years, v_app.consolidated_transcript,
    (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(v_docs) x
      WHERE x->>'superseded_at' IS NULL AND x->>'verification_status' <> 'rejected'));

  RETURN v_check || jsonb_build_object(
    'application_id', p_application_id,
    'education_status', v_app.education_status,
    'qualification_level', v_app.qualification_level,
    'completed_years', v_app.completed_years,
    'consolidated_transcript', v_app.consolidated_transcript,
    'requirement_version', v_app.document_requirement_version,
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

-- 6. Bind every new application to the requirement versions active at creation
CREATE OR REPLACE FUNCTION public._rec_bind_requirement_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_set uuid; v_version integer; v_universal uuid;
BEGIN
  IF NEW.document_requirement_set_id IS NULL AND NEW.vacancy_id IS NOT NULL THEN
    SELECT id, version INTO v_set, v_version
      FROM public.rec_document_requirement_sets
     WHERE vacancy_id = NEW.vacancy_id AND status = 'active'
     ORDER BY version DESC LIMIT 1;
    NEW.document_requirement_set_id := v_set;
    NEW.document_requirement_version := coalesce(NEW.document_requirement_version, v_version);
  END IF;

  IF NEW.document_requirement_universal_set_id IS NULL THEN
    SELECT id INTO v_universal FROM public.rec_document_requirement_sets
     WHERE scope = 'universal' AND status = 'active'
     ORDER BY version DESC LIMIT 1;
    NEW.document_requirement_universal_set_id := v_universal;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_bind_requirement_version ON public.rec_applications;
CREATE TRIGGER trg_rec_bind_requirement_version
  BEFORE INSERT ON public.rec_applications
  FOR EACH ROW EXECUTE FUNCTION public._rec_bind_requirement_version();

-- Backfill existing applications so none floats on "latest active"
UPDATE public.rec_applications a
   SET document_requirement_set_id = s.id,
       document_requirement_version = coalesce(a.document_requirement_version, s.version)
  FROM public.rec_document_requirement_sets s
 WHERE a.document_requirement_set_id IS NULL
   AND s.vacancy_id = a.vacancy_id AND s.status = 'active';

UPDATE public.rec_applications a
   SET document_requirement_universal_set_id = u.id
  FROM (SELECT id FROM public.rec_document_requirement_sets
         WHERE scope = 'universal' AND status = 'active' ORDER BY version DESC LIMIT 1) u
 WHERE a.document_requirement_universal_set_id IS NULL;

-- 7. Requirement version history (audit surface)
DROP VIEW IF EXISTS public.rec_requirement_version_history;
CREATE VIEW public.rec_requirement_version_history
WITH (security_invoker = true) AS
SELECT
  s.id                        AS set_id,
  s.scope,
  s.vacancy_id,
  v.title                     AS vacancy_title,
  v.public_slug,
  s.version,
  s.status,
  s.effective_from,
  s.vacancy_content_version,
  s.notes,
  s.created_at,
  s.updated_at,
  (SELECT count(*) FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id) AS rule_count,
  (SELECT count(*) FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id AND r.mandatory) AS mandatory_count,
  (SELECT array_agg(r.doc_key ORDER BY r.ord, r.doc_key)
     FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id) AS doc_keys,
  (SELECT array_agg(r.doc_key ORDER BY r.ord, r.doc_key)
     FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id AND r.mandatory) AS mandatory_doc_keys,
  (SELECT count(*) FROM public.rec_applications a
    WHERE a.document_requirement_set_id = s.id
       OR a.document_requirement_universal_set_id = s.id) AS bound_applications
FROM public.rec_document_requirement_sets s
LEFT JOIN public.rec_vacancies v ON v.id = s.vacancy_id;

GRANT SELECT ON public.rec_requirement_version_history TO authenticated;
