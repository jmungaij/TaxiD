
-- ============ IDEMPOTENCY ============
CREATE TABLE public.idempotency_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL,                       -- e.g. 'mpesa-stkpush', 'wallet-credit'
  key         text NOT NULL,
  user_id     uuid,
  request_hash text,
  status      text NOT NULL DEFAULT 'IN_FLIGHT' CHECK (status IN ('IN_FLIGHT','SUCCEEDED','FAILED')),
  response    jsonb,
  http_status int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (scope, key)
);
CREATE INDEX idx_idem_expiry ON public.idempotency_keys(expires_at);
GRANT SELECT ON public.idempotency_keys TO authenticated;
GRANT ALL ON public.idempotency_keys TO service_role;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY "idem_finance_read" ON public.idempotency_keys FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.idempotency_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id      uuid NOT NULL REFERENCES public.idempotency_keys(id) ON DELETE CASCADE,
  event       text NOT NULL,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.idempotency_events TO authenticated;
GRANT ALL ON public.idempotency_events TO service_role;
ALTER TABLE public.idempotency_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_events FORCE ROW LEVEL SECURITY;
CREATE POLICY "idem_ev_finance_read" ON public.idempotency_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============ FRAUD EXPANSION ============
CREATE TYPE public.fraud_signal_kind AS ENUM (
  'DEVICE_CHANGE','IP_CHANGE','VELOCITY','GEO_ANOMALY','PAYMENT_PATTERN','SUSPICIOUS_PHONE','SYNTHETIC_IDENTITY','DRIVER_COLLUSION'
);

CREATE TABLE public.fraud_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  transaction_id uuid REFERENCES public.mpesa_transactions(id),
  kind        public.fraud_signal_kind NOT NULL,
  score       numeric(6,3) NOT NULL DEFAULT 0,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fraud_signals_user ON public.fraud_signals(user_id, created_at DESC);
GRANT SELECT, INSERT ON public.fraud_signals TO authenticated;
GRANT ALL ON public.fraud_signals TO service_role;
ALTER TABLE public.fraud_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY "fraud_signals_finance" ON public.fraud_signals FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.behavioral_scores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  score       numeric(6,3) NOT NULL,
  band        text NOT NULL CHECK (band IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  features    jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_behavior_user_time ON public.behavioral_scores(user_id, computed_at DESC);
GRANT SELECT ON public.behavioral_scores TO authenticated;
GRANT ALL ON public.behavioral_scores TO service_role;
ALTER TABLE public.behavioral_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.behavioral_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY "behavior_finance" ON public.behavioral_scores FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.velocity_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL,        -- user or device id
  subject_kind text NOT NULL,       -- 'user','device','phone'
  window_sec  int NOT NULL,
  count       int NOT NULL,
  threshold   int NOT NULL,
  breached    boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.velocity_checks TO authenticated;
GRANT ALL ON public.velocity_checks TO service_role;
ALTER TABLE public.velocity_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.velocity_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY "velocity_finance" ON public.velocity_checks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.geo_anomalies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  prev_country text,
  current_country text,
  prev_lat numeric, prev_lng numeric,
  cur_lat numeric,  cur_lng numeric,
  distance_km numeric,
  velocity_kmh numeric,
  flagged     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.geo_anomalies TO authenticated;
GRANT ALL ON public.geo_anomalies TO service_role;
ALTER TABLE public.geo_anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_anomalies FORCE ROW LEVEL SECURITY;
CREATE POLICY "geo_finance" ON public.geo_anomalies FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============ CRYPTOGRAPHIC INTEGRITY ============
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.ledger_entries
  ADD COLUMN prev_hash bytea,
  ADD COLUMN entry_hash bytea;

CREATE OR REPLACE FUNCTION public.compute_entry_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _last bytea;
BEGIN
  SELECT entry_hash INTO _last FROM public.ledger_entries
   WHERE entry_hash IS NOT NULL
   ORDER BY created_at DESC, id DESC LIMIT 1;
  NEW.prev_hash := _last;
  NEW.entry_hash := digest(
    coalesce(encode(_last,'hex'),'GENESIS') ||
    '|' || NEW.id::text ||
    '|' || NEW.journal_id::text ||
    '|' || NEW.account_id::text ||
    '|' || NEW.direction::text ||
    '|' || NEW.amount_cents::text ||
    '|' || coalesce(NEW.currency,'') ||
    '|' || coalesce(NEW.transaction_id::text,''),
    'sha256');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ledger_entry_hash
BEFORE INSERT ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.compute_entry_hash();

CREATE TABLE public.digital_signatures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL,   -- 'journal','ledger_entry','settlement','report'
  subject_id  uuid NOT NULL,
  algorithm   text NOT NULL DEFAULT 'sha256',
  key_id      text,
  signature   bytea NOT NULL,
  signed_at   timestamptz NOT NULL DEFAULT now(),
  signed_by   uuid
);
GRANT SELECT ON public.digital_signatures TO authenticated;
GRANT ALL ON public.digital_signatures TO service_role;
ALTER TABLE public.digital_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_signatures FORCE ROW LEVEL SECURITY;
CREATE POLICY "sig_finance" ON public.digital_signatures FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.audit_hashes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of       timestamptz NOT NULL DEFAULT now(),
  chain_root  bytea NOT NULL,
  entry_count int NOT NULL,
  algorithm   text NOT NULL DEFAULT 'sha256',
  notes       text
);
GRANT SELECT ON public.audit_hashes TO authenticated;
GRANT ALL ON public.audit_hashes TO service_role;
ALTER TABLE public.audit_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_hashes FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_hash_finance" ON public.audit_hashes FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- Verify chain
CREATE OR REPLACE FUNCTION public.verify_ledger_chain(_from timestamptz DEFAULT NULL, _to timestamptz DEFAULT NULL)
RETURNS TABLE(broken_entry uuid, expected_prev bytea, actual_prev bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prev bytea := NULL;
  _e record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  FOR _e IN
    SELECT id, prev_hash, entry_hash, created_at FROM public.ledger_entries
    WHERE (_from IS NULL OR created_at >= _from)
      AND (_to   IS NULL OR created_at <= _to)
    ORDER BY created_at, id
  LOOP
    IF _e.prev_hash IS DISTINCT FROM _prev THEN
      broken_entry := _e.id; expected_prev := _prev; actual_prev := _e.prev_hash;
      RETURN NEXT;
    END IF;
    _prev := _e.entry_hash;
  END LOOP;
  RETURN;
END $$;
GRANT EXECUTE ON FUNCTION public.verify_ledger_chain(timestamptz, timestamptz) TO authenticated, service_role;

-- Take a Merkle/chain root snapshot
CREATE OR REPLACE FUNCTION public.snapshot_audit_hash(_notes text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _root bytea; _n int; _id uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT entry_hash, count(*) OVER () INTO _root, _n
  FROM public.ledger_entries WHERE entry_hash IS NOT NULL
  ORDER BY created_at DESC, id DESC LIMIT 1;
  INSERT INTO public.audit_hashes (id, chain_root, entry_count, notes)
  VALUES (_id, COALESCE(_root, '\x00'::bytea), COALESCE(_n,0), _notes);
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.snapshot_audit_hash(text) TO authenticated, service_role;
