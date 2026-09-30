
-- =========================================================
-- PHASE 3: DOUBLE-ENTRY LEDGER + RECONCILIATION
-- =========================================================

-- Enums
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_direction') THEN
    CREATE TYPE public.ledger_direction AS ENUM ('DEBIT','CREDIT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_account_kind') THEN
    CREATE TYPE public.ledger_account_kind AS ENUM (
      'ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','CLEARING','WALLET'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconciliation_status') THEN
    CREATE TYPE public.reconciliation_status AS ENUM ('OK','VARIANCE','PENDING_REVIEW','RESOLVED');
  END IF;
END $$;

-- 1. ledger_accounts (chart of accounts)
CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        public.ledger_account_kind NOT NULL,
  currency    text NOT NULL DEFAULT 'KES',
  wallet_id   uuid REFERENCES public.wallets(id) ON DELETE RESTRICT,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT  ledger_accounts_currency_chk CHECK (currency IN ('KES','USD','EUR'))
);
CREATE INDEX IF NOT EXISTS ix_ledger_accounts_wallet ON public.ledger_accounts(wallet_id);

GRANT SELECT ON public.ledger_accounts TO authenticated;
GRANT ALL    ON public.ledger_accounts TO service_role;
ALTER TABLE public.ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_accounts_select ON public.ledger_accounts;
CREATE POLICY ledger_accounts_select ON public.ledger_accounts FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- Seed system accounts (idempotent)
INSERT INTO public.ledger_accounts (code, name, kind, currency) VALUES
  ('MPESA_CLEARING',   'M-Pesa Clearing',   'CLEARING', 'KES'),
  ('MPESA_FEES',       'M-Pesa Fees',       'EXPENSE',  'KES'),
  ('REVENUE_PLATFORM', 'Platform Revenue',  'REVENUE',  'KES')
ON CONFLICT (code) DO NOTHING;

-- 2. ledger_entries
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id      uuid NOT NULL,
  account_id      uuid NOT NULL REFERENCES public.ledger_accounts(id) ON DELETE RESTRICT,
  direction       public.ledger_direction NOT NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  currency        text NOT NULL DEFAULT 'KES' CHECK (currency IN ('KES','USD','EUR')),
  transaction_id  uuid REFERENCES public.mpesa_transactions(id) ON DELETE RESTRICT,
  memo            text,
  posted_by       uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ledger_journal      ON public.ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS ix_ledger_account_date ON public.ledger_entries(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ledger_txn          ON public.ledger_entries(transaction_id);

GRANT SELECT ON public.ledger_entries TO authenticated;
GRANT ALL    ON public.ledger_entries TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ledger_entries_select ON public.ledger_entries;
CREATE POLICY ledger_entries_select ON public.ledger_entries FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[])
  OR EXISTS (
    SELECT 1 FROM public.ledger_accounts a
    JOIN public.wallets w ON w.id = a.wallet_id
    WHERE a.id = ledger_entries.account_id AND w.user_id = auth.uid()
  )
);

-- Block direct INSERT/UPDATE/DELETE for users (service_role bypasses; FORCE applies to owner)
-- (No policies for write ops = denied)

-- 3. Journal balance enforcement (deferrable via constraint trigger)
CREATE OR REPLACE FUNCTION public.assert_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  imbalanced_rows int;
BEGIN
  -- Check the journal touched by this statement
  SELECT count(*) INTO imbalanced_rows
  FROM (
    SELECT journal_id, currency,
           sum(CASE WHEN direction = 'DEBIT'  THEN amount_cents ELSE 0 END) AS dr,
           sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) AS cr
    FROM public.ledger_entries
    WHERE journal_id = COALESCE(NEW.journal_id, OLD.journal_id)
    GROUP BY journal_id, currency
  ) g
  WHERE g.dr <> g.cr;

  IF imbalanced_rows > 0 THEN
    RAISE EXCEPTION 'Ledger journal % is not balanced (debits must equal credits per currency)',
      COALESCE(NEW.journal_id, OLD.journal_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_journal_balanced ON public.ledger_entries;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
AFTER INSERT OR UPDATE OR DELETE ON public.ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_journal_balanced();

-- Prevent updates/deletes on ledger entries (immutable)
CREATE OR REPLACE FUNCTION public.deny_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable; post a reversing journal instead';
END $$;

DROP TRIGGER IF EXISTS trg_ledger_no_update ON public.ledger_entries;
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE OR DELETE ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.deny_ledger_mutation();

-- 4. Helper: get-or-create the ledger account for a wallet
CREATE OR REPLACE FUNCTION public.get_or_create_wallet_account(_wallet_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _acc_id uuid;
  _w record;
BEGIN
  SELECT id INTO _acc_id FROM public.ledger_accounts WHERE wallet_id = _wallet_id;
  IF _acc_id IS NOT NULL THEN RETURN _acc_id; END IF;

  SELECT id, wallet_type, currency, user_id INTO _w FROM public.wallets WHERE id = _wallet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet % not found', _wallet_id; END IF;

  INSERT INTO public.ledger_accounts (code, name, kind, currency, wallet_id)
  VALUES (
    'WALLET_' || upper(_w.wallet_type::text) || '_' || replace(_wallet_id::text, '-', ''),
    'Wallet ' || _w.wallet_type::text || ' ' || _wallet_id::text,
    'WALLET',
    _w.currency,
    _wallet_id
  )
  RETURNING id INTO _acc_id;
  RETURN _acc_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_wallet_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_or_create_wallet_account(uuid) TO service_role;

-- 5. Post settlement for an mpesa transaction
CREATE OR REPLACE FUNCTION public.post_mpesa_settlement(_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn record;
  _clearing uuid;
  _wallet_acc uuid;
  _journal uuid := gen_random_uuid();
BEGIN
  SELECT * INTO _txn FROM public.mpesa_transactions WHERE id = _txn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction % not found', _txn_id; END IF;
  IF _txn.status <> 'SUCCESS' THEN
    RAISE EXCEPTION 'Cannot settle non-SUCCESS transaction (status=%)', _txn.status;
  END IF;
  IF _txn.wallet_id IS NULL THEN
    RAISE EXCEPTION 'Transaction % has no wallet to settle into', _txn_id;
  END IF;

  -- Idempotency
  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE transaction_id = _txn_id) THEN
    RAISE EXCEPTION 'Transaction % already has ledger entries', _txn_id;
  END IF;

  SELECT id INTO _clearing FROM public.ledger_accounts WHERE code = 'MPESA_CLEARING';
  _wallet_acc := public.get_or_create_wallet_account(_txn.wallet_id);

  INSERT INTO public.ledger_entries (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by)
  VALUES
    (_journal, _clearing,   'DEBIT',  _txn.amount_cents, _txn.currency, _txn_id, 'M-Pesa settlement DR clearing', auth.uid()),
    (_journal, _wallet_acc, 'CREDIT', _txn.amount_cents, _txn.currency, _txn_id, 'M-Pesa settlement CR wallet',   auth.uid());

  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_SETTLED'::payment_event_type,
    jsonb_build_object('journal_id', _journal, 'amount_cents', _txn.amount_cents));

  RETURN _journal;
END $$;

REVOKE EXECUTE ON FUNCTION public.post_mpesa_settlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.post_mpesa_settlement(uuid) TO service_role;

-- 6. Driver payout journal
CREATE OR REPLACE FUNCTION public.post_driver_payout(
  _corporate_wallet uuid, _driver_wallet uuid, _amount_cents bigint, _memo text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _journal uuid := gen_random_uuid();
  _corp uuid := public.get_or_create_wallet_account(_corporate_wallet);
  _drv  uuid := public.get_or_create_wallet_account(_driver_wallet);
BEGIN
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  INSERT INTO public.ledger_entries (journal_id, account_id, direction, amount_cents, currency, memo, posted_by)
  VALUES
    (_journal, _corp, 'DEBIT',  _amount_cents, 'KES', COALESCE(_memo,'Driver payout DR corporate'), auth.uid()),
    (_journal, _drv,  'CREDIT', _amount_cents, 'KES', COALESCE(_memo,'Driver payout CR driver'),    auth.uid());

  RETURN _journal;
END $$;

REVOKE EXECUTE ON FUNCTION public.post_driver_payout(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.post_driver_payout(uuid, uuid, bigint, text) TO service_role;

-- 7. Reversal
CREATE OR REPLACE FUNCTION public.reverse_payment_journal(_txn_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _journal uuid := gen_random_uuid();
  _e record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may reverse payments';
  END IF;

  FOR _e IN
    SELECT * FROM public.ledger_entries WHERE transaction_id = _txn_id
  LOOP
    INSERT INTO public.ledger_entries (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by)
    VALUES (_journal, _e.account_id,
            CASE WHEN _e.direction = 'DEBIT' THEN 'CREDIT'::ledger_direction ELSE 'DEBIT'::ledger_direction END,
            _e.amount_cents, _e.currency, _txn_id,
            'REVERSAL: ' || COALESCE(_reason,''), auth.uid());
  END LOOP;

  UPDATE public.mpesa_transactions SET status = 'REVERSED' WHERE id = _txn_id;

  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_REVERSED'::payment_event_type,
    jsonb_build_object('reason', _reason, 'journal_id', _journal));

  RETURN _journal;
END $$;

REVOKE EXECUTE ON FUNCTION public.reverse_payment_journal(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reverse_payment_journal(uuid, text) TO authenticated;

-- 8. wallet_reconciliation
CREATE TABLE IF NOT EXISTS public.wallet_reconciliation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id         uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  period_start      timestamptz NOT NULL,
  period_end        timestamptz NOT NULL,
  opening_balance   bigint NOT NULL,
  credits           bigint NOT NULL DEFAULT 0,
  debits            bigint NOT NULL DEFAULT 0,
  closing_balance   bigint NOT NULL,
  expected_balance  bigint NOT NULL,
  variance          bigint GENERATED ALWAYS AS (closing_balance - expected_balance) STORED,
  status            public.reconciliation_status NOT NULL DEFAULT 'PENDING_REVIEW',
  notes             text,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallet_recon_period_chk CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS ix_recon_wallet_period ON public.wallet_reconciliation (wallet_id, period_end DESC);
CREATE INDEX IF NOT EXISTS ix_recon_status ON public.wallet_reconciliation (status, period_end DESC);

GRANT SELECT ON public.wallet_reconciliation TO authenticated;
GRANT ALL    ON public.wallet_reconciliation TO service_role;
ALTER TABLE public.wallet_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_reconciliation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_select ON public.wallet_reconciliation;
CREATE POLICY recon_select ON public.wallet_reconciliation FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[])
  OR EXISTS (SELECT 1 FROM public.wallets w WHERE w.id = wallet_reconciliation.wallet_id AND w.user_id = auth.uid())
);

CREATE TRIGGER trg_recon_updated_at BEFORE UPDATE ON public.wallet_reconciliation
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ledger_accounts_updated_at BEFORE UPDATE ON public.ledger_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
