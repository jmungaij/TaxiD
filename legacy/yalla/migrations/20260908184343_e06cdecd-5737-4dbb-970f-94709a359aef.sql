
CREATE TABLE public.customer_document_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_kind text NOT NULL CHECK (document_kind IN ('invoice','proforma','receipt')),
  document_id uuid NOT NULL,
  document_no text,
  confirmed_by_user_id uuid NOT NULL,
  confirmed_email text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_kind, document_id, confirmed_by_user_id)
);

GRANT SELECT ON public.customer_document_confirmations TO authenticated;
GRANT ALL ON public.customer_document_confirmations TO service_role;
ALTER TABLE public.customer_document_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers see their own confirmations" ON public.customer_document_confirmations
FOR SELECT TO authenticated
USING (confirmed_by_user_id = auth.uid()
       OR public.is_platform_admin()
       OR public.has_staff_permission('staff.commercial.read'));

CREATE OR REPLACE FUNCTION public._customer_confirmations_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'CONFIRMATION_IS_PERMANENT'; END $$;
REVOKE ALL ON FUNCTION public._customer_confirmations_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cdc_immutable BEFORE UPDATE OR DELETE ON public.customer_document_confirmations
FOR EACH ROW EXECUTE FUNCTION public._customer_confirmations_immutable();

-- Which billing documents belong to the signed-in person.
CREATE OR REPLACE FUNCTION public.customer_billing_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_leads uuid[]; v jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT coalesce(array_agg(DISTINCT l.id), '{}'::uuid[]) INTO v_leads
  FROM public.sales_leads l
  LEFT JOIN public.crm_accounts a ON a.id = l.account_id
  LEFT JOIN public.crm_contacts ct ON ct.account_id = a.id
  WHERE l.submitted_by_user_id = v_uid
     OR (v_email IS NOT NULL AND lower(coalesce(ct.email,'')) = v_email);

  SELECT jsonb_build_object(
    'generated_at', now(),
    'email', v_email,
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'document_no', i.invoice_no, 'currency', i.currency,
        'issue_date', i.issue_date, 'due_date', i.due_date,
        'service_from', i.service_from, 'service_to', i.service_to,
        'subtotal_cents', i.subtotal_cents, 'vat_cents', i.vat_cents,
        'total_cents', i.total_cents, 'paid_cents', i.paid_cents,
        'balance_cents', i.total_cents - i.paid_cents,
        'payment_terms', i.payment_terms,
        'lpo_reference', i.lpo_reference,
        'status', CASE i.status
          WHEN 'issued' THEN 'Issued' WHEN 'sent' THEN 'Sent to you'
          WHEN 'part_paid' THEN 'Part paid' WHEN 'paid' THEN 'Paid in full' ELSE 'Issued' END,
        'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'description', l.description, 'qty', l.qty,
                              'unit_rate_cents', l.unit_rate_cents, 'amount_cents', l.amount_cents)
                              ORDER BY l.line_no)
                            FROM public.tax_invoice_lines l WHERE l.invoice_id = i.id), '[]'::jsonb),
        'confirmed_at', (SELECT c.created_at FROM public.customer_document_confirmations c
                          WHERE c.document_kind = 'invoice' AND c.document_id = i.id
                            AND c.confirmed_by_user_id = v_uid)
      ) ORDER BY i.issue_date DESC NULLS LAST)
      FROM public.tax_invoices i
      WHERE i.status IN ('issued','sent','part_paid','paid')
        AND NOT COALESCE(i.is_test, false)
        AND ((v_email IS NOT NULL AND lower(coalesce(i.customer_email,'')) = v_email)
             OR i.lead_id = ANY(v_leads))
    ), '[]'::jsonb),
    'proformas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'document_no', p.proforma_no, 'currency', p.currency,
        'issue_date', p.issue_date, 'valid_until', p.valid_until,
        'total_cents', p.total_cents, 'vat_cents', p.vat_cents, 'subtotal_cents', p.subtotal_cents,
        'status', CASE p.status
          WHEN 'issued' THEN 'Issued' WHEN 'sent' THEN 'Sent to you'
          WHEN 'accepted' THEN 'Accepted' WHEN 'expired' THEN 'Expired' ELSE 'Issued' END,
        'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'description', l.description, 'qty', l.qty,
                              'unit_rate_cents', l.unit_rate_cents, 'amount_cents', l.amount_cents)
                              ORDER BY l.line_no)
                            FROM public.proforma_invoice_lines l WHERE l.proforma_id = p.id), '[]'::jsonb),
        'confirmed_at', (SELECT c.created_at FROM public.customer_document_confirmations c
                          WHERE c.document_kind = 'proforma' AND c.document_id = p.id
                            AND c.confirmed_by_user_id = v_uid)
      ) ORDER BY p.issue_date DESC NULLS LAST)
      FROM public.proforma_invoices p
      WHERE p.status IN ('issued','sent','accepted','expired')
        AND NOT COALESCE(p.is_test, false)
        AND ((v_email IS NOT NULL AND lower(coalesce(p.customer_email,'')) = v_email)
             OR p.lead_id = ANY(v_leads))
    ), '[]'::jsonb),
    'receipts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'document_no', r.receipt_no, 'amount_cents', r.amount_cents,
        'currency', r.currency, 'received_on', r.received_on, 'method', r.method,
        'invoice_no', i.invoice_no)
        ORDER BY r.received_on DESC)
      FROM public.payment_receipts r
      JOIN public.tax_invoices i ON i.id = r.invoice_id
      WHERE r.status <> 'void' AND NOT COALESCE(r.is_test, false)
        AND ((v_email IS NOT NULL AND lower(coalesce(i.customer_email,'')) = v_email)
             OR i.lead_id = ANY(v_leads))
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.customer_billing_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_billing_overview() TO authenticated, service_role;

-- Customer confirms they received a document.
CREATE OR REPLACE FUNCTION public.customer_document_confirm(_kind text, _id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_no text; v_ok boolean := false; v_row uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _kind NOT IN ('invoice','proforma','receipt') THEN RAISE EXCEPTION 'UNKNOWN_DOCUMENT_KIND'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  -- The document must be one the caller can already see in their own overview.
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
    INSERT INTO public.tax_invoice_events(invoice_id, event, note, actor_user_id)
    VALUES (_id, 'customer_confirmed_receipt', COALESCE(v_email,'customer') || ' confirmed receipt', v_uid);
  END IF;
  IF _kind = 'proforma' AND v_row IS NOT NULL THEN
    INSERT INTO public.proforma_invoice_events(proforma_id, event, note, actor_user_id)
    VALUES (_id, 'customer_confirmed_receipt', COALESCE(v_email,'customer') || ' confirmed receipt', v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'document_no', v_no, 'already_confirmed', v_row IS NULL);
END $$;

REVOKE ALL ON FUNCTION public.customer_document_confirm(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_document_confirm(text, uuid, text) TO authenticated, service_role;
