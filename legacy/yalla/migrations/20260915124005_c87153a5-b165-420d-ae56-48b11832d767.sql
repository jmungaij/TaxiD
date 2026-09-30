CREATE OR REPLACE FUNCTION public.corp_guarantee_upload(
  _corporate_id uuid,
  _guarantee_number text,
  _issuing_bank text,
  _legal_entity_name text,
  _guaranteed_amount_cents bigint,
  _issue_date date,
  _effective_date date,
  _expiry_date date,
  _document_storage_path text,
  _document_sha256 text DEFAULT NULL,
  _document_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF NOT (public.is_corporate_manager_or_admin(v_uid, _corporate_id)
          OR public.has_any_role(v_uid, ARRAY['finance_admin','admin','super_admin']::public.app_role[])) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _guaranteed_amount_cents IS NULL OR _guaranteed_amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF _document_storage_path IS NULL OR length(trim(_document_storage_path)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_required');
  END IF;
  IF _expiry_date IS NULL OR _expiry_date <= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expiry_must_be_in_the_future');
  END IF;
  IF _effective_date IS NULL OR _effective_date > _expiry_date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_validity_window');
  END IF;

  INSERT INTO public.corporate_bank_guarantees
    (corporate_id, guarantee_number, issuing_bank, beneficiary, legal_entity_name, guaranteed_amount_cents,
     currency, issue_date, effective_date, expiry_date, document_storage_path, document_sha256,
     document_reference, state, external_verification_required, created_by)
  VALUES (_corporate_id, trim(_guarantee_number), trim(_issuing_bank), 'Yalla Beena Limited',
          trim(_legal_entity_name), _guaranteed_amount_cents, 'KES', _issue_date, _effective_date, _expiry_date,
          _document_storage_path, _document_sha256, _document_reference, 'UPLOADED', true, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.corporate_bank_guarantee_events
    (guarantee_id, corporate_id, event_type, state_before, state_after, actor_id, reason, source)
  VALUES (v_id, _corporate_id, 'UPLOADED', NULL, 'UPLOADED', v_uid, 'Guarantee document lodged', 'console');

  RETURN jsonb_build_object('ok', true, 'guarantee_id', v_id, 'state', 'UPLOADED');
END $$;