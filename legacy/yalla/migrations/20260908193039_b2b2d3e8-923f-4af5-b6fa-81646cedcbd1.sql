CREATE OR REPLACE FUNCTION public.customer_billing_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_email text; v_leads uuid[]; v jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT coalesce(array_agg(DISTINCT lid), '{}'::uuid[]) INTO v_leads
  FROM (
    SELECT l.id AS lid
      FROM public.sales_leads l
      LEFT JOIN public.crm_accounts a ON a.id = l.account_id
      LEFT JOIN public.crm_contacts ct ON ct.account_id = a.id
     WHERE l.submitted_by_user_id = v_uid
        OR (v_email IS NOT NULL AND lower(coalesce(ct.email,'')) = v_email)
    UNION
    SELECT i.lead_id
      FROM public.tax_invoices i
     WHERE i.lead_id IS NOT NULL AND NOT COALESCE(i.is_test,false)
       AND v_email IS NOT NULL AND lower(coalesce(i.customer_email,'')) = v_email
    UNION
    SELECT p.lead_id
      FROM public.proforma_invoices p
     WHERE p.lead_id IS NOT NULL AND NOT COALESCE(p.is_test,false)
       AND v_email IS NOT NULL AND lower(coalesce(p.customer_email,'')) = v_email
  ) s
  WHERE lid IS NOT NULL;

  WITH mine AS (
    SELECT i.* FROM public.tax_invoices i
     WHERE i.status IN ('issued','sent','part_paid','paid')
       AND NOT COALESCE(i.is_test, false)
       AND ((v_email IS NOT NULL AND lower(coalesce(i.customer_email,'')) = v_email)
            OR i.lead_id = ANY(v_leads))
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'email', v_email,
    'summary', (
      SELECT jsonb_build_object(
        'invoice_count', count(*),
        'invoiced_cents', COALESCE(sum(total_cents),0),
        'paid_cents', COALESCE(sum(paid_cents),0),
        'outstanding_cents', COALESCE(sum(GREATEST(total_cents - paid_cents,0)),0),
        'overdue_count', count(*) FILTER (WHERE total_cents - paid_cents > 0 AND due_date IS NOT NULL AND due_date < current_date),
        'overdue_cents', COALESCE(sum(GREATEST(total_cents - paid_cents,0)) FILTER (WHERE due_date IS NOT NULL AND due_date < current_date),0),
        'due_soon_cents', COALESCE(sum(GREATEST(total_cents - paid_cents,0)) FILTER (WHERE due_date IS NOT NULL AND due_date >= current_date AND due_date <= current_date + 7),0),
        'next_due_date', min(due_date) FILTER (WHERE total_cents - paid_cents > 0),
        'receipts_count', (SELECT count(*) FROM public.payment_receipts r JOIN mine m2 ON m2.id = r.invoice_id
                            WHERE r.status <> 'void' AND NOT COALESCE(r.is_test,false)),
        'last_payment_on', (SELECT max(r.received_on) FROM public.payment_receipts r JOIN mine m3 ON m3.id = r.invoice_id
                             WHERE r.status <> 'void' AND NOT COALESCE(r.is_test,false))
      ) FROM mine
    ),
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
        'overdue', (i.total_cents - i.paid_cents > 0 AND i.due_date IS NOT NULL AND i.due_date < current_date),
        'status', CASE i.status
          WHEN 'issued' THEN 'Issued' WHEN 'sent' THEN 'Sent to you'
          WHEN 'part_paid' THEN 'Part paid' WHEN 'paid' THEN 'Paid in full' ELSE 'Issued' END,
        'next_step', (
          SELECT jsonb_build_object(
            'action_type', replace(ca.action_type,'_',' '),
            'due_on', ca.due_on,
            'promised_on', ca.promised_on,
            'promised_amount_cents', ca.promised_amount_cents)
            FROM public.invoice_collection_actions ca
           WHERE ca.invoice_id = i.id AND ca.status = 'open'
           ORDER BY ca.due_on NULLS LAST, ca.created_at
           LIMIT 1
        ),
        'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                              'description', l.description, 'qty', l.qty,
                              'unit_rate_cents', l.unit_rate_cents, 'amount_cents', l.amount_cents)
                              ORDER BY l.line_no)
                            FROM public.tax_invoice_lines l WHERE l.invoice_id = i.id), '[]'::jsonb),
        'confirmed_at', (SELECT c.created_at FROM public.customer_document_confirmations c
                          WHERE c.document_kind = 'invoice' AND c.document_id = i.id
                            AND c.confirmed_by_user_id = v_uid)
      ) ORDER BY i.issue_date DESC NULLS LAST)
      FROM mine i
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
    ), '[]'::jsonb),
    'agreements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id::text || ':' || e.document_type,
        'kind', CASE e.document_type
                  WHEN 'mobility_service_contract' THEN 'Service contract'
                  WHEN 'service_order' THEN 'Service order'
                  WHEN 'service_completion' THEN 'Service completion'
                  WHEN 'pod' THEN 'Proof of delivery'
                  WHEN 'quotation' THEN 'Quotation'
                  ELSE replace(e.document_type, '_', ' ') END,
        'reference', e.reference,
        'note', e.note,
        'recorded_at', e.recorded_at)
        ORDER BY e.recorded_at)
      FROM public.commercial_lifecycle_evidence e
      JOIN public.commercial_lifecycle l ON l.id = e.lifecycle_id
      WHERE NOT COALESCE(l.is_test, false)
        AND l.lead_id = ANY(v_leads)
        AND e.document_type IN ('mobility_service_contract','service_order','service_completion','pod','quotation')
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $function$;

REVOKE ALL ON FUNCTION public.customer_billing_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.customer_billing_overview() TO authenticated;