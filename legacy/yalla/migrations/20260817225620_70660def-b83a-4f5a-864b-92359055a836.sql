
-- =====================================================================
-- Document OS — Forensic Document Security, Authenticity & Traceability
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.doc_source_systems (
  code text PRIMARY KEY,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.doc_source_systems TO authenticated;
GRANT ALL ON public.doc_source_systems TO service_role;
ALTER TABLE public.doc_source_systems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "source systems readable by staff"
  ON public.doc_source_systems FOR SELECT TO authenticated USING (true);

INSERT INTO public.doc_source_systems(code, label) VALUES
  ('REC360','Recruitment 360'),
  ('STAFF360','Staff 360'),
  ('DOCOS','Document OS'),
  ('PERF360','Performance 360'),
  ('WORKFORCE','Workforce OS'),
  ('ORG360','Organisation 360'),
  ('CHARTER','Corporate Charter'),
  ('CORP360','Corporate 360')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.doc_security_profiles (
  code text PRIMARY KEY,
  label text NOT NULL,
  watermark_text text NOT NULL,
  watermark_placement text NOT NULL DEFAULT 'DIAGONAL',
  watermark_opacity numeric NOT NULL DEFAULT 0.12,
  seal_enabled boolean NOT NULL DEFAULT true,
  seal_opacity numeric NOT NULL DEFAULT 0.14,
  qr_enabled boolean NOT NULL DEFAULT false,
  recipient_binding boolean NOT NULL DEFAULT false,
  microtext_enabled boolean NOT NULL DEFAULT true,
  footer_opacity numeric NOT NULL DEFAULT 0.55,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.doc_security_profiles TO authenticated;
GRANT ALL ON public.doc_security_profiles TO service_role;
ALTER TABLE public.doc_security_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "security profiles readable by staff"
  ON public.doc_security_profiles FOR SELECT TO authenticated USING (true);

INSERT INTO public.doc_security_profiles
  (code,label,watermark_text,watermark_placement,watermark_opacity,seal_enabled,seal_opacity,qr_enabled,recipient_binding,microtext_enabled,footer_opacity)
VALUES
  ('PUBLIC','Profile A — Public','YALLA MOBILITY OFFICIAL DOCUMENT','FOOTER',0.06,false,0.10,false,false,false,0.60),
  ('INTERNAL','Profile B — Internal','YALLA MOBILITY CONTROLLED COPY','DIAGONAL',0.10,true,0.12,false,false,true,0.55),
  ('CONFIDENTIAL','Profile C — Confidential','YALLA MOBILITY CONFIDENTIAL','DIAGONAL',0.13,true,0.14,true,false,true,0.55),
  ('RESTRICTED','Profile D — Restricted','YALLA MOBILITY RESTRICTED','DIAGONAL',0.15,true,0.16,true,true,true,0.60),
  ('HIGHLY_RESTRICTED','Profile E — Highly restricted','YALLA MOBILITY HIGHLY RESTRICTED','REPEATING_GRID',0.18,true,0.18,true,true,true,0.65)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.doc_number_sequences (
  domain_code text NOT NULL,
  class_code text NOT NULL,
  year int NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_code, class_code, year)
);
GRANT ALL ON public.doc_number_sequences TO service_role;
ALTER TABLE public.doc_number_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.doc_next_number(_domain text, _class text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_year int := EXTRACT(YEAR FROM now())::int; v_seq bigint;
BEGIN
  INSERT INTO public.doc_number_sequences(domain_code, class_code, year, last_seq)
  VALUES (upper(_domain), upper(_class), v_year, 1)
  ON CONFLICT (domain_code, class_code, year)
  DO UPDATE SET last_seq = public.doc_number_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN format('YML-%s-%s-%s-%s', upper(_domain), upper(_class), v_year, lpad(v_seq::text, 6, '0'));
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_new_security_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_alpha text := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; i int; v_out text := '';
BEGIN
  FOR i IN 1..12 LOOP
    v_out := v_out || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
  END LOOP;
  RETURN format('YM-%s-%s-%s', substr(v_out,1,4), substr(v_out,5,4), substr(v_out,9,4));
END;
$$;

CREATE TABLE IF NOT EXISTS public.doc_security_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number text NOT NULL UNIQUE,
  security_number text NOT NULL UNIQUE,
  verification_token text NOT NULL UNIQUE,
  document_id uuid,
  domain_code text NOT NULL,
  class_code text NOT NULL,
  source_system text NOT NULL REFERENCES public.doc_source_systems(code),
  origin_ref text NOT NULL,
  doc_version int NOT NULL DEFAULT 1,
  template_code text,
  template_version text,
  template_hash text,
  data_snapshot_hash text,
  document_hash text,
  classification text NOT NULL DEFAULT 'INTERNAL',
  profile_code text NOT NULL REFERENCES public.doc_security_profiles(code),
  footer_line text NOT NULL,
  micro_code text NOT NULL,
  page_count int,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','valid','superseded','void','expired')),
  supersedes_mark_id uuid REFERENCES public.doc_security_marks(id),
  superseded_by_mark_id uuid REFERENCES public.doc_security_marks(id),
  expires_at timestamptz,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_security_marks_document_idx ON public.doc_security_marks(document_id);
CREATE INDEX IF NOT EXISTS doc_security_marks_origin_idx ON public.doc_security_marks(source_system, origin_ref);

GRANT SELECT ON public.doc_security_marks TO authenticated;
GRANT ALL ON public.doc_security_marks TO service_role;
ALTER TABLE public.doc_security_marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "security marks readable by governance roles"
  ON public.doc_security_marks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.doc_security_mark_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.doc_number <> OLD.doc_number
     OR NEW.security_number <> OLD.security_number
     OR NEW.verification_token <> OLD.verification_token
     OR NEW.source_system <> OLD.source_system
     OR NEW.origin_ref <> OLD.origin_ref
     OR NEW.doc_version <> OLD.doc_version
     OR NEW.footer_line <> OLD.footer_line
     OR NEW.micro_code <> OLD.micro_code
     OR COALESCE(NEW.template_hash,'') <> COALESCE(OLD.template_hash,'')
     OR COALESCE(NEW.data_snapshot_hash,'') <> COALESCE(OLD.data_snapshot_hash,'')
  THEN
    RAISE EXCEPTION 'forensic_identity_immutable';
  END IF;

  IF OLD.document_hash IS NOT NULL AND NEW.document_hash <> OLD.document_hash THEN
    RAISE EXCEPTION 'document_hash_immutable';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS doc_security_marks_immutable ON public.doc_security_marks;
CREATE TRIGGER doc_security_marks_immutable
  BEFORE UPDATE ON public.doc_security_marks
  FOR EACH ROW EXECUTE FUNCTION public.doc_security_mark_immutable();

CREATE TABLE IF NOT EXISTS public.doc_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_id uuid NOT NULL REFERENCES public.doc_security_marks(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid,
  actor_role text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_chain_hash text,
  chain_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_security_events_mark_idx ON public.doc_security_events(mark_id, created_at);
GRANT SELECT ON public.doc_security_events TO authenticated;
GRANT ALL ON public.doc_security_events TO service_role;
ALTER TABLE public.doc_security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "security events readable by governance roles"
  ON public.doc_security_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.doc_security_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'security_events_append_only'; END;
$$;
DROP TRIGGER IF EXISTS doc_security_events_no_mutate ON public.doc_security_events;
CREATE TRIGGER doc_security_events_no_mutate
  BEFORE UPDATE OR DELETE ON public.doc_security_events
  FOR EACH ROW EXECUTE FUNCTION public.doc_security_events_append_only();

CREATE OR REPLACE FUNCTION public.doc_log_security_event(
  _mark_id uuid, _event text, _detail jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev text; v_hash text; v_id uuid;
BEGIN
  SELECT chain_hash INTO v_prev FROM public.doc_security_events
   WHERE mark_id = _mark_id ORDER BY created_at DESC LIMIT 1;
  v_hash := encode(digest(coalesce(v_prev,'genesis') || '|' || _event || '|' || _detail::text || '|' || clock_timestamp()::text, 'sha256'), 'hex');
  INSERT INTO public.doc_security_events(mark_id, event_type, actor_id, detail, prev_chain_hash, chain_hash)
  VALUES (_mark_id, _event, auth.uid(), coalesce(_detail,'{}'::jsonb), v_prev, v_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE TABLE IF NOT EXISTS public.doc_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_id uuid NOT NULL REFERENCES public.doc_security_marks(id) ON DELETE RESTRICT,
  distribution_ref text NOT NULL UNIQUE,
  recipient_label text NOT NULL,
  recipient_role text,
  channel text NOT NULL DEFAULT 'download',
  file_hash text,
  purpose text,
  issued_to uuid,
  issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_distributions_mark_idx ON public.doc_distributions(mark_id);
GRANT SELECT ON public.doc_distributions TO authenticated;
GRANT ALL ON public.doc_distributions TO service_role;
ALTER TABLE public.doc_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "distributions readable by governance roles"
  ON public.doc_distributions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

-- ============================== governed routines =====================

CREATE OR REPLACE FUNCTION public.doc_issue_security_mark(
  _domain text,
  _class text,
  _source_system text,
  _origin_ref text,
  _classification text DEFAULT 'INTERNAL',
  _profile_code text DEFAULT 'INTERNAL',
  _document_id uuid DEFAULT NULL,
  _template_code text DEFAULT NULL,
  _template_version text DEFAULT NULL,
  _template_hash text DEFAULT NULL,
  _data_snapshot_hash text DEFAULT NULL,
  _supersedes_mark_id uuid DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL
) RETURNS public.doc_security_marks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_number text; v_sec text; v_token text; v_version int := 1;
  v_row public.doc_security_marks; v_attempt int := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _origin_ref IS NULL OR btrim(_origin_ref) = '' THEN
    RAISE EXCEPTION 'origin_ref_required';
  END IF;

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
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
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

CREATE OR REPLACE FUNCTION public.doc_set_mark_status(_mark_id uuid, _status text, _reason text DEFAULT NULL)
RETURNS public.doc_security_marks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.doc_security_marks;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _status NOT IN ('void','expired','valid') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.doc_security_marks SET status = _status WHERE id = _mark_id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'mark_not_found'; END IF;
  PERFORM public.doc_log_security_event(_mark_id, 'DOCUMENT_STATUS_CHANGED',
    jsonb_build_object('status', _status, 'reason', _reason));
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
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  v_ref := format('DIST-%s-%s', EXTRACT(YEAR FROM now())::int, upper(encode(gen_random_bytes(4),'hex')));
  INSERT INTO public.doc_distributions(mark_id, distribution_ref, recipient_label, recipient_role, channel, purpose, file_hash, issued_to)
  VALUES (_mark_id, v_ref, _recipient_label, _recipient_role, _channel, _purpose, _file_hash, auth.uid())
  RETURNING * INTO v_row;
  PERFORM public.doc_log_security_event(_mark_id, 'DOCUMENT_DOWNLOADED',
    jsonb_build_object('distribution_ref', v_ref, 'recipient', _recipient_label, 'channel', _channel));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_verify_public(_doc_number text, _token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.doc_security_marks;
BEGIN
  SELECT * INTO m FROM public.doc_security_marks
   WHERE upper(doc_number) = upper(btrim(_doc_number))
     AND upper(verification_token) = upper(btrim(_token));

  IF m.id IS NULL THEN
    RETURN jsonb_build_object('state','UNKNOWN_DOCUMENT','valid',false);
  END IF;

  RETURN jsonb_build_object(
    'valid', m.status IN ('issued','valid'),
    'state', CASE m.status
        WHEN 'superseded' THEN 'AUTHENTIC_SUPERSEDED'
        WHEN 'void' THEN 'AUTHENTIC_VOID'
        WHEN 'expired' THEN 'AUTHENTIC_EXPIRED'
        ELSE CASE WHEN m.expires_at IS NOT NULL AND m.expires_at < now()
                  THEN 'AUTHENTIC_EXPIRED' ELSE 'AUTHENTIC' END
      END,
    'doc_number', m.doc_number,
    'organisation', 'Yalla Mobility',
    'document_class', m.class_code,
    'domain', m.domain_code,
    'version', m.doc_version,
    'classification', m.classification,
    'issued_at', m.issued_at,
    'has_document_hash', m.document_hash IS NOT NULL,
    'superseded', m.superseded_by_mark_id IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_tamper_check(
  _doc_number text, _security_number text DEFAULT NULL,
  _version int DEFAULT NULL, _document_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    WHEN m.status = 'superseded' THEN 'AUTHENTIC_SUPERSEDED'
    WHEN m.status = 'void' THEN 'AUTHENTIC_VOID'
    WHEN m.status = 'expired' THEN 'AUTHENTIC_EXPIRED'
    ELSE 'VERIFIED' END;

  PERFORM public.doc_log_security_event(m.id, 'DOCUMENT_TAMPER_CHECKED',
    jsonb_build_object('state', v_state));
  IF v_state IN ('HASH_MISMATCH','INVALID_SECURITY_ID') THEN
    PERFORM public.doc_log_security_event(m.id, 'DOCUMENT_INTEGRITY_FAILED',
      jsonb_build_object('state', v_state));
  END IF;

  RETURN jsonb_build_object(
    'state', v_state,
    'signals', v_signals,
    'mark', jsonb_build_object(
      'id', m.id, 'doc_number', m.doc_number, 'security_number', m.security_number,
      'version', m.doc_version, 'source_system', m.source_system, 'origin_ref', m.origin_ref,
      'status', m.status, 'classification', m.classification, 'issued_at', m.issued_at,
      'document_hash', m.document_hash, 'template_hash', m.template_hash,
      'data_snapshot_hash', m.data_snapshot_hash, 'profile_code', m.profile_code)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.doc_security_metrics()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'documents_generated', (SELECT count(*) FROM public.doc_security_marks),
    'documents_valid', (SELECT count(*) FROM public.doc_security_marks WHERE status IN ('issued','valid')),
    'documents_superseded', (SELECT count(*) FROM public.doc_security_marks WHERE status = 'superseded'),
    'documents_void', (SELECT count(*) FROM public.doc_security_marks WHERE status = 'void'),
    'documents_expired', (SELECT count(*) FROM public.doc_security_marks WHERE status = 'expired'),
    'restricted_documents', (SELECT count(*) FROM public.doc_security_marks WHERE profile_code IN ('RESTRICTED','HIGHLY_RESTRICTED')),
    'sealed_documents', (SELECT count(*) FROM public.doc_security_marks WHERE document_hash IS NOT NULL),
    'integrity_failures', (SELECT count(*) FROM public.doc_security_events WHERE event_type = 'DOCUMENT_INTEGRITY_FAILED'),
    'tamper_checks', (SELECT count(*) FROM public.doc_security_events WHERE event_type = 'DOCUMENT_TAMPER_CHECKED'),
    'downloads', (SELECT count(*) FROM public.doc_distributions),
    'security_events', (SELECT count(*) FROM public.doc_security_events)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_next_number(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.doc_new_security_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_issue_security_mark(text,text,text,text,text,text,uuid,text,text,text,text,uuid,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_seal_document_hash(uuid,text,int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_set_mark_status(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_register_distribution(uuid,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_verify_public(text,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_tamper_check(text,text,int,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_security_metrics() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.doc_log_security_event(uuid,text,jsonb) TO authenticated, service_role;
