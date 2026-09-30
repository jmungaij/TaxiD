-- 1) Alert sink for schema/contract failures in production
CREATE TABLE public.report_schema_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id text NOT NULL,
  report text NOT NULL,
  error_kind text NOT NULL,
  error_code text,
  message text NOT NULL,
  missing jsonb NOT NULL DEFAULT '{}'::jsonb,
  route text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.report_schema_alerts TO authenticated;
GRANT ALL ON public.report_schema_alerts TO service_role;

ALTER TABLE public.report_schema_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can record report schema alerts"
  ON public.report_schema_alerts FOR INSERT TO authenticated
  WITH CHECK (actor_id IS NULL OR actor_id = auth.uid());

CREATE POLICY "Tax report readers can view report schema alerts"
  ON public.report_schema_alerts FOR SELECT TO authenticated
  USING (public.can_read_tax_reports(auth.uid()));

CREATE INDEX report_schema_alerts_created_idx
  ON public.report_schema_alerts (created_at DESC);
CREATE INDEX report_schema_alerts_report_idx
  ON public.report_schema_alerts (report, created_at DESC);

-- 2) Schema contract self-check used as a preflight by the Tax Command Center
CREATE OR REPLACE FUNCTION public.tax_report_schema_check()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  required_functions text[] := ARRAY[
    'tax_report_overview',
    'tax_report_invoices',
    'tax_report_vat_summary',
    'tax_report_sync_health',
    'tax_report_corporate_billing',
    'tax_record_report_sync_run'
  ];
  required_columns text[][] := ARRAY[
    ARRAY['etims_invoices','status'],
    ARRAY['etims_invoices','kra_invoice_number'],
    ARRAY['etims_invoices','tax_total_cents'],
    ARRAY['etims_invoices','total_cents'],
    ARRAY['etims_invoices','issued_at'],
    ARRAY['etims_invoices','last_error'],
    ARRAY['etims_retry_queue','abandoned'],
    ARRAY['etims_retry_queue','attempt'],
    ARRAY['etims_retry_queue','next_retry_at'],
    ARRAY['etims_webhooks','signature_verified'],
    ARRAY['tax_report_sync_runs','request_id'],
    ARRAY['report_schema_alerts','request_id']
  ];
  missing_functions text[] := ARRAY[]::text[];
  missing_columns text[] := ARRAY[]::text[];
  fn text;
  i int;
BEGIN
  IF NOT public.can_read_tax_reports(auth.uid()) THEN
    RAISE EXCEPTION 'tax_reports_forbidden';
  END IF;

  FOREACH fn IN ARRAY required_functions LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    ) THEN
      missing_functions := missing_functions || fn;
    END IF;
  END LOOP;

  FOR i IN 1 .. array_length(required_columns, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = required_columns[i][1]
        AND c.column_name = required_columns[i][2]
    ) THEN
      missing_columns := missing_columns
        || (required_columns[i][1] || '.' || required_columns[i][2]);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', (array_length(missing_functions, 1) IS NULL AND array_length(missing_columns, 1) IS NULL),
    'contract_version', 1,
    'checked_at', now(),
    'missing_functions', to_jsonb(missing_functions),
    'missing_columns', to_jsonb(missing_columns)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tax_report_schema_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tax_report_schema_check() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_schema_check() TO service_role;