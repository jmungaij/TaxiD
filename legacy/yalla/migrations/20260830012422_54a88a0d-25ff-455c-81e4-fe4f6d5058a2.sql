-- =====================================================================
-- LG LEGAL DOSSIER CONTROL LAYER
-- =====================================================================

CREATE TABLE public.lg_dossier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id text NOT NULL,
  document_id text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  folder_path text NOT NULL,
  file_name text NOT NULL,
  evidence_type text NOT NULL,
  provenance text NOT NULL,
  issuing_authority text NOT NULL,
  draft_state text NOT NULL,
  declaration text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  authoritative_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  regulatory_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  operational_linkage text NOT NULL,
  blocking_stages text[] NOT NULL DEFAULT ARRAY['booking','dispatch']::text[],
  requires_insurer_approval boolean NOT NULL DEFAULT false,
  body_markdown text NOT NULL,
  content_hash text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  superseded_by uuid REFERENCES public.lg_dossier_documents(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lg_dossier_version_positive CHECK (version >= 1),
  CONSTRAINT lg_dossier_draft_state_valid CHECK (draft_state IN (
    'LEGAL_REVIEW_REQUIRED','EVIDENCE_REQUIRED','INSURANCE_EVIDENCE_REQUIRED',
    'REGULATOR_ACTION_REQUIRED','OWNER_APPROVAL_REQUIRED')),
  CONSTRAINT lg_dossier_control_version_unique UNIQUE (control_id, version)
);

CREATE UNIQUE INDEX lg_dossier_one_current_per_control
  ON public.lg_dossier_documents (control_id) WHERE is_current;

GRANT SELECT ON public.lg_dossier_documents TO authenticated;
GRANT ALL ON public.lg_dossier_documents TO service_role;
ALTER TABLE public.lg_dossier_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legal staff read lg dossier"
  ON public.lg_dossier_documents FOR SELECT TO authenticated
  USING (has_staff_permission('staff.legal.read') OR has_staff_permission('staff.logistics.read'));

-- Documents are write-once: only supersession flags may change, never content.
CREATE OR REPLACE FUNCTION public._lg_dossier_document_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lg_dossier_documents is append-only; a dossier document version cannot be deleted';
  END IF;
  IF ROW(NEW.control_id, NEW.document_id, NEW.version, NEW.title, NEW.folder_path, NEW.file_name,
         NEW.evidence_type, NEW.provenance, NEW.issuing_authority, NEW.draft_state, NEW.declaration,
         NEW.sections, NEW.authoritative_fields, NEW.regulatory_references, NEW.operational_linkage,
         NEW.blocking_stages, NEW.requires_insurer_approval, NEW.body_markdown, NEW.content_hash,
         NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.control_id, OLD.document_id, OLD.version, OLD.title, OLD.folder_path, OLD.file_name,
         OLD.evidence_type, OLD.provenance, OLD.issuing_authority, OLD.draft_state, OLD.declaration,
         OLD.sections, OLD.authoritative_fields, OLD.regulatory_references, OLD.operational_linkage,
         OLD.blocking_stages, OLD.requires_insurer_approval, OLD.body_markdown, OLD.content_hash,
         OLD.created_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'lg_dossier_documents content is immutable; publish a new version instead';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lg_dossier_documents_immutable
  BEFORE UPDATE OR DELETE ON public.lg_dossier_documents
  FOR EACH ROW EXECUTE FUNCTION public._lg_dossier_document_immutable();

-- ---------------------------------------------------------------- approvals
CREATE TABLE public.lg_dossier_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id uuid NOT NULL REFERENCES public.lg_dossier_documents(id) ON DELETE RESTRICT,
  control_id text NOT NULL,
  document_version integer NOT NULL,
  content_hash text NOT NULL,
  approver_kind text NOT NULL,
  decision text NOT NULL,
  conditions text,
  evidence_ref text,
  issuing_authority text,
  effective_from timestamptz,
  effective_until timestamptz,
  comments text NOT NULL,
  decided_by uuid NOT NULL,
  decided_by_email text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lg_approval_kind_valid CHECK (approver_kind IN ('legal_reviewer','insurer','owner')),
  CONSTRAINT lg_approval_decision_valid CHECK (decision IN ('approved','approved_with_conditions','rejected')),
  CONSTRAINT lg_approval_window CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
  CONSTRAINT lg_approval_once_per_kind UNIQUE (document_version_id, approver_kind)
);

GRANT SELECT ON public.lg_dossier_approvals TO authenticated;
GRANT ALL ON public.lg_dossier_approvals TO service_role;
ALTER TABLE public.lg_dossier_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legal staff read lg approvals"
  ON public.lg_dossier_approvals FOR SELECT TO authenticated
  USING (has_staff_permission('staff.legal.read') OR has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._lg_dossier_approval_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'lg_dossier_approvals is append-only; a recorded legal decision cannot be % ', lower(TG_OP);
END;
$$;

CREATE TRIGGER lg_dossier_approvals_append_only
  BEFORE UPDATE OR DELETE ON public.lg_dossier_approvals
  FOR EACH ROW EXECUTE FUNCTION public._lg_dossier_approval_append_only();

-- -------------------------------------------------------------- audit trail
CREATE TABLE public.lg_dossier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id text NOT NULL,
  document_version_id uuid REFERENCES public.lg_dossier_documents(id) ON DELETE RESTRICT,
  document_version integer,
  content_hash text,
  action text NOT NULL,
  approver_kind text,
  decision text,
  actor_user_id uuid,
  actor_email text,
  prior_version integer,
  prior_content_hash text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lg_audit_action_valid CHECK (action IN ('SEEDED','VERSION_PUBLISHED','SUPERSEDED','APPROVAL_RECORDED'))
);

GRANT SELECT ON public.lg_dossier_audit TO authenticated;
GRANT ALL ON public.lg_dossier_audit TO service_role;
ALTER TABLE public.lg_dossier_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legal staff read lg audit"
  ON public.lg_dossier_audit FOR SELECT TO authenticated
  USING (has_staff_permission('staff.legal.read') OR has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._lg_dossier_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'lg_dossier_audit is immutable';
END;
$$;

CREATE TRIGGER lg_dossier_audit_append_only
  BEFORE UPDATE OR DELETE ON public.lg_dossier_audit
  FOR EACH ROW EXECUTE FUNCTION public._lg_dossier_audit_append_only();

-- ============================================================ publish version
CREATE OR REPLACE FUNCTION public.lg_dossier_publish_version(
  p_control_id text,
  p_document_id text,
  p_title text,
  p_folder_path text,
  p_file_name text,
  p_evidence_type text,
  p_provenance text,
  p_issuing_authority text,
  p_draft_state text,
  p_declaration text,
  p_sections jsonb,
  p_authoritative_fields jsonb,
  p_regulatory_references jsonb,
  p_operational_linkage text,
  p_blocking_stages text[],
  p_requires_insurer_approval boolean,
  p_body_markdown text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prior public.lg_dossier_documents;
  v_hash text := encode(sha256(convert_to(p_body_markdown, 'UTF8')), 'hex');
  v_new_id uuid;
  v_version integer;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF v_actor IS NOT NULL
     AND NOT (has_role(v_actor, 'admin'::app_role) OR has_staff_permission('staff.legal.manage')) THEN
    RAISE EXCEPTION 'not authorised to publish a legal dossier version';
  END IF;

  SELECT * INTO v_prior FROM public.lg_dossier_documents
   WHERE control_id = p_control_id AND is_current;

  IF v_prior.id IS NOT NULL AND v_prior.content_hash = v_hash THEN
    RETURN v_prior.id; -- identical content: seeding is idempotent
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.lg_dossier_documents WHERE control_id = p_control_id;

  INSERT INTO public.lg_dossier_documents (
    control_id, document_id, version, title, folder_path, file_name, evidence_type, provenance,
    issuing_authority, draft_state, declaration, sections, authoritative_fields,
    regulatory_references, operational_linkage, blocking_stages, requires_insurer_approval,
    body_markdown, content_hash, created_by)
  VALUES (
    p_control_id, p_document_id, v_version, p_title, p_folder_path, p_file_name, p_evidence_type,
    p_provenance, p_issuing_authority, p_draft_state, p_declaration,
    COALESCE(p_sections, '[]'::jsonb), COALESCE(p_authoritative_fields, '[]'::jsonb),
    COALESCE(p_regulatory_references, '[]'::jsonb), p_operational_linkage,
    COALESCE(p_blocking_stages, ARRAY['booking','dispatch']::text[]),
    COALESCE(p_requires_insurer_approval, false), p_body_markdown, v_hash, v_actor)
  RETURNING id INTO v_new_id;

  IF v_prior.id IS NOT NULL THEN
    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'title', CASE WHEN v_prior.title IS DISTINCT FROM p_title
                    THEN jsonb_build_object('from', v_prior.title, 'to', p_title) END,
      'draft_state', CASE WHEN v_prior.draft_state IS DISTINCT FROM p_draft_state
                    THEN jsonb_build_object('from', v_prior.draft_state, 'to', p_draft_state) END,
      'issuing_authority', CASE WHEN v_prior.issuing_authority IS DISTINCT FROM p_issuing_authority
                    THEN jsonb_build_object('from', v_prior.issuing_authority, 'to', p_issuing_authority) END,
      'declaration', CASE WHEN v_prior.declaration IS DISTINCT FROM p_declaration
                    THEN jsonb_build_object('from', v_prior.declaration, 'to', p_declaration) END,
      'folder_path', CASE WHEN v_prior.folder_path IS DISTINCT FROM p_folder_path
                    THEN jsonb_build_object('from', v_prior.folder_path, 'to', p_folder_path) END,
      'sections', CASE WHEN v_prior.sections IS DISTINCT FROM COALESCE(p_sections, '[]'::jsonb)
                    THEN jsonb_build_object('from', v_prior.sections, 'to', COALESCE(p_sections, '[]'::jsonb)) END,
      'body', jsonb_build_object('from_hash', v_prior.content_hash, 'to_hash', v_hash)
    ));

    UPDATE public.lg_dossier_documents
       SET is_current = false, superseded_by = v_new_id
     WHERE id = v_prior.id;

    INSERT INTO public.lg_dossier_audit (
      control_id, document_version_id, document_version, content_hash, action, actor_user_id,
      prior_version, prior_content_hash, changes, detail)
    VALUES (p_control_id, v_prior.id, v_prior.version, v_prior.content_hash, 'SUPERSEDED', v_actor,
      v_prior.version, v_prior.content_hash, v_changes,
      format('Superseded by version %s', v_version));
  END IF;

  INSERT INTO public.lg_dossier_audit (
    control_id, document_version_id, document_version, content_hash, action, actor_user_id,
    prior_version, prior_content_hash, changes, detail)
  VALUES (p_control_id, v_new_id, v_version, v_hash,
    CASE WHEN v_prior.id IS NULL THEN 'SEEDED' ELSE 'VERSION_PUBLISHED' END,
    v_actor, v_prior.version, v_prior.content_hash, v_changes,
    format('%s filed at %s as %s (state %s)', p_document_id, p_folder_path, p_file_name, p_draft_state));

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lg_dossier_publish_version(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text[],boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lg_dossier_publish_version(text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,text[],boolean,text) TO service_role, authenticated;

-- =================================================================== approve
CREATE OR REPLACE FUNCTION public.lg_dossier_approve(
  p_document_version_id uuid,
  p_approver_kind text,
  p_decision text,
  p_comments text,
  p_conditions text DEFAULT NULL,
  p_evidence_ref text DEFAULT NULL,
  p_issuing_authority text DEFAULT NULL,
  p_effective_from timestamptz DEFAULT NULL,
  p_effective_until timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_doc public.lg_dossier_documents;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required to record a legal approval';
  END IF;

  SELECT * INTO v_doc FROM public.lg_dossier_documents WHERE id = p_document_version_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'dossier document version not found';
  END IF;
  IF NOT v_doc.is_current THEN
    RAISE EXCEPTION 'this dossier version has been superseded; approve the current version';
  END IF;

  IF p_approver_kind = 'owner' THEN
    IF NOT has_role(v_actor, 'admin'::app_role) THEN
      RAISE EXCEPTION 'owner approval requires an administrator';
    END IF;
  ELSIF NOT has_staff_permission('staff.legal.manage') THEN
    RAISE EXCEPTION 'not authorised to record a legal determination decision';
  END IF;

  IF p_approver_kind = 'insurer' AND NOT v_doc.requires_insurer_approval THEN
    RAISE EXCEPTION 'insurer approval does not apply to control %', v_doc.control_id;
  END IF;

  IF p_comments IS NULL OR length(btrim(p_comments)) < 40 THEN
    RAISE EXCEPTION 'a decision must describe the actual evidentiary basis (at least 40 characters)';
  END IF;

  IF p_decision <> 'rejected' AND p_effective_from IS NULL THEN
    RAISE EXCEPTION 'an approval must carry the effective date of the authoritative evidence';
  END IF;

  IF p_decision = 'approved_with_conditions'
     AND (p_conditions IS NULL OR length(btrim(p_conditions)) = 0) THEN
    RAISE EXCEPTION 'conditional approval must state the conditions';
  END IF;

  -- Separation of duties: one person may not hold two approver roles on a version.
  IF EXISTS (
    SELECT 1 FROM public.lg_dossier_approvals
     WHERE document_version_id = p_document_version_id
       AND decided_by = v_actor
       AND approver_kind <> p_approver_kind
  ) THEN
    RAISE EXCEPTION 'separation of duties: you already recorded a different approver role on this version';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;

  INSERT INTO public.lg_dossier_approvals (
    document_version_id, control_id, document_version, content_hash, approver_kind, decision,
    conditions, evidence_ref, issuing_authority, effective_from, effective_until, comments,
    decided_by, decided_by_email)
  VALUES (
    p_document_version_id, v_doc.control_id, v_doc.version, v_doc.content_hash, p_approver_kind,
    p_decision, p_conditions, p_evidence_ref, p_issuing_authority, p_effective_from,
    p_effective_until, btrim(p_comments), v_actor, v_email)
  RETURNING id INTO v_id;

  INSERT INTO public.lg_dossier_audit (
    control_id, document_version_id, document_version, content_hash, action, approver_kind,
    decision, actor_user_id, actor_email, changes, detail)
  VALUES (
    v_doc.control_id, v_doc.id, v_doc.version, v_doc.content_hash, 'APPROVAL_RECORDED',
    p_approver_kind, p_decision, v_actor, v_email,
    jsonb_build_object('decision', p_decision, 'approver_kind', p_approver_kind,
      'effective_from', p_effective_from, 'effective_until', p_effective_until,
      'conditions', p_conditions, 'evidence_ref', p_evidence_ref),
    format('%s recorded %s on %s v%s', p_approver_kind, p_decision, v_doc.document_id, v_doc.version));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lg_dossier_approve(uuid,text,text,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lg_dossier_approve(uuid,text,text,text,text,text,text,timestamptz,timestamptz) TO authenticated, service_role;

-- ============================================================ operational gate
CREATE OR REPLACE VIEW public.v_lg_dossier_gate
WITH (security_invoker = true)
AS
WITH cur AS (
  SELECT * FROM public.lg_dossier_documents WHERE is_current
), agg AS (
  SELECT
    d.id,
    bool_or(a.decision = 'rejected') AS has_rejection,
    bool_or(a.approver_kind = 'legal_reviewer' AND a.decision <> 'rejected') AS legal_ok,
    bool_or(a.approver_kind = 'owner' AND a.decision <> 'rejected') AS owner_ok,
    bool_or(a.approver_kind = 'insurer' AND a.decision <> 'rejected') AS insurer_ok,
    max(a.effective_from) AS effective_from,
    min(a.effective_until) AS effective_until,
    count(a.id) AS decisions
  FROM cur d
  LEFT JOIN public.lg_dossier_approvals a ON a.document_version_id = d.id
  GROUP BY d.id
)
SELECT
  d.control_id,
  d.id AS document_version_id,
  d.document_id,
  d.version,
  d.title,
  d.folder_path,
  d.file_name,
  d.draft_state,
  d.blocking_stages,
  d.requires_insurer_approval,
  COALESCE(g.decisions, 0) AS decision_count,
  COALESCE(g.legal_ok, false) AS legal_reviewer_approved,
  COALESCE(g.insurer_ok, false) AS insurer_approved,
  COALESCE(g.owner_ok, false) AS owner_approved,
  COALESCE(g.has_rejection, false) AS rejected,
  g.effective_from,
  g.effective_until,
  CASE
    WHEN COALESCE(g.has_rejection, false) THEN 'BLOCKED'
    WHEN NOT COALESCE(g.legal_ok, false) THEN 'BLOCKED'
    WHEN d.requires_insurer_approval AND NOT COALESCE(g.insurer_ok, false) THEN 'BLOCKED'
    WHEN NOT COALESCE(g.owner_ok, false) THEN 'BLOCKED'
    WHEN g.effective_from IS NULL OR g.effective_from > now() THEN 'PENDING_EFFECTIVE'
    WHEN g.effective_until IS NOT NULL AND g.effective_until <= now() THEN 'BLOCKED'
    ELSE 'EFFECTIVE'
  END AS gate_state,
  CASE
    WHEN COALESCE(g.has_rejection, false) THEN 'LG_DETERMINATION_REJECTED'
    WHEN NOT COALESCE(g.legal_ok, false) THEN 'LG_LEGAL_REVIEW_REQUIRED'
    WHEN d.requires_insurer_approval AND NOT COALESCE(g.insurer_ok, false) THEN 'LG_INSURER_EVIDENCE_REQUIRED'
    WHEN NOT COALESCE(g.owner_ok, false) THEN 'LG_OWNER_APPROVAL_REQUIRED'
    WHEN g.effective_from IS NULL OR g.effective_from > now() THEN 'LG_NOT_YET_EFFECTIVE'
    WHEN g.effective_until IS NOT NULL AND g.effective_until <= now() THEN 'LG_APPROVAL_EXPIRED'
    ELSE 'LG_EFFECTIVE'
  END AS reason_code
FROM cur d
LEFT JOIN agg g ON g.id = d.id;

GRANT SELECT ON public.v_lg_dossier_gate TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lg_gate_blocking(p_stage text)
RETURNS TABLE (control_id text, document_id text, title text, gate_state text, reason_code text, folder_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.control_id, v.document_id, v.title, v.gate_state, v.reason_code, v.folder_path
    FROM public.v_lg_dossier_gate v
   WHERE v.gate_state <> 'EFFECTIVE'
     AND p_stage = ANY (v.blocking_stages)
   ORDER BY v.control_id;
$$;

REVOKE ALL ON FUNCTION public.lg_gate_blocking(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lg_gate_blocking(text) TO authenticated, service_role;