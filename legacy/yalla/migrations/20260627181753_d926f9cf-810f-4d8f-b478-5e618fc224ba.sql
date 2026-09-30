
-- ============================================================
-- 1. export_audit_log retention (13 months)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_export_audit_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.export_audit_log
   WHERE created_at < now() - INTERVAL '13 months';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ============================================================
-- 2. mpesa_idempotency_keys GC (expires_at < now)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_mpesa_idempotency_keys()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.mpesa_idempotency_keys
   WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ============================================================
-- 3. Daraja per-shortcode token bucket rate limiter
-- ============================================================
CREATE TABLE IF NOT EXISTS public.mpesa_rate_limit_buckets (
  shortcode           text PRIMARY KEY,
  tokens              double precision NOT NULL DEFAULT 100,
  capacity            integer NOT NULL DEFAULT 100,
  refill_rate_per_sec integer NOT NULL DEFAULT 80,
  last_refill_at      timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mpesa_rate_limit_buckets TO authenticated;
GRANT ALL ON public.mpesa_rate_limit_buckets TO service_role;

ALTER TABLE public.mpesa_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages mpesa rate buckets"
  ON public.mpesa_rate_limit_buckets
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read mpesa rate buckets"
  ON public.mpesa_rate_limit_buckets
  FOR SELECT TO authenticated
  USING (true);

-- Atomic token acquisition. Returns TRUE on grant, FALSE when over limit.
CREATE OR REPLACE FUNCTION public.acquire_mpesa_token(
  p_shortcode text,
  p_capacity  integer DEFAULT 100,
  p_refill    integer DEFAULT 80
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now           timestamptz := clock_timestamp();
  v_tokens        double precision;
  v_last          timestamptz;
  v_elapsed       double precision;
  v_new_tokens    double precision;
BEGIN
  -- Upsert bucket row atomically.
  INSERT INTO public.mpesa_rate_limit_buckets (shortcode, tokens, capacity, refill_rate_per_sec, last_refill_at)
  VALUES (p_shortcode, p_capacity, p_capacity, p_refill, v_now)
  ON CONFLICT (shortcode) DO NOTHING;

  -- Row-level lock so concurrent edge invocations serialize on this shortcode only.
  SELECT tokens, last_refill_at INTO v_tokens, v_last
    FROM public.mpesa_rate_limit_buckets
   WHERE shortcode = p_shortcode
   FOR UPDATE;

  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_last)));
  v_new_tokens := LEAST(p_capacity::double precision, v_tokens + v_elapsed * p_refill);

  IF v_new_tokens < 1 THEN
    UPDATE public.mpesa_rate_limit_buckets
       SET tokens = v_new_tokens, last_refill_at = v_now, updated_at = v_now
     WHERE shortcode = p_shortcode;
    RETURN false;
  END IF;

  UPDATE public.mpesa_rate_limit_buckets
     SET tokens = v_new_tokens - 1,
         last_refill_at = v_now,
         updated_at = v_now
   WHERE shortcode = p_shortcode;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_mpesa_token(text, integer, integer) TO service_role;

-- ============================================================
-- 4. pg_cron schedules (idempotent)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Daily 03:15 UTC export retention sweep
    PERFORM cron.unschedule('cleanup_export_audit_log_daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_export_audit_log_daily');
    PERFORM cron.schedule(
      'cleanup_export_audit_log_daily',
      '15 3 * * *',
      $cron$ SELECT public.cleanup_export_audit_log(); $cron$
    );

    -- Hourly idempotency key GC
    PERFORM cron.unschedule('cleanup_mpesa_idempotency_keys_hourly')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_mpesa_idempotency_keys_hourly');
    PERFORM cron.schedule(
      'cleanup_mpesa_idempotency_keys_hourly',
      '7 * * * *',
      $cron$ SELECT public.cleanup_mpesa_idempotency_keys(); $cron$
    );
  END IF;
END $$;

-- Seed default bucket for the production paybill (idempotent).
INSERT INTO public.mpesa_rate_limit_buckets (shortcode, tokens, capacity, refill_rate_per_sec)
VALUES ('4148095', 100, 100, 80)
ON CONFLICT (shortcode) DO NOTHING;
