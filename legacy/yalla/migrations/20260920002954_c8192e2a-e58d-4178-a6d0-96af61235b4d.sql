ALTER TABLE public.proforma_invoices
  ADD COLUMN IF NOT EXISTS booked_for text,
  ADD COLUMN IF NOT EXISTS booked_by text;

CREATE OR REPLACE FUNCTION public.proforma_save(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := NULLIF(p->>'id','')::uuid;
  v_staff uuid := public._my_staff_member_id();
  v_status text;
  v_owner uuid;
  v_sub bigint := 0;
  v_vat bigint := 0;
  v_total bigint := 0;
  v_rate numeric := COALESCE((p->>'vat_rate')::numeric, 16);
  v_incl boolean := COALESCE((p->>'vat_inclusive')::boolean, false);
  v_line jsonb;
  v_no integer := 0;
  v_amount bigint;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT status, owner_staff_id INTO v_status, v_owner
      FROM public.proforma_invoices WHERE id = v_id;
    IF v_status IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
    IF NOT public._proforma_can_write(v_owner) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_CAN_BE_EDITED'; END IF;
  ELSE
    IF NOT public._proforma_can_write(v_staff) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    INSERT INTO public.proforma_invoices (owner_staff_id, created_by)
      VALUES (v_staff, auth.uid())
      RETURNING id INTO v_id;
    INSERT INTO public.proforma_invoice_events (proforma_id, event, status_after, actor_id)
      VALUES (v_id, 'CREATED', 'draft', auth.uid());
  END IF;

  UPDATE public.proforma_invoices SET
    customer_company        = COALESCE(NULLIF(p->>'customer_company',''), customer_company),
    customer_address        = COALESCE(p->>'customer_address', customer_address),
    customer_pin            = COALESCE(p->>'customer_pin', customer_pin),
    customer_contact_person = COALESCE(p->>'customer_contact_person', customer_contact_person),
    customer_email          = COALESCE(p->>'customer_email', customer_email),
    customer_phone          = COALESCE(p->>'customer_phone', customer_phone),
    customer_ref            = COALESCE(p->>'customer_ref', customer_ref),
    booked_for              = COALESCE(p->>'booked_for', booked_for),
    booked_by               = COALESCE(p->>'booked_by', booked_by),
    quote_reference         = COALESCE(p->>'quote_reference', quote_reference),
    contract_reference      = COALESCE(p->>'contract_reference', contract_reference),
    service_from            = COALESCE(NULLIF(p->>'service_from','')::date, service_from),
    service_to              = COALESCE(NULLIF(p->>'service_to','')::date, service_to),
    payment_terms           = COALESCE(NULLIF(p->>'payment_terms',''), payment_terms),
    currency                = COALESCE(NULLIF(p->>'currency',''), currency),
    vat_rate                = v_rate,
    vat_inclusive           = v_incl,
    valid_until             = COALESCE(NULLIF(p->>'valid_until','')::date, valid_until),
    notes                   = COALESCE(p->>'notes', notes),
    authorised_name         = COALESCE(p->>'authorised_name', authorised_name),
    authorised_title        = COALESCE(p->>'authorised_title', authorised_title),
    account_id              = COALESCE(NULLIF(p->>'account_id','')::uuid, account_id),
    lead_id                 = COALESCE(NULLIF(p->>'lead_id','')::uuid, lead_id)
  WHERE id = v_id;

  IF p ? 'lines' THEN
    DELETE FROM public.proforma_invoice_lines WHERE proforma_id = v_id;
    FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines','[]'::jsonb))
    LOOP
      IF COALESCE(NULLIF(TRIM(v_line->>'description'),''), '') = '' THEN CONTINUE; END IF;
      v_no := v_no + 1;
      v_amount := ROUND(COALESCE((v_line->>'qty')::numeric,1)
                        * COALESCE((v_line->>'unit_rate_cents')::numeric,0))::bigint;
      INSERT INTO public.proforma_invoice_lines
        (proforma_id, line_no, description, service_date, vehicle_category, qty, unit_rate_cents, amount_cents)
      VALUES (v_id, v_no, TRIM(v_line->>'description'),
              NULLIF(v_line->>'service_date','')::date,
              NULLIF(v_line->>'vehicle_category',''),
              COALESCE((v_line->>'qty')::numeric,1),
              COALESCE((v_line->>'unit_rate_cents')::bigint,0),
              v_amount);
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(amount_cents),0) INTO v_total
    FROM public.proforma_invoice_lines WHERE proforma_id = v_id;

  IF v_incl THEN
    v_sub := ROUND(v_total / (1 + v_rate/100))::bigint;
    v_vat := v_total - v_sub;
  ELSE
    v_sub := v_total;
    v_vat := ROUND(v_total * v_rate/100)::bigint;
    v_total := v_sub + v_vat;
  END IF;

  UPDATE public.proforma_invoices
     SET subtotal_cents = v_sub, vat_cents = v_vat, total_cents = v_total
   WHERE id = v_id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_after, actor_id, detail)
    VALUES (v_id, 'SAVED', 'draft', auth.uid(),
            jsonb_build_object('subtotal_cents', v_sub, 'vat_cents', v_vat, 'total_cents', v_total));

  RETURN public.proforma_get(v_id);
END $function$;