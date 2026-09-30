CREATE OR REPLACE FUNCTION public.contract_portal_submit(_token text, _accepted_by text, _accepted_title text, _signed_on date, _storage_path text DEFAULT NULL::text, _file_name text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv public.contract_portal_invites; c public.commercial_contract_instances;
        v_prefix text; v_version integer; v_signed date; v_staff uuid; v_work uuid;
BEGIN
  IF coalesce(length(trim(coalesce(_token, ''))), 0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  END IF;
  SELECT * INTO inv FROM public.contract_portal_invites
   WHERE token_hash = encode(sha256(convert_to(trim(_token), 'utf8')), 'hex') FOR UPDATE;
  IF inv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF inv.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;
  IF inv.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_SUBMITTED'); END IF;

  IF coalesce(length(trim(coalesce(_accepted_by, ''))), 0) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNATORY_NAME_REQUIRED');
  END IF;
  IF _storage_path IS NULL OR trim(_storage_path) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNED_COPY_REQUIRED');
  END IF;

  v_prefix := 'portal-inbox/' || inv.id::text || '/';
  IF position(v_prefix in _storage_path) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UPLOAD_PATH_REJECTED');
  END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = inv.contract_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF c.activated_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_ALREADY_ACTIVE'); END IF;

  v_signed := least(coalesce(_signed_on, current_date), current_date);

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.contract_documents WHERE contract_id = c.id AND document_type = 'executed';

  INSERT INTO public.contract_documents
    (contract_id, document_type, version, storage_bucket, storage_path, file_name, status, source, notes)
  VALUES (c.id, 'executed', v_version, 'crm-portal-inbox', trim(_storage_path),
          NULLIF(trim(coalesce(_file_name, '')), ''), 'received', 'client_portal',
          'Uploaded by ' || trim(_accepted_by) || coalesce(' — ' || NULLIF(trim(coalesce(_notes, '')), ''), ''));

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.contract_documents WHERE contract_id = c.id AND document_type = 'acceptance_evidence';

  INSERT INTO public.contract_documents
    (contract_id, document_type, version, external_reference, status, source, notes)
  VALUES (c.id, 'acceptance_evidence', v_version, 'PORTAL/' || inv.id::text, 'received', 'client_portal',
          'Accepted in the client portal by ' || trim(_accepted_by)
            || coalesce(', ' || NULLIF(trim(coalesce(_accepted_title, '')), ''), '')
            || coalesce(' <' || inv.recipient_email || '>', ''));

  UPDATE public.commercial_contract_instances
     SET status = 'executed',
         customer_signatory = coalesce(customer_signatory, trim(_accepted_by)),
         customer_signatory_email = coalesce(customer_signatory_email, inv.recipient_email),
         signature_method = coalesce(signature_method, 'client_portal'),
         signature_date = coalesce(signature_date, v_signed),
         execution_date = coalesce(execution_date, v_signed),
         revenue_period = coalesce(revenue_period, to_char(v_signed, 'YYYY-MM')),
         updated_at = now()
   WHERE id = c.id;

  UPDATE public.contract_portal_invites SET completed_at = now() WHERE id = inv.id;

  INSERT INTO public.contract_events (contract_id, event_type, from_status, to_status, reason, source, after_state)
  VALUES (c.id, 'CLIENT_PORTAL_ACCEPTANCE', c.status, 'executed',
          'Signed copy uploaded and acceptance confirmed by ' || trim(_accepted_by), 'portal',
          jsonb_build_object('invite_id', inv.id, 'storage_bucket', 'crm-portal-inbox',
                             'storage_path', trim(_storage_path), 'signed_on', v_signed));

  v_staff := c.owner_staff_id;
  IF v_staff IS NOT NULL THEN
    v_work := public._sales_work_ensure(
      v_staff, 'contract_onboarding',
      'Onboard ' || coalesce(c.customer_legal_name, 'customer') || ' — signed copy received',
      'The client uploaded the signed copy of ' || coalesce(c.contract_number, 'the contract')
        || ' and confirmed acceptance in the portal. Complete onboarding to activate the contract and record revenue.',
      'commercial_contract_instances', c.id, c.contract_number, 'high', 1440);
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'executed', 'contract_number', c.contract_number,
                            'work_item_id', v_work);
END $function$;