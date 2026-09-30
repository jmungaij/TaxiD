
-- =========================================================================
-- 1. Drop & recreate high-volume tables as RANGE-partitioned
-- =========================================================================

DROP TABLE IF EXISTS public.package_events CASCADE;
DROP TABLE IF EXISTS public.package_tracking CASCADE;
DROP TABLE IF EXISTS public.delivery_route_segments CASCADE;
DROP TABLE IF EXISTS public.delivery_eta_predictions CASCADE;

-- package_events: partition by occurred_at
CREATE TABLE public.package_events (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  package_id    uuid NOT NULL,
  event_type    text NOT NULL,
  actor_id      uuid,
  location_lat  numeric,
  location_lng  numeric,
  notes         text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- package_tracking: partition by recorded_at
CREATE TABLE public.package_tracking (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  package_id   uuid NOT NULL,
  lat          numeric NOT NULL,
  lng          numeric NOT NULL,
  heading      numeric,
  speed_kph    numeric,
  accuracy_m   numeric,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- delivery_route_segments: partition by created_at
CREATE TABLE public.delivery_route_segments (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL,
  segment_index  integer NOT NULL,
  start_lat      numeric, start_lng numeric,
  end_lat        numeric, end_lng numeric,
  distance_m     integer,
  duration_s     integer,
  polyline       text,
  status         text NOT NULL DEFAULT 'pending',
  reached_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- delivery_eta_predictions: partition by created_at
CREATE TABLE public.delivery_eta_predictions (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  package_id     uuid NOT NULL,
  job_id         uuid,
  predicted_eta  timestamptz NOT NULL,
  confidence     numeric,
  model_version  text,
  features       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions (current + 3 forward) + DEFAULT catch-all
DO $$
DECLARE
  parents text[] := ARRAY['package_events','package_tracking','delivery_route_segments','delivery_eta_predictions'];
  parent  text;
  m       int;
  starts  date;
  ends    date;
BEGIN
  FOREACH parent IN ARRAY parents LOOP
    FOR m IN 0..3 LOOP
      starts := date_trunc('month', (date '2026-06-01' + (m || ' month')::interval))::date;
      ends   := (starts + interval '1 month')::date;
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
        parent || '_' || to_char(starts, 'YYYYMM'),
        parent, starts, ends
      );
    END LOOP;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I DEFAULT',
      parent || '_default', parent
    );
  END LOOP;
END $$;

-- Indexes on parents (propagated to partitions)
CREATE INDEX idx_package_events_pkg_time   ON public.package_events(package_id, occurred_at DESC);
CREATE INDEX idx_package_tracking_pkg_time ON public.package_tracking(package_id, recorded_at DESC);
CREATE INDEX idx_route_segments_job_index  ON public.delivery_route_segments(job_id, segment_index);
CREATE INDEX idx_eta_predictions_pkg_time  ON public.delivery_eta_predictions(package_id, created_at DESC);

-- =========================================================================
-- 2. Grants + RLS for partitioned tables
-- =========================================================================
GRANT SELECT, INSERT ON public.package_events           TO authenticated;
GRANT SELECT          ON public.package_events           TO anon;
GRANT ALL             ON public.package_events           TO service_role;

GRANT SELECT, INSERT ON public.package_tracking         TO authenticated;
GRANT SELECT          ON public.package_tracking         TO anon;
GRANT ALL             ON public.package_tracking         TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.delivery_route_segments TO authenticated;
GRANT ALL             ON public.delivery_route_segments  TO service_role;

GRANT SELECT, INSERT ON public.delivery_eta_predictions TO authenticated;
GRANT SELECT          ON public.delivery_eta_predictions TO anon;
GRANT ALL             ON public.delivery_eta_predictions TO service_role;

ALTER TABLE public.package_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_tracking         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_route_segments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_eta_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pkg events read auth"    ON public.package_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pkg events anon read"    ON public.package_events FOR SELECT TO anon USING (true);
CREATE POLICY "Pkg events insert auth"  ON public.package_events FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Tracking read auth"      ON public.package_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tracking anon read"      ON public.package_tracking FOR SELECT TO anon USING (true);
CREATE POLICY "Tracking insert auth"    ON public.package_tracking FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Segments read auth"      ON public.delivery_route_segments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Segments write auth"     ON public.delivery_route_segments FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Segments update auth"    ON public.delivery_route_segments FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "ETA read auth"           ON public.delivery_eta_predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "ETA anon read"           ON public.delivery_eta_predictions FOR SELECT TO anon USING (true);
CREATE POLICY "ETA insert auth"         ON public.delivery_eta_predictions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- =========================================================================
-- 3. Reapply immutability on package_events
-- =========================================================================
DROP TRIGGER IF EXISTS package_events_no_update ON public.package_events;
DROP TRIGGER IF EXISTS package_events_no_delete ON public.package_events;
CREATE TRIGGER package_events_no_update BEFORE UPDATE ON public.package_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_mutation();
CREATE TRIGGER package_events_no_delete BEFORE DELETE ON public.package_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_mutation();

-- =========================================================================
-- 4. Fraud signals
-- =========================================================================
CREATE TABLE public.delivery_fraud_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type  text NOT NULL,
  severity     text NOT NULL DEFAULT 'medium',
  package_id   uuid,
  pod_id       uuid,
  job_id       uuid,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open',
  reviewer_id  uuid,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fraud_signals_status ON public.delivery_fraud_signals(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.delivery_fraud_signals TO authenticated;
GRANT ALL ON public.delivery_fraud_signals TO service_role;

ALTER TABLE public.delivery_fraud_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Fraud signals admin read"   ON public.delivery_fraud_signals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Fraud signals system insert" ON public.delivery_fraud_signals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Fraud signals admin update" ON public.delivery_fraud_signals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- haversine helper
CREATE OR REPLACE FUNCTION public.haversine_km(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT 6371 * 2 * asin(
    sqrt(
      sin(radians(coalesce(lat2,0) - coalesce(lat1,0))/2)^2
      + cos(radians(coalesce(lat1,0))) * cos(radians(coalesce(lat2,0)))
        * sin(radians(coalesce(lng2,0) - coalesce(lng1,0))/2)^2
    )
  )::numeric;
$$;

-- POD fraud trigger: duplicate + geo-distance
CREATE OR REPLACE FUNCTION public.tg_pod_fraud_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  dup_count int;
  pkg record;
  dist_km numeric;
BEGIN
  SELECT count(*) INTO dup_count FROM public.proof_of_delivery WHERE package_id = NEW.package_id AND id <> NEW.id;
  IF dup_count > 0 THEN
    INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, pod_id, details)
    VALUES ('duplicate_pod', 'high', NEW.package_id, NEW.id,
            jsonb_build_object('duplicate_count', dup_count));
  END IF;

  SELECT dropoff_lat, dropoff_lng INTO pkg FROM public.packages WHERE id = NEW.package_id;
  IF pkg.dropoff_lat IS NOT NULL AND NEW.delivered_lat IS NOT NULL THEN
    dist_km := public.haversine_km(pkg.dropoff_lat, pkg.dropoff_lng, NEW.delivered_lat, NEW.delivered_lng);
    IF dist_km > 5 THEN
      INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, pod_id, details)
      VALUES ('impossible_geolocation',
              CASE WHEN dist_km > 50 THEN 'critical' ELSE 'high' END,
              NEW.package_id, NEW.id,
              jsonb_build_object('distance_km', dist_km,
                                 'expected', jsonb_build_object('lat', pkg.dropoff_lat, 'lng', pkg.dropoff_lng),
                                 'actual',   jsonb_build_object('lat', NEW.delivered_lat, 'lng', NEW.delivered_lng)));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pod_fraud_check ON public.proof_of_delivery;
CREATE TRIGGER pod_fraud_check AFTER INSERT ON public.proof_of_delivery
  FOR EACH ROW EXECUTE FUNCTION public.tg_pod_fraud_check();

-- ETA anomaly trigger
CREATE OR REPLACE FUNCTION public.tg_eta_anomaly_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  prev_eta timestamptz;
  delta_min numeric;
BEGIN
  SELECT predicted_eta INTO prev_eta
  FROM public.delivery_eta_predictions
  WHERE package_id = NEW.package_id AND id <> NEW.id
  ORDER BY created_at DESC LIMIT 1;

  IF prev_eta IS NOT NULL THEN
    delta_min := abs(extract(epoch FROM (NEW.predicted_eta - prev_eta)) / 60);
    IF delta_min > 30 THEN
      INSERT INTO public.delivery_fraud_signals(signal_type, severity, package_id, job_id, details)
      VALUES ('eta_anomaly',
              CASE WHEN delta_min > 120 THEN 'high' ELSE 'medium' END,
              NEW.package_id, NEW.job_id,
              jsonb_build_object('delta_minutes', delta_min,
                                 'previous_eta', prev_eta,
                                 'new_eta', NEW.predicted_eta));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS eta_anomaly_check ON public.delivery_eta_predictions;
CREATE TRIGGER eta_anomaly_check AFTER INSERT ON public.delivery_eta_predictions
  FOR EACH ROW EXECUTE FUNCTION public.tg_eta_anomaly_check();

-- =========================================================================
-- 5. Event outbox
-- =========================================================================
CREATE TABLE public.event_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate     text NOT NULL,           -- 'package_event' | 'proof_of_delivery'
  aggregate_id  uuid NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  dedupe_key    text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'pending',
  attempts      int  NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outbox_pending ON public.event_outbox(status, next_attempt_at) WHERE status = 'pending';

GRANT SELECT ON public.event_outbox TO authenticated;
GRANT ALL ON public.event_outbox TO service_role;
ALTER TABLE public.event_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Outbox admin read" ON public.event_outbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- Enqueue triggers
CREATE OR REPLACE FUNCTION public.tg_enqueue_pkg_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.event_outbox(aggregate, aggregate_id, event_type, payload, dedupe_key)
  VALUES ('package_event', NEW.id, NEW.event_type,
          jsonb_build_object('package_id', NEW.package_id, 'event_type', NEW.event_type,
                             'occurred_at', NEW.occurred_at, 'metadata', NEW.metadata, 'notes', NEW.notes),
          'pkg_event:' || NEW.id::text)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enqueue_pkg_event AFTER INSERT ON public.package_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_pkg_event();

CREATE OR REPLACE FUNCTION public.tg_enqueue_pod()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.event_outbox(aggregate, aggregate_id, event_type, payload, dedupe_key)
  VALUES ('proof_of_delivery', NEW.id, 'pod_captured',
          jsonb_build_object('package_id', NEW.package_id, 'recipient_name', NEW.recipient_name,
                             'has_photo', NEW.photo_url IS NOT NULL,
                             'has_signature', NEW.signature_url IS NOT NULL,
                             'delivered_at', NEW.created_at,
                             'lat', NEW.delivered_lat, 'lng', NEW.delivered_lng),
          'pod:' || NEW.id::text)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enqueue_pod AFTER INSERT ON public.proof_of_delivery
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_pod();

-- =========================================================================
-- 6. Realtime publication
-- =========================================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_route_segments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_eta_predictions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.package_tracking;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.delivery_fraud_signals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
