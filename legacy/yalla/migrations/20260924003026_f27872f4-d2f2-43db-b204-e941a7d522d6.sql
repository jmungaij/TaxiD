ALTER TABLE public.proforma_invoices
  ADD COLUMN IF NOT EXISTS recipient_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_flag_reason text;

CREATE OR REPLACE FUNCTION public.proforma_verified_recipient(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.proforma_invoices; v_email text; v_source text;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  v_email := lower(trim(coalesce(r.customer_email,'')));
  IF v_email = '' THEN
    RETURN jsonb_build_object('verified', false, 'email', null, 'reason', 'NO_CUSTOMER_EMAIL');
  END IF;
  IF r.lead_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales_leads l WHERE l.id = r.lead_id AND lower(trim(l.contact_email)) = v_email) THEN
    v_source := 'lead';
  ELSIF r.account_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.crm_contacts c WHERE c.account_id = r.account_id AND lower(trim(c.email)) = v_email) THEN
    v_source := 'account_contact';
  END IF;
  IF v_source IS NULL THEN
    RETURN jsonb_build_object('verified', false, 'email', v_email, 'reason', 'EMAIL_NOT_ON_CUSTOMER_RECORD');
  END IF;
  RETURN jsonb_build_object('verified', true, 'email', v_email, 'source', v_source);
END $$;
REVOKE ALL ON FUNCTION public.proforma_verified_recipient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_verified_recipient(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.proforma_record_dispatch(_id uuid, _to text, _pdf_sha256 text, _provider_ref text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.proforma_invoices; v jsonb; v_flag boolean := false; v_reason text;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status NOT IN ('issued','sent') THEN RAISE EXCEPTION 'ISSUE_THE_PROFORMA_FIRST'; END IF;

  v := public.proforma_verified_recipient(_id);
  IF lower(trim(coalesce(_to,''))) <> lower(trim(coalesce(r.customer_email,''))) THEN
    v_flag := true; v_reason := 'SENT_TO_ADDRESS_OTHER_THAN_CUSTOMER_EMAIL';
  ELSIF NOT (v->>'verified')::boolean THEN
    v_flag := true; v_reason := v->>'reason';
  END IF;

  UPDATE public.proforma_invoices
     SET status = 'sent', sent_at = now(), sent_to = _to,
         pdf_sha256 = COALESCE(pdf_sha256, _pdf_sha256),
         recipient_flagged = recipient_flagged OR v_flag,
         recipient_flag_reason = CASE WHEN v_flag THEN v_reason ELSE recipient_flag_reason END
   WHERE id = _id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id, CASE WHEN v_flag THEN 'SENT_RECIPIENT_FLAGGED' ELSE 'SENT_TO_CUSTOMER' END, r.status, 'sent', auth.uid(),
            jsonb_build_object('recipient', _to, 'pdf_sha256', _pdf_sha256, 'provider_ref', _provider_ref,
                               'verification', v, 'flag_reason', v_reason));
  RETURN public.proforma_get(_id);
END $$;

UPDATE public.proforma_invoices
   SET recipient_flagged = true, recipient_flag_reason = 'SENT_TO_ADDRESS_OTHER_THAN_CUSTOMER_EMAIL'
 WHERE sent_to IS NOT NULL AND lower(trim(sent_to)) <> lower(trim(coalesce(customer_email,'')));