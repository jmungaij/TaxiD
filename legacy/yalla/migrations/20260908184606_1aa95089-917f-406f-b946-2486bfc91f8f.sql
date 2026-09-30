
CREATE OR REPLACE FUNCTION public.customer_document_confirm(_kind text, _id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_no text; v_ok boolean := false; v_row uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _kind NOT IN ('invoice','proforma','receipt') THEN RAISE EXCEPTION 'UNKNOWN_DOCUMENT_KIND'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  IF _kind = 'invoice' THEN
    SELECT invoice_no INTO v_no FROM public.tax_invoices i
     WHERE i.id = _id AND i.status IN ('issued','sent','part_paid','paid');
  ELSIF _kind = 'proforma' THEN
    SELECT proforma_no INTO v_no FROM public.proforma_invoices p
     WHERE p.id = _id AND p.status IN ('issued','sent','accepted','expired');
  ELSE
    SELECT receipt_no INTO v_no FROM public.payment_receipts r WHERE r.id = _id AND r.status <> 'void';
  END IF;
  IF v_no IS NULL THEN RAISE EXCEPTION 'DOCUMENT_NOT_AVAILABLE'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE _kind WHEN 'invoice' THEN (public.customer_billing_overview()->'invoices')
                 WHEN 'proforma' THEN (public.customer_billing_overview()->'proformas')
                 ELSE (public.customer_billing_overview()->'receipts') END) d
     WHERE (d->>'id')::uuid = _id
  ) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'DOCUMENT_NOT_AVAILABLE'; END IF;

  INSERT INTO public.customer_document_confirmations(
    document_kind, document_id, document_no, confirmed_by_user_id, confirmed_email, note)
  VALUES (_kind, _id, v_no, v_uid, v_email, NULLIF(btrim(COALESCE(_note,'')),''))
  ON CONFLICT (document_kind, document_id, confirmed_by_user_id) DO NOTHING
  RETURNING id INTO v_row;

  IF _kind = 'invoice' AND v_row IS NOT NULL THEN
    INSERT INTO public.tax_invoice_events(invoice_id, event, note, actor_id)
    VALUES (_id, 'customer_confirmed_receipt', COALESCE(v_email,'customer') || ' confirmed receipt', v_uid);
  END IF;
  IF _kind = 'proforma' AND v_row IS NOT NULL THEN
    INSERT INTO public.proforma_invoice_events(proforma_id, event, note, actor_id)
    VALUES (_id, 'customer_confirmed_receipt', COALESCE(v_email,'customer') || ' confirmed receipt', v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'document_no', v_no, 'already_confirmed', v_row IS NULL);
END $$;

REVOKE ALL ON FUNCTION public.customer_document_confirm(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_document_confirm(text, uuid, text) TO authenticated, service_role;
