
-- =========================================================
-- PHASE 4: FRAUD SIGNALS + METRICS VIEW
-- =========================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_severity') THEN
    CREATE TYPE public.risk_severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.payment_risk_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES public.mpesa_transactions(id) ON DELETE RESTRICT,
  rule            text NOT NULL,
  severity        public.risk_severity NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  resolution      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_risk_txn      ON public.payment_risk_events(transaction_id);
CREATE INDEX IF NOT EXISTS ix_risk_severity ON public.payment_risk_events(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_risk_unreviewed
  ON public.payment_risk_events(created_at DESC) WHERE reviewed_at IS NULL;

GRANT SELECT, UPDATE ON public.payment_risk_events TO authenticated;
GRANT ALL ON public.payment_risk_events TO service_role;
ALTER TABLE public.payment_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_risk_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS risk_select_admin ON public.payment_risk_events;
CREATE POLICY risk_select_admin ON public.payment_risk_events FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

DROP POLICY IF EXISTS risk_update_admin ON public.payment_risk_events;
CREATE POLICY risk_update_admin ON public.payment_risk_events FOR UPDATE TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- Risk scanner trigger
CREATE OR REPLACE FUNCTION public.scan_payment_risk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_attempts int;
BEGIN
  -- 1. Duplicate receipt
  IF NEW.mpesa_receipt IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.mpesa_receipt IS DISTINCT FROM NEW.mpesa_receipt) THEN
    IF EXISTS (
      SELECT 1 FROM public.mpesa_transactions
      WHERE mpesa_receipt = NEW.mpesa_receipt AND id <> NEW.id
    ) THEN
      INSERT INTO public.payment_risk_events (transaction_id, rule, severity, details)
      VALUES (NEW.id, 'duplicate_receipt', 'CRITICAL',
        jsonb_build_object('receipt', NEW.mpesa_receipt));
    END IF;
  END IF;

  -- 2. Velocity: more than 5 attempts per user per minute
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO recent_attempts
    FROM public.mpesa_transactions
    WHERE user_id = NEW.user_id AND created_at > now() - interval '1 minute';

    IF recent_attempts > 5 THEN
      INSERT INTO public.payment_risk_events (transaction_id, rule, severity, details)
      VALUES (NEW.id, 'velocity_exceeded', 'HIGH',
        jsonb_build_object('attempts_last_minute', recent_attempts));
    END IF;
  END IF;

  -- 3. Large amount (over 1,000,000 KES = 100,000,000 cents)
  IF NEW.amount_cents > 100000000 THEN
    INSERT INTO public.payment_risk_events (transaction_id, rule, severity, details)
    VALUES (NEW.id, 'large_amount', 'MEDIUM',
      jsonb_build_object('amount_cents', NEW.amount_cents, 'currency', NEW.currency));
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.scan_payment_risk() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_risk_scan ON public.mpesa_transactions;
CREATE TRIGGER trg_payment_risk_scan
AFTER INSERT OR UPDATE OF mpesa_receipt, amount_cents ON public.mpesa_transactions
FOR EACH ROW EXECUTE FUNCTION public.scan_payment_risk();

-- =========================================================
-- METRICS VIEW
-- =========================================================
CREATE OR REPLACE VIEW public.payment_metrics
WITH (security_invoker = true) AS
SELECT
  date_trunc('day', created_at) AS day,
  currency,
  status,
  count(*)                       AS txn_count,
  sum(amount_cents)              AS amount_cents_total,
  avg(EXTRACT(EPOCH FROM (updated_at - created_at))) AS avg_settle_seconds
FROM public.mpesa_transactions
WHERE deleted_at IS NULL
GROUP BY 1,2,3;

GRANT SELECT ON public.payment_metrics TO authenticated;
