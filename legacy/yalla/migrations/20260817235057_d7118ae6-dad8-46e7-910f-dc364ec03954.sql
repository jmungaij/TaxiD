-- ============================================================================
-- Document Authority — forensic audit remediation
-- P0: pgcrypto lives in schema `extensions`; every routine pinned
--     search_path=public, so digest()/gen_random_bytes() raised
--     "function digest(text, unknown) does not exist" at runtime.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.doc_verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number text NOT NULL,
  outcome text NOT NULL,
  mark_id uuid REFERENCES public.doc_security_marks(id) ON DELETE RESTRICT,
  client_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_verification_attempts_doc_idx
  ON public.doc_verification_attempts (doc_number, created_at DESC);
CREATE INDEX IF NOT EXISTS doc_verification_attempts_time_idx
  ON public.doc_verification_attempts (created_at DESC);

GRANT SELECT ON public.doc_verification_attempts TO authenticated;
GRANT ALL ON public.doc_verification_attempts TO service_role;
ALTER TABLE public.doc_verification_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "verification attempts readable by governance roles" ON public.doc_verification_attempts;
CREATE POLICY "verification attempts readable by governance roles"
  ON public.doc_verification_attempts FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

-- ---------------------------------------------------------------- audit chain
CREATE OR REPLACE FUNCTION public.doc_log_security_event(
  _mark_id uuid, _event text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_prev text; v_hash text; v_id uuid := gen_random_uuid();
  v_ts timestamptz := clock_timestamp(); v_detail jsonb := coalesce(_detail,'{}'::jsonb);
BEGIN
  -- Audit events may only be appended by the document authority itself.
  IF NOT public.doc_forensics_authorized() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT chain_hash INTO v_prev FROM public.doc_security_events
   WHERE mark_id = _mark_id ORDER BY created_at DESC, id DESC LIMIT 1;

  v_hash := encode(extensions.digest(
    coalesce(v_prev,'genesis') || '|' || v_id::text || '|' || _mark_id::text || '|' ||
    _event || '|' || coalesce(auth.uid()::text,'system') || '|' ||
    to_char(v_ts,'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' || v_detail::text,
    'sha256'), 'hex');

  INSERT INTO public.doc_security_events(id, mark_id, event_type, actor_id, detail, prev_chain_hash, chain_hash, created_at)
  VALUES (v_id, _mark_id, _event, auth.uid(), v_detail, v_prev, v_hash, v_ts);
  RETURN v_id;
END; $$;

-- Internal appender for routines that must log even for anonymous callers
-- (public verification). Not granted to clients.
CREATE OR REPLACE FUNCTION public.doc_log_security_event_internal(
  _mark_id uuid, _event text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_prev text; v_hash text; v_id uuid := gen_random_uuid();
  v_ts timestamptz := clock_timestamp(); v_detail jsonb := coalesce(_detail,'{}'::jsonb);
BEGIN
  SELECT chain_hash INTO v_prev FROM public.doc_security_events
   WHERE mark_id = _mark_id ORDER BY created_at DESC, id DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    coalesce(v_prev,'genesis') || '|' || v_id::text || '|' || _mark_id::text || '|' ||
    _event || '|' || coalesce(auth.uid()::text,'system') || '|' ||
    to_char(v_ts,'YYYY-MM-DD"T"HH24:MI:SS.USOF') || '|' || v_detail::text,
    'sha256'), 'hex');
  INSERT INTO public.doc_security_events(id, mark_id, event_type, actor_id, detail, prev_chain_hash, chain_hash, created_at)
  VALUES (v_id, _mark_id, _event, auth.uid(), v_detail, v_prev, v_hash, v_ts);
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.doc_log_security_event_internal(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.doc_log_security_event_internal(uuid, text, jsonb) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.doc_audit_chain_verify(_mark_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  r record; v_prev text := NULL; v_expected text; v_broken int := 0; v_total int := 0;
  v_first_break jsonb := NULL;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[])
     AND NOT public.doc_forensics_authorized() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR r IN
    SELECT * FROM public.doc_security_events WHERE mark_id = _mark_id
     ORDER BY created_at ASC, id ASC
  LOOP
    v_total := v_total + 1;
    v_expected := encode(extensions.digest(
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
    'verified', v_broken = 0, 'events', v_total, 'broken_links', v_broken,
    'head_hash', v_prev, 'first_break', v_first_break, 'checked_at', now());
END; $$;

-- ------------------------------------------------------------ identity minting
CREATE OR REPLACE FUNCTION public.doc_new_security_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_alpha text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(12);
  i int; v_out text := '';
BEGIN
  -- CSPRNG, not random(): security numbers must not be predictable.
  FOR i IN 0..11 LOOP
    v_out := v_out || substr(v_alpha, 1 + (get_byte(v_bytes, i) % length(v_alpha)), 1);
  END LOOP;
  RETURN format('YM-%s-%s-%s', substr(v_out,1,4), substr(v_out,5,4), substr(v_out,9,4));
END; $$;

CREATE OR REPLACE FUNCTION public.doc_issue_security_mark(
  _domain text, _class text, _source_system text, _origin_ref text,
  _classification text DEFAULT 'CONFIDENTIAL', _profile_code text DEFAULT 'CONFIDENTIAL',
  _document_id uuid DEFAULT NULL,
  _template_code text DEFAULT NULL, _template_version text DEFAULT NULL,
  _template_hash text DEFAULT NULL, _data_snapshot_hash text DEFAULT NULL,
  _supersedes_mark_id uuid DEFAULT NULL, _expires_at timestamptz DEFAULT NULL)
RETURNS public.doc_security_marks LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_number text; v_sec text; v_token text; v_version int := 1;
  v_row public.doc_security_marks; v_attempt int := 0;
BEGIN
  IF NOT public.doc_forensics_authorized() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _origin_ref IS NULL OR btrim(_origin_ref) = '' THEN RAISE EXCEPTION 'origin_ref_required'; END IF;

  IF _supersedes_mark_id IS NOT NULL THEN
    SELECT doc_version + 1 INTO v_version FROM public.doc_security_marks WHERE id = _supersedes_mark_id;
    IF v_version IS NULL THEN RAISE EXCEPTION 'supersedes_mark_not_found'; END IF;
  END IF;

  v_number := public.doc_next_number(_domain, _class);

  LOOP
    v_attempt := v_attempt + 1;
    v_sec := public.doc_new_security_number();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.doc_security_marks WHERE security_number = v_sec);
    IF v_attempt > 10 THEN RAISE EXCEPTION 'security_number_collision'; END IF;
  END LOOP;

  v_token := upper(encode(extensions.gen_random_bytes(9), 'hex'));

  INSERT INTO public.doc_security_marks(
    doc_number, security_number, verification_token, document_id, domain_code, class_code,
    source_system, origin_ref, doc_version, template_code, template_version, template_hash,
    data_snapshot_hash, classification, profile_code, footer_line, micro_code,
    supersedes_mark_id, expires_at, created_by
  ) VALUES (
    v_number, v_sec, v_token, _document_id, upper(_domain), upper(_class),
    upper(_source_system), _origin_ref, v_version, _template_code, _template_version, _template_hash,
    _data_snapshot_hash, upper(_classification), upper(_profile_code),
    format('YALLA MOBILITY | OFFICIAL CONTROLLED DOCUMENT | DOC: %s | SRC: %s | ORG: %s | V%s | SEC: %s',
           v_number, upper(_source_system), _origin_ref, lpad(v_version::text,2,'0'), v_sec),
    format('YML|DOCOS|%s|%s|%s|%s|V%s|%s',
           upper(_domain), upper(_class), to_char(now(),'YY'),
           split_part(v_number,'-',5), lpad(v_version::text,2,'0'), replace(v_sec,'-','')),
    _supersedes_mark_id, _expires_at, auth.uid()
  ) RETURNING * INTO v_row;

  PERFORM public.doc_log_security_event_internal(v_row.id, 'DOCUMENT_FORENSIC_ID_ASSIGNED',
    jsonb_build_object('doc_number', v_number, 'profile', upper(_profile_code)));
  PERFORM public.doc_log_security_event_internal(v_row.id, 'DOCUMENT_SECURITY_MARK_GENERATED',
    jsonb_build_object('security_number', v_sec));

  IF _supersedes_mark_id IS NOT NULL THEN
    UPDATE public.doc_security_marks
       SET status = 'superseded', superseded_by_mark_id = v_row.id
     WHERE id = _supersedes_mark_id;
    PERFORM public.doc_log_security_event_internal(_supersedes_mark_id, 'DOCUMENT_SUPERSEDED',
      jsonb_build_object('superseded_by', v_number));
  END IF;

  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.doc_seal_document_hash(
  _mark_id uuid, _document_hash text, _page_count integer DEFAULT NULL)
RETURNS public.doc_security_marks LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_row public.doc_security_marks;
BEGIN
  IF NOT public.doc_forensics_authorized() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _document_hash IS NULL OR _document_hash !~* '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'document_hash_must_be_sha256_hex';
  END IF;
  UPDATE public.doc_security_marks
     SET document_hash = _document_hash,
         page_count = COALESCE(_page_count, page_count),
         status = CASE WHEN status = 'issued' THEN 'valid' ELSE status END
   WHERE id = _mark_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;
  PERFORM public.doc_log_security_event_internal(_mark_id, 'DOCUMENT_HASH_GENERATED',
    jsonb_build_object('document_hash', _document_hash, 'pages', _page_count));
  PERFORM public.doc_log_security_event_internal(_mark_id, 'DOCUMENT_RENDERED', '{}'::jsonb);
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.doc_register_distribution(
  _mark_id uuid, _recipient_label text, _recipient_role text DEFAULT NULL,
  _channel text DEFAULT 'download', _purpose text DEFAULT NULL, _file_hash text DEFAULT NULL)
RETURNS public.doc_distributions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_ref text; v_row public.doc_distributions;
BEGIN
  IF NOT public.doc_forensics_authorized() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_ref := format('DIST-%s-%s', EXTRACT(YEAR FROM now())::int, upper(encode(extensions.gen_random_bytes(4),'hex')));
  INSERT INTO public.doc_distributions(mark_id, distribution_ref, recipient_label, recipient_role, channel, purpose, file_hash, issued_to)
  VALUES (_mark_id, v_ref, _recipient_label, _recipient_role, _channel, _purpose, _file_hash, auth.uid())
  RETURNING * INTO v_row;
  PERFORM public.doc_log_security_event_internal(_mark_id, 'DOCUMENT_DOWNLOADED',
    jsonb_build_object('distribution_ref', v_ref, 'recipient', _recipient_label, 'channel', _channel));
  RETURN v_row;
END; $$;

-- ------------------------------------------------------------------ signatures
CREATE OR REPLACE FUNCTION public.doc_signing_statement(_mark_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT CASE WHEN public.doc_forensics_authorized() THEN concat_ws('|',
    'YALLA-DOC-V1', m.doc_number, m.security_number, m.doc_version::text,
    m.source_system, m.origin_ref,
    coalesce(m.template_code,'-'), coalesce(m.template_version,'-'),
    coalesce(m.template_hash,'-'), coalesce(m.data_snapshot_hash,'-'),
    coalesce(m.document_hash,'-'), m.classification, m.profile_code,
    to_char(m.issued_at,'YYYY-MM-DD"T"HH24:MI:SSOF')) END
  FROM public.doc_security_marks m WHERE m.id = _mark_id;
$$;

CREATE OR REPLACE FUNCTION public.doc_record_signature(
  _mark_id uuid, _key_id text, _signature_b64 text, _signed_statement text,
  _statement_hash text, _algorithm text DEFAULT 'ed25519')
RETURNS public.doc_signatures LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_row public.doc_signatures; v_expected text; v_key public.doc_signing_keys;
  v_jwt_role text; v_mark public.doc_security_marks;
BEGIN
  v_jwt_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  IF v_jwt_role <> 'service_role'
     AND NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_key FROM public.doc_signing_keys WHERE key_id = _key_id;
  IF v_key.key_id IS NULL THEN RAISE EXCEPTION 'unknown_signing_key'; END IF;
  IF v_key.status <> 'active' THEN RAISE EXCEPTION 'signing_key_not_active'; END IF;

  SELECT * INTO v_mark FROM public.doc_security_marks WHERE id = _mark_id;
  IF v_mark.id IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;
  -- A signature must bind to real artefact bytes, never to an unsealed shell.
  IF v_mark.document_hash IS NULL THEN RAISE EXCEPTION 'document_not_sealed'; END IF;
  IF v_mark.status IN ('revoked','void') THEN RAISE EXCEPTION 'document_authority_withdrawn'; END IF;

  v_expected := public.doc_signing_statement(_mark_id);
  IF v_expected IS NULL THEN RAISE EXCEPTION 'statement_unavailable'; END IF;
  IF v_expected <> _signed_statement THEN RAISE EXCEPTION 'statement_mismatch'; END IF;
  IF _statement_hash <> encode(extensions.digest(_signed_statement, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'statement_hash_mismatch';
  END IF;

  INSERT INTO public.doc_signatures(mark_id, key_id, algorithm, signed_statement, statement_hash, signature_b64)
  VALUES (_mark_id, _key_id, _algorithm, _signed_statement, _statement_hash, _signature_b64)
  ON CONFLICT (mark_id, key_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.doc_signatures WHERE mark_id = _mark_id AND key_id = _key_id;
  ELSE
    PERFORM public.doc_log_security_event_internal(_mark_id, 'DOCUMENT_SIGNED',
      jsonb_build_object('key_id', _key_id, 'algorithm', _algorithm, 'statement_hash', _statement_hash));
  END IF;

  RETURN v_row;
END; $$;

-- --------------------------------------------------------------- key rotation
CREATE OR REPLACE FUNCTION public.doc_register_signing_key(
  _key_id text, _public_key_pem text, _algorithm text DEFAULT 'ed25519',
  _provider text DEFAULT 'server_kms')
RETURNS public.doc_signing_keys LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_row public.doc_signing_keys;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','compliance_admin']::app_role[])
     AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _public_key_pem NOT LIKE '%BEGIN PUBLIC KEY%' THEN RAISE EXCEPTION 'public_key_pem_required'; END IF;
  IF _public_key_pem LIKE '%PRIVATE KEY%' THEN RAISE EXCEPTION 'private_key_must_never_be_stored'; END IF;

  INSERT INTO public.doc_signing_keys(key_id, algorithm, public_key_pem, provider, status, trusted, activated_at)
  VALUES (_key_id, _algorithm, _public_key_pem, _provider, 'active', true, now())
  RETURNING * INTO v_row;
  RETURN v_row;
END; $$;

CREATE OR REPLACE FUNCTION public.doc_retire_signing_key(
  _key_id text, _reason text, _compromised boolean DEFAULT false)
RETURNS public.doc_signing_keys LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_row public.doc_signing_keys;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.doc_signing_keys
     SET status = CASE WHEN _compromised THEN 'compromised' ELSE 'retired' END,
         trusted = NOT _compromised,
         retired_at = now()
   WHERE key_id = _key_id
  RETURNING * INTO v_row;
  IF v_row.key_id IS NULL THEN RAISE EXCEPTION 'unknown_signing_key'; END IF;
  RETURN v_row;
END; $$;

-- ------------------------------------------------------------ tamper forensics
CREATE OR REPLACE FUNCTION public.doc_tamper_check(
  _doc_number text, _security_number text DEFAULT NULL,
  _version integer DEFAULT NULL, _document_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE m public.doc_security_marks; v_signals jsonb; v_state text;
  fn_sec boolean; fn_ver boolean; fn_hash boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO m FROM public.doc_security_marks WHERE upper(doc_number) = upper(btrim(_doc_number));
  IF m.id IS NULL THEN
    RETURN jsonb_build_object('state','INVALID_DOCUMENT_ID','signals', jsonb_build_array(
      jsonb_build_object('label','Document number','passed',false)));
  END IF;

  fn_sec  := _security_number IS NULL OR upper(btrim(_security_number)) = m.security_number;
  fn_ver  := _version IS NULL OR _version = m.doc_version;
  fn_hash := _document_hash IS NULL OR (m.document_hash IS NOT NULL AND lower(btrim(_document_hash)) = lower(m.document_hash));

  v_signals := jsonb_build_array(
    jsonb_build_object('label','Document number','passed',true),
    jsonb_build_object('label','Security number','passed',fn_sec),
    jsonb_build_object('label','Version','passed',fn_ver),
    jsonb_build_object('label','Source system','passed',true),
    jsonb_build_object('label','Origin record','passed',m.origin_ref IS NOT NULL),
    jsonb_build_object('label','Template lineage','passed',m.template_hash IS NOT NULL),
    jsonb_build_object('label','Data snapshot','passed',m.data_snapshot_hash IS NOT NULL),
    jsonb_build_object('label','Document hash','passed',fn_hash)
  );

  v_state := CASE
    WHEN NOT fn_sec THEN 'INVALID_SECURITY_ID'
    WHEN NOT fn_hash THEN 'HASH_MISMATCH'
    WHEN NOT fn_ver THEN 'INCOMPLETE_PROVENANCE'
    WHEN m.template_hash IS NULL OR m.data_snapshot_hash IS NULL THEN 'INCOMPLETE_PROVENANCE'
    WHEN m.status = 'revoked' THEN 'AUTHENTIC_REVOKED'
    WHEN m.status = 'void' THEN 'AUTHENTIC_VOID'
    WHEN m.status = 'archived' THEN 'AUTHENTIC_ARCHIVED'
    WHEN m.status = 'superseded' THEN 'AUTHENTIC_SUPERSEDED'
    WHEN m.status = 'expired'
      OR (m.expires_at IS NOT NULL AND m.expires_at < now()) THEN 'AUTHENTIC_EXPIRED'
    ELSE 'VERIFIED' END;

  PERFORM public.doc_log_security_event_internal(m.id, 'DOCUMENT_TAMPER_CHECKED',
    jsonb_build_object('state', v_state));
  IF v_state IN ('HASH_MISMATCH','INVALID_SECURITY_ID') THEN
    PERFORM public.doc_log_security_event_internal(m.id, 'DOCUMENT_INTEGRITY_FAILED',
      jsonb_build_object('state', v_state));
  END IF;

  RETURN jsonb_build_object(
    'state', v_state, 'signals', v_signals,
    'mark', jsonb_build_object(
      'id', m.id, 'doc_number', m.doc_number, 'security_number', m.security_number,
      'version', m.doc_version, 'source_system', m.source_system, 'origin_ref', m.origin_ref,
      'status', m.status, 'classification', m.classification, 'issued_at', m.issued_at,
      'document_hash', m.document_hash, 'template_hash', m.template_hash,
      'data_snapshot_hash', m.data_snapshot_hash, 'profile_code', m.profile_code));
END; $$;

-- ------------------------------------------------------- public verification
CREATE OR REPLACE FUNCTION public.doc_verify_public(
  _doc_number text, _token text, _client_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  m public.doc_security_marks; s public.doc_signatures; k public.doc_signing_keys;
  v_state text; v_withhold boolean; v_fail_recent int; v_global int;
  v_doc text := upper(btrim(coalesce(_doc_number,'')));
BEGIN
  -- Abuse control: the endpoint must not become an enumeration oracle.
  SELECT count(*) INTO v_fail_recent FROM public.doc_verification_attempts
   WHERE doc_number = v_doc AND outcome = 'UNKNOWN_DOCUMENT'
     AND created_at > now() - interval '10 minutes';
  SELECT count(*) INTO v_global FROM public.doc_verification_attempts
   WHERE outcome = 'UNKNOWN_DOCUMENT' AND created_at > now() - interval '1 minute';

  IF v_fail_recent >= 10 OR v_global >= 120 THEN
    INSERT INTO public.doc_verification_attempts(doc_number, outcome, client_ref)
    VALUES (v_doc, 'RATE_LIMITED', _client_ref);
    RETURN jsonb_build_object('state','RATE_LIMITED','valid',false);
  END IF;

  SELECT * INTO m FROM public.doc_security_marks
   WHERE upper(doc_number) = v_doc
     AND upper(verification_token) = upper(btrim(coalesce(_token,'')));

  IF m.id IS NULL THEN
    -- Identical response for a wrong number and a wrong token: no oracle.
    INSERT INTO public.doc_verification_attempts(doc_number, outcome, client_ref)
    VALUES (v_doc, 'UNKNOWN_DOCUMENT', _client_ref);
    RETURN jsonb_build_object('state','UNKNOWN_DOCUMENT','valid',false);
  END IF;

  SELECT * INTO s FROM public.doc_signatures WHERE mark_id = m.id ORDER BY signed_at DESC LIMIT 1;
  IF s.id IS NOT NULL THEN SELECT * INTO k FROM public.doc_signing_keys WHERE key_id = s.key_id; END IF;

  v_state := CASE m.status
      WHEN 'superseded' THEN 'AUTHENTIC_SUPERSEDED'
      WHEN 'revoked' THEN 'AUTHENTIC_REVOKED'
      WHEN 'void' THEN 'AUTHENTIC_VOID'
      WHEN 'expired' THEN 'AUTHENTIC_EXPIRED'
      WHEN 'archived' THEN 'AUTHENTIC_ARCHIVED'
      ELSE CASE WHEN m.expires_at IS NOT NULL AND m.expires_at < now()
                THEN 'AUTHENTIC_EXPIRED' ELSE 'AUTHENTIC' END
    END;

  -- Restricted documents confirm authenticity but never publish the signed
  -- statement (it carries the security number and internal origin reference).
  v_withhold := m.profile_code IN ('RESTRICTED','HIGHLY_RESTRICTED');

  INSERT INTO public.doc_verification_attempts(doc_number, outcome, mark_id, client_ref)
  VALUES (v_doc, v_state, m.id, _client_ref);
  PERFORM public.doc_log_security_event_internal(m.id, 'DOCUMENT_VERIFICATION_ATTEMPTED',
    jsonb_build_object('state', v_state, 'channel', 'public'));

  RETURN jsonb_build_object(
    'valid', m.status IN ('issued','valid') AND (m.expires_at IS NULL OR m.expires_at >= now()),
    'state', v_state,
    'mark_id', m.id,
    'doc_number', m.doc_number,
    'organisation', 'Yalla Mobility',
    'document_class', m.class_code,
    'domain', m.domain_code,
    'version', m.doc_version,
    'classification', m.classification,
    'issued_at', m.issued_at,
    'has_document_hash', m.document_hash IS NOT NULL,
    'document_hash', CASE WHEN v_withhold THEN NULL ELSE m.document_hash END,
    'superseded', m.superseded_by_mark_id IS NOT NULL,
    'revoked_at', m.revoked_at,
    'signed', s.id IS NOT NULL,
    'material_withheld', v_withhold AND s.id IS NOT NULL,
    'signature', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
        'algorithm', s.algorithm,
        'key_id', s.key_id,
        'signed_at', s.signed_at,
        'key_provider', k.provider,
        -- Retired keys must stay trusted so historical documents keep verifying.
        'key_trusted', k.trusted AND k.status IN ('active','retired'),
        'key_status', k.status,
        'signature_b64', CASE WHEN v_withhold THEN NULL ELSE s.signature_b64 END,
        'signed_statement', CASE WHEN v_withhold THEN NULL ELSE s.signed_statement END,
        'statement_hash', s.statement_hash,
        'public_key_pem', k.public_key_pem
      ) END
  );
END; $$;

DROP FUNCTION IF EXISTS public.doc_verify_public(text, text);

-- --------------------------------------------------------- evidence packages
CREATE OR REPLACE FUNCTION public.doc_evidence_package(_mark_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
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
      'key_provider', k.provider, 'key_status', k.status,
      'key_trusted', k.trusted AND k.status IN ('active','retired')) END,
    'audit', jsonb_build_object('events', v_events, 'chain', v_chain),
    'custody', jsonb_build_object('distributions', v_dist),
    'exported_at', now(),
    'exported_by', auth.uid()
  );

  PERFORM public.doc_log_security_event_internal(m.id, 'EVIDENCE_PACKAGE_EXPORTED',
    jsonb_build_object('events', jsonb_array_length(v_events), 'chain_verified', v_chain->'verified'));

  RETURN jsonb_build_object(
    'manifest', jsonb_build_object(
      'package_format', 'YALLA-EVIDENCE/1.0',
      'doc_number', m.doc_number,
      'body_sha256', encode(extensions.digest(v_body::text, 'sha256'), 'hex'),
      'signature_present', s.id IS NOT NULL,
      'audit_chain_verified', v_chain->'verified',
      'generated_at', now()),
    'body', v_body);
END; $$;

CREATE OR REPLACE FUNCTION public.doc_set_mark_status(
  _mark_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS public.doc_security_marks LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
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

  PERFORM public.doc_log_security_event_internal(_mark_id,
    CASE _status WHEN 'revoked' THEN 'DOCUMENT_REVOKED'
                 WHEN 'void' THEN 'DOCUMENT_VOIDED'
                 WHEN 'archived' THEN 'DOCUMENT_ARCHIVED'
                 ELSE 'DOCUMENT_STATUS_CHANGED' END,
    jsonb_build_object('status', _status, 'reason', _reason));
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.doc_register_signing_key(text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.doc_retire_signing_key(text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.doc_verify_public(text, text, text) TO anon, authenticated;