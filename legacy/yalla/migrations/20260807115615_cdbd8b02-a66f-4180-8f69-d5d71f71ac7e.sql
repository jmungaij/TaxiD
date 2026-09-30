CREATE OR REPLACE FUNCTION public.can_read_tax_reports(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role = ANY (ARRAY[
         'admin','super_admin','finance_admin','compliance_admin',
         'operations_admin','corporate_admin','corporate_manager'
       ]::app_role[])
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_read_tax_reports(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_tax_reports(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tax_report_overview(_from date DEFAULT (CURRENT_DATE - 30), _to date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
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

CREATE OR REPLACE FUNCTION public.tax_report_sync_health(_from date DEFAULT (CURRENT_DATE - 7), _to date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.can_read_tax_reports(auth.uid()) THEN
    RAISE EXCEPTION 'tax_reports_forbidden: your account lacks a finance or admin role required to read tax sync health';
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
    'last_success', (
      SELECT to_jsonb(s) FROM (
        SELECT id, invoice_id, event_type::text AS event_type, response_status, created_at
        FROM public.etims_sync_events
        WHERE event_type IN ('SUBMIT_SUCCEEDED','WEBHOOK_RECEIVED')
        ORDER BY created_at DESC LIMIT 1
      ) s
    ),
    'last_error', (
      SELECT to_jsonb(s) FROM (
        SELECT id, invoice_id, event_type::text AS event_type, response_status, error_message, created_at
        FROM public.etims_sync_events
        WHERE event_type IN ('SUBMIT_FAILED','WEBHOOK_FAILED','VALIDATION_FAILED')
        ORDER BY created_at DESC LIMIT 1
      ) s
    ),
    'next_retry_at', (
      SELECT MIN(next_attempt_at) FROM public.etims_retry_queue WHERE status = 'PENDING'
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

DO $do$
DECLARE _src text; _new text;
BEGIN
  FOR _src IN
    SELECT p.oid::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('tax_report_invoices','tax_report_vat_summary','tax_report_corporate_billing')
  LOOP
    SELECT replace(
      pg_get_functiondef(_src::oid),
      'public.has_any_role(auth.uid(), ARRAY[''admin'',''finance_admin'',''super_admin'']::app_role[])',
      'public.can_read_tax_reports(auth.uid())'
    ) INTO _new;
    _new := replace(_new, '''Forbidden''', '''tax_reports_forbidden: your account lacks a finance or admin role required to read tax reports''');
    EXECUTE _new;
  END LOOP;
END
$do$;

GRANT EXECUTE ON FUNCTION public.tax_report_overview(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_invoices(date,date,text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_sync_health(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_vat_summary(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_corporate_billing(date,date) TO authenticated;