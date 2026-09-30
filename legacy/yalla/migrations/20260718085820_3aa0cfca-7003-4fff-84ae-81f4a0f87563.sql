DROP VIEW IF EXISTS public.event_outbox_dlq CASCADE;

-- 1. event_outbox envelope columns
ALTER TABLE public.event_outbox
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS span_id text,
  ADD COLUMN IF NOT EXISTS parent_span_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS event_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS deployment_version text,
  ADD COLUMN IF NOT EXISTS git_revision text,
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS payment_session_id uuid,
  ADD COLUMN IF NOT EXISTS payment_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS poisoned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS error_signature text,
  ADD COLUMN IF NOT EXISTS delivery_latency_ms integer,
  ADD COLUMN IF NOT EXISTS first_attempted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_idempotency_uniq
  ON public.event_outbox (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_outbox_trace_idx ON public.event_outbox (trace_id);
CREATE INDEX IF NOT EXISTS event_outbox_correlation_idx ON public.event_outbox (correlation_id);
CREATE INDEX IF NOT EXISTS event_outbox_pending_due_idx
  ON public.event_outbox (status, next_attempt_at) WHERE status IN ('PENDING','RETRY');
CREATE INDEX IF NOT EXISTS event_outbox_expiry_idx
  ON public.event_outbox (expires_at) WHERE expires_at IS NOT NULL AND status IN ('PENDING','RETRY');

-- 2. DLQ table
CREATE TABLE public.event_outbox_dlq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  aggregate text,
  aggregate_id uuid,
  correlation_id text,
  trace_id text,
  span_id text,
  parent_span_id text,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text,
  retry_count integer NOT NULL DEFAULT 0,
  retry_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_reason text,
  stack_trace text,
  poisoned boolean NOT NULL DEFAULT false,
  expired boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'production',
  deployment_version text,
  git_revision text,
  resolution_status text NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending','acknowledged','replayed','discarded')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_retry_at timestamptz
);
CREATE INDEX event_outbox_dlq_status_idx ON public.event_outbox_dlq (resolution_status, created_at DESC);
CREATE INDEX event_outbox_dlq_correlation_idx ON public.event_outbox_dlq (correlation_id);
CREATE INDEX event_outbox_dlq_trace_idx ON public.event_outbox_dlq (trace_id);

GRANT SELECT, INSERT, UPDATE ON public.event_outbox_dlq TO authenticated;
GRANT ALL ON public.event_outbox_dlq TO service_role;
ALTER TABLE public.event_outbox_dlq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dlq_view_privileged" ON public.event_outbox_dlq
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'operations_admin')
  );
CREATE POLICY "dlq_resolve_super_admin" ON public.event_outbox_dlq
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 3. Notification dispatches — trace propagation
ALTER TABLE public.payment_notification_dispatches
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS span_id text,
  ADD COLUMN IF NOT EXISTS parent_span_id text,
  ADD COLUMN IF NOT EXISTS delivery_latency_ms integer,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE INDEX IF NOT EXISTS payment_notification_dispatches_trace_idx
  ON public.payment_notification_dispatches (trace_id);

-- 4. Infra SLOs
CREATE TABLE IF NOT EXISTS public.payment_infra_slos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  unit text NOT NULL,
  direction text NOT NULL DEFAULT 'lower_is_better'
    CHECK (direction IN ('lower_is_better','higher_is_better')),
  target_value numeric NOT NULL,
  warn_value numeric NOT NULL,
  critical_value numeric NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_infra_slos TO authenticated;
GRANT ALL ON public.payment_infra_slos TO service_role;
ALTER TABLE public.payment_infra_slos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra_slos_view_privileged" ON public.payment_infra_slos
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'operations_admin')
    OR public.has_role(auth.uid(), 'finance_admin')
  );

CREATE TABLE IF NOT EXISTS public.payment_infra_slo_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_key text NOT NULL REFERENCES public.payment_infra_slos(slo_key) ON DELETE CASCADE,
  observed_value numeric NOT NULL,
  breach_severity text NOT NULL DEFAULT 'ok'
    CHECK (breach_severity IN ('ok','warn','critical')),
  window_seconds integer NOT NULL DEFAULT 60,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  measured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_infra_slo_measurements_key_time_idx
  ON public.payment_infra_slo_measurements (slo_key, measured_at DESC);
CREATE INDEX IF NOT EXISTS payment_infra_slo_measurements_breach_idx
  ON public.payment_infra_slo_measurements (breach_severity, measured_at DESC)
  WHERE breach_severity <> 'ok';
GRANT SELECT ON public.payment_infra_slo_measurements TO authenticated;
GRANT ALL ON public.payment_infra_slo_measurements TO service_role;
ALTER TABLE public.payment_infra_slo_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra_slo_meas_view_privileged" ON public.payment_infra_slo_measurements
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'operations_admin')
    OR public.has_role(auth.uid(), 'finance_admin')
  );

-- 5. Seed SLO defaults
INSERT INTO public.payment_infra_slos
  (slo_key, display_name, description, unit, direction, target_value, warn_value, critical_value)
VALUES
  ('outbox_pending_depth',        'Outbox pending depth',           'PENDING+RETRY events awaiting delivery',  'count', 'lower_is_better',   50,   200,   1000),
  ('outbox_dlq_depth',            'Outbox DLQ depth (unresolved)',  'Unresolved dead-lettered events',         'count', 'lower_is_better',    0,     5,     25),
  ('notification_backlog',        'Notification backlog',           'Outbox notify events awaiting dispatch',  'count', 'lower_is_better',   10,    50,    250),
  ('notification_dispatch_p95_ms','Notification dispatch p95 ms',   'p95 provider dispatch latency',           'ms',    'lower_is_better', 1500,  5000,  15000),
  ('outbox_retry_rate_pct',       'Outbox retry rate %',            '% events retried in last window',         'ratio', 'lower_is_better',    2,    10,     30)
ON CONFLICT (slo_key) DO NOTHING;

-- 6. Envelope enqueue helper
CREATE OR REPLACE FUNCTION public.enqueue_payment_event(
  _event_type text, _aggregate text, _aggregate_id uuid, _payload jsonb,
  _correlation_id text, _trace_id text, _span_id text,
  _parent_span_id text DEFAULT NULL, _idempotency_key text DEFAULT NULL,
  _payment_session_id uuid DEFAULT NULL, _payment_attempt_id uuid DEFAULT NULL,
  _tenant_id uuid DEFAULT NULL, _deployment_version text DEFAULT NULL,
  _git_revision text DEFAULT NULL, _environment text DEFAULT 'production',
  _expires_in_minutes integer DEFAULT 60,
  _event_version text DEFAULT '1.0', _schema_version text DEFAULT '1.0'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _id FROM public.event_outbox
     WHERE idempotency_key = _idempotency_key LIMIT 1;
    IF _id IS NOT NULL THEN RETURN _id; END IF;
  END IF;

  INSERT INTO public.event_outbox (
    aggregate, aggregate_id, event_type, payload, dedupe_key,
    trace_id, span_id, parent_span_id, idempotency_key, correlation_id,
    event_version, schema_version, deployment_version, git_revision,
    tenant_id, environment, payment_session_id, payment_attempt_id, expires_at
  ) VALUES (
    _aggregate, _aggregate_id, _event_type, COALESCE(_payload,'{}'::jsonb),
    COALESCE(_idempotency_key, _correlation_id),
    _trace_id, _span_id, _parent_span_id, _idempotency_key, _correlation_id,
    _event_version, _schema_version, _deployment_version, _git_revision,
    _tenant_id, _environment, _payment_session_id, _payment_attempt_id,
    CASE WHEN _expires_in_minutes IS NULL THEN NULL
         ELSE now() + make_interval(mins => _expires_in_minutes) END
  ) RETURNING id INTO _id;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_payment_event(text,text,uuid,jsonb,text,text,text,text,text,uuid,uuid,uuid,text,text,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_payment_event(text,text,uuid,jsonb,text,text,text,text,text,uuid,uuid,uuid,text,text,text,integer,text,text) TO service_role;

-- 7. Infra SLO snapshot RPC
CREATE OR REPLACE FUNCTION public.payment_slo_snapshot()
RETURNS TABLE (slo_key text, observed_value numeric, breach_severity text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pending_depth numeric; _dlq_depth numeric; _notify_backlog numeric;
  _dispatch_p95 numeric;  _retry_rate numeric;
  _total numeric; _retried numeric;
BEGIN
  SELECT count(*) INTO _pending_depth FROM public.event_outbox
   WHERE status IN ('PENDING','RETRY');
  SELECT count(*) INTO _dlq_depth FROM public.event_outbox_dlq
   WHERE resolution_status = 'pending';
  SELECT count(*) INTO _notify_backlog FROM public.event_outbox
   WHERE status IN ('PENDING','RETRY') AND event_type LIKE 'payment.notify.%';
  SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery_latency_ms)::numeric, 0)
    INTO _dispatch_p95 FROM public.payment_notification_dispatches
   WHERE dispatched_at > now() - interval '15 minutes' AND delivery_latency_ms IS NOT NULL;
  SELECT count(*)::numeric INTO _total FROM public.event_outbox
   WHERE created_at > now() - interval '15 minutes';
  SELECT count(*)::numeric INTO _retried FROM public.event_outbox
   WHERE created_at > now() - interval '15 minutes' AND attempts > 1;
  _retry_rate := CASE WHEN _total = 0 THEN 0 ELSE round((_retried / _total) * 100, 2) END;

  RETURN QUERY
  WITH observed AS (
    SELECT * FROM (VALUES
      ('outbox_pending_depth',         _pending_depth),
      ('outbox_dlq_depth',             _dlq_depth),
      ('notification_backlog',         _notify_backlog),
      ('notification_dispatch_p95_ms', _dispatch_p95),
      ('outbox_retry_rate_pct',        _retry_rate)
    ) AS t(slo_key, observed_value)
  )
  SELECT o.slo_key, o.observed_value,
    CASE
      WHEN s.direction='lower_is_better'  AND o.observed_value >= s.critical_value THEN 'critical'
      WHEN s.direction='lower_is_better'  AND o.observed_value >= s.warn_value     THEN 'warn'
      WHEN s.direction='higher_is_better' AND o.observed_value <= s.critical_value THEN 'critical'
      WHEN s.direction='higher_is_better' AND o.observed_value <= s.warn_value     THEN 'warn'
      ELSE 'ok'
    END
  FROM observed o
  JOIN public.payment_infra_slos s ON s.slo_key = o.slo_key
  WHERE s.active = true;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_slo_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_slo_snapshot() TO service_role, authenticated;
