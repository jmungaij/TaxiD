-- ============================================================
-- WAVE 1: evidence -> verification -> requirement -> gate
-- ============================================================

-- ---------- requirement version governance columns ----------
ALTER TABLE public.rec_document_requirement_sets
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS effective_until timestamptz,
  ADD COLUMN IF NOT EXISTS supersedes_set_id uuid REFERENCES public.rec_document_requirement_sets(id),
  ADD COLUMN IF NOT EXISTS superseded_by_set_id uuid REFERENCES public.rec_document_requirement_sets(id);

-- Published requirement versions are immutable: a change is a NEW version.
CREATE OR REPLACE FUNCTION public._rec_requirement_set_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published requirement version % cannot be deleted; supersede it with a new version', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    -- Only lifecycle / provenance fields may move on a published version.
    IF (NEW.scope, NEW.vacancy_id, NEW.version, NEW.effective_from)
       IS DISTINCT FROM (OLD.scope, OLD.vacancy_id, OLD.version, OLD.effective_from) THEN
      RAISE EXCEPTION 'requirement version % is published and immutable; create a new version instead', OLD.id;
    END IF;
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'requirement version % cannot return to draft', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_requirement_set_immutable ON public.rec_document_requirement_sets;
CREATE TRIGGER trg_rec_requirement_set_immutable
  BEFORE UPDATE OR DELETE ON public.rec_document_requirement_sets
  FOR EACH ROW EXECUTE FUNCTION public._rec_requirement_set_immutable();

CREATE OR REPLACE FUNCTION public._rec_requirement_rule_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text; v_set uuid;
BEGIN
  v_set := CASE WHEN TG_OP = 'DELETE' THEN OLD.set_id ELSE NEW.set_id END;
  SELECT status INTO v_status FROM public.rec_document_requirement_sets WHERE id = v_set;
  IF coalesce(v_status,'draft') <> 'draft' THEN
    RAISE EXCEPTION 'requirement rules of published version % are immutable; create a new version instead', v_set;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_requirement_rule_immutable ON public.rec_document_requirement_rules;
CREATE TRIGGER trg_rec_requirement_rule_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.rec_document_requirement_rules
  FOR EACH ROW EXECUTE FUNCTION public._rec_requirement_rule_immutable();

-- ---------- append-only evaluation trail ----------
CREATE TABLE IF NOT EXISTS public.rec_requirement_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  trigger_reason text NOT NULL,
  document_id uuid,
  requirement_version integer,
  requirement_set_ids uuid[],
  education_evidence_complete boolean NOT NULL,
  education_verified_complete boolean NOT NULL,
  submission_allowed boolean NOT NULL,
  progression_allowed boolean NOT NULL,
  outstanding text[] NOT NULL DEFAULT '{}',
  evaluation jsonb NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rec_requirement_evaluations_app_idx
  ON public.rec_requirement_evaluations(application_id, created_at DESC);

GRANT SELECT ON public.rec_requirement_evaluations TO authenticated;
GRANT ALL ON public.rec_requirement_evaluations TO service_role;
ALTER TABLE public.rec_requirement_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read requirement evaluations" ON public.rec_requirement_evaluations;
CREATE POLICY "staff read requirement evaluations"
  ON public.rec_requirement_evaluations FOR SELECT TO authenticated
  USING (public.rec_can_read());

CREATE OR REPLACE FUNCTION public._rec_requirement_evaluations_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_requirement_evaluations is append-only audit evidence';
END; $$;

DROP TRIGGER IF EXISTS trg_rec_requirement_evaluations_append_only ON public.rec_requirement_evaluations;
CREATE TRIGGER trg_rec_requirement_evaluations_append_only
  BEFORE UPDATE OR DELETE ON public.rec_requirement_evaluations
  FOR EACH ROW EXECUTE FUNCTION public._rec_requirement_evaluations_append_only();

-- ---------- THE canonical evaluator (internal, no auth check) ----------
CREATE OR REPLACE FUNCTION public._rec_evaluate_application_requirements(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.rec_applications;
  v_sets uuid[];
  v_docs jsonb;
  v_check jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_doc jsonb;
  v_needs_ver boolean;
  v_vstate text;
  v_evidence boolean;
  v_verified boolean;
  v_ev_out text[] := '{}';
  v_ver_out text[] := '{}';
BEGIN
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;

  SELECT array_agg(x) INTO v_sets FROM (
    SELECT unnest(ARRAY[v_app.document_requirement_set_id,
                        v_app.document_requirement_universal_set_id]) AS x) s
   WHERE x IS NOT NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_key', coalesce(d.doc_key, d.doc_type), 'doc_type', d.doc_type,
    'academic_year', d.academic_year, 'consolidated', d.consolidated,
    'file_name', d.file_name, 'upload_status', d.upload_status,
    'verification_status', d.verification_status, 'verified_at', d.verified_at,
    'verified_by', d.verified_by, 'review_reason', d.review_reason,
    'attested_at', d.attested_at, 'version_no', d.version_no,
    'superseded_at', d.superseded_at) ORDER BY d.created_at), '[]'::jsonb)
  INTO v_docs FROM public.rec_candidate_documents d WHERE d.application_id = p_application_id;

  -- Evidence evaluation uses live (non-superseded, non-rejected) documents only.
  v_check := public.rec_document_evaluate_versioned(
    v_app.vacancy_id, v_sets, v_app.education_status, v_app.qualification_level,
    v_app.completed_years, v_app.consolidated_transcript,
    (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(v_docs) x
      WHERE x->>'superseded_at' IS NULL
        AND coalesce(x->>'verification_status','uploaded') NOT IN ('rejected','replacement_required')));

  FOR v_item IN SELECT jsonb_array_elements(coalesce(v_check->'items','[]'::jsonb))
  LOOP
    v_needs_ver := coalesce((v_item->>'requires_verification')::boolean, true);
    v_evidence  := coalesce(v_item->>'state','missing') = 'uploaded';

    SELECT x INTO v_doc FROM jsonb_array_elements(v_docs) x
     WHERE x->>'superseded_at' IS NULL
       AND coalesce(x->>'doc_key','') = coalesce(v_item->>'doc_key','')
       AND coalesce(x->>'academic_year','') = coalesce(v_item->>'academic_year','')
     ORDER BY (x->>'version_no')::int DESC LIMIT 1;

    v_vstate := coalesce(v_doc->>'verification_status', CASE WHEN v_evidence THEN 'uploaded' ELSE 'absent' END);
    v_verified := v_vstate IN ('verified','waived');

    IF coalesce((v_item->>'mandatory')::boolean,false)
       AND (v_item->>'doc_class') IN ('education','graduation') THEN
      IF NOT v_evidence THEN v_ev_out := v_ev_out || (v_item->>'label'); END IF;
      IF v_needs_ver AND NOT v_verified THEN
        v_ver_out := v_ver_out || format('%s (%s)', v_item->>'label',
          CASE WHEN v_vstate IN ('rejected','replacement_required') THEN 'rejected — replacement required'
               WHEN v_evidence THEN 'awaiting verification' ELSE 'not provided' END);
      END IF;
    END IF;

    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object(
      'document_id', v_doc->>'id',
      'document_status', v_vstate,
      'verification_required', v_needs_ver,
      'evidence_satisfied', v_evidence,
      'verified', v_verified,
      'satisfied', v_evidence AND (NOT v_needs_ver OR v_verified)));
  END LOOP;

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'vacancy_id', v_app.vacancy_id,
    'stage', v_app.stage,
    'requirement_version', v_app.document_requirement_version,
    'requirement_set_ids', to_jsonb(coalesce(v_sets, '{}'::uuid[])),
    'requirement_binding', v_check->'requirement_binding',
    'education', jsonb_build_object(
      'complete', array_length(v_ev_out,1) IS NULL,
      'verified_complete', array_length(v_ev_out,1) IS NULL AND array_length(v_ver_out,1) IS NULL,
      'outstanding_evidence', to_jsonb(v_ev_out),
      'outstanding_verification', to_jsonb(v_ver_out),
      'requirements', v_items),
    'gates', jsonb_build_object(
      'education_gate', jsonb_build_object(
        'allowed', array_length(v_ev_out,1) IS NULL,
        'basis', 'persisted_evidence', 'outstanding', to_jsonb(v_ev_out)),
      'submission_gate', jsonb_build_object(
        'allowed', array_length(v_ev_out,1) IS NULL,
        'basis', 'persisted_evidence', 'outstanding', to_jsonb(v_ev_out)),
      'progression_gate', jsonb_build_object(
        'allowed', array_length(v_ev_out,1) IS NULL AND array_length(v_ver_out,1) IS NULL,
        'basis', 'staff_verified_evidence',
        'outstanding', to_jsonb(array_cat(v_ev_out, v_ver_out)))),
    'documents', v_docs,
    'evaluated_at', now());
END; $$;

-- Staff-facing wrapper.
CREATE OR REPLACE FUNCTION public.rec_evaluate_application_requirements(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN public._rec_evaluate_application_requirements(p_application_id);
END; $$;

-- ---------- verification -> re-evaluation (deterministic, recorded) ----------
CREATE OR REPLACE FUNCTION public._rec_verification_reevaluate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eval jsonb;
BEGIN
  IF NEW.application_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    RETURN NEW;
  END IF;

  v_eval := public._rec_evaluate_application_requirements(NEW.application_id);

  INSERT INTO public.rec_requirement_evaluations(
    application_id, trigger_reason, document_id, requirement_version, requirement_set_ids,
    education_evidence_complete, education_verified_complete,
    submission_allowed, progression_allowed, outstanding, evaluation, actor_id)
  VALUES (
    NEW.application_id,
    'document_' || coalesce(NEW.verification_status,'unknown'),
    NEW.id,
    (v_eval->>'requirement_version')::int,
    (SELECT coalesce(array_agg((x)::uuid), '{}'::uuid[])
       FROM jsonb_array_elements_text(coalesce(v_eval->'requirement_set_ids','[]'::jsonb)) x),
    (v_eval->'education'->>'complete')::boolean,
    (v_eval->'education'->>'verified_complete')::boolean,
    (v_eval->'gates'->'submission_gate'->>'allowed')::boolean,
    (v_eval->'gates'->'progression_gate'->>'allowed')::boolean,
    (SELECT coalesce(array_agg(x), '{}'::text[])
       FROM jsonb_array_elements_text(coalesce(v_eval->'gates'->'progression_gate'->'outstanding','[]'::jsonb)) x),
    v_eval, auth.uid());

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rec_verification_reevaluate ON public.rec_candidate_documents;
CREATE TRIGGER trg_rec_verification_reevaluate
  AFTER INSERT OR UPDATE OF verification_status ON public.rec_candidate_documents
  FOR EACH ROW EXECUTE FUNCTION public._rec_verification_reevaluate();

-- ---------- progression gate enforced in the state machine ----------
CREATE OR REPLACE FUNCTION public.rec_application_transition(p_application_id uuid, p_next_stage text, p_reason text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.rec_applications;
  v_allowed text[];
  v_gate jsonb;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not authorised to change application stage';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  v_allowed := CASE v_app.stage
    WHEN 'applied'      THEN ARRAY['received','screening','rejected','withdrawn','talent_pool']
    WHEN 'received'     THEN ARRAY['screening','rejected','withdrawn','talent_pool']
    WHEN 'screening'    THEN ARRAY['shortlisted','rejected','withdrawn','talent_pool']
    WHEN 'shortlisted'  THEN ARRAY['evaluation','interview','rejected','withdrawn']
    WHEN 'evaluation'   THEN ARRAY['interview','rejected','withdrawn']
    WHEN 'interview'    THEN ARRAY['evaluation','offer','rejected','withdrawn']
    WHEN 'offer'        THEN ARRAY['accepted','rejected','withdrawn']
    WHEN 'accepted'     THEN ARRAY['onboarding','withdrawn']
    WHEN 'onboarding'   THEN ARRAY['hired','withdrawn']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_next_stage = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'invalid stage transition % -> %', v_app.stage, p_next_stage;
  END IF;

  -- Advancing a candidate is an eligibility decision: mandatory academic
  -- evidence that requires verification must be verified first. Negative
  -- outcomes (rejected/withdrawn/talent_pool) are never blocked.
  IF p_next_stage NOT IN ('rejected','withdrawn','talent_pool') THEN
    v_gate := public._rec_evaluate_application_requirements(p_application_id);
    IF NOT (v_gate->'gates'->'progression_gate'->>'allowed')::boolean THEN
      RAISE EXCEPTION 'requirement_verification_incomplete: %',
        coalesce(nullif(array_to_string((SELECT array_agg(x) FROM jsonb_array_elements_text(
          v_gate->'gates'->'progression_gate'->'outstanding') x), '; '),''), 'unverified academic evidence');
    END IF;
  END IF;

  UPDATE public.rec_applications
     SET stage = p_next_stage,
         stage_entered_at = now(),
         last_activity_at = now(),
         status = CASE WHEN p_next_stage IN ('rejected','withdrawn','hired') THEN 'closed' ELSE status END,
         rejection_reason = CASE WHEN p_next_stage = 'rejected' THEN p_reason ELSE rejection_reason END,
         updated_at = now()
   WHERE id = p_application_id;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
  VALUES (auth.uid(), 'application_stage_changed', 'application', p_application_id,
          jsonb_build_object('stage', v_app.stage), jsonb_build_object('stage', p_next_stage),
          jsonb_build_object('reason', p_reason, 'progression_gate', v_gate->'gates'->'progression_gate'), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'from', v_app.stage, 'to', p_next_stage);
END; $$;

-- ---------- machine-verifiable requirement integrity check ----------
CREATE OR REPLACE FUNCTION public.rec_requirement_integrity_check()
RETURNS TABLE(
  vacancy_id uuid, public_slug text, title text, set_id uuid, requirement_version integer,
  rule_count integer, mandatory_count integer, doc_keys text[], mandatory_doc_keys text[],
  verification_required_keys text[], bound_applications integer, result text, reasons text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
  WITH pub AS (
    SELECT v.id, v.public_slug, v.title
      FROM public.rec_vacancies v
     WHERE v.publication_status = 'published' AND v.approval_status = 'approved'
  ), act AS (
    SELECT p.*, s.id AS set_id, s.version
      FROM pub p
      LEFT JOIN public.rec_document_requirement_sets s
             ON s.vacancy_id = p.id AND s.scope = 'vacancy' AND s.status = 'active'
  ), agg AS (
    SELECT a.*,
           coalesce(count(r.id), 0)::int AS rules,
           coalesce(count(r.id) FILTER (WHERE r.mandatory), 0)::int AS mand,
           coalesce(array_agg(r.doc_key ORDER BY r.ord) FILTER (WHERE r.doc_key IS NOT NULL), '{}') AS keys,
           coalesce(array_agg(r.doc_key ORDER BY r.ord) FILTER (WHERE r.mandatory AND r.doc_key IS NOT NULL), '{}') AS mkeys,
           coalesce(array_agg(r.doc_key ORDER BY r.ord) FILTER (WHERE r.requires_verification AND r.doc_key IS NOT NULL), '{}') AS vkeys,
           coalesce(count(r.id) FILTER (WHERE r.doc_key IS NULL OR btrim(r.doc_key) = ''), 0)::int AS keyless,
           coalesce(count(r.id) FILTER (WHERE r.label IS NULL OR btrim(r.label) = ''), 0)::int AS labelless
      FROM act a
      LEFT JOIN public.rec_document_requirement_rules r ON r.set_id = a.set_id
     GROUP BY a.id, a.public_slug, a.title, a.set_id, a.version
  )
  SELECT g.id, g.public_slug, g.title, g.set_id, g.version,
         g.rules, g.mand, g.keys, g.mkeys, g.vkeys,
         (SELECT count(*)::int FROM public.rec_applications ap WHERE ap.document_requirement_set_id = g.set_id),
         CASE WHEN cardinality(f.reasons) = 0 THEN 'PASS' ELSE 'FAIL' END,
         f.reasons
    FROM agg g
    CROSS JOIN LATERAL (
      SELECT array_remove(ARRAY[
        CASE WHEN g.set_id IS NULL THEN 'NO_ACTIVE_REQUIREMENT_VERSION' END,
        CASE WHEN g.set_id IS NOT NULL AND g.rules = 0 THEN 'ACTIVE_VERSION_HAS_NO_RULES' END,
        CASE WHEN g.set_id IS NOT NULL AND g.mand = 0 THEN 'NO_MANDATORY_REQUIREMENT' END,
        CASE WHEN g.keyless > 0 THEN 'REQUIREMENT_WITHOUT_DOCUMENT_KEY' END,
        CASE WHEN g.labelless > 0 THEN 'REQUIREMENT_WITHOUT_LABEL' END,
        CASE WHEN (SELECT count(*) FROM (
                     SELECT r.doc_key, r.per_completed_year, count(*) c
                       FROM public.rec_document_requirement_rules r
                      WHERE r.set_id = g.set_id AND r.mandatory
                      GROUP BY 1,2 HAVING count(*) > 1) d) > 0
             THEN 'DUPLICATE_MANDATORY_DOCUMENT_KEY' END,
        CASE WHEN (SELECT count(*) FROM public.rec_document_requirement_sets u
                    WHERE u.scope = 'universal' AND u.status = 'active') <> 1
             THEN 'UNIVERSAL_ACTIVE_VERSION_NOT_UNIQUE' END
      ], NULL) AS reasons) f
   ORDER BY (CASE WHEN cardinality(f.reasons) = 0 THEN 1 ELSE 0 END), g.title;
END; $$;

-- ---------- least privilege ----------
REVOKE ALL ON FUNCTION public._rec_evaluate_application_requirements(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rec_verification_reevaluate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rec_requirement_set_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rec_requirement_rule_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rec_requirement_evaluations_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rec_evaluate_application_requirements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_evaluate_application_requirements(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rec_requirement_integrity_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_integrity_check() TO authenticated;