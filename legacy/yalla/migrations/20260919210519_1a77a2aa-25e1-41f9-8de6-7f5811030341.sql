CREATE OR REPLACE FUNCTION public.is_linked_commercial_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.employment_status IN ('active','onboarding')
    ) OR public.has_staff_permission('staff.crm.manage'),
  false);
$$;
REVOKE ALL ON FUNCTION public.is_linked_commercial_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_linked_commercial_staff() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_linked_commercial_staff() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_org_upsert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_staff uuid; v_account uuid; v_name text; v_lead uuid;
BEGIN
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  v_staff := public._my_staff_member_id();
  v_name := btrim(coalesce(p->>'name',''));
  IF length(v_name) < 2 THEN RAISE EXCEPTION 'ORGANISATION_NAME_REQUIRED'; END IF;

  v_account := nullif(p->>'account_id','')::uuid;
  IF v_account IS NULL THEN
    SELECT id INTO v_account FROM public.crm_accounts WHERE lower(name) = lower(v_name) LIMIT 1;
  END IF;

  IF v_account IS NULL THEN
    INSERT INTO public.crm_accounts(
      name, legal_name, registration_number, tax_identifier, industry, city,
      phone, website, notes, owner_staff_id, source, provenance, lifecycle_stage)
    VALUES (
      v_name,
      nullif(btrim(coalesce(p->>'legal_name','')),''),
      nullif(btrim(coalesce(p->>'registration_number','')),''),
      nullif(btrim(coalesce(p->>'tax_identifier','')),''),
      nullif(btrim(coalesce(p->>'industry','')),''),
      nullif(btrim(coalesce(p->>'city','')),''),
      nullif(btrim(coalesce(p->>'phone','')),''),
      nullif(btrim(coalesce(p->>'website','')),''),
      nullif(btrim(coalesce(p->>'notes','')),''),
      v_staff, 'staff_capture', 'declared', 'engaged')
    RETURNING id INTO v_account;
  ELSE
    UPDATE public.crm_accounts SET
      name = v_name,
      legal_name = coalesce(nullif(btrim(coalesce(p->>'legal_name','')),''), legal_name),
      registration_number = coalesce(nullif(btrim(coalesce(p->>'registration_number','')),''), registration_number),
      tax_identifier = coalesce(nullif(btrim(coalesce(p->>'tax_identifier','')),''), tax_identifier),
      industry = coalesce(nullif(btrim(coalesce(p->>'industry','')),''), industry),
      city = coalesce(nullif(btrim(coalesce(p->>'city','')),''), city),
      phone = coalesce(nullif(btrim(coalesce(p->>'phone','')),''), phone),
      website = coalesce(nullif(btrim(coalesce(p->>'website','')),''), website),
      notes = coalesce(nullif(btrim(coalesce(p->>'notes','')),''), notes),
      owner_staff_id = coalesce(nullif(p->>'owner_staff_id','')::uuid, owner_staff_id, v_staff),
      updated_at = now()
    WHERE id = v_account;
  END IF;

  v_lead := nullif(p->>'lead_id','')::uuid;
  IF v_lead IS NOT NULL THEN
    UPDATE public.sales_leads
       SET account_id = v_account, updated_at = now()
     WHERE id = v_lead
       AND (sales_staff_id = v_staff OR public.has_staff_permission('staff.crm.manage'));
    IF FOUND THEN
      INSERT INTO public.sales_lead_events(lead_id, action, note, actor_user_id, detail)
      VALUES (v_lead, 'ORGANISATION_ONBOARDED',
              'Organisation record linked: ' || v_name, auth.uid(),
              jsonb_build_object('account_id', v_account));
    END IF;
  END IF;

  RETURN jsonb_build_object('account_id', v_account);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_org_upsert(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_org_upsert(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_org_upsert(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_org_document_register(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_staff uuid; v_account uuid; v_doc uuid; v_ver uuid;
  v_type text; v_title text; v_seq int; v_shared boolean;
BEGIN
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  v_staff := public._my_staff_member_id();
  v_account := nullif(p->>'account_id','')::uuid;
  IF v_account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
  v_type := btrim(coalesce(p->>'doc_type',''));
  IF v_type NOT IN ('cr12','kra_pin','certificate_of_registration','tax_compliance',
                    'rate_card','proforma_invoice','service_contract','signed_contract','other') THEN
    RAISE EXCEPTION 'DOCUMENT_TYPE_NOT_RECOGNISED';
  END IF;
  IF nullif(btrim(coalesce(p->>'storage_path','')),'') IS NULL THEN
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;
  v_title := coalesce(nullif(btrim(coalesce(p->>'title','')),''), replace(initcap(v_type),'_',' '));
  v_shared := coalesce((p->>'shared_with_customer')::boolean, false);

  SELECT id INTO v_doc FROM public.crm_documents
   WHERE account_id = v_account AND doc_type = v_type AND doc_class = 'customer_instance'
   ORDER BY created_at LIMIT 1;

  IF v_doc IS NULL THEN
    INSERT INTO public.crm_documents(
      doc_class, doc_type, title, account_id, owner_staff_id,
      internal_state, external_state, confidentiality, tags, created_by)
    VALUES ('customer_instance', v_type, v_title, v_account, v_staff,
            'draft', CASE WHEN v_shared THEN 'shared' ELSE 'draft' END,
            'internal', ARRAY['organisation_onboarding'], auth.uid())
    RETURNING id INTO v_doc;
  END IF;

  SELECT coalesce(max(version_seq),0) + 1 INTO v_seq
    FROM public.crm_document_versions WHERE document_id = v_doc;

  INSERT INTO public.crm_document_versions(
    document_id, version_label, version_seq, storage_path, file_name,
    mime_type, byte_size, change_note, authored_by, authored_staff_id, approval_state)
  VALUES (v_doc, 'v' || v_seq || '.0', v_seq,
          p->>'storage_path', nullif(p->>'file_name',''), nullif(p->>'mime_type',''),
          nullif(p->>'byte_size','')::bigint, nullif(btrim(coalesce(p->>'change_note','')),''),
          auth.uid(), v_staff, 'pending')
  RETURNING id INTO v_ver;

  UPDATE public.crm_documents
     SET current_version_id = v_ver,
         title = v_title,
         external_state = CASE WHEN v_shared THEN 'shared' ELSE external_state END,
         updated_at = now()
   WHERE id = v_doc;

  RETURN jsonb_build_object('document_id', v_doc, 'version_id', v_ver, 'version_seq', v_seq);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_org_document_register(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_org_document_register(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_org_document_register(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_org_overview(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_account uuid; v_lead uuid; v_acc jsonb; v_docs jsonb;
BEGIN
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  v_account := nullif(p->>'account_id','')::uuid;
  v_lead := nullif(p->>'lead_id','')::uuid;
  IF v_account IS NULL AND v_lead IS NOT NULL THEN
    SELECT account_id INTO v_account FROM public.sales_leads WHERE id = v_lead;
  END IF;
  IF v_account IS NULL THEN RETURN jsonb_build_object('account', NULL, 'documents', '[]'::jsonb); END IF;

  SELECT to_jsonb(a) - 'created_by' INTO v_acc FROM public.crm_accounts a WHERE a.id = v_account;

  SELECT coalesce(jsonb_agg(d ORDER BY d->>'doc_type'), '[]'::jsonb) INTO v_docs FROM (
    SELECT jsonb_build_object(
      'document_id', doc.id,
      'doc_type', doc.doc_type,
      'title', doc.title,
      'internal_state', doc.internal_state,
      'external_state', doc.external_state,
      'updated_at', doc.updated_at,
      'version_label', v.version_label,
      'version_seq', v.version_seq,
      'storage_path', v.storage_path,
      'file_name', v.file_name,
      'uploaded_at', v.created_at,
      'uploaded_by', sm.full_name,
      'versions', (SELECT count(*) FROM public.crm_document_versions cv WHERE cv.document_id = doc.id)
    ) AS d
    FROM public.crm_documents doc
    LEFT JOIN public.crm_document_versions v ON v.id = doc.current_version_id
    LEFT JOIN public.staff_members sm ON sm.id = v.authored_staff_id
    WHERE doc.account_id = v_account
  ) t;

  RETURN jsonb_build_object('account', v_acc, 'documents', v_docs);
END;
$$;
REVOKE ALL ON FUNCTION public.sales_org_overview(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_org_overview(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_org_overview(jsonb) TO authenticated, service_role;

CREATE POLICY "Linked commercial staff upload organisation documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'crm-documents' AND public.is_linked_commercial_staff());

CREATE POLICY "Linked commercial staff read organisation documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'crm-documents' AND public.is_linked_commercial_staff());