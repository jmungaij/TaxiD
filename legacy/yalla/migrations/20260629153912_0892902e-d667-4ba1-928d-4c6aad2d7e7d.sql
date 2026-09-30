
-- Extend event_consumers with subscription + delivery config
ALTER TABLE public.event_consumers
  ADD COLUMN IF NOT EXISTS event_pattern text,
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS backoff_base_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

-- Per-(event, consumer) delivery ledger
CREATE TABLE IF NOT EXISTS public.outbox_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.event_outbox(id) ON DELETE CASCADE,
  consumer_id uuid NOT NULL REFERENCES public.event_consumers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING', -- PENDING | SUCCESS | RETRY | DLQ
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_status_code integer,
  last_error text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, consumer_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outbox_deliveries TO authenticated;
GRANT ALL ON public.outbox_deliveries TO service_role;

ALTER TABLE public.outbox_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_outbox_deliveries" ON public.outbox_deliveries
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'finance_admin')
);

CREATE INDEX IF NOT EXISTS idx_outbox_deliveries_ready
  ON public.outbox_deliveries (status, next_attempt_at)
  WHERE status IN ('PENDING','RETRY');

CREATE INDEX IF NOT EXISTS idx_event_outbox_ready
  ON public.event_outbox (status, next_attempt_at)
  WHERE status IN ('PENDING','RETRY');

-- updated_at trigger reuse
DROP TRIGGER IF EXISTS trg_outbox_deliveries_updated ON public.outbox_deliveries;
CREATE TRIGGER trg_outbox_deliveries_updated
BEFORE UPDATE ON public.outbox_deliveries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enqueue helper: idempotent via dedupe_key
CREATE OR REPLACE FUNCTION public.enqueue_event(
  _aggregate text,
  _aggregate_id uuid,
  _event_type text,
  _payload jsonb,
  _dedupe_key text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _key text := COALESCE(_dedupe_key, _event_type || ':' || _aggregate_id::text || ':' || extract(epoch from now())::text);
BEGIN
  INSERT INTO public.event_outbox (aggregate, aggregate_id, event_type, payload, dedupe_key, status, attempts, next_attempt_at)
  VALUES (_aggregate, _aggregate_id, _event_type, COALESCE(_payload, '{}'::jsonb), _key, 'PENDING', 0, now())
  ON CONFLICT (dedupe_key) DO UPDATE SET payload = EXCLUDED.payload
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_event(text, uuid, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_event(text, uuid, text, jsonb, text) TO authenticated, service_role;

-- Ensure dedupe_key uniqueness (no-op if already there)
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_outbox_dedupe_key
  ON public.event_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Replay: reset deliveries for an event so processor retries
CREATE OR REPLACE FUNCTION public.replay_outbox_event(_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'finance_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.event_outbox
    SET status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = NULL, processed_at = NULL
    WHERE id = _event_id;

  UPDATE public.outbox_deliveries
    SET status = 'PENDING', attempts = 0, next_attempt_at = now(), last_error = NULL
    WHERE event_id = _event_id AND status IN ('DLQ','RETRY','SUCCESS');

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.replay_outbox_event(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.replay_outbox_event(uuid) TO authenticated, service_role;
