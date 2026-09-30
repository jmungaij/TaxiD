
-- =========================================================
-- PHASE 1: LEDGER FOUNDATION
-- Chart of Accounts + Journals + Posting Engine + Snapshots
-- =========================================================

-- ---------- 1. CHART OF ACCOUNTS ----------
CREATE TYPE public.coa_type AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');
CREATE TYPE public.coa_normal_side AS ENUM ('DEBIT','CREDIT');

CREATE TABLE public.chart_of_accounts (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  account_type public.coa_type NOT NULL,
  normal_side public.coa_normal_side NOT NULL,
  parent_code text REFERENCES public.chart_of_accounts(code),
  is_postable boolean NOT NULL DEFAULT true, -- false for roll-up parents
  currency    text,                          -- null = multi-currency
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.chart_of_accounts TO authenticated;
GRANT ALL ON public.chart_of_accounts TO service_role;
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY "coa_read_authenticated" ON public.chart_of_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "coa_admin_manage" ON public.chart_of_accounts FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- Seed canonical hierarchy (parents first)
INSERT INTO public.chart_of_accounts (code,name,account_type,normal_side,parent_code,is_postable) VALUES
('1000','Assets','ASSET','DEBIT',NULL,false),
('1100','Cash','ASSET','DEBIT','1000',false),
('1110','Bank Accounts','ASSET','DEBIT','1100',true),
('1120','MPESA Float','ASSET','DEBIT','1100',true),
('1130','Escrow Accounts','ASSET','DEBIT','1100',true),
('1140','MPESA Clearing','ASSET','DEBIT','1100',true),
('1200','Receivables','ASSET','DEBIT','1000',false),
('1210','Corporate Receivables','ASSET','DEBIT','1200',true),
('1300','Driver Advances','ASSET','DEBIT','1000',true),
('1400','Wallet Assets (Riders/Drivers/Corporate)','ASSET','DEBIT','1000',false),
('1410','Personal Wallet Holdings','ASSET','DEBIT','1400',true),
('1420','Corporate Wallet Holdings','ASSET','DEBIT','1400',true),
('1430','Driver Wallet Holdings','ASSET','DEBIT','1400',true),
('1440','Treasury Wallet Holdings','ASSET','DEBIT','1400',true),

('2000','Liabilities','LIABILITY','CREDIT',NULL,false),
('2100','Driver Payables','LIABILITY','CREDIT','2000',true),
('2200','Tax Payables','LIABILITY','CREDIT','2000',false),
('2210','VAT Payable','LIABILITY','CREDIT','2200',true),
('2220','Withholding Tax Payable','LIABILITY','CREDIT','2200',true),
('2300','Deferred Revenue','LIABILITY','CREDIT','2000',true),
('2400','Customer Wallet Liabilities','LIABILITY','CREDIT','2000',false),
('2410','Rider Wallet Liability','LIABILITY','CREDIT','2400',true),
('2420','Corporate Wallet Liability','LIABILITY','CREDIT','2400',true),

('3000','Equity','EQUITY','CREDIT',NULL,false),
('3100','Retained Earnings','EQUITY','CREDIT','3000',true),

('4000','Revenue','REVENUE','CREDIT',NULL,false),
('4100','Ride Revenue','REVENUE','CREDIT','4000',true),
('4200','Delivery Revenue','REVENUE','CREDIT','4000',true),
('4300','Rental Revenue','REVENUE','CREDIT','4000',true),
('4400','Commission Income','REVENUE','CREDIT','4000',true),

('5000','Expenses','EXPENSE','DEBIT',NULL,false),
('5100','Driver Expense','EXPENSE','DEBIT','5000',true),
('5200','Corporate Travel Expense','EXPENSE','DEBIT','5000',true),
('5300','Platform Operations','EXPENSE','DEBIT','5000',true),
('5400','FX Gain/Loss','EXPENSE','DEBIT','5000',true);

-- Link existing ledger_accounts to COA
ALTER TABLE public.ledger_accounts ADD COLUMN coa_code text REFERENCES public.chart_of_accounts(code);
UPDATE public.ledger_accounts SET coa_code = '1140' WHERE code = 'MPESA_CLEARING';
UPDATE public.ledger_accounts SET coa_code = CASE
  WHEN code LIKE 'WALLET_PERSONAL_%'  THEN '2410'
  WHEN code LIKE 'WALLET_CORPORATE_%' THEN '2420'
  WHEN code LIKE 'WALLET_DRIVER_%'    THEN '2100'
  WHEN code LIKE 'WALLET_TREASURY_%'  THEN '1440'
  ELSE coa_code
END WHERE coa_code IS NULL AND code LIKE 'WALLET_%';

-- ---------- 2. JOURNALS + JOURNAL LINES ----------
CREATE TYPE public.journal_status AS ENUM ('DRAFT','POSTED','REVERSED');
CREATE TYPE public.journal_source AS ENUM (
  'MPESA_SETTLEMENT','MPESA_REVERSAL','DRIVER_PAYOUT',
  'CORPORATE_TRANSFER','RIDE_COMPLETION','MANUAL_ADJUSTMENT',
  'FX_REVALUATION','SETTLEMENT_BATCH','OTHER'
);

CREATE TABLE public.journals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       public.journal_source NOT NULL DEFAULT 'OTHER',
  reference    text,                       -- external correlation id
  description  text,
  status       public.journal_status NOT NULL DEFAULT 'DRAFT',
  posted_at    timestamptz,
  posted_by    uuid,
  reverses_journal_id uuid REFERENCES public.journals(id),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_journals_status      ON public.journals(status);
CREATE INDEX idx_journals_source_ref  ON public.journals(source, reference);
CREATE INDEX idx_journals_reverses    ON public.journals(reverses_journal_id);

GRANT SELECT ON public.journals TO authenticated;
GRANT ALL ON public.journals TO service_role;
ALTER TABLE public.journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journals FORCE ROW LEVEL SECURITY;
CREATE POLICY "journals_read_admins" ON public.journals FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- Backfill journals from existing ledger entries
INSERT INTO public.journals (id, source, status, posted_at, posted_by, description)
SELECT DISTINCT le.journal_id,
       'MPESA_SETTLEMENT'::public.journal_source,
       'POSTED'::public.journal_status,
       min(le.created_at) OVER (PARTITION BY le.journal_id),
       le.posted_by,
       'Backfilled from legacy ledger entries'
FROM public.ledger_entries le
ON CONFLICT (id) DO NOTHING;

-- Promote journal_id to FK
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_journal_fk
  FOREIGN KEY (journal_id) REFERENCES public.journals(id) DEFERRABLE INITIALLY DEFERRED;

-- Block direct status mutation paths outside posting engine
CREATE OR REPLACE FUNCTION public.assert_journal_status_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) IN (
       ('DRAFT','POSTED'),
       ('POSTED','REVERSED')
     ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Illegal journal status transition: % -> %', OLD.status, NEW.status;
END $$;

CREATE TRIGGER trg_journal_status_transition
BEFORE UPDATE OF status ON public.journals
FOR EACH ROW EXECUTE FUNCTION public.assert_journal_status_transition();

-- Once posted, lines are sealed: prevent new entries on a POSTED journal
CREATE OR REPLACE FUNCTION public.assert_journal_open_for_entries()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _status public.journal_status;
BEGIN
  SELECT status INTO _status FROM public.journals WHERE id = NEW.journal_id;
  IF _status IS NULL THEN
    -- Allow legacy inserts where journal record not yet created (during transactional posting)
    RETURN NEW;
  END IF;
  IF _status = 'POSTED' THEN
    RAISE EXCEPTION 'Cannot append ledger entries to a POSTED journal (%)', NEW.journal_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ledger_entries_journal_open
BEFORE INSERT ON public.ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.assert_journal_open_for_entries();

-- ---------- 3. POSTING ENGINE ----------
-- Single authoritative entry point. Validates balance, account validity,
-- then transitions journal DRAFT -> POSTED atomically.
CREATE OR REPLACE FUNCTION public.posting_engine_post(_journal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _j record;
  _bad int;
  _line_count int;
BEGIN
  SELECT * INTO _j FROM public.journals WHERE id = _journal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal % not found', _journal_id; END IF;
  IF _j.status <> 'DRAFT' THEN RAISE EXCEPTION 'Journal % is not DRAFT (status=%)', _journal_id, _j.status; END IF;

  SELECT count(*) INTO _line_count FROM public.ledger_entries WHERE journal_id = _journal_id;
  IF _line_count < 2 THEN RAISE EXCEPTION 'Journal % must contain at least 2 lines', _journal_id; END IF;

  -- All accounts must be active + postable + linked to a postable COA
  SELECT count(*) INTO _bad
  FROM public.ledger_entries e
  JOIN public.ledger_accounts a ON a.id = e.account_id
  LEFT JOIN public.chart_of_accounts c ON c.code = a.coa_code
  WHERE e.journal_id = _journal_id
    AND (
      a.active IS DISTINCT FROM true
      OR a.coa_code IS NULL
      OR c.is_postable = false
      OR c.active = false
    );
  IF _bad > 0 THEN RAISE EXCEPTION 'Journal % references invalid/non-postable accounts', _journal_id; END IF;

  -- Balance check per currency (deferred trigger also enforces, but fail early)
  IF EXISTS (
    SELECT 1 FROM (
      SELECT currency,
             sum(CASE WHEN direction='DEBIT'  THEN amount_cents ELSE 0 END) dr,
             sum(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END) cr
      FROM public.ledger_entries WHERE journal_id = _journal_id GROUP BY currency
    ) g WHERE dr <> cr
  ) THEN RAISE EXCEPTION 'Journal % is unbalanced', _journal_id; END IF;

  UPDATE public.journals
     SET status='POSTED', posted_at=now(), posted_by=auth.uid()
   WHERE id = _journal_id;

  RETURN _journal_id;
END $$;
GRANT EXECUTE ON FUNCTION public.posting_engine_post(uuid) TO authenticated, service_role;

-- ---------- 4. REWRITE post_mpesa_settlement / post_driver_payout / reverse_payment_journal ----------
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
  IF _txn.status <> 'SUCCESS' THEN RAISE EXCEPTION 'Cannot settle status=%', _txn.status; END IF;
  IF _txn.wallet_id IS NULL THEN RAISE EXCEPTION 'Transaction % has no wallet', _txn_id; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE transaction_id = _txn_id) THEN
    RAISE EXCEPTION 'Transaction % already settled', _txn_id;
  END IF;

  SELECT id INTO _clearing FROM public.ledger_accounts WHERE code = 'MPESA_CLEARING';
  _wallet_acc := public.get_or_create_wallet_account(_txn.wallet_id);

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (_journal, 'MPESA_SETTLEMENT', _txn.mpesa_receipt,
          'M-Pesa settlement '||COALESCE(_txn.mpesa_receipt,_txn_id::text), auth.uid());

  INSERT INTO public.ledger_entries (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by) VALUES
    (_journal, _clearing,   'DEBIT',  _txn.amount_cents, _txn.currency, _txn_id, 'DR M-Pesa clearing', auth.uid()),
    (_journal, _wallet_acc, 'CREDIT', _txn.amount_cents, _txn.currency, _txn_id, 'CR wallet',          auth.uid());

  PERFORM public.posting_engine_post(_journal);
  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_SETTLED'::payment_event_type,
    jsonb_build_object('journal_id', _journal, 'amount_cents', _txn.amount_cents));
  RETURN _journal;
END $$;

CREATE OR REPLACE FUNCTION public.post_driver_payout(_corporate_wallet uuid, _driver_wallet uuid, _amount_cents bigint, _memo text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _journal uuid := gen_random_uuid();
  _corp uuid := public.get_or_create_wallet_account(_corporate_wallet);
  _drv  uuid := public.get_or_create_wallet_account(_driver_wallet);
BEGIN
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  INSERT INTO public.journals (id, source, description, created_by)
  VALUES (_journal, 'DRIVER_PAYOUT', COALESCE(_memo,'Driver payout'), auth.uid());
  INSERT INTO public.ledger_entries (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (_journal, _corp, 'DEBIT',  _amount_cents, 'KES', COALESCE(_memo,'DR corporate'), auth.uid()),
    (_journal, _drv,  'CREDIT', _amount_cents, 'KES', COALESCE(_memo,'CR driver'),    auth.uid());
  PERFORM public.posting_engine_post(_journal);
  RETURN _journal;
END $$;

CREATE OR REPLACE FUNCTION public.reverse_payment_journal(_txn_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _journal uuid := gen_random_uuid();
  _orig uuid;
  _e record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may reverse payments';
  END IF;

  SELECT DISTINCT journal_id INTO _orig FROM public.ledger_entries WHERE transaction_id = _txn_id LIMIT 1;

  INSERT INTO public.journals (id, source, description, reverses_journal_id, created_by)
  VALUES (_journal, 'MPESA_REVERSAL', 'REVERSAL: '||COALESCE(_reason,''), _orig, auth.uid());

  FOR _e IN SELECT * FROM public.ledger_entries WHERE transaction_id = _txn_id AND journal_id = _orig LOOP
    INSERT INTO public.ledger_entries (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by)
    VALUES (_journal, _e.account_id,
            CASE WHEN _e.direction='DEBIT' THEN 'CREDIT'::ledger_direction ELSE 'DEBIT'::ledger_direction END,
            _e.amount_cents, _e.currency, _txn_id,
            'REVERSAL: '||COALESCE(_reason,''), auth.uid());
  END LOOP;

  PERFORM public.posting_engine_post(_journal);
  IF _orig IS NOT NULL THEN
    UPDATE public.journals SET status='REVERSED' WHERE id=_orig;
  END IF;
  UPDATE public.mpesa_transactions SET status='REVERSED' WHERE id=_txn_id;
  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_REVERSED'::payment_event_type,
    jsonb_build_object('reason',_reason,'journal_id',_journal));
  RETURN _journal;
END $$;

-- ---------- 5. LEDGER SNAPSHOTS (point-in-time balances) ----------
CREATE TABLE public.ledger_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of       timestamptz NOT NULL,
  account_id  uuid NOT NULL REFERENCES public.ledger_accounts(id),
  currency    text NOT NULL,
  debits_cents  bigint NOT NULL,
  credits_cents bigint NOT NULL,
  balance_cents bigint NOT NULL, -- signed per normal_side
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (as_of, account_id, currency)
);
GRANT SELECT ON public.ledger_snapshots TO authenticated;
GRANT ALL ON public.ledger_snapshots TO service_role;
ALTER TABLE public.ledger_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY "snapshots_read_admins" ON public.ledger_snapshots FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.take_ledger_snapshot(_as_of timestamptz DEFAULT now())
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  WITH agg AS (
    SELECT e.account_id, e.currency,
           sum(CASE WHEN e.direction='DEBIT'  THEN e.amount_cents ELSE 0 END) dr,
           sum(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) cr
    FROM public.ledger_entries e
    JOIN public.journals j ON j.id = e.journal_id AND j.status = 'POSTED'
    WHERE e.created_at <= _as_of
    GROUP BY e.account_id, e.currency
  )
  INSERT INTO public.ledger_snapshots (as_of, account_id, currency, debits_cents, credits_cents, balance_cents, created_by)
  SELECT _as_of, agg.account_id, agg.currency, agg.dr, agg.cr,
         CASE WHEN c.normal_side='DEBIT' THEN agg.dr - agg.cr ELSE agg.cr - agg.dr END,
         auth.uid()
  FROM agg
  JOIN public.ledger_accounts la ON la.id = agg.account_id
  LEFT JOIN public.chart_of_accounts c ON c.code = la.coa_code
  ON CONFLICT (as_of, account_id, currency) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
GRANT EXECUTE ON FUNCTION public.take_ledger_snapshot(timestamptz) TO authenticated, service_role;

-- ---------- 6. TRIAL BALANCE VIEW ----------
CREATE OR REPLACE VIEW public.v_trial_balance AS
SELECT la.id AS account_id, la.code, la.coa_code, c.name AS coa_name, c.account_type, e.currency,
       sum(CASE WHEN e.direction='DEBIT'  THEN e.amount_cents ELSE 0 END) AS debits_cents,
       sum(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) AS credits_cents,
       CASE WHEN c.normal_side='DEBIT'
            THEN sum(CASE WHEN e.direction='DEBIT'  THEN e.amount_cents ELSE -e.amount_cents END)
            ELSE sum(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE -e.amount_cents END)
       END AS balance_cents
FROM public.ledger_entries e
JOIN public.journals j ON j.id = e.journal_id AND j.status='POSTED'
JOIN public.ledger_accounts la ON la.id = e.account_id
LEFT JOIN public.chart_of_accounts c ON c.code = la.coa_code
GROUP BY la.id, la.code, la.coa_code, c.name, c.account_type, c.normal_side, e.currency;
GRANT SELECT ON public.v_trial_balance TO authenticated;
