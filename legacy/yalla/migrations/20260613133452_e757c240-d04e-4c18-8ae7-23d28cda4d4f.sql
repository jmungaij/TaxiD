
-- =========================================================
-- PHASE 2: AUDIT LOG + EVENT SOURCING + STATUS TRANSITIONS
-- =========================================================

-- 1. Audit event type enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_audit_event') THEN
    CREATE TYPE public.payment_audit_event AS ENUM (
      'INSERT','UPDATE','STATUS_CHANGE','REVERSAL','RECONCILIATION','EXPORT','DELETE_REQUEST','SOFT_DELETE'
    );
  END IF;
END $$;

-- 2. Payment lifecycle event enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_event_type') THEN
    CREATE TYPE public.payment_event_type AS ENUM (
      'PAYMENT_CREATED','PAYMENT_RESERVED','PAYMENT_CALLBACK_RECEIVED','PAYMENT_CONFIRMED',
      'PAYMENT_SETTLED','PAYMENT_FAILED','PAYMENT_REVERSED','PAYMENT_REFUNDED'
    );
  END IF;
END $$;

-- 3. payment_audit_logs
CREATE TABLE IF NOT EXISTS public.payment_audit_logs (
  audit_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.mpesa_transactions(id) ON DELETE RESTRICT,
  event_type    public.payment_audit_event NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  actor_id      uuid,
  actor_type    text NOT NULL DEFAULT 'system',
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_audit_txn      ON public.payment_audit_logs (transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_actor    ON public.payment_audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_event    ON public.payment_audit_logs (event_type, created_at DESC);

GRANT SELECT ON public.payment_audit_logs TO authenticated;
GRANT ALL    ON public.payment_audit_logs TO service_role;

ALTER TABLE public.payment_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_select_own_or_admin ON public.payment_audit_logs;
CREATE POLICY audit_select_own_or_admin
ON public.payment_audit_logs FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[])
  OR EXISTS (
    SELECT 1 FROM public.mpesa_transactions t
    WHERE t.id = payment_audit_logs.transaction_id AND t.user_id = auth.uid()
  )
);

-- No INSERT/UPDATE/DELETE policies → table is read-only for authenticated; only service_role can write
-- (RLS denies everything not explicitly allowed)

-- 4. payment_events
CREATE TABLE IF NOT EXISTS public.payment_events (
  event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.mpesa_transactions(id) ON DELETE RESTRICT,
  event_type     public.payment_event_type NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id       uuid,
  actor_type     text NOT NULL DEFAULT 'system',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_events_txn   ON public.payment_events (transaction_id, created_at);
CREATE INDEX IF NOT EXISTS ix_events_type  ON public.payment_events (event_type, created_at DESC);

GRANT SELECT ON public.payment_events TO authenticated;
GRANT ALL    ON public.payment_events TO service_role;

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_select_own_or_admin ON public.payment_events;
CREATE POLICY events_select_own_or_admin
ON public.payment_events FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[])
  OR EXISTS (
    SELECT 1 FROM public.mpesa_transactions t
    WHERE t.id = payment_events.transaction_id AND t.user_id = auth.uid()
  )
);

-- 5. Status transition guard
CREATE OR REPLACE FUNCTION public.enforce_mpesa_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Permitted transitions
  IF (OLD.status, NEW.status) IN (
       ('PENDING'::mpesa_status,    'PROCESSING'::mpesa_status),
       ('PENDING'::mpesa_status,    'CANCELLED'::mpesa_status),
       ('PENDING'::mpesa_status,    'FAILED'::mpesa_status),
       ('PROCESSING'::mpesa_status, 'SUCCESS'::mpesa_status),
       ('PROCESSING'::mpesa_status, 'FAILED'::mpesa_status),
       ('PROCESSING'::mpesa_status, 'CANCELLED'::mpesa_status),
       ('SUCCESS'::mpesa_status,    'REVERSED'::mpesa_status)
     ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Illegal payment status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mpesa_status_transition ON public.mpesa_transactions;
CREATE TRIGGER trg_mpesa_status_transition
BEFORE UPDATE OF status ON public.mpesa_transactions
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.enforce_mpesa_status_transition();

-- 6. Auto-audit trigger
CREATE OR REPLACE FUNCTION public.log_mpesa_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev public.payment_audit_event;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ev := 'INSERT';
    INSERT INTO public.payment_audit_logs
      (transaction_id, event_type, old_value, new_value, actor_id, actor_type)
    VALUES (NEW.id, ev, NULL, to_jsonb(NEW), auth.uid(),
            CASE WHEN auth.uid() IS NULL THEN 'service' ELSE 'user' END);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      ev := 'STATUS_CHANGE';
    ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      ev := 'SOFT_DELETE';
    ELSE
      ev := 'UPDATE';
    END IF;
    INSERT INTO public.payment_audit_logs
      (transaction_id, event_type, old_value, new_value, actor_id, actor_type)
    VALUES (NEW.id, ev, to_jsonb(OLD), to_jsonb(NEW), auth.uid(),
            CASE WHEN auth.uid() IS NULL THEN 'service' ELSE 'user' END);
    RETURN NEW;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.log_mpesa_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_mpesa_status_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mpesa_audit ON public.mpesa_transactions;
CREATE TRIGGER trg_mpesa_audit
AFTER INSERT OR UPDATE ON public.mpesa_transactions
FOR EACH ROW EXECUTE FUNCTION public.log_mpesa_audit();

-- 7. Helper: emit lifecycle event (used by edge functions via service_role)
CREATE OR REPLACE FUNCTION public.emit_payment_event(
  _txn_id uuid, _type public.payment_event_type, _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.payment_events (transaction_id, event_type, payload, actor_id,
    actor_type)
  VALUES (_txn_id, _type, _payload, auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'service' ELSE 'user' END)
  RETURNING event_id INTO _id;
  RETURN _id;
END $$;

REVOKE EXECUTE ON FUNCTION public.emit_payment_event(uuid, public.payment_event_type, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.emit_payment_event(uuid, public.payment_event_type, jsonb) TO service_role;
