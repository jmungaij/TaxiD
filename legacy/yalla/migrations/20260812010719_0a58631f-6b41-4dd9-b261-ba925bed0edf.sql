-- ============================ Phase 3 · Document OS ============================
CREATE TYPE public.crm_doc_class AS ENUM ('master','customer_instance');
CREATE TYPE public.crm_doc_internal_state AS ENUM ('draft','internal_review','approval_pending','approved','active','superseded','archived');
CREATE TYPE public.crm_doc_external_state AS ENUM ('draft','approved','shared','customer_review','customer_revision_requested','revised','accepted','executed');
CREATE TYPE public.crm_doc_verb AS ENUM ('view','download','use_template','create_version','edit','submit','approve','share','archive');

CREATE TABLE public.crm_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_class public.crm_doc_class NOT NULL,
  doc_type text NOT NULL,
  title text NOT NULL,
  description text,
  account_id uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  parent_document_id uuid REFERENCES public.crm_documents(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  internal_state public.crm_doc_internal_state NOT NULL DEFAULT 'draft',
  external_state public.crm_doc_external_state,
  current_version_id uuid,
  confidentiality text NOT NULL DEFAULT 'internal',
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_documents_master_no_parent CHECK (doc_class <> 'master' OR parent_document_id IS NULL),
  CONSTRAINT crm_documents_instance_scope CHECK (doc_class <> 'customer_instance' OR account_id IS NOT NULL)
);

CREATE TABLE public.crm_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.crm_documents(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  version_seq integer NOT NULL,
  storage_path text,
  file_name text,
  mime_type text,
  byte_size bigint,
  checksum text,
  change_note text,
  authored_by uuid REFERENCES auth.users(id),
  authored_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  approval_state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_seq),
  UNIQUE (document_id, version_label)
);

ALTER TABLE public.crm_documents
  ADD CONSTRAINT crm_documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.crm_document_versions(id) ON DELETE SET NULL;

CREATE TABLE public.crm_document_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.crm_document_versions(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  rationale text NOT NULL CHECK (length(btrim(rationale)) >= 5),
  decided_by uuid REFERENCES auth.users(id),
  decided_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.crm_document_versions(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'email',
  recipient_email text,
  note text,
  shared_by uuid REFERENCES auth.users(id),
  shared_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_document_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.crm_documents(id) ON DELETE CASCADE,
  doc_class public.crm_doc_class,
  doc_type text,
  role app_role,
  verb public.crm_doc_verb NOT NULL,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_document_permissions_scope CHECK (document_id IS NOT NULL OR doc_class IS NOT NULL OR doc_type IS NOT NULL)
);

CREATE TABLE public.crm_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.crm_documents(id) ON DELETE CASCADE,
  version_id uuid REFERENCES public.crm_document_versions(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('opportunity','interaction','work_item','account','transaction')),
  target_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, target_type, target_id)
);

CREATE INDEX idx_crm_documents_account ON public.crm_documents(account_id);
CREATE INDEX idx_crm_documents_opportunity ON public.crm_documents(opportunity_id);
CREATE INDEX idx_crm_documents_parent ON public.crm_documents(parent_document_id);
CREATE INDEX idx_crm_document_versions_doc ON public.crm_document_versions(document_id, version_seq DESC);
CREATE INDEX idx_crm_document_shares_version ON public.crm_document_shares(version_id);
CREATE INDEX idx_crm_document_links_target ON public.crm_document_links(target_type, target_id);

GRANT SELECT, INSERT, UPDATE ON public.crm_documents TO authenticated;
GRANT SELECT, INSERT ON public.crm_document_versions TO authenticated;
GRANT SELECT, INSERT ON public.crm_document_approvals TO authenticated;
GRANT SELECT, INSERT ON public.crm_document_shares TO authenticated;
GRANT SELECT ON public.crm_document_permissions TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.crm_document_links TO authenticated;
GRANT ALL ON public.crm_documents TO service_role;
GRANT ALL ON public.crm_document_versions TO service_role;
GRANT ALL ON public.crm_document_approvals TO service_role;
GRANT ALL ON public.crm_document_shares TO service_role;
GRANT ALL ON public.crm_document_permissions TO service_role;
GRANT ALL ON public.crm_document_links TO service_role;

ALTER TABLE public.crm_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_document_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_document_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_document_links ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.crm_can_write_commercial(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','super_admin','corporate_manager','operations_admin','finance_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.crm_document_authority(_user_id uuid, _document_id uuid, _verb public.crm_doc_verb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; explicit boolean;
BEGIN
  SELECT * INTO d FROM public.crm_documents WHERE id = _document_id;
  IF d.id IS NULL THEN RETURN false; END IF;

  IF public.has_role(_user_id,'admin') OR public.has_role(_user_id,'super_admin') THEN
    RETURN true;
  END IF;

  SELECT bool_or(allowed) INTO explicit
  FROM public.crm_document_permissions p
  WHERE p.verb = _verb
    AND p.role IS NOT NULL
    AND public.has_role(_user_id, p.role)
    AND (p.document_id = _document_id OR p.document_id IS NULL)
    AND (p.doc_class IS NULL OR p.doc_class = d.doc_class)
    AND (p.doc_type IS NULL OR p.doc_type = d.doc_type);
  IF explicit IS NOT NULL THEN RETURN explicit; END IF;

  IF d.doc_class = 'customer_instance'
     AND _verb IN ('view','download','use_template','create_version','share','submit')
     AND public.crm_can_write_commercial(_user_id) THEN
    RETURN true;
  END IF;

  IF _verb IN ('view','download','use_template') AND public.is_staff_portal_member(_user_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE POLICY "Staff can read documents" ON public.crm_documents
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "Commercial staff can create documents" ON public.crm_documents
  FOR INSERT TO authenticated WITH CHECK (public.crm_can_write_commercial(auth.uid()));
CREATE POLICY "Authorised staff can update documents" ON public.crm_documents
  FOR UPDATE TO authenticated
  USING (public.crm_document_authority(auth.uid(), id, 'edit') OR public.crm_can_write_commercial(auth.uid()))
  WITH CHECK (public.crm_document_authority(auth.uid(), id, 'edit') OR public.crm_can_write_commercial(auth.uid()));

CREATE POLICY "Staff can read document versions" ON public.crm_document_versions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "Authorised staff can add versions" ON public.crm_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.crm_document_authority(auth.uid(), document_id, 'create_version'));

CREATE POLICY "Staff can read document approvals" ON public.crm_document_approvals
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "Approvers can record decisions" ON public.crm_document_approvals
  FOR INSERT TO authenticated WITH CHECK (
    public.crm_document_authority(
      auth.uid(),
      (SELECT document_id FROM public.crm_document_versions v WHERE v.id = version_id),
      'approve')
  );

CREATE POLICY "Staff can read document shares" ON public.crm_document_shares
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "Authorised staff can record shares" ON public.crm_document_shares
  FOR INSERT TO authenticated WITH CHECK (
    public.crm_document_authority(
      auth.uid(),
      (SELECT document_id FROM public.crm_document_versions v WHERE v.id = version_id),
      'share')
  );

CREATE POLICY "Staff can read document permissions" ON public.crm_document_permissions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));

CREATE POLICY "Staff can read document links" ON public.crm_document_links
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "Commercial staff can manage document links" ON public.crm_document_links
  FOR INSERT TO authenticated WITH CHECK (public.crm_can_write_commercial(auth.uid()));
CREATE POLICY "Commercial staff can remove document links" ON public.crm_document_links
  FOR DELETE TO authenticated USING (public.crm_can_write_commercial(auth.uid()));

CREATE OR REPLACE FUNCTION public.crm_block_document_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER crm_document_versions_immutable
  BEFORE UPDATE OR DELETE ON public.crm_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.crm_block_document_immutable_mutation();
CREATE TRIGGER crm_document_shares_immutable
  BEFORE UPDATE OR DELETE ON public.crm_document_shares
  FOR EACH ROW EXECUTE FUNCTION public.crm_block_document_immutable_mutation();
CREATE TRIGGER crm_document_approvals_immutable
  BEFORE UPDATE OR DELETE ON public.crm_document_approvals
  FOR EACH ROW EXECUTE FUNCTION public.crm_block_document_immutable_mutation();

CREATE TRIGGER crm_documents_touch
  BEFORE UPDATE ON public.crm_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.crm_create_document_version(
  _document_id uuid,
  _storage_path text DEFAULT NULL,
  _file_name text DEFAULT NULL,
  _mime_type text DEFAULT NULL,
  _byte_size bigint DEFAULT NULL,
  _change_note text DEFAULT NULL,
  _checksum text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq integer; v_id uuid; v_staff uuid; d record;
BEGIN
  IF NOT public.crm_document_authority(auth.uid(), _document_id, 'create_version') THEN
    RAISE EXCEPTION 'not authorised to create a version of this document';
  END IF;
  SELECT * INTO d FROM public.crm_documents WHERE id = _document_id;
  IF d.internal_state = 'archived' THEN RAISE EXCEPTION 'document is archived'; END IF;

  SELECT COALESCE(MAX(version_seq),0)+1 INTO v_seq FROM public.crm_document_versions WHERE document_id = _document_id;
  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.crm_document_versions(
    document_id, version_label, version_seq, storage_path, file_name, mime_type,
    byte_size, checksum, change_note, authored_by, authored_staff_id)
  VALUES (_document_id, 'v'||v_seq||'.0', v_seq, _storage_path, _file_name, _mime_type,
          _byte_size, _checksum, _change_note, auth.uid(), v_staff)
  RETURNING id INTO v_id;

  UPDATE public.crm_documents
     SET current_version_id = v_id,
         internal_state = CASE WHEN internal_state IN ('approved','active') THEN 'internal_review' ELSE internal_state END,
         updated_at = now()
   WHERE id = _document_id;

  INSERT INTO public.ops_event_outbox(event_type, entity_type, entity_id, entity_ref, dedupe_key, payload)
  VALUES ('commercial.document.version_created','crm_document',_document_id, d.title,
          'crm_doc_version:'||v_id::text,
          jsonb_build_object('document_id',_document_id,'version_id',v_id,'version_seq',v_seq))
  ON CONFLICT DO NOTHING;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_decide_document_version(
  _version_id uuid, _decision text, _rationale text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; d record; a_id uuid; v_staff uuid;
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid decision'; END IF;
  SELECT * INTO v FROM public.crm_document_versions WHERE id = _version_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'version not found'; END IF;
  IF NOT public.crm_document_authority(auth.uid(), v.document_id, 'approve') THEN
    RAISE EXCEPTION 'not authorised to approve this document';
  END IF;
  SELECT * INTO d FROM public.crm_documents WHERE id = v.document_id;
  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.crm_document_approvals(version_id, decision, rationale, decided_by, decided_staff_id)
  VALUES (_version_id, _decision, _rationale, auth.uid(), v_staff)
  RETURNING id INTO a_id;

  UPDATE public.crm_documents
     SET internal_state = CASE WHEN _decision = 'approved' THEN 'approved'::public.crm_doc_internal_state
                               ELSE 'internal_review'::public.crm_doc_internal_state END,
         external_state = CASE WHEN _decision = 'approved' AND d.doc_class = 'customer_instance'
                               THEN 'approved'::public.crm_doc_external_state ELSE d.external_state END,
         updated_at = now()
   WHERE id = v.document_id;

  INSERT INTO public.ops_event_outbox(event_type, entity_type, entity_id, entity_ref, dedupe_key, payload)
  VALUES ('commercial.document.'||_decision,'crm_document', v.document_id, d.title,
          'crm_doc_decision:'||a_id::text,
          jsonb_build_object('document_id',v.document_id,'version_id',_version_id,'decision',_decision))
  ON CONFLICT DO NOTHING;

  RETURN a_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_share_document_version(
  _version_id uuid, _contact_id uuid DEFAULT NULL, _channel text DEFAULT 'email',
  _recipient_email text DEFAULT NULL, _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; d record; s_id uuid;
BEGIN
  SELECT * INTO v FROM public.crm_document_versions WHERE id = _version_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'version not found'; END IF;
  IF NOT public.crm_document_authority(auth.uid(), v.document_id, 'share') THEN
    RAISE EXCEPTION 'not authorised to share this document';
  END IF;
  SELECT * INTO d FROM public.crm_documents WHERE id = v.document_id;
  IF d.internal_state NOT IN ('approved','active') THEN
    RAISE EXCEPTION 'only approved documents may be shared externally';
  END IF;

  INSERT INTO public.crm_document_shares(version_id, contact_id, channel, recipient_email, note, shared_by)
  VALUES (_version_id, _contact_id, _channel, _recipient_email, _note, auth.uid())
  RETURNING id INTO s_id;

  UPDATE public.crm_documents
     SET external_state = 'shared', internal_state = 'active', updated_at = now()
   WHERE id = v.document_id;

  IF d.account_id IS NOT NULL THEN
    INSERT INTO public.crm_interactions(account_id, contact_id, opportunity_id, kind, subject, summary, occurred_at, created_by)
    VALUES (d.account_id, _contact_id, d.opportunity_id, 'document_shared', d.title,
            COALESCE(_note,'Document version shared with customer'), now(), auth.uid());
  END IF;

  INSERT INTO public.ops_event_outbox(event_type, entity_type, entity_id, entity_ref, dedupe_key, payload)
  VALUES ('commercial.document.shared','crm_document', v.document_id, d.title,
          'crm_doc_share:'||s_id::text,
          jsonb_build_object('document_id',v.document_id,'version_id',_version_id,'share_id',s_id))
  ON CONFLICT DO NOTHING;

  RETURN s_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_create_document_version(uuid,text,text,text,bigint,text,text) FROM public;
REVOKE ALL ON FUNCTION public.crm_decide_document_version(uuid,text,text) FROM public;
REVOKE ALL ON FUNCTION public.crm_share_document_version(uuid,uuid,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_create_document_version(uuid,text,text,text,bigint,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_decide_document_version(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_share_document_version(uuid,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_document_authority(uuid,uuid,public.crm_doc_verb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_can_write_commercial(uuid) TO authenticated;

INSERT INTO public.crm_document_permissions(doc_class, verb, role, allowed) VALUES
  ('master','edit','admin',true),
  ('master','approve','admin',true),
  ('master','archive','admin',true),
  ('customer_instance','approve','corporate_manager',true),
  ('customer_instance','approve','finance_admin',true),
  ('customer_instance','create_version','corporate_manager',true),
  ('customer_instance','share','corporate_manager',true);

CREATE POLICY "Staff can read crm document files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crm-documents' AND public.is_staff_portal_member(auth.uid()));
CREATE POLICY "Commercial staff can upload crm document files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-documents' AND public.crm_can_write_commercial(auth.uid()));