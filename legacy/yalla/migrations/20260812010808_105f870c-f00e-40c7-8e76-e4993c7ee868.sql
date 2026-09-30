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
    INSERT INTO public.crm_interactions(
      account_id, contact_id, opportunity_id, interaction_type, direction,
      subject, summary, occurred_at, created_by)
    VALUES (d.account_id, _contact_id, d.opportunity_id, 'document_shared', 'outbound',
            d.title, COALESCE(_note, 'Document version '||v.version_label||' shared with customer'),
            now(), auth.uid());
  END IF;

  INSERT INTO public.ops_event_outbox(event_type, entity_type, entity_id, entity_ref, dedupe_key, payload)
  VALUES ('commercial.document.shared','crm_document', v.document_id, d.title,
          'crm_doc_share:'||s_id::text,
          jsonb_build_object('document_id',v.document_id,'version_id',_version_id,'share_id',s_id))
  ON CONFLICT DO NOTHING;

  RETURN s_id;
END;
$$;