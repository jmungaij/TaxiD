-- =====================================================================
-- LG DOSSIER: approver role mapping, stakeholder notifications, read API
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.lg_approver_role_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_kind text NOT NULL CHECK (approver_kind IN ('legal_reviewer','insurer','owner')),
  role text NOT NULL,
  control_id text,                                  -- NULL = every LG control
  allowed boolean NOT NULL DEFAULT true,
  notify boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lg_approver_role_map_uniq
  ON public.lg_approver_role_map (approver_kind, role, coalesce(control_id, '*'));

GRANT SELECT ON public.lg_approver_role_map TO authenticated;
GRANT ALL ON public.lg_approver_role_map TO service_role;
ALTER TABLE public.lg_approver_role_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_map_read ON public.lg_approver_role_map;
CREATE POLICY lg_map_read ON public.lg_approver_role_map
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.legal.manage')
         OR public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS lg_map_write ON public.lg_approver_role_map;
CREATE POLICY lg_map_write ON public.lg_approver_role_map
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE OR REPLACE FUNCTION public._lg_touch_map()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS lg_approver_role_map_touch ON public.lg_approver_role_map;
CREATE TRIGGER lg_approver_role_map_touch BEFORE UPDATE ON public.lg_approver_role_map
  FOR EACH ROW EXECUTE FUNCTION public._lg_touch_map();

-- Seeded baseline: conservative, fully re-configurable by an administrator.
INSERT INTO public.lg_approver_role_map (approver_kind, role, control_id, notes) VALUES
  ('legal_reviewer', 'compliance_admin', NULL, 'Baseline: compliance function performs the legal determination review.'),
  ('legal_reviewer', 'director',         NULL, 'Baseline: director may act as legal reviewer of record.'),
  ('insurer',        'compliance_admin', 'LG-05', 'Baseline: records the insurer written confirmation for LG-05.'),
  ('insurer',        'compliance_admin', 'LG-06', 'Baseline: records the insurer written confirmation for LG-06.'),
  ('owner',          'super_admin',      NULL, 'Baseline: owner approval of record.'),
  ('owner',          'admin',            NULL, 'Baseline: administrator acting for the owner.')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------ helper
CREATE OR REPLACE FUNCTION public.lg_can_approve(_user_id uuid, _approver_kind text, _control_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.lg_approver_role_map m
      JOIN public.user_roles ur
        ON ur.user_id = _user_id
       AND ur.role::text = m.role
     WHERE m.approver_kind = _approver_kind
       AND m.allowed
       AND (m.control_id IS NULL OR m.control_id = _control_id)
  );
$$;

REVOKE ALL ON FUNCTION public.lg_can_approve(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lg_can_approve(uuid, text, text) TO authenticated, service_role;

-- --------------------------------------------------- notification outbox
CREATE TABLE IF NOT EXISTS public.lg_dossier_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.lg_dossier_audit(id) ON DELETE SET NULL,
  control_id text NOT NULL,
  document_id text,
  document_version_id uuid,
  document_version integer,
  event text NOT NULL CHECK (event IN ('SEEDED','VERSION_PUBLISHED','SUPERSEDED','APPROVAL_RECORDED','BECAME_EFFECTIVE')),
  channel text NOT NULL CHECK (channel IN ('email','in_app')),
  recipient_role text,
  recipient_user_id uuid,
  recipient_email text,
  subject text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS lg_dossier_notifications_idem
  ON public.lg_dossier_notifications (idempotency_key);
CREATE INDEX IF NOT EXISTS lg_dossier_notifications_pending
  ON public.lg_dossier_notifications (status, created_at) WHERE status = 'pending';

GRANT SELECT ON public.lg_dossier_notifications TO authenticated;
GRANT ALL ON public.lg_dossier_notifications TO service_role;
ALTER TABLE public.lg_dossier_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lg_notif_read ON public.lg_dossier_notifications;
CREATE POLICY lg_notif_read ON public.lg_dossier_notifications
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid()
         OR public.has_staff_permission('staff.legal.manage')
         OR public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- ------------------------------------------------------- fan-out trigger
CREATE OR REPLACE FUNCTION public._lg_dossier_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc         public.lg_dossier_documents;
  v_gate_state  text;
  v_events      text[] := ARRAY[NEW.action];
  v_event       text;
  v_subject     text;
  v_body        text;
  r             record;
BEGIN
  SELECT * INTO v_doc FROM public.lg_dossier_documents WHERE id = NEW.document_version_id;

  -- A recorded approval may be the one that makes the determination effective.
  IF NEW.action = 'APPROVAL_RECORDED' THEN
    SELECT gate_state INTO v_gate_state
      FROM public.v_lg_dossier_gate WHERE control_id = NEW.control_id;
    IF v_gate_state = 'EFFECTIVE' THEN
      v_events := v_events || 'BECAME_EFFECTIVE';
    END IF;
  END IF;

  FOREACH v_event IN ARRAY v_events LOOP
    v_subject := CASE v_event
      WHEN 'SEEDED'            THEN format('LG dossier filed for review — %s', NEW.control_id)
      WHEN 'VERSION_PUBLISHED' THEN format('LG dossier version %s published — %s', COALESCE(NEW.document_version, 0), NEW.control_id)
      WHEN 'SUPERSEDED'        THEN format('LG dossier version superseded — %s', NEW.control_id)
      WHEN 'APPROVAL_RECORDED' THEN format('LG determination decision recorded — %s', NEW.control_id)
      ELSE format('LG determination is now effective — %s', NEW.control_id)
    END;

    v_body := format(
      '%s (%s) version %s. %s%sBooking and dispatch remain closed for this control until an authorised legal, insurer (where required) and owner approval exist against this exact version with a real effective date.',
      COALESCE(v_doc.title, NEW.control_id),
      COALESCE(v_doc.document_id, NEW.control_id),
      COALESCE(NEW.document_version, 0),
      COALESCE(NEW.detail || ' ', ''),
      CASE WHEN v_event = 'BECAME_EFFECTIVE'
           THEN 'All required approvals are now recorded and the determination is operationally effective. '
           ELSE '' END);

    FOR r IN
      SELECT DISTINCT ur.user_id, m.role, u.email
        FROM public.lg_approver_role_map m
        JOIN public.user_roles ur ON ur.role::text = m.role
        JOIN auth.users u ON u.id = ur.user_id
       WHERE m.allowed AND m.notify
         AND (m.control_id IS NULL OR m.control_id = NEW.control_id)
    LOOP
      INSERT INTO public.staff_notifications (
        recipient_user_id, actor_user_id, kind, title, body, source_of_record, source_record_id)
      VALUES (
        r.user_id, NEW.actor_user_id,
        CASE WHEN v_event IN ('APPROVAL_RECORDED','BECAME_EFFECTIVE') THEN 'decision_recorded' ELSE 'decision_requested' END,
        v_subject, v_body, 'lg_dossier_audit', NEW.id);

      INSERT INTO public.lg_dossier_notifications (
        audit_id, control_id, document_id, document_version_id, document_version, event, channel,
        recipient_role, recipient_user_id, recipient_email, subject, body, payload, idempotency_key)
      VALUES (
        NEW.id, NEW.control_id, v_doc.document_id, NEW.document_version_id, NEW.document_version,
        v_event, 'in_app', r.role, r.user_id, r.email, v_subject, v_body,
        jsonb_build_object('folder_path', v_doc.folder_path, 'file_name', v_doc.file_name,
                           'gate_state', v_gate_state, 'content_hash', NEW.content_hash),
        format('%s:%s:in_app:%s', v_event, NEW.id, r.user_id))
      ON CONFLICT (idempotency_key) DO NOTHING;

      IF r.email IS NOT NULL THEN
        INSERT INTO public.lg_dossier_notifications (
          audit_id, control_id, document_id, document_version_id, document_version, event, channel,
          recipient_role, recipient_user_id, recipient_email, subject, body, payload, idempotency_key)
        VALUES (
          NEW.id, NEW.control_id, v_doc.document_id, NEW.document_version_id, NEW.document_version,
          v_event, 'email', r.role, r.user_id, r.email, v_subject, v_body,
          jsonb_build_object('folder_path', v_doc.folder_path, 'file_name', v_doc.file_name,
                             'gate_state', v_gate_state, 'content_hash', NEW.content_hash,
                             'approver_kind', NEW.approver_kind, 'decision', NEW.decision),
          format('%s:%s:email:%s', v_event, NEW.id, r.user_id))
        ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Notification fan-out must never break the immutable audit write.
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS lg_dossier_audit_notify ON public.lg_dossier_audit;
CREATE TRIGGER lg_dossier_audit_notify AFTER INSERT ON public.lg_dossier_audit
  FOR EACH ROW EXECUTE FUNCTION public._lg_dossier_notify();

-- ------------------------------------------- approval: mapping enforcement
CREATE OR REPLACE FUNCTION public.lg_dossier_approve(
  p_document_version_id uuid,
  p_approver_kind text,
  p_decision text,
  p_comments text,
  p_conditions text DEFAULT NULL,
  p_evidence_ref text DEFAULT NULL,
  p_issuing_authority text DEFAULT NULL,
  p_effective_from timestamptz DEFAULT NULL,
  p_effective_until timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- Authority comes ONLY from the administered approver role mapping.
  IF NOT public.lg_can_approve(v_actor, p_approver_kind, v_doc.control_id) THEN
    RAISE EXCEPTION 'your roles are not mapped to approve % as % — an administrator must configure the approver role mapping',
      v_doc.control_id, p_approver_kind;
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
END; $$;

-- ------------------------------------------------- read-only status API
CREATE OR REPLACE FUNCTION public.lg_gate_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH last_audit AS (
    SELECT DISTINCT ON (control_id) control_id, id, action, content_hash, document_version, created_at, actor_email
      FROM public.lg_dossier_audit ORDER BY control_id, created_at DESC
  ),
  controls AS (
    SELECT
      g.control_id, g.document_id, g.title, g.folder_path, g.file_name, g.version,
      g.draft_state, g.gate_state, g.reason_code, g.blocking_stages,
      g.requires_insurer_approval, g.legal_reviewer_approved, g.insurer_approved,
      g.owner_approved, g.rejected, g.effective_from, g.effective_until,
      g.document_version_id,
      (SELECT jsonb_agg(jsonb_build_object(
          'approver_kind', a.approver_kind, 'decision', a.decision,
          'document_version', a.document_version, 'content_hash', a.content_hash,
          'effective_from', a.effective_from, 'effective_until', a.effective_until,
          'decided_at', a.decided_at, 'decided_by_email', a.decided_by_email)
          ORDER BY a.decided_at)
         FROM public.lg_dossier_approvals a
        WHERE a.document_version_id = g.document_version_id) AS approvals,
      to_jsonb(la.*) - 'control_id' AS latest_audit
    FROM public.v_lg_dossier_gate g
    LEFT JOIN last_audit la ON la.control_id = g.control_id
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'stages', (
      SELECT jsonb_object_agg(stage, jsonb_build_object(
        'open', NOT EXISTS (SELECT 1 FROM public.lg_gate_blocking(stage)),
        'blocking', COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'control_id', b.control_id, 'reason_code', b.reason_code,
             'gate_state', b.gate_state, 'title', b.title))
           FROM public.lg_gate_blocking(stage) b), '[]'::jsonb)))
      FROM (VALUES ('booking'),('dispatch')) AS s(stage)
    ),
    'controls', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.control_id) FROM controls c), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.lg_gate_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lg_gate_status() TO service_role;
