
-- =========================================================
-- PHASE 1: RLS HARDENING, CONSTRAINTS, INDEXES
-- =========================================================

-- 1. Extend roles
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';

-- Commit enum additions before they can be used
COMMIT;
BEGIN;

-- 2. has_any_role helper
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  )
$$;

-- 3. New status enum (replace old mpesa_status)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mpesa_status_v2') THEN
    CREATE TYPE public.mpesa_status_v2 AS ENUM
      ('PENDING','PROCESSING','SUCCESS','FAILED','REVERSED','CANCELLED');
  END IF;
END $$;

-- Drop default so we can change column type
ALTER TABLE public.mpesa_transactions ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.mpesa_transactions
  ALTER COLUMN status TYPE public.mpesa_status_v2
  USING (
    CASE status::text
      WHEN 'pending' THEN 'PENDING'
      WHEN 'success' THEN 'SUCCESS'
      WHEN 'failed'  THEN 'FAILED'
      ELSE 'PENDING'
    END
  )::public.mpesa_status_v2;

ALTER TABLE public.mpesa_transactions
  ALTER COLUMN status SET DEFAULT 'PENDING'::public.mpesa_status_v2;

-- Retire old enum
DROP TYPE IF EXISTS public.mpesa_status;
ALTER TYPE public.mpesa_status_v2 RENAME TO mpesa_status;

-- 4. New columns
ALTER TABLE public.mpesa_transactions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'mpesa_daraja',
  ADD COLUMN IF NOT EXISTS transaction_reference text,
  ADD COLUMN IF NOT EXISTS callback_reference text,
  ADD COLUMN IF NOT EXISTS provider_transaction_id text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS corporate_id uuid,
  ADD COLUMN IF NOT EXISTS employee_id uuid,
  ADD COLUMN IF NOT EXISTS trip_id uuid,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS approval_id uuid,
  ADD COLUMN IF NOT EXISTS budget_reservation_id uuid,
  ADD COLUMN IF NOT EXISTS trip_type text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 5. Check constraints
ALTER TABLE public.mpesa_transactions
  DROP CONSTRAINT IF EXISTS mpesa_amount_positive,
  ADD  CONSTRAINT mpesa_amount_positive CHECK (amount_cents > 0);

ALTER TABLE public.mpesa_transactions
  DROP CONSTRAINT IF EXISTS mpesa_currency_allowed,
  ADD  CONSTRAINT mpesa_currency_allowed CHECK (currency IN ('KES','USD','EUR'));

ALTER TABLE public.mpesa_transactions
  DROP CONSTRAINT IF EXISTS mpesa_trip_type_allowed,
  ADD  CONSTRAINT mpesa_trip_type_allowed CHECK (trip_type IS NULL OR trip_type IN ('BUSINESS','PERSONAL'));

-- 6. Unique constraints (partial - allow nulls)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_receipt
  ON public.mpesa_transactions (mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_provider_txn
  ON public.mpesa_transactions (provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_txn_ref
  ON public.mpesa_transactions (transaction_reference) WHERE transaction_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_callback_ref
  ON public.mpesa_transactions (callback_reference) WHERE callback_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mpesa_checkout_request
  ON public.mpesa_transactions (checkout_request_id) WHERE checkout_request_id IS NOT NULL;

-- 7. Performance indexes
CREATE INDEX IF NOT EXISTS ix_mpesa_user_created   ON public.mpesa_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mpesa_status_created ON public.mpesa_transactions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mpesa_corp_created   ON public.mpesa_transactions (corporate_id, created_at DESC) WHERE corporate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mpesa_wallet_created ON public.mpesa_transactions (wallet_id, created_at DESC) WHERE wallet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mpesa_not_deleted    ON public.mpesa_transactions (created_at DESC) WHERE deleted_at IS NULL;

-- 8. RLS hardening
ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mpesa_transactions FORCE ROW LEVEL SECURITY;

-- Drop legacy policies
DROP POLICY IF EXISTS "view own mpesa" ON public.mpesa_transactions;
DROP POLICY IF EXISTS view_own_mpesa_transactions ON public.mpesa_transactions;
DROP POLICY IF EXISTS insert_own_mpesa_transactions ON public.mpesa_transactions;
DROP POLICY IF EXISTS update_mpesa_transactions ON public.mpesa_transactions;
DROP POLICY IF EXISTS delete_mpesa_transactions_admin_only ON public.mpesa_transactions;

-- SELECT
CREATE POLICY view_own_mpesa_transactions
ON public.mpesa_transactions
FOR SELECT
TO authenticated
USING (
  (auth.uid() = user_id AND deleted_at IS NULL)
  OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[])
);

-- INSERT: client may only create their own PENDING row
CREATE POLICY insert_own_mpesa_transactions
ON public.mpesa_transactions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'PENDING'::mpesa_status
  AND mpesa_receipt IS NULL
  AND provider_transaction_id IS NULL
  AND deleted_at IS NULL
);

-- UPDATE: regular users can only touch metadata on own rows; admins/finance can update everything (status changes still gated by transition trigger in Phase 2)
CREATE POLICY update_mpesa_transactions_user_metadata
ON public.mpesa_transactions
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND deleted_at IS NULL)
WITH CHECK (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY update_mpesa_transactions_admin
ON public.mpesa_transactions
FOR UPDATE
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- Column-level: prevent users from modifying financial fields (admins are exempt because we revoke at column level only from non-admin roles via trigger)
CREATE OR REPLACE FUNCTION public.enforce_mpesa_user_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role bypasses all RLS, so this trigger only fires for direct user updates
  IF current_setting('role', true) IN ('service_role') THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RETURN NEW;
  END IF;

  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.mpesa_receipt IS DISTINCT FROM OLD.mpesa_receipt
     OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
     OR NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id
     OR NEW.callback_reference IS DISTINCT FROM OLD.callback_reference
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION 'Users may only update metadata fields on payment records';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mpesa_user_immutable ON public.mpesa_transactions;
CREATE TRIGGER trg_mpesa_user_immutable
BEFORE UPDATE ON public.mpesa_transactions
FOR EACH ROW EXECUTE FUNCTION public.enforce_mpesa_user_immutable_fields();

-- DELETE: deny all (financial records are immutable; soft delete only via service_role/admin RPC)
CREATE POLICY delete_mpesa_transactions_admin_only
ON public.mpesa_transactions
FOR DELETE
TO authenticated
USING (false);

-- Admin soft-delete RPC
CREATE OR REPLACE FUNCTION public.soft_delete_mpesa_transaction(_txn_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only admins may soft-delete payment records';
  END IF;

  UPDATE public.mpesa_transactions
     SET deleted_at = now(),
         admin_notes = COALESCE(admin_notes || E'\n', '') || 'SOFT_DELETED: ' || COALESCE(_reason,'(no reason)')
   WHERE id = _txn_id AND deleted_at IS NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.soft_delete_mpesa_transaction(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.soft_delete_mpesa_transaction(uuid, text) TO authenticated;

-- 9. Grants (re-affirm — RLS still enforces)
GRANT SELECT, INSERT, UPDATE ON public.mpesa_transactions TO authenticated;
GRANT ALL ON public.mpesa_transactions TO service_role;
REVOKE DELETE ON public.mpesa_transactions FROM authenticated;
