-- Only the signing service (service_role) or the document authority roles may
-- attach a signature. Without this, any signed-in user could record arbitrary
-- signature bytes even though they cannot mint a valid one.
CREATE OR REPLACE FUNCTION public.doc_record_signature(
  _mark_id uuid, _key_id text, _signature_b64 text,
  _signed_statement text, _statement_hash text, _algorithm text DEFAULT 'ed25519'
) RETURNS public.doc_signatures
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.doc_signatures; v_expected text; v_key public.doc_signing_keys; v_jwt_role text;
BEGIN
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  IF v_jwt_role <> 'service_role'
     AND NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

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

REVOKE ALL ON FUNCTION public.doc_record_signature(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.doc_signing_statement(uuid) FROM anon;