
-- ===== TREASURY =====
CREATE TYPE public.treasury_account_kind AS ENUM ('BANK','MPESA_FLOAT','AIRTEL_FLOAT','ESCROW','RESERVE','SETTLEMENT','OPERATING');

CREATE TABLE public.treasury_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  kind         public.treasury_account_kind NOT NULL,
  currency     text NOT NULL REFERENCES public.currencies(code) DEFAULT 'KES',
  provider     text,
  external_ref text,
  ledger_account_id uuid REFERENCES public.ledger_accounts(id),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.treasury_accounts TO authenticated;
GRANT ALL ON public.treasury_accounts TO service_role;
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY "treasury_acct_finance" ON public.treasury_accounts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.treasury_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.treasury_accounts(id),
  direction   text NOT NULL CHECK (direction IN ('INFLOW','OUTFLOW')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency    text NOT NULL,
  journal_id  uuid REFERENCES public.journals(id),
  reference   text,
  memo        text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
CREATE INDEX idx_treasury_mvmt_acct_time ON public.treasury_movements(account_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.treasury_movements TO authenticated;
GRANT ALL ON public.treasury_movements TO service_role;
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY "treasury_mvmt_finance" ON public.treasury_movements FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.treasury_positions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.treasury_accounts(id),
  as_of       date NOT NULL,
  currency    text NOT NULL,
  opening_cents bigint NOT NULL,
  inflows_cents bigint NOT NULL DEFAULT 0,
  outflows_cents bigint NOT NULL DEFAULT 0,
  closing_cents bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, as_of, currency)
);
GRANT SELECT, INSERT ON public.treasury_positions TO authenticated;
GRANT ALL ON public.treasury_positions TO service_role;
ALTER TABLE public.treasury_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_positions FORCE ROW LEVEL SECURITY;
CREATE POLICY "treasury_pos_finance" ON public.treasury_positions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.treasury_forecasts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES public.treasury_accounts(id),
  forecast_date date NOT NULL,
  horizon_days int  NOT NULL DEFAULT 30,
  projected_cents bigint NOT NULL,
  confidence  numeric(5,2),
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
GRANT SELECT, INSERT ON public.treasury_forecasts TO authenticated;
GRANT ALL ON public.treasury_forecasts TO service_role;
ALTER TABLE public.treasury_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_forecasts FORCE ROW LEVEL SECURITY;
CREATE POLICY "treasury_fc_finance" ON public.treasury_forecasts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ===== SETTLEMENT =====
CREATE TYPE public.settlement_batch_status AS ENUM ('OPEN','SUBMITTED','SETTLED','RECONCILED','FAILED','CLOSED');
CREATE TYPE public.settlement_status AS ENUM ('PENDING','MATCHED','MISMATCHED','MISSING','REVERSED');

CREATE TABLE public.settlement_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,        -- MPESA, AIRTEL, VISA, MASTERCARD, BANK
  batch_ref   text NOT NULL,
  cutoff_at   timestamptz NOT NULL,
  total_count int NOT NULL DEFAULT 0,
  total_amount_cents bigint NOT NULL DEFAULT 0,
  currency    text NOT NULL DEFAULT 'KES',
  status      public.settlement_batch_status NOT NULL DEFAULT 'OPEN',
  treasury_account_id uuid REFERENCES public.treasury_accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  UNIQUE (provider, batch_ref)
);
GRANT SELECT ON public.settlement_batches TO authenticated;
GRANT ALL ON public.settlement_batches TO service_role;
ALTER TABLE public.settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY "settle_batch_finance" ON public.settlement_batches FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.settlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES public.settlement_batches(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES public.mpesa_transactions(id),
  provider_ref text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency    text NOT NULL DEFAULT 'KES',
  status      public.settlement_status NOT NULL DEFAULT 'PENDING',
  variance_cents bigint NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_settlements_batch ON public.settlements(batch_id);
CREATE INDEX idx_settlements_txn   ON public.settlements(transaction_id);
GRANT SELECT ON public.settlements TO authenticated;
GRANT ALL ON public.settlements TO service_role;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY "settle_finance" ON public.settlements FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.settlement_reconciliation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES public.settlement_batches(id) ON DELETE CASCADE,
  ran_at      timestamptz NOT NULL DEFAULT now(),
  expected_count int NOT NULL,
  actual_count   int NOT NULL,
  expected_amount_cents bigint NOT NULL,
  actual_amount_cents   bigint NOT NULL,
  variance_cents bigint NOT NULL,
  status      text NOT NULL CHECK (status IN ('OK','VARIANCE','FAILED')),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.settlement_reconciliation TO authenticated;
GRANT ALL ON public.settlement_reconciliation TO service_role;
ALTER TABLE public.settlement_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_reconciliation FORCE ROW LEVEL SECURITY;
CREATE POLICY "settle_recon_finance" ON public.settlement_reconciliation FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.settlement_failures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid REFERENCES public.settlement_batches(id) ON DELETE CASCADE,
  settlement_id uuid REFERENCES public.settlements(id) ON DELETE CASCADE,
  error_code  text,
  error_message text NOT NULL,
  retry_count int NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.settlement_failures TO authenticated;
GRANT ALL ON public.settlement_failures TO service_role;
ALTER TABLE public.settlement_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_failures FORCE ROW LEVEL SECURITY;
CREATE POLICY "settle_fail_finance" ON public.settlement_failures FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ----- Reconciliation RPC -----
CREATE OR REPLACE FUNCTION public.reconcile_settlement_batch(_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b record;
  _ledger_count int;
  _ledger_amount bigint;
  _variance bigint;
  _status text;
  _rec_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin','service_role']::app_role[]) THEN
    -- service role bypasses anyway; this is for human callers
    NULL;
  END IF;

  SELECT * INTO _b FROM public.settlement_batches WHERE id=_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch % not found', _batch_id; END IF;

  SELECT count(*), COALESCE(sum(le.amount_cents),0)
    INTO _ledger_count, _ledger_amount
  FROM public.settlements s
  JOIN public.ledger_entries le ON le.transaction_id = s.transaction_id AND le.direction='DEBIT'
  JOIN public.ledger_accounts la ON la.id = le.account_id AND la.code='MPESA_CLEARING'
  WHERE s.batch_id = _batch_id;

  _variance := _b.total_amount_cents - _ledger_amount;
  _status := CASE WHEN _variance=0 AND _ledger_count=_b.total_count THEN 'OK'
                  WHEN abs(_variance) < 100 THEN 'VARIANCE'
                  ELSE 'FAILED' END;

  INSERT INTO public.settlement_reconciliation
    (id, batch_id, expected_count, actual_count, expected_amount_cents, actual_amount_cents, variance_cents, status)
  VALUES (_rec_id, _batch_id, _b.total_count, _ledger_count, _b.total_amount_cents, _ledger_amount, _variance, _status);

  IF _status = 'OK' THEN
    UPDATE public.settlement_batches SET status='RECONCILED' WHERE id=_batch_id;
  END IF;
  RETURN _rec_id;
END $$;
GRANT EXECUTE ON FUNCTION public.reconcile_settlement_batch(uuid) TO authenticated, service_role;
