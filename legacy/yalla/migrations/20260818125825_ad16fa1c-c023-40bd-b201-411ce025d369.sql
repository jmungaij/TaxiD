-- ============================================================
-- Recruitment 360 — Document delivery tracking & audit spine
-- ============================================================

CREATE TABLE public.rec_doc_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.rec_comm_requests(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.rec_comm_documents(id) ON DELETE SET NULL,
  mark_id uuid,
  kind text NOT NULL,
  candidate_id uuid,
  application_id uuid,
  onboarding_case_id uuid,
  channel text NOT NULL DEFAULT 'email',
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  requires_signature boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','sent','delivered','read','signed','failed')),
  sent_by uuid,
  sent_at timestamptz,
  provider text,
  provider_message_id text,
  delivered_at timestamptz,
  first_read_at timestamptz,
  last_read_at timestamptz,
  read_count integer NOT NULL DEFAULT 0,
  signed_at timestamptz,
  signed_by_name text,
  signature_hash text,
  failed_at timestamptz,
  failure_reason text,
  open_token_hash text UNIQUE,
  sign_token_hash text UNIQUE,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rec_doc_deliveries_request ON public.rec_doc_deliveries(request_id);
CREATE INDEX idx_rec_doc_deliveries_state ON public.rec_doc_deliveries(state, created_at DESC);
CREATE INDEX idx_rec_doc_deliveries_msg ON public.rec_doc_deliveries(provider_message_id);

CREATE TABLE public.rec_doc_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.rec_doc_deliveries(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  event_type text NOT NULL,
  actor_id uuid,
  actor_label text NOT NULL DEFAULT 'system',
  client_fingerprint text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL,
  UNIQUE (delivery_id, seq)
);

CREATE INDEX idx_rec_doc_delivery_events_delivery ON public.rec_doc_delivery_events(delivery_id, seq);

GRANT SELECT ON public.rec_doc_deliveries TO authenticated;
GRANT ALL ON public.rec_doc_deliveries TO service_role;
GRANT SELECT ON public.rec_doc_delivery_events TO authenticated;
GRANT ALL ON public.rec_doc_delivery_events TO service_role;

ALTER TABLE public.rec_doc_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_doc_delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read deliveries" ON public.rec_doc_deliveries
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff read delivery events" ON public.rec_doc_delivery_events
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- Delivery events are forensic evidence: append-only, never edited or removed.
CREATE OR REPLACE FUNCTION public.rec_delivery_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_doc_delivery_events is append-only';
END;
$$;

CREATE TRIGGER rec_delivery_events_no_update
  BEFORE UPDATE OR DELETE ON public.rec_doc_delivery_events
  FOR EACH ROW EXECUTE FUNCTION public.rec_delivery_events_append_only();

-- ---------------------------------------------------------- helpers

-- Monotonic delivery ladder: a late provider event can never regress state.
CREATE OR REPLACE FUNCTION public.rec_delivery_rank(_state text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _state
    WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2
    WHEN 'read' THEN 3 WHEN 'signed' THEN 4 WHEN 'failed' THEN 5 ELSE -1 END;
$$;

-- Hash-chained append of one delivery event + mirrored recruitment audit event.
CREATE OR REPLACE FUNCTION public.rec_delivery_log_event(
  _delivery_id uuid,
  _event_type text,
  _actor_label text DEFAULT 'system',
  _detail jsonb DEFAULT '{}'::jsonb,
  _fingerprint text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seq integer;
  v_prev text;
  v_hash text;
  v_at timestamptz := now();
  v_id uuid := gen_random_uuid();
BEGIN
  SELECT COALESCE(MAX(seq), 0) + 1,
         COALESCE((SELECT hash FROM rec_doc_delivery_events
                   WHERE delivery_id = _delivery_id ORDER BY seq DESC LIMIT 1), 'genesis')
    INTO v_seq, v_prev
  FROM rec_doc_delivery_events WHERE delivery_id = _delivery_id;

  v_hash := encode(sha256(convert_to(
    concat_ws('|', v_prev, _delivery_id::text, v_seq::text, _event_type,
              _actor_label, COALESCE(_detail::text, '{}'), v_at::text), 'utf8')), 'hex');

  INSERT INTO rec_doc_delivery_events
    (id, delivery_id, seq, event_type, actor_id, actor_label, client_fingerprint, detail, occurred_at, prev_hash, hash)
  VALUES (v_id, _delivery_id, v_seq, _event_type, auth.uid(), _actor_label, _fingerprint,
          COALESCE(_detail, '{}'::jsonb), v_at, v_prev, v_hash);

  INSERT INTO rec_audit_events (action, object_type, object_id, new_state, context, source)
  VALUES ('delivery_' || _event_type, 'rec_doc_delivery', _delivery_id,
          jsonb_build_object('event', _event_type, 'seq', v_seq, 'hash', v_hash),
          COALESCE(_detail, '{}'::jsonb), 'recruitment_delivery');

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------- transitions

CREATE OR REPLACE FUNCTION public.rec_delivery_register(
  p_request_id uuid,
  p_kind text,
  p_recipient_email text,
  p_recipient_name text,
  p_channel text DEFAULT 'email',
  p_requires_signature boolean DEFAULT false,
  p_open_token_hash text DEFAULT NULL,
  p_sign_token_hash text DEFAULT NULL,
  p_ttl_hours integer DEFAULT 336,
  p_onboarding_case_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req record;
  v_doc record;
  v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT rec_comm_actor_ok() THEN
    RAISE EXCEPTION 'not_authorised_for_delivery_registration';
  END IF;

  SELECT * INTO v_req FROM rec_comm_requests WHERE id = p_request_id;
  IF v_req IS NULL THEN RAISE EXCEPTION 'letter_request_not_found'; END IF;

  SELECT * INTO v_doc FROM rec_comm_documents WHERE request_id = p_request_id
   ORDER BY issued_at DESC LIMIT 1;
  IF v_doc IS NULL THEN RAISE EXCEPTION 'document_not_sealed_yet'; END IF;

  -- One live delivery per letter: re-registration returns the existing row.
  SELECT id INTO v_id FROM rec_doc_deliveries
   WHERE request_id = p_request_id AND state <> 'failed' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO rec_doc_deliveries (
    request_id, document_id, kind, candidate_id, application_id, onboarding_case_id,
    channel, recipient_email, recipient_name, requires_signature,
    open_token_hash, sign_token_hash, token_expires_at, sent_by
  ) VALUES (
    p_request_id, v_doc.id, COALESCE(p_kind, v_req.comm_type), v_req.candidate_id,
    v_req.application_id, COALESCE(p_onboarding_case_id, v_req.onboarding_case_id),
    COALESCE(p_channel, 'email'),
    COALESCE(NULLIF(p_recipient_email, ''), v_req.recipient_email),
    COALESCE(NULLIF(p_recipient_name, ''), v_req.recipient_name),
    COALESCE(p_requires_signature, false),
    p_open_token_hash, p_sign_token_hash,
    now() + make_interval(hours => GREATEST(COALESCE(p_ttl_hours, 336), 1)),
    auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM rec_delivery_log_event(v_id, 'registered', 'recruitment_office',
    jsonb_build_object('document_ref', v_req.document_ref, 'kind', COALESCE(p_kind, v_req.comm_type),
                       'requires_signature', COALESCE(p_requires_signature, false)));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_delivery_mark_sent(
  p_delivery_id uuid, p_provider text, p_provider_message_id text, p_actor_label text DEFAULT 'recruitment_office'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM rec_doc_deliveries WHERE id = p_delivery_id;
  IF v_row IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;

  UPDATE rec_doc_deliveries
     SET state = CASE WHEN rec_delivery_rank(state) < 1 THEN 'sent' ELSE state END,
         sent_at = COALESCE(sent_at, now()),
         sent_by = COALESCE(sent_by, auth.uid()),
         provider = COALESCE(p_provider, provider),
         provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
         updated_at = now()
   WHERE id = p_delivery_id;

  PERFORM rec_delivery_log_event(p_delivery_id, 'sent', p_actor_label,
    jsonb_build_object('provider', p_provider, 'provider_message_id', p_provider_message_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_delivery_confirm_delivered(
  p_delivery_id uuid DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  SELECT * INTO v_row FROM rec_doc_deliveries
   WHERE (p_delivery_id IS NOT NULL AND id = p_delivery_id)
      OR (p_delivery_id IS NULL AND p_provider_message_id IS NOT NULL
          AND provider_message_id = p_provider_message_id)
   ORDER BY created_at DESC LIMIT 1;
  IF v_row IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;

  UPDATE rec_doc_deliveries
     SET state = CASE WHEN rec_delivery_rank(state) < 2 THEN 'delivered' ELSE state END,
         delivered_at = COALESCE(delivered_at, now()),
         updated_at = now()
   WHERE id = v_row.id;

  PERFORM rec_delivery_log_event(v_row.id, 'delivered', 'email_provider', COALESCE(p_detail, '{}'::jsonb));

  RETURN jsonb_build_object('delivery_id', v_row.id, 'state',
    (SELECT state FROM rec_doc_deliveries WHERE id = v_row.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_delivery_mark_failed(
  p_delivery_id uuid, p_reason text, p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE rec_doc_deliveries
     SET state = 'failed', failed_at = now(), failure_reason = left(COALESCE(p_reason, 'unknown'), 500),
         updated_at = now()
   WHERE id = p_delivery_id;
  PERFORM rec_delivery_log_event(p_delivery_id, 'failed', 'email_provider',
    COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object('reason', p_reason));
END;
$$;

-- Candidate-side touches. Only a single-use hashed token identifies the row —
-- no candidate id, email or document reference is ever accepted from the client.
CREATE OR REPLACE FUNCTION public.rec_delivery_touch_public(
  p_token_hash text,
  p_kind text,
  p_signer_name text DEFAULT NULL,
  p_fingerprint text DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
  v_sig text;
BEGIN
  IF p_kind NOT IN ('read','signed') THEN RAISE EXCEPTION 'invalid_touch_kind'; END IF;

  SELECT * INTO v_row FROM rec_doc_deliveries
   WHERE (p_kind = 'read'  AND open_token_hash = p_token_hash)
      OR (p_kind = 'signed' AND sign_token_hash = p_token_hash)
   LIMIT 1;
  IF v_row IS NULL THEN RAISE EXCEPTION 'token_not_found'; END IF;
  IF v_row.token_expires_at IS NOT NULL AND v_row.token_expires_at < now() THEN
    RAISE EXCEPTION 'token_expired';
  END IF;

  IF p_kind = 'read' THEN
    -- A read implies delivery, so the ladder is closed up to 'read'.
    UPDATE rec_doc_deliveries
       SET state = CASE WHEN rec_delivery_rank(state) < 3 THEN 'read' ELSE state END,
           delivered_at = COALESCE(delivered_at, now()),
           first_read_at = COALESCE(first_read_at, now()),
           last_read_at = now(),
           read_count = read_count + 1,
           updated_at = now()
     WHERE id = v_row.id;
    PERFORM rec_delivery_log_event(v_row.id, 'read', 'candidate',
      COALESCE(p_detail, '{}'::jsonb), p_fingerprint);
  ELSE
    IF NOT v_row.requires_signature THEN RAISE EXCEPTION 'signature_not_required'; END IF;
    IF v_row.signed_at IS NOT NULL THEN
      RETURN jsonb_build_object('delivery_id', v_row.id, 'state', v_row.state, 'already_signed', true);
    END IF;
    IF COALESCE(btrim(p_signer_name), '') = '' THEN RAISE EXCEPTION 'signer_name_required'; END IF;

    v_sig := encode(sha256(convert_to(
      concat_ws('|', v_row.id::text, btrim(p_signer_name), now()::text, p_token_hash), 'utf8')), 'hex');

    UPDATE rec_doc_deliveries
       SET state = 'signed',
           delivered_at = COALESCE(delivered_at, now()),
           first_read_at = COALESCE(first_read_at, now()),
           signed_at = now(),
           signed_by_name = btrim(p_signer_name),
           signature_hash = v_sig,
           updated_at = now()
     WHERE id = v_row.id;
    PERFORM rec_delivery_log_event(v_row.id, 'signed', 'candidate',
      COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object('signer_name', btrim(p_signer_name), 'signature_hash', v_sig),
      p_fingerprint);
  END IF;

  RETURN jsonb_build_object(
    'delivery_id', v_row.id,
    'state', (SELECT state FROM rec_doc_deliveries WHERE id = v_row.id),
    'kind', v_row.kind);
END;
$$;

-- Verifies the hash chain of one delivery trail.
CREATE OR REPLACE FUNCTION public.rec_delivery_chain_verify(_delivery_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_prev text := 'genesis'; v_ok boolean := true; v_count integer := 0; v_calc text;
BEGIN
  FOR r IN SELECT * FROM rec_doc_delivery_events WHERE delivery_id = _delivery_id ORDER BY seq LOOP
    v_calc := encode(sha256(convert_to(
      concat_ws('|', v_prev, r.delivery_id::text, r.seq::text, r.event_type,
                r.actor_label, COALESCE(r.detail::text, '{}'), r.occurred_at::text), 'utf8')), 'hex');
    IF v_calc <> r.hash OR r.prev_hash <> v_prev THEN v_ok := false; END IF;
    v_prev := r.hash; v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('delivery_id', _delivery_id, 'events', v_count, 'chain_intact', v_ok);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_delivery_log_event(uuid, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_delivery_touch_public(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_delivery_register(uuid, text, text, text, text, boolean, text, text, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_mark_sent(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_confirm_delivered(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_mark_failed(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_touch_public(text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_log_event(uuid, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_chain_verify(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rec_delivery_rank(text) TO authenticated, service_role;