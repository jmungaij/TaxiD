
-- ============ export_audit_log ============
CREATE TABLE IF NOT EXISTS public.export_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email  text,
  dataset      text NOT NULL,
  export_type  text NOT NULL CHECK (export_type IN ('pdf','csv','json','xlsx','zip')),
  row_count    integer,
  byte_size    bigint,
  ip_address   inet,
  user_agent   text,
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','partial')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_audit_log_created_at ON public.export_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_audit_log_actor      ON public.export_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_audit_log_dataset    ON public.export_audit_log (dataset, created_at DESC);

GRANT SELECT, INSERT ON public.export_audit_log TO authenticated;
GRANT ALL ON public.export_audit_log TO service_role;

ALTER TABLE public.export_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins view all export audits"
  ON public.export_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "users insert own export audit"
  ON public.export_audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- ============ mpesa_idempotency_keys ============
CREATE TABLE IF NOT EXISTS public.mpesa_idempotency_keys (
  idempotency_key text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_hash    text NOT NULL,
  response        jsonb,
  status          text NOT NULL DEFAULT 'in_flight' CHECK (status IN ('in_flight','succeeded','failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_mpesa_idem_user    ON public.mpesa_idempotency_keys (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_idem_expires ON public.mpesa_idempotency_keys (expires_at);

GRANT SELECT ON public.mpesa_idempotency_keys TO authenticated;
GRANT ALL ON public.mpesa_idempotency_keys TO service_role;

ALTER TABLE public.mpesa_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own idem keys"
  ON public.mpesa_idempotency_keys FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ============ wallet_transactions: INSERT/UPDATE policies (root cause) ============
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='wallet_transactions' AND policyname='service writes wallet txns') THEN
    CREATE POLICY "service writes wallet txns"
      ON public.wallet_transactions FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='mpesa_transactions' AND policyname='service writes mpesa txns') THEN
    CREATE POLICY "service writes mpesa txns"
      ON public.mpesa_transactions FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;
