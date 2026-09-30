
-- 1. Failure metadata columns for operator visibility
ALTER TABLE public.event_outbox
  ADD COLUMN IF NOT EXISTS first_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

-- Backfill for already-DLQ'd rows so the view is immediately useful
UPDATE public.event_outbox
   SET dead_lettered_at = COALESCE(dead_lettered_at, processed_at, now())
 WHERE status = 'DLQ' AND dead_lettered_at IS NULL;

-- 2. DLQ operator view — joins outbox rows with the failing delivery attempts.
DROP VIEW IF EXISTS public.event_outbox_dlq;
CREATE VIEW public.event_outbox_dlq
WITH (security_invoker = true) AS
SELECT
  o.id                     AS event_id,
  o.aggregate,
  o.aggregate_id,
  o.event_type,
  o.dedupe_key,
  o.attempts               AS event_attempts,
  o.first_failed_at,
  o.dead_lettered_at,
  o.last_error             AS event_last_error,
  o.payload,
  o.created_at,
  d.consumer_id,
  c.consumer_name,
  d.status                 AS delivery_status,
  d.attempts               AS delivery_attempts,
  d.last_status_code,
  d.last_error             AS delivery_last_error,
  d.latency_ms,
  d.last_attempt_at
FROM public.event_outbox o
LEFT JOIN public.outbox_deliveries d ON d.event_id = o.id
LEFT JOIN public.event_consumers  c ON c.id = d.consumer_id
WHERE o.status = 'DLQ' OR d.status = 'DLQ';

GRANT SELECT ON public.event_outbox_dlq TO authenticated;
GRANT ALL    ON public.event_outbox_dlq TO service_role;

-- 3. Tighten alerts_events insert policy: caller cannot forge triggered_by.
DROP POLICY IF EXISTS "authenticated insert alert events" ON public.alerts_events;
CREATE POLICY "authenticated insert own alert events"
  ON public.alerts_events
  FOR INSERT
  TO authenticated
  WITH CHECK (triggered_by IS NULL OR triggered_by = auth.uid());

-- Service role bypasses RLS, so edge functions using SUPABASE_SERVICE_ROLE_KEY
-- can still emit alerts on behalf of any actor.
