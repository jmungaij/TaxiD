-- =====================================================================
-- Document OS — Forensic Document Authority
-- Cryptographic authenticity (Ed25519), explicit revocation, recomputable
-- audit hash chain and verifiable evidence packages.
-- =====================================================================

-- ------------------------------------------------- lifecycle: revocation
ALTER TABLE public.doc_security_marks
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text,
  ADD COLUMN IF NOT EXISTS revoked_by uuid;

ALTER TABLE public.doc_security_marks DROP CONSTRAINT IF EXISTS doc_security_marks_status_check;
ALTER TABLE public.doc_security_marks ADD CONSTRAINT doc_security_marks_status_check
  CHECK (status IN ('issued','valid','superseded','revoked','void','expired','archived'));

-- --------------------------------------------------- signing key registry
CREATE TABLE IF NOT EXISTS public.doc_signing_keys (
  key_id text PRIMARY KEY,
  algorithm text NOT NULL DEFAULT 'ed25519',
  public_key_pem text NOT NULL,
  provider text NOT NULL DEFAULT 'server_kms'
    CHECK (provider IN ('server_kms','development')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','compromised')),
  trusted boolean NOT NULL DEFAULT true,
  activated_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  note text
);
GRANT SELECT ON public.doc_signing_keys TO authenticated, anon;
GRANT ALL ON public.doc_signing_keys TO service_role;
ALTER TABLE public.doc_signing_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signing keys are public trust anchors" ON public.doc_signing_keys;
CREATE POLICY "signing keys are public trust anchors"
  ON public.doc_signing_keys FOR SELECT TO authenticated, anon USING (true);

INSERT INTO public.doc_signing_keys(key_id, algorithm, public_key_pem, provider, status, note)
VALUES (
  'YALLA-DOC-K01',
  'ed25519',
  '-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEASsFCC9TfAyW/0kKPoBXTX7b2lYVQrqn1Cr7vfpNuHsc=
-----END PUBLIC KEY-----',
  'server_kms',
  'active',
  'Yalla Mobility document authority key 01 — private half held by the signing service only.'
) ON CONFLICT (key_id) DO NOTHING;

-- ------------------------------------------------------- signature ledger
CREATE TABLE IF NOT EXISTS public.doc_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_id uuid NOT NULL REFERENCES public.doc_security_marks(id) ON DELETE RESTRICT,
  key_id text NOT NULL REFERENCES public.doc_signing_keys(key_id),
  algorithm text NOT NULL DEFAULT 'ed25519',
  signed_statement text NOT NULL,
  statement_hash text NOT NULL,
  signature_b64 text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_signatures_mark_key_idx ON public.doc_signatures(mark_id, key_id);
GRANT SELECT ON public.doc_signatures TO authenticated;
GRANT ALL ON public.doc_signatures TO service_role;
ALTER TABLE public.doc_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signatures readable by governance roles" ON public.doc_signatures;
CREATE POLICY "signatures readable by governance roles"
  ON public.doc_signatures FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.doc_signatures_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'signatures_append_only'; END;
$$;
DROP TRIGGER IF EXISTS doc_signatures_no_mutate ON public.doc_signatures;
CREATE TRIGGER doc_signatures_no_mutate
  BEFORE UPDATE OR DELETE ON public.doc_signatures
  FOR EACH ROW EXECUTE FUNCTION public.doc_signatures_append_only();

-- ------------------------------------------- recomputable audit hash chain
CREATE OR REPLACE FUNCTION public.doc_log_security_event(
  _mark_id uuid, _event text, _detail jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text; v_hash text; v_id uuid := gen_random_uuid();
  v_ts timestamptz := clock_timestamp(); v_detail jsonb := coalesce(_detail,'{}'::jsonb);
BEGIN
  SELECT chain_hash INTO v_prev FROM public.doc_security_events
   WHERE mark_id = _mark_id ORDER BY created_at DESC, id DESC LIMIT 1;

  v_hash := encode(digest(
    coalesce(v_prev,'genesis') || '|' || v_id::text || '|' || _mark_id::text || '|' ||
    _event || '|' || coalesce(auth.uid()::text,'system') || '|' ||
    to_char(v_ts,'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' || v_detail::text,
    'sha256'), 'hex');

  INSERT INTO public.doc_security_events(id, mark_id, event_type, actor_id, detail, prev_chain_hash, chain_hash, created_at)
  VALUES (v_id, _mark_id, _event, auth.uid(), v_detail, v_prev, v_hash, v_ts);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_audit_chain_verify(_mark_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_prev text := NULL; v_expected text; v_broken int := 0; v_total int := 0;
  v_first_break jsonb := NULL;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR r IN
    SELECT * FROM public.doc_security_events WHERE mark_id = _mark_id
     ORDER BY created_at ASC, id ASC
  LOOP
    v_total := v_total + 1;
    v_expected := encode(digest(
      coalesce(v_prev,'genesis') || '|' || r.id::text || '|' || r.mark_id::text || '|' ||
      r.event_type || '|' || coalesce(r.actor_id::text,'system') || '|' ||
      to_char(r.created_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' || r.detail::text,
      'sha256'), 'hex');

    IF r.chain_hash IS DISTINCT FROM v_expected
       OR r.prev_chain_hash IS DISTINCT FROM v_prev THEN
      v_broken := v_broken + 1;
      IF v_first_break IS NULL THEN
        v_first_break := jsonb_build_object(
          'event_id', r.id, 'event_type', r.event_type, 'created_at', r.created_at,
          'stored_hash', r.chain_hash, 'expected_hash', v_expected);
      END IF;
    END IF;
    v_prev := r.chain_hash;
  END LOOP;

  RETURN jsonb_build_object(
    'verified', v_broken = 0,
    'events', v_total,
    'broken_links', v_broken,
    'head_hash', v_prev,
    'first_break', v_first_break,
    'checked_at', now()
  );
END;
$$;

-- ------------------------------------------------------- canonical statement
CREATE OR REPLACE FUNCTION public.doc_signing_statement(_mark_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT concat_ws('|',
    'YALLA-DOC-V1', m.doc_number, m.security_number, m.doc_version::text,
    m.source_system, m.origin_ref,
    coalesce(m.template_code,'-'), coalesce(m.template_version,'-'),
    coalesce(m.template_hash,'-'), coalesce(m.data_snapshot_hash,'-'),
    coalesce(m.document_hash,'-'), m.classification, m.profile_code,
    to_char(m.issued_at,'YYYY-MM-DD"T"HH24:MI:SSOF'))
  FROM public.doc_security_marks m WHERE m.id = _mark_id;
$$;

CREATE OR REPLACE FUNCTION public.doc_record_signature(
  _mark_id uuid, _key_id text, _signature_b64 text,
  _signed_statement text, _statement_hash text, _algorithm text DEFAULT 'ed25519'
) RETURNS public.doc_signatures
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.doc_signatures; v_expected text; v_key public.doc_signing_keys;
BEGIN
  SELECT * INTO v_key FROM public.doc_signing_keys WHERE key_id = _key_id;
  IF v_key.key_id IS NULL THEN RAISE EXCEPTION 'unknown_signing_key'; END IF;
  IF v_key.status <> 'active' THEN RAISE EXCEPTION 'signing_key_not_active'; END IF;

  v_expected := public.doc_signing_statement(_mark_id);
  IF v_expected IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;
  IF v_expected <> _signed_statement THEN RAISE EXCEPTION 'statement_mismatch'; END IF;

  INSERT INTO public.doc_signatures(mark_id, key_id, algorithm, signed_statement, statement_hash, signature_b64)
  VALUES (_mark_id, _key_id, _algorithm, _signed_statement, _statement_hash, _signature_b64)
  ON CONFLICT (mark_id, key_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.doc_signatures WHERE mark_id = _mark_id AND key_id = _key_id;
  ELSE
    PERFORM public.doc_log_security_event(_mark_id, 'DOCUMENT_SIGNED',
      jsonb_build_object('key_id', _key_id, 'algorithm', _algorithm, 'statement_hash', _statement_hash));
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------- revocation vs supersession
CREATE OR REPLACE FUNCTION public.doc_set_mark_status(_mark_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS public.doc_security_marks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.doc_security_marks;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _status NOT IN ('revoked','void','expired','archived','valid') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  IF _status IN ('revoked','void') AND coalesce(btrim(_reason),'') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  UPDATE public.doc_security_marks
     SET status = _status,
         revoked_at = CASE WHEN _status IN ('revoked','void') THEN now() ELSE NULL END,
         revoked_reason = CASE WHEN _status IN ('revoked','void') THEN btrim(_reason) ELSE NULL END,
         revoked_by = CASE WHEN _status IN ('revoked','void') THEN auth.uid() ELSE NULL END
   WHERE id = _mark_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;

  PERFORM public.doc_log_security_event(_mark_id,
    CASE _status WHEN 'revoked' THEN 'DOCUMENT_REVOKED'
                 WHEN 'void' THEN 'DOCUMENT_VOIDED'
                 WHEN 'archived' THEN 'DOCUMENT_ARCHIVED'
                 ELSE 'DOCUMENT_STATUS_CHANGED' END,
    jsonb_build_object('status', _status, 'reason', _reason));
  RETURN v_row;
END;
$$;

-- ------------------------------------------------ public verification (v2)
CREATE OR REPLACE FUNCTION public.doc_verify_public(_doc_number text, _token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.doc_security_marks; s public.doc_signatures; k public.doc_signing_keys; v_state text;
BEGIN
  SELECT * INTO m FROM public.doc_security_marks
   WHERE upper(doc_number) = upper(btrim(_doc_number))
     AND upper(verification_token) = upper(btrim(_token));

  IF m.id IS NULL THEN
    RETURN jsonb_build_object('state','UNKNOWN_DOCUMENT','valid',false);
  END IF;

  SELECT * INTO s FROM public.doc_signatures WHERE mark_id = m.id ORDER BY signed_at DESC LIMIT 1;
  IF s.id IS NOT NULL THEN
    SELECT * INTO k FROM public.doc_signing_keys WHERE key_id = s.key_id;
  END IF;

  v_state := CASE m.status
      WHEN 'superseded' THEN 'AUTHENTIC_SUPERSEDED'
      WHEN 'revoked' THEN 'AUTHENTIC_REVOKED'
      WHEN 'void' THEN 'AUTHENTIC_VOID'
      WHEN 'expired' THEN 'AUTHENTIC_EXPIRED'
      WHEN 'archived' THEN 'AUTHENTIC_ARCHIVED'
      ELSE CASE WHEN m.expires_at IS NOT NULL AND m.expires_at < now()
                THEN 'AUTHENTIC_EXPIRED' ELSE 'AUTHENTIC' END
    END;

  RETURN jsonb_build_object(
    'valid', m.status IN ('issued','valid') AND (m.expires_at IS NULL OR m.expires_at >= now()),
    'state', v_state,
    'doc_number', m.doc_number,
    'organisation', 'Yalla Mobility',
    'document_class', m.class_code,
    'domain', m.domain_code,
    'version', m.doc_version,
    'classification', m.classification,
    'issued_at', m.issued_at,
    'has_document_hash', m.document_hash IS NOT NULL,
    'document_hash', m.document_hash,
    'superseded', m.superseded_by_mark_id IS NOT NULL,
    'revoked_at', m.revoked_at,
    'signed', s.id IS NOT NULL,
    'signature', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
        'algorithm', s.algorithm,
        'key_id', s.key_id,
        'signature_b64', s.signature_b64,
        'signed_statement', s.signed_statement,
        'statement_hash', s.statement_hash,
        'signed_at', s.signed_at,
        'public_key_pem', k.public_key_pem,
        'key_provider', k.provider,
        'key_trusted', k.trusted AND k.status = 'active'
      ) END
  );
END;
$$;

-- ------------------------------------------------- forensic evidence package
CREATE OR REPLACE FUNCTION public.doc_evidence_package(_mark_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.doc_security_marks; s public.doc_signatures; k public.doc_signing_keys;
  v_events jsonb; v_dist jsonb; v_chain jsonb; v_body jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO m FROM public.doc_security_marks WHERE id = _mark_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;

  SELECT * INTO s FROM public.doc_signatures WHERE mark_id = m.id ORDER BY signed_at DESC LIMIT 1;
  IF s.id IS NOT NULL THEN SELECT * INTO k FROM public.doc_signing_keys WHERE key_id = s.key_id; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'event_id', e.id, 'event_type', e.event_type, 'actor_id', e.actor_id,
           'created_at', e.created_at, 'detail', e.detail,
           'prev_chain_hash', e.prev_chain_hash, 'chain_hash', e.chain_hash
         ) ORDER BY e.created_at, e.id), '[]'::jsonb)
    INTO v_events FROM public.doc_security_events e WHERE e.mark_id = m.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'distribution_ref', d.distribution_ref, 'recipient_label', d.recipient_label,
           'recipient_role', d.recipient_role, 'channel', d.channel,
           'purpose', d.purpose, 'file_hash', d.file_hash, 'issued_at', d.issued_at
         ) ORDER BY d.issued_at), '[]'::jsonb)
    INTO v_dist FROM public.doc_distributions d WHERE d.mark_id = m.id;

  v_chain := public.doc_audit_chain_verify(m.id);

  v_body := jsonb_build_object(
    'package_format', 'YALLA-EVIDENCE/1.0',
    'registry', jsonb_build_object(
      'mark_id', m.id, 'doc_number', m.doc_number, 'security_number', m.security_number,
      'version', m.doc_version, 'status', m.status, 'classification', m.classification,
      'profile_code', m.profile_code, 'issued_at', m.issued_at, 'expires_at', m.expires_at,
      'revoked_at', m.revoked_at, 'revoked_reason', m.revoked_reason,
      'supersedes_mark_id', m.supersedes_mark_id, 'superseded_by_mark_id', m.superseded_by_mark_id,
      'page_count', m.page_count),
    'provenance', jsonb_build_object(
      'source_system', m.source_system, 'origin_ref', m.origin_ref,
      'template_code', m.template_code, 'template_version', m.template_version,
      'domain_code', m.domain_code, 'class_code', m.class_code,
      'complete', m.template_hash IS NOT NULL AND m.data_snapshot_hash IS NOT NULL AND m.document_hash IS NOT NULL),
    'hashes', jsonb_build_object(
      'document_sha256', m.document_hash,
      'template_sha256', m.template_hash,
      'data_snapshot_sha256', m.data_snapshot_hash),
    'signature', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'algorithm', s.algorithm, 'key_id', s.key_id, 'signature_b64', s.signature_b64,
      'signed_statement', s.signed_statement, 'statement_hash', s.statement_hash,
      'signed_at', s.signed_at, 'public_key_pem', k.public_key_pem,
      'key_provider', k.provider, 'key_status', k.status) END,
    'audit', jsonb_build_object('events', v_events, 'chain', v_chain),
    'custody', jsonb_build_object('distributions', v_dist),
    'exported_at', now(),
    'exported_by', auth.uid()
  );

  PERFORM public.doc_log_security_event(m.id, 'EVIDENCE_PACKAGE_EXPORTED',
    jsonb_build_object('events', jsonb_array_length(v_events), 'chain_verified', v_chain->'verified'));

  RETURN jsonb_build_object(
    'manifest', jsonb_build_object(
      'package_format', 'YALLA-EVIDENCE/1.0',
      'doc_number', m.doc_number,
      'body_sha256', encode(digest(v_body::text, 'sha256'), 'hex'),
      'signature_present', s.id IS NOT NULL,
      'audit_chain_verified', v_chain->'verified',
      'generated_at', now()),
    'body', v_body
  );
END;
$$;