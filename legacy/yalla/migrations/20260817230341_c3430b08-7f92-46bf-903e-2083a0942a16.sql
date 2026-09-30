
-- Backend workers run without a user session; they are trusted callers.
CREATE OR REPLACE FUNCTION public.doc_forensics_authorized()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_user IN ('service_role','postgres','supabase_admin')
      OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]);
$$;
REVOKE ALL ON FUNCTION public.doc_forensics_authorized() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_forensics_authorized() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.doc_issue_security_mark(
  _domain text, _class text, _source_system text, _origin_ref text,
  _classification text DEFAULT 'INTERNAL', _profile_code text DEFAULT 'INTERNAL',
  _document_id uuid DEFAULT NULL, _template_code text DEFAULT NULL,
  _template_version text DEFAULT NULL, _template_hash text DEFAULT NULL,
  _data_snapshot_hash text DEFAULT NULL, _supersedes_mark_id uuid DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
) RETURNS public.doc_security_marks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  v_token := upper(encode(gen_random_bytes(9), 'hex'));

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

  PERFORM public.doc_log_security_event(v_row.id, 'DOCUMENT_FORENSIC_ID_ASSIGNED',
    jsonb_build_object('doc_number', v_number, 'profile', upper(_profile_code)));
  PERFORM public.doc_log_security_event(v_row.id, 'DOCUMENT_SECURITY_MARK_GENERATED',
    jsonb_build_object('security_number', v_sec));

  IF _supersedes_mark_id IS NOT NULL THEN
    UPDATE public.doc_security_marks
       SET status = 'superseded', superseded_by_mark_id = v_row.id
     WHERE id = _supersedes_mark_id;
    PERFORM public.doc_log_security_event(_supersedes_mark_id, 'DOCUMENT_SUPERSEDED',
      jsonb_build_object('superseded_by', v_number));
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_seal_document_hash(
  _mark_id uuid, _document_hash text, _page_count int DEFAULT NULL
) RETURNS public.doc_security_marks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.doc_security_marks;
BEGIN
  IF NOT public.doc_forensics_authorized() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.doc_security_marks
     SET document_hash = _document_hash,
         page_count = COALESCE(_page_count, page_count),
         status = CASE WHEN status = 'issued' THEN 'valid' ELSE status END
   WHERE id = _mark_id
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;
  PERFORM public.doc_log_security_event(_mark_id, 'DOCUMENT_HASH_GENERATED',
    jsonb_build_object('document_hash', _document_hash, 'pages', _page_count));
  PERFORM public.doc_log_security_event(_mark_id, 'DOCUMENT_RENDERED', '{}'::jsonb);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_register_distribution(
  _mark_id uuid, _recipient_label text, _recipient_role text DEFAULT NULL,
  _channel text DEFAULT 'download', _purpose text DEFAULT NULL, _file_hash text DEFAULT NULL
) RETURNS public.doc_distributions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref text; v_row public.doc_distributions;
BEGIN
  IF NOT public.doc_forensics_authorized() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_ref := format('DIST-%s-%s', EXTRACT(YEAR FROM now())::int, upper(encode(gen_random_bytes(4),'hex')));
  INSERT INTO public.doc_distributions(mark_id, distribution_ref, recipient_label, recipient_role, channel, purpose, file_hash, issued_to)
  VALUES (_mark_id, v_ref, _recipient_label, _recipient_role, _channel, _purpose, _file_hash, auth.uid())
  RETURNING * INTO v_row;
  PERFORM public.doc_log_security_event(_mark_id, 'DOCUMENT_DOWNLOADED',
    jsonb_build_object('distribution_ref', v_ref, 'recipient', _recipient_label, 'channel', _channel));
  RETURN v_row;
END;
$$;
