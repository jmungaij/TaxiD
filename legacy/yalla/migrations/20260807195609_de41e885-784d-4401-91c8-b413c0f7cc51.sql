CREATE OR REPLACE FUNCTION public.tax_report_overview(_from date DEFAULT (CURRENT_DATE - 30), _to date DEFAULT CURRENT_DATE)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r jsonb;
BEGIN
  IF NOT public.can_read_tax_reports(auth.uid()) THEN
    RAISE EXCEPTION 'tax_reports_forbidden: your account lacks a finance or admin role required to read tax reports';
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
        'pending', COUNT(*) FILTER (WHERE NOT abandoned AND attempt < max_attempts),
        'in_flight', COUNT(*) FILTER (WHERE NOT abandoned AND last_attempt_at IS NOT NULL AND (next_retry_at IS NULL OR next_retry_at > now())),
        'exhausted', COUNT(*) FILTER (WHERE abandoned OR attempt >= max_attempts),
        'due_now', COUNT(*) FILTER (WHERE NOT abandoned AND attempt < max_attempts AND next_retry_at <= now())
      ) FROM public.etims_retry_queue
    ),
    'webhooks_24h', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'verified', COUNT(*) FILTER (WHERE signature_verified = true),
        'rejected', COUNT(*) FILTER (WHERE signature_verified = false)
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
END $function$;

CREATE OR REPLACE FUNCTION public.tax_report_sync_health(_from date DEFAULT (CURRENT_DATE - 7), _to date DEFAULT CURRENT_DATE)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _r jsonb;
BEGIN
  IF NOT public.can_read_tax_reports(auth.uid()) THEN
    RAISE EXCEPTION 'tax_reports_forbidden: your account lacks a finance or admin role required to read tax sync health';
  END IF;
  SELECT jsonb_build_object(
    'events_by_type', (
      SELECT COALESCE(jsonb_object_agg(event_type, cnt),'{}'::jsonb)
      FROM (
        SELECT event_type::text AS event_type, COUNT(*) cnt
        FROM public.etims_sync_events
        WHERE created_at::date BETWEEN _from AND _to
        GROUP BY event_type
      ) t
    ),
    'retry_by_status', (
      SELECT COALESCE(jsonb_object_agg(status, cnt),'{}'::jsonb)
      FROM (
        SELECT CASE
                 WHEN abandoned OR attempt >= max_attempts THEN 'EXHAUSTED'
                 WHEN next_retry_at <= now() THEN 'DUE'
                 ELSE 'PENDING'
               END AS status,
               COUNT(*) cnt
        FROM public.etims_retry_queue
        GROUP BY 1
      ) t
    ),
    'last_success', (
      SELECT to_jsonb(s) FROM (
        SELECT id, invoice_id, event_type::text AS event_type, response_status, created_at
        FROM public.etims_sync_events
        WHERE event_type IN ('SUBMIT_SUCCESS','WEBHOOK_ACK')
        ORDER BY created_at DESC LIMIT 1
      ) s
    ),
    'last_error', (
      SELECT to_jsonb(s) FROM (
        SELECT id, invoice_id, event_type::text AS event_type, response_status, error_message, created_at
        FROM public.etims_sync_events
        WHERE event_type IN ('SUBMIT_FAILURE','WEBHOOK_REJECT')
        ORDER BY created_at DESC LIMIT 1
      ) s
    ),
    'next_retry_at', (
      SELECT MIN(next_retry_at) FROM public.etims_retry_queue
      WHERE NOT abandoned AND attempt < max_attempts
    ),
    'recent_failures', (
      SELECT COALESCE(jsonb_agg(row_to_json(f)),'[]'::jsonb) FROM (
        SELECT id, invoice_id, event_type::text AS event_type, response_status, error_message, created_at
        FROM public.etims_sync_events
        WHERE event_type IN ('SUBMIT_FAILURE','WEBHOOK_REJECT')
          AND created_at::date BETWEEN _from AND _to
        ORDER BY created_at DESC LIMIT 25
      ) f
    )
  ) INTO _r;
  RETURN _r;
END $function$;

CREATE OR REPLACE FUNCTION public.tax_report_invoices(_from date DEFAULT (CURRENT_DATE - 30), _to date DEFAULT CURRENT_DATE, _status text DEFAULT NULL::text, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, invoice_number text, status text, customer_name text, customer_kra_pin text, subtotal_cents bigint, tax_total_cents bigint, total_cents bigint, currency text, issued_at timestamp with time zone, kra_reference text, last_attempt_at timestamp with time zone, attempt_count integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_read_tax_reports(auth.uid()) THEN
    RAISE EXCEPTION 'tax_reports_forbidden: your account lacks a finance or admin role required to read tax reports';
  END IF;
  RETURN QUERY
  SELECT i.id, i.invoice_number, i.status::text, i.customer_name, i.customer_kra_pin,
         i.subtotal_cents, i.tax_total_cents, i.total_cents, i.currency,
         i.issued_at, i.kra_invoice_number AS kra_reference,
         rq.last_attempt_at,
         COALESCE(rq.attempt, i.retry_count, 0)::integer AS attempt_count
  FROM public.etims_invoices i
  LEFT JOIN public.etims_retry_queue rq ON rq.invoice_id = i.id
  WHERE i.issued_at::date BETWEEN _from AND _to
    AND (_status IS NULL OR i.status::text = _status)
  ORDER BY i.issued_at DESC
  LIMIT GREATEST(_limit,1) OFFSET GREATEST(_offset,0);
END $function$;