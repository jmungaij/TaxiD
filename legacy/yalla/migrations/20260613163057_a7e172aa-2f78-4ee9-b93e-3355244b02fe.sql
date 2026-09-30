-- T6: Read-only reporting functions for Tax Command Center
-- All SECURITY DEFINER, gated to admin/finance roles

CREATE OR REPLACE FUNCTION public.tax_report_overview(_from date DEFAULT (CURRENT_DATE - 30), _to date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT jsonb_build_object(
    'period_start', _from,
    'period_end', _to,
    'invoices', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'pending', COUNT(*) FILTER (WHERE status='PENDING'),
        'syncing', COUNT(*) FILTER (WHERE status='SYNCING'),
        'retrying', COUNT(*) FILTER (WHERE status='RETRYING'),
        'synced', COUNT(*) FILTER (WHERE status='SYNCED'),
        'failed', COUNT(*) FILTER (WHERE status='FAILED'),
        'voided', COUNT(*) FILTER (WHERE status='VOIDED'),
        'gross_cents', COALESCE(SUM(total_cents),0),
        'tax_cents', COALESCE(SUM(tax_total_cents),0),
        'net_cents', COALESCE(SUM(subtotal_cents),0)
      ) FROM public.etims_invoices
      WHERE issued_at::date BETWEEN _from AND _to
    ),
    'retry_queue', (
      SELECT jsonb_build_object(
        'pending', COUNT(*) FILTER (WHERE status='PENDING'),
        'in_flight', COUNT(*) FILTER (WHERE status='IN_FLIGHT'),
        'exhausted', COUNT(*) FILTER (WHERE status='EXHAUSTED'),
        'due_now', COUNT(*) FILTER (WHERE status='PENDING' AND next_attempt_at <= now())
      ) FROM public.etims_retry_queue
    ),
    'webhooks_24h', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'verified', COUNT(*) FILTER (WHERE signature_valid = true),
        'rejected', COUNT(*) FILTER (WHERE signature_valid = false)
      ) FROM public.etims_webhooks
      WHERE received_at > now() - interval '24 hours'
    ),
    'corporate', (
      SELECT jsonb_build_object(
        'invoices', COUNT(*),
        'gross_cents', COALESCE(SUM(total_cents),0),
        'outstanding_cents', COALESCE(SUM(balance_cents),0)
      ) FROM public.corporate_invoices
      WHERE issued_at::date BETWEEN _from AND _to
    )
  ) INTO _r;
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.tax_report_invoices(
  _from date DEFAULT (CURRENT_DATE - 30),
  _to date DEFAULT CURRENT_DATE,
  _status text DEFAULT NULL,
  _limit int DEFAULT 100,
  _offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid, invoice_number text, status text, customer_name text, customer_kra_pin text,
  subtotal_cents bigint, tax_total_cents bigint, total_cents bigint, currency text,
  issued_at timestamptz, kra_reference text, last_attempt_at timestamptz, attempt_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT i.id, i.invoice_number, i.status::text, i.customer_name, i.customer_kra_pin,
         i.subtotal_cents, i.tax_total_cents, i.total_cents, i.currency,
         i.issued_at, i.kra_reference, i.last_attempt_at, i.attempt_count
  FROM public.etims_invoices i
  WHERE i.issued_at::date BETWEEN _from AND _to
    AND (_status IS NULL OR i.status::text = _status)
  ORDER BY i.issued_at DESC
  LIMIT GREATEST(_limit,1) OFFSET GREATEST(_offset,0);
END $$;

CREATE OR REPLACE FUNCTION public.tax_report_sync_health(_from date DEFAULT (CURRENT_DATE - 7), _to date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'events_by_type', (
      SELECT COALESCE(jsonb_object_agg(event_type, cnt),'{}'::jsonb)
      FROM (
        SELECT event_type::text, COUNT(*) cnt
        FROM public.etims_sync_events
        WHERE created_at::date BETWEEN _from AND _to
        GROUP BY event_type
      ) t
    ),
    'retry_by_status', (
      SELECT COALESCE(jsonb_object_agg(status, cnt),'{}'::jsonb)
      FROM (
        SELECT status::text, COUNT(*) cnt FROM public.etims_retry_queue GROUP BY status
      ) t
    ),
    'recent_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(f)),'[]'::jsonb) FROM (
        SELECT id, invoice_id, event_type, response_status, error_message, created_at
        FROM public.etims_sync_events
        WHERE event_type IN ('SUBMIT_FAILED','WEBHOOK_FAILED','VALIDATION_FAILED')
          AND created_at::date BETWEEN _from AND _to
        ORDER BY created_at DESC LIMIT 25
      ) f
    )
  ) INTO _r;
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.tax_report_vat_summary(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'period_start', _from,
    'period_end', _to,
    'by_scheme', (
      SELECT COALESCE(jsonb_agg(row_to_json(s)),'[]'::jsonb) FROM (
        SELECT ii.tax_scheme_code,
               COUNT(*) line_count,
               SUM(ii.taxable_cents) taxable_cents,
               SUM(ii.tax_cents) tax_cents,
               SUM(ii.total_cents) total_cents
        FROM public.etims_invoice_items ii
        JOIN public.etims_invoices i ON i.id = ii.invoice_id
        WHERE i.issued_at::date BETWEEN _from AND _to
          AND i.status NOT IN ('VOIDED')
        GROUP BY ii.tax_scheme_code
        ORDER BY ii.tax_scheme_code
      ) s
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.day),'[]'::jsonb) FROM (
        SELECT i.issued_at::date AS day,
               COUNT(*) invoice_count,
               SUM(i.subtotal_cents) net_cents,
               SUM(i.tax_total_cents) tax_cents,
               SUM(i.total_cents) gross_cents
        FROM public.etims_invoices i
        WHERE i.issued_at::date BETWEEN _from AND _to
          AND i.status NOT IN ('VOIDED')
        GROUP BY i.issued_at::date
        ORDER BY i.issued_at::date
      ) d
    )
  ) INTO _r;
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.tax_report_corporate_billing(_from date DEFAULT (CURRENT_DATE - 90), _to date DEFAULT CURRENT_DATE)
RETURNS TABLE(
  invoice_id uuid, corporate_id uuid, legal_name text, invoice_number text, status text,
  subtotal_cents bigint, tax_total_cents bigint, total_cents bigint, balance_cents bigint,
  currency text, issued_at timestamptz, due_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT ci.id, ci.corporate_id, ca.legal_name, ci.invoice_number, ci.status::text,
         ci.subtotal_cents, ci.tax_total_cents, ci.total_cents, ci.balance_cents,
         ci.currency, ci.issued_at, ci.due_at
  FROM public.corporate_invoices ci
  JOIN public.corporate_accounts ca ON ca.id = ci.corporate_id
  WHERE ci.issued_at::date BETWEEN _from AND _to
  ORDER BY ci.issued_at DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.tax_report_overview(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_invoices(date,date,text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_sync_health(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_vat_summary(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_corporate_billing(date,date) TO authenticated;