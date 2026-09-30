
-- 1. Outbox runs log
CREATE TABLE IF NOT EXISTS public.outbox_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'cron',
  processed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  duration_ms integer,
  webhook_url text,
  notes text
);

GRANT SELECT ON public.outbox_runs TO authenticated;
GRANT ALL ON public.outbox_runs TO service_role;

ALTER TABLE public.outbox_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outbox_runs admin read" ON public.outbox_runs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_outbox_runs_time ON public.outbox_runs (ran_at DESC);

-- 2. POD image sha256 for duplicate detection
ALTER TABLE public.proof_of_delivery
  ADD COLUMN IF NOT EXISTS image_sha256 text;

CREATE INDEX IF NOT EXISTS idx_pod_image_sha ON public.proof_of_delivery (image_sha256) WHERE image_sha256 IS NOT NULL;

-- 3. Replace fraud trigger to add new checks
CREATE OR REPLACE FUNCTION public.tg_pod_fraud_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg_recipient text;
  drop_lat numeric;
  drop_lng numeric;
  dist_km numeric;
  dup_count integer;
  hash_count integer;
  signer_lc text;
  recip_lc text;
BEGIN
  SELECT recipient_name, dropoff_lat, dropoff_lng
    INTO pkg_recipient, drop_lat, drop_lng
    FROM public.packages WHERE id = NEW.package_id;

  -- Duplicate POD on same package (unique constraint normally blocks, but track signal)
  SELECT count(*) INTO dup_count FROM public.proof_of_delivery WHERE package_id = NEW.package_id;
  IF dup_count > 1 THEN
    INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, pod_id, details)
    VALUES ('duplicate_pod', 'high', NEW.package_id, NEW.id,
            jsonb_build_object('count', dup_count));
  END IF;

  -- Duplicate POD image hash (same photo used across packages)
  IF NEW.image_sha256 IS NOT NULL THEN
    SELECT count(*) INTO hash_count
      FROM public.proof_of_delivery
      WHERE image_sha256 = NEW.image_sha256 AND id <> NEW.id;
    IF hash_count > 0 THEN
      INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, pod_id, details)
      VALUES ('duplicate_pod_image', 'critical', NEW.package_id, NEW.id,
              jsonb_build_object('image_sha256', NEW.image_sha256, 'matches', hash_count));
    END IF;
  END IF;

  -- Geolocation anomaly (>5km from expected dropoff)
  IF drop_lat IS NOT NULL AND drop_lng IS NOT NULL
     AND NEW.delivered_lat IS NOT NULL AND NEW.delivered_lng IS NOT NULL THEN
    dist_km := public.haversine_km(drop_lat, drop_lng, NEW.delivered_lat, NEW.delivered_lng);
    IF dist_km > 5 THEN
      INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, pod_id, details)
      VALUES ('geo_anomaly', CASE WHEN dist_km > 25 THEN 'critical' ELSE 'high' END,
              NEW.package_id, NEW.id,
              jsonb_build_object('distance_km', round(dist_km::numeric, 2),
                                 'expected_lat', drop_lat, 'expected_lng', drop_lng,
                                 'actual_lat', NEW.delivered_lat, 'actual_lng', NEW.delivered_lng));
    END IF;
  END IF;

  -- Signer identity mismatch (no token overlap between POD recipient_name and package.recipient_name)
  IF NEW.recipient_name IS NOT NULL AND pkg_recipient IS NOT NULL
     AND length(trim(NEW.recipient_name)) > 0 AND length(trim(pkg_recipient)) > 0 THEN
    signer_lc := lower(regexp_replace(NEW.recipient_name, '[^a-z0-9 ]', '', 'gi'));
    recip_lc := lower(regexp_replace(pkg_recipient, '[^a-z0-9 ]', '', 'gi'));
    IF NOT EXISTS (
      SELECT 1
      FROM unnest(string_to_array(signer_lc, ' ')) AS s(tok)
      JOIN unnest(string_to_array(recip_lc, ' ')) AS r(tok) ON s.tok = r.tok
      WHERE length(s.tok) >= 3
    ) THEN
      INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, pod_id, details)
      VALUES ('signer_mismatch', 'medium', NEW.package_id, NEW.id,
              jsonb_build_object('pod_signer', NEW.recipient_name, 'expected_recipient', pkg_recipient));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Dispatch reassignment frequency
CREATE OR REPLACE FUNCTION public.tg_dispatch_reassignment_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire when attempts crosses the >=3 threshold
  IF NEW.attempts >= 3 AND (OLD.attempts IS DISTINCT FROM NEW.attempts) THEN
    -- Avoid duplicate signals: only insert if no open signal already exists for this job
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_fraud_signals
      WHERE job_id = NEW.id AND signal_type = 'frequent_reassignment' AND status = 'open'
    ) THEN
      INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, job_id, details)
      VALUES ('frequent_reassignment',
              CASE WHEN NEW.attempts >= 5 THEN 'high' ELSE 'medium' END,
              NEW.package_id, NEW.id,
              jsonb_build_object('attempts', NEW.attempts,
                                 'current_driver', NEW.assigned_driver_id,
                                 'status', NEW.status));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dispatch_reassignment_check ON public.delivery_dispatch_jobs;
CREATE TRIGGER dispatch_reassignment_check
AFTER UPDATE ON public.delivery_dispatch_jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_dispatch_reassignment_check();
