CREATE TABLE IF NOT EXISTS public.tax_report_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  report text NOT NULL,
  trigger_source text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  backoff_ms integer,
  duration_ms integer,
  status text NOT NULL,
  window_from date,
  window_to date,
  last_error jsonb,
  triggered_by uuid,
  triggered_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_report_sync_runs_status_check CHECK (status IN ('success','failed')),
  CONSTRAINT tax_report_sync_runs_trigger_check CHECK (trigger_source IN ('initial_load','auto_retry','manual_retry','retry_job','scheduled')),
  CONSTRAINT tax_report_sync_runs_attempt_check CHECK (attempt >= 1)
);

CREATE INDEX IF NOT EXISTS tax_report_sync_runs_created_idx ON public.tax_report_sync_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS tax_report_sync_runs_report_idx ON public.tax_report_sync_runs (report, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_report_sync_runs_request_idx ON public.tax_report_sync_runs (request_id);

GRANT SELECT, INSERT ON public.tax_report_sync_runs TO authenticated;
GRANT ALL ON public.tax_report_sync_runs TO service_role;

ALTER TABLE public.tax_report_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tax readers and own actor can view sync runs"
ON public.tax_report_sync_runs
FOR SELECT TO authenticated
USING (public.can_read_tax_reports(auth.uid()) OR triggered_by = auth.uid());

CREATE POLICY "Signed-in users can append their own sync runs"
ON public.tax_report_sync_runs
FOR INSERT TO authenticated
WITH CHECK (triggered_by IS NULL OR triggered_by = auth.uid());

CREATE OR REPLACE FUNCTION public.deny_tax_report_sync_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'tax_report_sync_runs is append-only: % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS tax_report_sync_runs_immutable ON public.tax_report_sync_runs;
CREATE TRIGGER tax_report_sync_runs_immutable
BEFORE UPDATE OR DELETE ON public.tax_report_sync_runs
FOR EACH ROW EXECUTE FUNCTION public.deny_tax_report_sync_run_mutation();

CREATE OR REPLACE FUNCTION public.tax_record_report_sync_run(
  _request_id text,
  _report text,
  _trigger_source text,
  _status text,
  _attempt integer DEFAULT 1,
  _backoff_ms integer DEFAULT NULL,
  _duration_ms integer DEFAULT NULL,
  _window_from date DEFAULT NULL,
  _window_to date DEFAULT NULL,
  _last_error jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _uid uuid := auth.uid();
  _email text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'tax_sync_run_unauthenticated: sign in before recording a tax report run';
  END IF;

  SELECT u.email INTO _email FROM auth.users u WHERE u.id = _uid;

  INSERT INTO public.tax_report_sync_runs (
    request_id, report, trigger_source, attempt, backoff_ms, duration_ms,
    status, window_from, window_to, last_error, triggered_by, triggered_by_email
  ) VALUES (
    _request_id, _report, _trigger_source, GREATEST(COALESCE(_attempt, 1), 1), _backoff_ms, _duration_ms,
    _status, _window_from, _window_to, _last_error, _uid, _email
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.tax_record_report_sync_run(text,text,text,text,integer,integer,integer,date,date,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tax_record_report_sync_run(text,text,text,text,integer,integer,integer,date,date,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tax_report_sync_run_history(
  _report text DEFAULT NULL,
  _limit integer DEFAULT 100
)
RETURNS SETOF public.tax_report_sync_runs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.*
  FROM public.tax_report_sync_runs r
  WHERE (public.can_read_tax_reports(auth.uid()) OR r.triggered_by = auth.uid())
    AND (_report IS NULL OR r.report = _report)
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.tax_report_sync_run_history(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tax_report_sync_run_history(text,integer) TO authenticated, service_role;