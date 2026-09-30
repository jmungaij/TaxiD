-- ============================================================
-- 1. Finance permission matrix (server-enforced RBAC)
-- ============================================================
CREATE OR REPLACE FUNCTION public.recon_permission_roles(_perm text)
RETURNS app_role[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _perm
    -- read/export discrepancy evidence
    WHEN 'recon.export'        THEN ARRAY['finance_admin','compliance_admin','admin','super_admin']::app_role[]
    -- trigger / queue reconciliation reruns
    WHEN 'recon.rerun'         THEN ARRAY['finance_admin','admin','super_admin']::app_role[]
    -- acknowledge / resolve findings with notes
    WHEN 'recon.resolve'       THEN ARRAY['finance_admin','compliance_admin','admin','super_admin']::app_role[]
    -- confirm the compensating (reversal/refund) ledger entry — money movement
    WHEN 'recon.reverse'       THEN ARRAY['finance_admin','admin','super_admin']::app_role[]
    -- mismatch alert routing + webhook configuration
    WHEN 'recon.alerts.manage' THEN ARRAY['finance_admin','admin','super_admin']::app_role[]
    -- scheduled-job (pg_cron) monitoring dashboard
    WHEN 'ops.cron.monitor'    THEN ARRAY['finance_admin','operations_admin','admin','super_admin']::app_role[]
    ELSE ARRAY[]::app_role[]
  END
$$;

CREATE OR REPLACE FUNCTION public.has_recon_permission(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = ANY (public.recon_permission_roles(_perm))
  )
$$;

REVOKE ALL ON FUNCTION public.has_recon_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_recon_permission(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.recon_permission_roles(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recon_permission_roles(text) TO authenticated, service_role;

-- Convenience: the permission set for the caller (drives UI affordances).
CREATE OR REPLACE FUNCTION public.my_recon_permissions()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(p ORDER BY p), ARRAY[]::text[])
  FROM unnest(ARRAY[
    'recon.export','recon.rerun','recon.resolve','recon.reverse',
    'recon.alerts.manage','ops.cron.monitor'
  ]) AS p
  WHERE public.has_recon_permission(auth.uid(), p)
$$;
REVOKE ALL ON FUNCTION public.my_recon_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_recon_permissions() TO authenticated, service_role;

-- ============================================================
-- 2. Re-gate the existing finance RPCs on the matrix
-- ============================================================
CREATE OR REPLACE FUNCTION public.charter_wallet_reconcile_range(
  _from timestamptz, _to timestamptz, _triggered_by text DEFAULT 'console',
  _retry_of uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  attempt_id uuid;
  v_run_id uuid;
  w_scanned integer := 0;
  r_scanned integer := 0;
  n_findings integer := 0;
  n_critical integer := 0;
  attempt_no integer := 1;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.rerun') THEN
    RAISE EXCEPTION 'forbidden: recon.rerun permission required';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF _retry_of IS NOT NULL THEN
    SELECT coalesce(attempt, 0) + 1 INTO attempt_no
      FROM public.charter_wallet_reconciliation_attempts WHERE id = _retry_of;
    attempt_no := coalesce(attempt_no, 1);
  END IF;

  INSERT INTO public.charter_wallet_reconciliation_attempts
    (requested_from, requested_to, status, attempt, retry_of, note, requested_by, started_at)
  VALUES (_from, _to, 'running', attempt_no, _retry_of, _note, auth.uid(), now())
  RETURNING id INTO attempt_id;

  BEGIN
    SELECT (r->>'run_id')::uuid,
           coalesce((r->>'wallets_scanned')::int, 0),
           coalesce((r->>'requests_scanned')::int, 0),
           coalesce((r->>'findings')::int, 0),
           coalesce((r->>'critical')::int, 0)
      INTO v_run_id, w_scanned, r_scanned, n_findings, n_critical
      FROM public.charter_wallet_reconcile(_from, _to, _triggered_by) AS r;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.charter_wallet_reconciliation_attempts
       SET status = 'failed', error = SQLERRM, finished_at = now()
     WHERE id = attempt_id;
    RAISE;
  END;

  UPDATE public.charter_wallet_reconciliation_attempts
     SET status = 'succeeded', run_id = v_run_id, findings = n_findings,
         critical = n_critical, finished_at = now()
   WHERE id = attempt_id;

  RETURN jsonb_build_object(
    'attempt_id', attempt_id, 'run_id', v_run_id,
    'wallets_scanned', w_scanned, 'requests_scanned', r_scanned,
    'findings', n_findings, 'critical', n_critical,
    'balanced', n_findings = 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.charter_wallet_queue_reconciliation(
  _from timestamptz, _to timestamptz, _retry_of uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  attempt_id uuid;
  attempt_no integer := 1;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.rerun') THEN
    RAISE EXCEPTION 'forbidden: recon.rerun permission required';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF _retry_of IS NOT NULL THEN
    SELECT coalesce(attempt, 0) + 1 INTO attempt_no
      FROM public.charter_wallet_reconciliation_attempts WHERE id = _retry_of;
    attempt_no := coalesce(attempt_no, 1);
  END IF;

  INSERT INTO public.charter_wallet_reconciliation_attempts
    (requested_from, requested_to, status, attempt, retry_of, note, requested_by)
  VALUES (_from, _to, 'queued', attempt_no, _retry_of, _note, auth.uid())
  RETURNING id INTO attempt_id;

  RETURN attempt_id;
END;
$function$;

-- ============================================================
-- 3. Finding acknowledgement / resolution with notes
-- ============================================================
ALTER TABLE public.charter_wallet_reconciliation_findings
  ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;

CREATE OR REPLACE FUNCTION public.charter_wallet_resolve_finding(
  _finding_id uuid, _status text, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  f public.charter_wallet_reconciliation_findings;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.resolve') THEN
    RAISE EXCEPTION 'forbidden: recon.resolve permission required';
  END IF;
  IF _status NOT IN ('open','acknowledged','resolved','false_positive') THEN
    RAISE EXCEPTION 'invalid_status: %', _status;
  END IF;
  IF _status IN ('resolved','false_positive') AND coalesce(btrim(_notes), '') = '' THEN
    RAISE EXCEPTION 'resolution_notes_required';
  END IF;

  UPDATE public.charter_wallet_reconciliation_findings
     SET resolution_status = _status,
         resolution_notes  = coalesce(nullif(btrim(_notes), ''), resolution_notes),
         acknowledged_at   = CASE WHEN _status = 'open' THEN NULL
                                  ELSE coalesce(acknowledged_at, now()) END,
         acknowledged_by   = CASE WHEN _status = 'open' THEN NULL
                                  ELSE coalesce(acknowledged_by, auth.uid()) END,
         resolved_at       = CASE WHEN _status IN ('resolved','false_positive') THEN now() ELSE NULL END,
         resolved_by       = CASE WHEN _status IN ('resolved','false_positive') THEN auth.uid() ELSE NULL END
   WHERE id = _finding_id
  RETURNING * INTO f;

  IF f IS NULL THEN RAISE EXCEPTION 'finding_not_found'; END IF;

  -- Acknowledging a finding also stops its alert from retrying forever.
  UPDATE public.charter_wallet_finance_alerts
     SET acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid()),
         acknowledgement_notes = coalesce(nullif(btrim(_notes), ''), acknowledgement_notes),
         status = CASE WHEN _status IN ('resolved','false_positive') THEN 'acknowledged' ELSE status END
   WHERE finding_id = _finding_id
     AND _status <> 'open';

  RETURN jsonb_build_object('id', f.id, 'resolution_status', f.resolution_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.charter_wallet_resolve_finding(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charter_wallet_resolve_finding(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- 4. Alert delivery retry / backoff + attempt history
-- ============================================================
ALTER TABLE public.charter_wallet_finance_alerts
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS acknowledgement_notes text;

CREATE INDEX IF NOT EXISTS charter_wallet_finance_alerts_due_idx
  ON public.charter_wallet_finance_alerts (next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE public.charter_wallet_finance_alert_settings
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS backoff_base_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS backoff_max_seconds integer NOT NULL DEFAULT 3600;

CREATE TABLE IF NOT EXISTS public.charter_wallet_alert_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.charter_wallet_finance_alerts(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  channel text NOT NULL,                        -- 'email' | 'webhook'
  target text,
  ok boolean NOT NULL DEFAULT false,
  status_code integer,
  error text,
  duration_ms integer,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_wallet_alert_delivery_attempts TO authenticated;
GRANT ALL ON public.charter_wallet_alert_delivery_attempts TO service_role;
ALTER TABLE public.charter_wallet_alert_delivery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance roles read alert delivery attempts"
  ON public.charter_wallet_alert_delivery_attempts FOR SELECT TO authenticated
  USING (public.has_recon_permission(auth.uid(), 'recon.export'));

CREATE INDEX IF NOT EXISTS charter_wallet_alert_delivery_attempts_alert_idx
  ON public.charter_wallet_alert_delivery_attempts (alert_id, created_at DESC);

-- Records one delivery try and schedules the next with exponential backoff.
CREATE OR REPLACE FUNCTION public.charter_wallet_record_alert_attempt(
  _alert_id uuid, _attempt integer, _channel text, _target text,
  _ok boolean, _status_code integer DEFAULT NULL,
  _error text DEFAULT NULL, _duration_ms integer DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.charter_wallet_finance_alert_settings;
  next_at timestamptz;
  delay_s integer;
BEGIN
  SELECT * INTO s FROM public.charter_wallet_finance_alert_settings ORDER BY created_at LIMIT 1;

  IF _ok OR _attempt >= coalesce(s.max_attempts, 6) THEN
    next_at := NULL;
  ELSE
    delay_s := least(
      coalesce(s.backoff_base_seconds, 60) * power(2, greatest(_attempt - 1, 0))::int,
      coalesce(s.backoff_max_seconds, 3600));
    next_at := now() + make_interval(secs => delay_s);
  END IF;

  INSERT INTO public.charter_wallet_alert_delivery_attempts
    (alert_id, attempt, channel, target, ok, status_code, error, duration_ms, next_attempt_at)
  VALUES (_alert_id, _attempt, _channel, _target, _ok, _status_code, _error, _duration_ms, next_at);

  RETURN next_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.charter_wallet_record_alert_attempt(uuid, integer, text, text, boolean, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charter_wallet_record_alert_attempt(uuid, integer, text, text, boolean, integer, text, integer) TO service_role;

-- ============================================================
-- 5. Scheduled-job (pg_cron) HTTP outcome monitoring
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scheduled_job_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  function_slug text NOT NULL,
  request_id bigint,
  invoked_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scheduled_job_invocations TO authenticated;
GRANT ALL ON public.scheduled_job_invocations TO service_role;
ALTER TABLE public.scheduled_job_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops roles read scheduled job invocations"
  ON public.scheduled_job_invocations FOR SELECT TO authenticated
  USING (public.has_recon_permission(auth.uid(), 'ops.cron.monitor'));

CREATE INDEX IF NOT EXISTS scheduled_job_invocations_job_idx
  ON public.scheduled_job_invocations (job_name, invoked_at DESC);

-- Wrapper used by cron commands: fires the HTTP call AND records the
-- pg_net request id so outcomes (200/502) can be attributed to the job.
CREATE OR REPLACE FUNCTION public.invoke_scheduled_function(
  _job_name text, _function_slug text, _url text,
  _headers jsonb, _body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $function$
DECLARE
  req_id bigint;
BEGIN
  SELECT net.http_post(url := _url, headers := _headers, body := _body) INTO req_id;
  INSERT INTO public.scheduled_job_invocations (job_name, function_slug, request_id)
  VALUES (_job_name, _function_slug, req_id);
  -- keep the tracking table bounded
  DELETE FROM public.scheduled_job_invocations WHERE invoked_at < now() - interval '7 days';
  RETURN req_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.invoke_scheduled_function(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_scheduled_function(text, text, text, jsonb, jsonb) TO postgres, service_role;

-- Read model for the monitoring dashboard: cron schedule + run status +
-- correlated HTTP status codes and the last error per job.
CREATE OR REPLACE FUNCTION public.scheduled_job_health(_hours integer DEFAULT 24)
RETURNS TABLE (
  job_name text, schedule text, active boolean, function_slug text,
  last_run_at timestamptz, last_run_status text, last_run_message text,
  runs integer, cron_failures integer,
  http_calls integer, http_ok integer, http_failed integer,
  last_http_status integer, last_http_at timestamptz, last_http_error text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, cron, net
AS $function$
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'ops.cron.monitor') THEN
    RAISE EXCEPTION 'forbidden: ops.cron.monitor permission required';
  END IF;

  RETURN QUERY
  WITH cutoff AS (SELECT now() - make_interval(hours => greatest(coalesce(_hours, 24), 1)) AS ts),
  jobs AS (
    SELECT j.jobid, j.jobname::text AS job_name, j.schedule::text AS schedule, j.active,
           coalesce(
             (regexp_match(j.command, 'functions/v1/([a-zA-Z0-9_-]+)'))[1],
             (regexp_match(j.command, 'invoke_scheduled_function\([^,]+,\s*''([a-zA-Z0-9_-]+)'''))[1]
           )::text AS function_slug
      FROM cron.job j
  ),
  runs AS (
    SELECT d.jobid,
           count(*)::int AS runs,
           count(*) FILTER (WHERE d.status = 'failed')::int AS cron_failures,
           max(d.start_time) AS last_run_at
      FROM cron.job_run_details d, cutoff c
     WHERE d.start_time >= c.ts
     GROUP BY d.jobid
  ),
  last_run AS (
    SELECT DISTINCT ON (d.jobid) d.jobid, d.status::text AS status, d.return_message::text AS message
      FROM cron.job_run_details d, cutoff c
     WHERE d.start_time >= c.ts
     ORDER BY d.jobid, d.start_time DESC
  ),
  http AS (
    SELECT i.job_name,
           count(r.id)::int AS http_calls,
           count(*) FILTER (WHERE r.status_code BETWEEN 200 AND 299)::int AS http_ok,
           count(*) FILTER (WHERE r.status_code IS NOT NULL AND r.status_code >= 400)::int AS http_failed
      FROM public.scheduled_job_invocations i
      JOIN cutoff c ON i.invoked_at >= c.ts
      LEFT JOIN net._http_response r ON r.id = i.request_id
     GROUP BY i.job_name
  ),
  last_http AS (
    SELECT DISTINCT ON (i.job_name) i.job_name, r.status_code, i.invoked_at,
           nullif(coalesce(r.error_msg, CASE WHEN r.status_code >= 400
                THEN left(coalesce(r.content, ''), 400) END), '') AS error
      FROM public.scheduled_job_invocations i
      JOIN cutoff c ON i.invoked_at >= c.ts
      JOIN net._http_response r ON r.id = i.request_id
     ORDER BY i.job_name, i.invoked_at DESC
  )
  SELECT j.job_name, j.schedule, j.active, j.function_slug,
         rn.last_run_at, lr.status, lr.message,
         coalesce(rn.runs, 0), coalesce(rn.cron_failures, 0),
         coalesce(h.http_calls, 0), coalesce(h.http_ok, 0), coalesce(h.http_failed, 0),
         lh.status_code, lh.invoked_at, lh.error
    FROM jobs j
    LEFT JOIN runs rn ON rn.jobid = j.jobid
    LEFT JOIN last_run lr ON lr.jobid = j.jobid
    LEFT JOIN http h ON h.job_name = j.job_name
    LEFT JOIN last_http lh ON lh.job_name = j.job_name
   ORDER BY (coalesce(rn.cron_failures, 0) + coalesce(h.http_failed, 0)) DESC, j.job_name;
END;
$function$;
REVOKE ALL ON FUNCTION public.scheduled_job_health(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduled_job_health(integer) TO authenticated, service_role;