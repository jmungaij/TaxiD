-- 1. Incident assignment & resolution ------------------------------------
ALTER TABLE public.partner_wl_incidents
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution text;

-- 2. Provisioning log (survives tenant rollback: no FK to tenants) --------
CREATE TABLE IF NOT EXISTS public.partner_wl_provisioning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL,
  tenant_id uuid,
  tenant_code text NOT NULL,
  step text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('started','succeeded','failed','rolled_back')),
  detail text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_wl_provisioning_log TO authenticated;
GRANT ALL ON public.partner_wl_provisioning_log TO service_role;
ALTER TABLE public.partner_wl_provisioning_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wl members read provisioning log" ON public.partner_wl_provisioning_log
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS partner_wl_provlog_partner_idx
  ON public.partner_wl_provisioning_log (partner_id, created_at DESC);

-- 3. Immutable, versioned evidence attachments ---------------------------
CREATE TABLE IF NOT EXISTS public.partner_wl_evidence_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL,
  evidence_id uuid REFERENCES public.partner_wl_evidence(id) ON DELETE SET NULL,
  document_key text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  note text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, document_key, version)
);
GRANT SELECT ON public.partner_wl_evidence_artifacts TO authenticated;
GRANT ALL ON public.partner_wl_evidence_artifacts TO service_role;
ALTER TABLE public.partner_wl_evidence_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wl members read evidence artifacts" ON public.partner_wl_evidence_artifacts
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public._partner_wl_artifacts_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'partner_wl_evidence_artifacts is append-only; upload a new version instead';
END;
$$;
DROP TRIGGER IF EXISTS partner_wl_artifacts_immutable ON public.partner_wl_evidence_artifacts;
CREATE TRIGGER partner_wl_artifacts_immutable
  BEFORE UPDATE OR DELETE ON public.partner_wl_evidence_artifacts
  FOR EACH ROW EXECUTE FUNCTION public._partner_wl_artifacts_immutable();

-- 4. Append-only signatures over evidence entries ------------------------
CREATE TABLE IF NOT EXISTS public.partner_wl_evidence_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.partner_wl_evidence(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL,
  key_id text NOT NULL,
  algorithm text NOT NULL DEFAULT 'Ed25519',
  signature_b64 text NOT NULL,
  signed_statement text NOT NULL,
  statement_hash text NOT NULL,
  signed_by uuid,
  signed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_wl_evidence_signatures TO authenticated;
GRANT ALL ON public.partner_wl_evidence_signatures TO service_role;
ALTER TABLE public.partner_wl_evidence_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wl members read evidence signatures" ON public.partner_wl_evidence_signatures
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public._partner_wl_signatures_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'partner_wl_evidence_signatures is append-only';
END;
$$;
DROP TRIGGER IF EXISTS partner_wl_signatures_append_only ON public.partner_wl_evidence_signatures;
CREATE TRIGGER partner_wl_signatures_append_only
  BEFORE UPDATE OR DELETE ON public.partner_wl_evidence_signatures
  FOR EACH ROW EXECUTE FUNCTION public._partner_wl_signatures_append_only();

-- 5. Canonical signing statement for one evidence entry ------------------
CREATE OR REPLACE FUNCTION public.partner_wl_evidence_statement(_evidence_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'YALLA-WL-EVIDENCE/v1' ||
         E'\ntenant=' || t.tenant_code ||
         E'\ntenant_id=' || e.tenant_id::text ||
         E'\nevidence_id=' || e.id::text ||
         E'\nkind=' || e.kind ||
         E'\nsubject=' || COALESCE(e.subject_ref,'') ||
         E'\nprev_hash=' || COALESCE(e.prev_hash,'genesis') ||
         E'\nentry_hash=' || e.entry_hash ||
         E'\ncreated_at=' || to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') ||
         E'\nstatement=' || e.statement
    FROM public.partner_wl_evidence e
    JOIN public.partner_wl_tenants t ON t.id = e.tenant_id
   WHERE e.id = _evidence_id;
$$;

-- 6. Incident actions ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_wl_incident_create(
  _tenant_id uuid, _severity text, _title text,
  _detail text DEFAULT NULL, _correlation_id text DEFAULT NULL, _assigned_to uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid; v_code text; v_seq integer; v_ref text; v_id uuid;
BEGIN
  SELECT partner_id, tenant_code INTO v_partner, v_code
    FROM public.partner_wl_tenants WHERE id = _tenant_id;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF NOT (public.partner_api_is_manager(v_partner) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to raise incidents for this tenant';
  END IF;
  IF _severity NOT IN ('sev1','sev2','sev3','sev4') THEN
    RAISE EXCEPTION 'severity must be sev1..sev4';
  END IF;
  IF coalesce(btrim(_title),'') = '' THEN RAISE EXCEPTION 'title is required'; END IF;

  SELECT count(*) + 1 INTO v_seq FROM public.partner_wl_incidents WHERE tenant_id = _tenant_id;
  v_ref := 'WL-' || upper(v_code) || '-INC-' || to_char(now(),'YYYYMMDD') || '-' || lpad(v_seq::text,3,'0');

  INSERT INTO public.partner_wl_incidents
    (tenant_id, partner_id, reference, severity, title, detail, status, correlation_id,
     assigned_to, assigned_at, created_by)
  VALUES (_tenant_id, v_partner, v_ref, _severity, btrim(_title), _detail, 'open', _correlation_id,
     _assigned_to, CASE WHEN _assigned_to IS NULL THEN NULL ELSE now() END, auth.uid())
  RETURNING id INTO v_id;

  PERFORM public.partner_wl_record_evidence(_tenant_id, 'incident',
    'Incident ' || v_ref || ' raised at ' || _severity || ': ' || btrim(_title), v_id::text,
    jsonb_build_object('reference', v_ref, 'severity', _severity, 'status', 'open',
                       'assigned_to', _assigned_to, 'correlation_id', _correlation_id));

  RETURN jsonb_build_object('ok', true, 'incident_id', v_id, 'reference', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_wl_incident_update(
  _incident_id uuid, _status text DEFAULT NULL, _severity text DEFAULT NULL,
  _assigned_to uuid DEFAULT NULL, _clear_assignee boolean DEFAULT false,
  _resolution text DEFAULT NULL, _note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.partner_wl_incidents; v_changes text[] := '{}'; v_new_status text;
BEGIN
  SELECT * INTO v_row FROM public.partner_wl_incidents WHERE id = _incident_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'incident not found'; END IF;
  IF NOT (public.partner_api_is_manager(v_row.partner_id) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to update this incident';
  END IF;
  IF v_row.status = 'closed' THEN RAISE EXCEPTION 'incident is closed and cannot be changed'; END IF;

  v_new_status := COALESCE(_status, v_row.status::text);
  IF v_new_status NOT IN ('open','mitigating','monitoring','resolved','closed') THEN
    RAISE EXCEPTION 'unknown incident status %', v_new_status;
  END IF;
  IF v_new_status IN ('resolved','closed')
     AND coalesce(btrim(COALESCE(_resolution, v_row.resolution)),'') = '' THEN
    RAISE EXCEPTION 'a resolution note is required to resolve or close an incident';
  END IF;
  IF _severity IS NOT NULL AND _severity NOT IN ('sev1','sev2','sev3','sev4') THEN
    RAISE EXCEPTION 'severity must be sev1..sev4';
  END IF;

  IF _status IS NOT NULL AND _status <> v_row.status::text THEN
    v_changes := v_changes || ('status ' || v_row.status::text || ' -> ' || _status);
  END IF;
  IF _severity IS NOT NULL AND _severity <> v_row.severity THEN
    v_changes := v_changes || ('severity ' || v_row.severity || ' -> ' || _severity);
  END IF;
  IF _clear_assignee THEN
    v_changes := v_changes || 'assignment cleared';
  ELSIF _assigned_to IS NOT NULL AND _assigned_to IS DISTINCT FROM v_row.assigned_to THEN
    v_changes := v_changes || ('assigned to ' || _assigned_to::text);
  END IF;
  IF _resolution IS NOT NULL AND _resolution IS DISTINCT FROM v_row.resolution THEN
    v_changes := v_changes || 'resolution recorded';
  END IF;

  UPDATE public.partner_wl_incidents SET
    status = v_new_status::public.partner_wl_incident_status,
    severity = COALESCE(_severity, severity),
    assigned_to = CASE WHEN _clear_assignee THEN NULL ELSE COALESCE(_assigned_to, assigned_to) END,
    assigned_at = CASE
      WHEN _clear_assignee THEN NULL
      WHEN _assigned_to IS NOT NULL AND _assigned_to IS DISTINCT FROM assigned_to THEN now()
      ELSE assigned_at END,
    resolution = COALESCE(_resolution, resolution),
    acknowledged_at = CASE
      WHEN acknowledged_at IS NULL AND v_new_status <> 'open' THEN now() ELSE acknowledged_at END,
    resolved_at = CASE
      WHEN v_new_status IN ('resolved','closed') AND resolved_at IS NULL THEN now()
      WHEN v_new_status NOT IN ('resolved','closed') THEN NULL
      ELSE resolved_at END,
    updated_at = now()
  WHERE id = _incident_id;

  PERFORM public.partner_wl_record_evidence(v_row.tenant_id, 'incident',
    'Incident ' || v_row.reference || ' updated: ' ||
    CASE WHEN array_length(v_changes,1) IS NULL THEN 'note added'
         ELSE array_to_string(v_changes, '; ') END ||
    CASE WHEN _note IS NULL THEN '' ELSE ' — ' || _note END,
    _incident_id::text,
    jsonb_build_object('reference', v_row.reference, 'status', v_new_status,
                       'changes', to_jsonb(v_changes), 'note', _note));

  RETURN jsonb_build_object('ok', true, 'incident_id', _incident_id, 'status', v_new_status);
END;
$$;

-- 7. Evidence attachment with automatic immutable versioning -------------
CREATE OR REPLACE FUNCTION public.partner_wl_evidence_attach(
  _tenant_id uuid, _document_key text, _title text, _file_name text,
  _storage_path text, _mime_type text, _byte_size bigint, _sha256 text,
  _note text DEFAULT NULL, _subject_ref text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid; v_version integer; v_ev jsonb; v_id uuid;
BEGIN
  SELECT partner_id INTO v_partner FROM public.partner_wl_tenants WHERE id = _tenant_id;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF NOT (public.partner_api_is_manager(v_partner) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to attach evidence for this tenant';
  END IF;
  IF _sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'sha256 must be 64 lowercase hex characters'; END IF;
  IF coalesce(btrim(_document_key),'') = '' THEN RAISE EXCEPTION 'document key is required'; END IF;

  SELECT COALESCE(max(version),0) + 1 INTO v_version
    FROM public.partner_wl_evidence_artifacts
   WHERE tenant_id = _tenant_id AND document_key = btrim(_document_key);

  v_ev := public.partner_wl_record_evidence(_tenant_id, 'attachment',
    'Evidence "' || _title || '" version ' || v_version || ' uploaded (' || _file_name ||
    ', sha256 ' || _sha256 || ').',
    COALESCE(_subject_ref, btrim(_document_key)),
    jsonb_build_object('document_key', btrim(_document_key), 'version', v_version,
                       'file_name', _file_name, 'sha256', _sha256,
                       'byte_size', _byte_size, 'mime_type', _mime_type, 'note', _note));

  INSERT INTO public.partner_wl_evidence_artifacts
    (tenant_id, partner_id, evidence_id, document_key, version, title, file_name,
     storage_path, mime_type, byte_size, sha256, note, uploaded_by)
  VALUES (_tenant_id, v_partner, (v_ev->>'evidence_id')::uuid, btrim(_document_key), v_version,
     _title, _file_name, _storage_path, _mime_type, _byte_size, _sha256, _note, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'artifact_id', v_id, 'version', v_version,
                            'evidence_id', v_ev->>'evidence_id', 'entry_hash', v_ev->>'entry_hash');
END;
$$;

-- 8. Provisioning step log + rollback ------------------------------------
CREATE OR REPLACE FUNCTION public.partner_wl_log_provisioning_step(
  _partner_id uuid, _tenant_code text, _step text, _outcome text,
  _tenant_id uuid DEFAULT NULL, _detail text DEFAULT NULL, _payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.partner_api_is_manager(_partner_id) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to provision for this partner';
  END IF;
  IF _outcome NOT IN ('started','succeeded','failed','rolled_back') THEN
    RAISE EXCEPTION 'unknown outcome %', _outcome;
  END IF;
  INSERT INTO public.partner_wl_provisioning_log
    (partner_id, tenant_id, tenant_code, step, outcome, detail, payload, actor_id)
  VALUES (_partner_id, _tenant_id, _tenant_code, _step, _outcome, _detail,
          COALESCE(_payload,'{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_wl_abort_provisioning(
  _tenant_id uuid, _reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid; v_code text; v_status text; v_creds integer := 0;
BEGIN
  SELECT partner_id, tenant_code, status::text INTO v_partner, v_code, v_status
    FROM public.partner_wl_tenants WHERE id = _tenant_id;
  IF v_partner IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_absent', true);
  END IF;
  IF NOT (public.partner_api_is_manager(v_partner) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to roll back this tenant';
  END IF;
  IF v_status NOT IN ('draft','provisioning') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tenant_not_rollbackable', 'status', v_status);
  END IF;

  UPDATE public.partner_api_credentials
     SET status = 'revoked', revoked_at = now()
   WHERE partner_id = v_partner
     AND status <> 'revoked'
     AND label LIKE '%' || v_code || '%';
  v_creds := COALESCE((SELECT count(*) FROM public.partner_api_credentials
     WHERE partner_id = v_partner AND status = 'revoked' AND label LIKE '%' || v_code || '%'), 0);

  UPDATE public.partner_wl_environments SET is_enabled = false WHERE tenant_id = _tenant_id;

  INSERT INTO public.partner_wl_provisioning_log
    (partner_id, tenant_id, tenant_code, step, outcome, detail, payload, actor_id)
  VALUES (v_partner, _tenant_id, v_code, 'rollback', 'rolled_back',
          COALESCE(_reason,'provisioning failed'),
          jsonb_build_object('credentials_revoked', v_creds, 'previous_status', v_status), auth.uid());

  DELETE FROM public.partner_wl_tenants WHERE id = _tenant_id;

  RETURN jsonb_build_object('ok', true, 'rolled_back', true, 'credentials_revoked', v_creds);
END;
$$;