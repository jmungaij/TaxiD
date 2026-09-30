
-- =========================================================================
-- B2: Journal lines + posting engine hardening
-- =========================================================================

-- 1. RENAME ledger_entries -> journal_lines (preserves all data, FKs, indexes)
ALTER TABLE public.ledger_entries RENAME TO journal_lines;

-- Existing triggers on the table keep working under the new name automatically.
-- Re-create/redefine functions that referenced ledger_entries by name.

-- 1a. compute_entry_hash
CREATE OR REPLACE FUNCTION public.compute_entry_hash()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _last bytea;
BEGIN
  SELECT entry_hash INTO _last FROM public.journal_lines
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
END $function$;

-- 1b. deny_ledger_mutation (message updated)
CREATE OR REPLACE FUNCTION public.deny_ledger_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'journal_lines are immutable; post a reversing journal instead';
END $function$;

-- 1c. assert_journal_balanced — checks balance on journal_lines
CREATE OR REPLACE FUNCTION public.assert_journal_balanced()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE imbalanced_rows int;
BEGIN
  SELECT count(*) INTO imbalanced_rows
  FROM (
    SELECT journal_id, currency,
           sum(CASE WHEN direction = 'DEBIT'  THEN amount_cents ELSE 0 END) AS dr,
           sum(CASE WHEN direction = 'CREDIT' THEN amount_cents ELSE 0 END) AS cr
    FROM public.journal_lines
    WHERE journal_id = COALESCE(NEW.journal_id, OLD.journal_id)
    GROUP BY journal_id, currency
  ) g
  WHERE g.dr <> g.cr;

  IF imbalanced_rows > 0 THEN
    RAISE EXCEPTION 'Journal % is not balanced (debits must equal credits per currency)',
      COALESCE(NEW.journal_id, OLD.journal_id);
  END IF;
  RETURN NULL;
END $function$;

-- 1d. assert_journal_open_for_entries — same logic, name retained
CREATE OR REPLACE FUNCTION public.assert_journal_open_for_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _status public.journal_status;
BEGIN
  SELECT status INTO _status FROM public.journals WHERE id = NEW.journal_id;
  IF _status IS NULL THEN RETURN NEW; END IF;
  IF _status = 'POSTED' THEN
    RAISE EXCEPTION 'Cannot append journal lines to a POSTED journal (%)', NEW.journal_id;
  END IF;
  RETURN NEW;
END $function$;

-- 1e. posting_engine_post — now reads from journal_lines
CREATE OR REPLACE FUNCTION public.posting_engine_post(_journal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _j record;
  _bad int;
  _line_count int;
BEGIN
  SELECT * INTO _j FROM public.journals WHERE id = _journal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal % not found', _journal_id; END IF;
  IF _j.status <> 'DRAFT' THEN RAISE EXCEPTION 'Journal % is not DRAFT (status=%)', _journal_id, _j.status; END IF;

  SELECT count(*) INTO _line_count FROM public.journal_lines WHERE journal_id = _journal_id;
  IF _line_count < 2 THEN
    INSERT INTO public.posting_errors (journal_id, error_code, error_message)
      VALUES (_journal_id, 'INSUFFICIENT_LINES', 'Journal must contain at least 2 lines');
    RAISE EXCEPTION 'Journal % must contain at least 2 lines', _journal_id;
  END IF;

  SELECT count(*) INTO _bad
  FROM public.journal_lines e
  JOIN public.ledger_accounts a ON a.id = e.account_id
  LEFT JOIN public.chart_of_accounts c ON c.code = a.coa_code
  WHERE e.journal_id = _journal_id
    AND (
      a.active IS DISTINCT FROM true
      OR a.coa_code IS NULL
      OR c.is_postable = false
      OR c.active = false
    );
  IF _bad > 0 THEN
    INSERT INTO public.posting_errors (journal_id, error_code, error_message)
      VALUES (_journal_id, 'INVALID_ACCOUNT', format('%s invalid/non-postable accounts', _bad));
    RAISE EXCEPTION 'Journal % references invalid/non-postable accounts', _journal_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT currency,
             sum(CASE WHEN direction='DEBIT'  THEN amount_cents ELSE 0 END) dr,
             sum(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END) cr
      FROM public.journal_lines WHERE journal_id = _journal_id GROUP BY currency
    ) g WHERE dr <> cr
  ) THEN
    INSERT INTO public.posting_errors (journal_id, error_code, error_message)
      VALUES (_journal_id, 'UNBALANCED', 'Debits do not equal credits per currency');
    RAISE EXCEPTION 'Journal % is unbalanced', _journal_id;
  END IF;

  UPDATE public.journals
     SET status='POSTED', posted_at=now(), posted_by=auth.uid()
   WHERE id = _journal_id;

  INSERT INTO public.posting_events (journal_id, event_type, payload, actor_id)
    VALUES (_journal_id, 'POSTED', jsonb_build_object('lines', _line_count), auth.uid());

  RETURN _journal_id;
END $function$;

-- 1f. reverse_payment_journal
CREATE OR REPLACE FUNCTION public.reverse_payment_journal(_txn_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _journal uuid := gen_random_uuid();
  _orig uuid;
  _e record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may reverse payments';
  END IF;

  SELECT DISTINCT journal_id INTO _orig FROM public.journal_lines WHERE transaction_id = _txn_id LIMIT 1;

  INSERT INTO public.journals (id, source, description, reverses_journal_id, created_by)
  VALUES (_journal, 'MPESA_REVERSAL', 'REVERSAL: '||COALESCE(_reason,''), _orig, auth.uid());

  FOR _e IN SELECT * FROM public.journal_lines WHERE transaction_id = _txn_id AND journal_id = _orig LOOP
    INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by)
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
END $function$;

-- 1g. post_mpesa_settlement
CREATE OR REPLACE FUNCTION public.post_mpesa_settlement(_txn_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF EXISTS (SELECT 1 FROM public.journal_lines WHERE transaction_id = _txn_id) THEN
    RAISE EXCEPTION 'Transaction % already settled', _txn_id;
  END IF;

  SELECT id INTO _clearing FROM public.ledger_accounts WHERE code = 'MPESA_CLEARING';
  _wallet_acc := public.get_or_create_wallet_account(_txn.wallet_id);

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (_journal, 'MPESA_SETTLEMENT', _txn.mpesa_receipt,
          'M-Pesa settlement '||COALESCE(_txn.mpesa_receipt,_txn_id::text), auth.uid());

  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by) VALUES
    (_journal, _clearing,   'DEBIT',  _txn.amount_cents, _txn.currency, _txn_id, 'DR M-Pesa clearing', auth.uid()),
    (_journal, _wallet_acc, 'CREDIT', _txn.amount_cents, _txn.currency, _txn_id, 'CR wallet',          auth.uid());

  PERFORM public.posting_engine_post(_journal);
  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_SETTLED'::payment_event_type,
    jsonb_build_object('journal_id', _journal, 'amount_cents', _txn.amount_cents));
  RETURN _journal;
END $function$;

-- 1h. post_driver_payout
CREATE OR REPLACE FUNCTION public.post_driver_payout(_corporate_wallet uuid, _driver_wallet uuid, _amount_cents bigint, _memo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _journal uuid := gen_random_uuid();
  _corp uuid := public.get_or_create_wallet_account(_corporate_wallet);
  _drv  uuid := public.get_or_create_wallet_account(_driver_wallet);
BEGIN
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  INSERT INTO public.journals (id, source, description, created_by)
  VALUES (_journal, 'DRIVER_PAYOUT', COALESCE(_memo,'Driver payout'), auth.uid());
  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (_journal, _corp, 'DEBIT',  _amount_cents, 'KES', COALESCE(_memo,'DR corporate'), auth.uid()),
    (_journal, _drv,  'CREDIT', _amount_cents, 'KES', COALESCE(_memo,'CR driver'),    auth.uid());
  PERFORM public.posting_engine_post(_journal);
  RETURN _journal;
END $function$;

-- 1i. run_fx_revaluation, generate_vat_report, take_ledger_snapshot, verify_ledger_chain, reconcile_settlement_batch
CREATE OR REPLACE FUNCTION public.generate_vat_report(_period_start date, _period_end date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _data jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'period_start', _period_start, 'period_end', _period_end,
    'vat_collected_cents',
      COALESCE(sum(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE -e.amount_cents END),0),
    'currency','KES',
    'entry_count', count(*)
  ) INTO _data
  FROM public.journal_lines e
  JOIN public.journals j ON j.id=e.journal_id AND j.status='POSTED'
  JOIN public.ledger_accounts la ON la.id=e.account_id
  WHERE la.coa_code='2210'
    AND e.created_at::date BETWEEN _period_start AND _period_end;
  RETURN _data;
END $function$;

CREATE OR REPLACE FUNCTION public.take_ledger_snapshot(_as_of timestamp with time zone DEFAULT now())
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  WITH agg AS (
    SELECT e.account_id, e.currency,
           sum(CASE WHEN e.direction='DEBIT'  THEN e.amount_cents ELSE 0 END) dr,
           sum(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) cr
    FROM public.journal_lines e
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
END $function$;

CREATE OR REPLACE FUNCTION public.verify_ledger_chain(_from timestamp with time zone DEFAULT NULL, _to timestamp with time zone DEFAULT NULL)
 RETURNS TABLE(broken_entry uuid, expected_prev bytea, actual_prev bytea)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _prev bytea := NULL; _e record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  FOR _e IN
    SELECT id, prev_hash, entry_hash, created_at FROM public.journal_lines
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
END $function$;

CREATE OR REPLACE FUNCTION public.run_fx_revaluation(_period_end date)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _rev_id uuid := gen_random_uuid();
  _journal uuid := gen_random_uuid();
  _rec record;
  _total_gain bigint := 0;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  INSERT INTO public.fx_revaluations (id, period_end, status, created_by)
  VALUES (_rev_id, _period_end, 'RUNNING', auth.uid());
  INSERT INTO public.journals (id, source, description, created_by)
  VALUES (_journal, 'FX_REVALUATION', 'FX revaluation '||_period_end, auth.uid());

  FOR _rec IN
    SELECT la.id AS account_id, e.currency,
           sum(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END) AS net_cents,
           sum(CASE WHEN e.direction='DEBIT' THEN e.base_amount_cents ELSE -e.base_amount_cents END) AS net_base_cents
    FROM public.journal_lines e
    JOIN public.journals j ON j.id = e.journal_id AND j.status='POSTED'
    JOIN public.ledger_accounts la ON la.id = e.account_id
    WHERE e.created_at::date <= _period_end AND e.currency <> 'KES'
    GROUP BY la.id, e.currency
    HAVING sum(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END) <> 0
  LOOP
    DECLARE
      _revalued_kes bigint := public.convert_amount(_rec.net_cents, _rec.currency, 'KES', _period_end);
      _delta bigint := _revalued_kes - COALESCE(_rec.net_base_cents, 0);
    BEGIN
      INSERT INTO public.fx_gain_loss (revaluation_id, account_id, currency, base_currency, unrealized_cents)
      VALUES (_rev_id, _rec.account_id, _rec.currency, 'KES', _delta);
      _total_gain := _total_gain + _delta;
    END;
  END LOOP;

  UPDATE public.fx_revaluations
     SET status='COMPLETED', journal_id=_journal, totals=jsonb_build_object('unrealized_kes', _total_gain)
   WHERE id=_rev_id;
  RETURN _rev_id;
END $function$;

CREATE OR REPLACE FUNCTION public.reconcile_settlement_batch(_batch_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _b record; _ledger_count int; _ledger_amount bigint; _variance bigint; _status text;
  _rec_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO _b FROM public.settlement_batches WHERE id=_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch % not found', _batch_id; END IF;

  SELECT count(*), COALESCE(sum(le.amount_cents),0)
    INTO _ledger_count, _ledger_amount
  FROM public.settlements s
  JOIN public.journal_lines le ON le.transaction_id = s.transaction_id AND le.direction='DEBIT'
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
END $function$;

-- snapshot_audit_hash
CREATE OR REPLACE FUNCTION public.snapshot_audit_hash(_notes text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _root bytea; _n int; _id uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT entry_hash, count(*) OVER () INTO _root, _n
  FROM public.journal_lines WHERE entry_hash IS NOT NULL
  ORDER BY created_at DESC, id DESC LIMIT 1;
  INSERT INTO public.audit_hashes (id, chain_root, entry_count, notes)
  VALUES (_id, COALESCE(_root, '\x00'::bytea), COALESCE(_n,0), _notes);
  RETURN _id;
END $function$;

-- 2. New posting control tables ------------------------------------------------

-- posting_batches
CREATE TABLE public.posting_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','POSTING','POSTED','FAILED','CANCELLED')),
  journal_count int NOT NULL DEFAULT 0,
  total_debit_cents bigint NOT NULL DEFAULT 0,
  total_credit_cents bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.posting_batches TO authenticated;
GRANT ALL ON public.posting_batches TO service_role;
ALTER TABLE public.posting_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance can view posting batches" ON public.posting_batches
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_posting_batches_updated BEFORE UPDATE ON public.posting_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add batch_id to journals (optional grouping)
ALTER TABLE public.journals ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.posting_batches(id);
CREATE INDEX IF NOT EXISTS idx_journals_batch ON public.journals(batch_id);

-- posting_rules
CREATE TABLE public.posting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL,
  version int NOT NULL DEFAULT 1,
  event_type text NOT NULL,
  description text,
  template jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version)
);
GRANT SELECT ON public.posting_rules TO authenticated;
GRANT ALL ON public.posting_rules TO service_role;
ALTER TABLE public.posting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth can view posting rules" ON public.posting_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Finance admins manage posting rules" ON public.posting_rules
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_posting_rules_updated BEFORE UPDATE ON public.posting_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- posting_events (append-only)
CREATE TABLE public.posting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.posting_batches(id),
  journal_id uuid REFERENCES public.journals(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.posting_events TO authenticated;
GRANT ALL ON public.posting_events TO service_role;
ALTER TABLE public.posting_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance can view posting events" ON public.posting_events
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE INDEX idx_posting_events_journal ON public.posting_events(journal_id);
CREATE INDEX idx_posting_events_batch ON public.posting_events(batch_id);

-- posting_errors
CREATE TABLE public.posting_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.posting_batches(id),
  journal_id uuid REFERENCES public.journals(id),
  error_code text NOT NULL,
  error_message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts int NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.posting_errors TO authenticated;
GRANT ALL ON public.posting_errors TO service_role;
ALTER TABLE public.posting_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance can view posting errors" ON public.posting_errors
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE INDEX idx_posting_errors_unresolved ON public.posting_errors(resolved) WHERE resolved = false;

-- 3. Lockdown direct writes on journal_lines ---------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.journal_lines FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.journal_lines FROM anon;
-- service_role and the SECURITY DEFINER posting functions retain full access.

-- 4. Backward-compatible read-only view for any straggler queries.
-- Drop only if exists from a prior attempt; create fresh.
DROP VIEW IF EXISTS public.ledger_entries CASCADE;
CREATE VIEW public.ledger_entries
  WITH (security_invoker = true)
  AS SELECT * FROM public.journal_lines;
GRANT SELECT ON public.ledger_entries TO authenticated, service_role;
