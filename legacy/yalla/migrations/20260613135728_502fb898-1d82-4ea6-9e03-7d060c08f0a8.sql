
CREATE TYPE public.fx_rate_type AS ENUM ('SPOT','DAILY','HISTORICAL','CLOSING');

-- ---------- Currencies ----------
CREATE TABLE public.currencies (
  code      text PRIMARY KEY,           -- ISO 4217
  name      text NOT NULL,
  symbol    text,
  decimals  int  NOT NULL DEFAULT 2,
  is_base   boolean NOT NULL DEFAULT false,
  active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.currencies TO authenticated, anon;
GRANT ALL ON public.currencies TO service_role;
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "currencies_read" ON public.currencies FOR SELECT USING (true);
CREATE POLICY "currencies_admin" ON public.currencies FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

INSERT INTO public.currencies (code,name,symbol,decimals,is_base) VALUES
('KES','Kenyan Shilling','KSh',2,true),
('UGX','Ugandan Shilling','USh',0,false),
('TZS','Tanzanian Shilling','TSh',2,false),
('RWF','Rwandan Franc','FRw',0,false),
('USD','US Dollar','$',2,false),
('EUR','Euro','€',2,false),
('AED','UAE Dirham','د.إ',2,false),
('GBP','British Pound','£',2,false);

-- ---------- Exchange Rates ----------
CREATE TABLE public.exchange_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency  text NOT NULL REFERENCES public.currencies(code),
  quote_currency text NOT NULL REFERENCES public.currencies(code),
  rate_date   date NOT NULL,
  rate_type   public.fx_rate_type NOT NULL DEFAULT 'DAILY',
  rate        numeric(20,10) NOT NULL CHECK (rate > 0),
  provider    text NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (base_currency, quote_currency, rate_date, rate_type)
);
CREATE INDEX idx_exchange_rates_lookup ON public.exchange_rates(base_currency, quote_currency, rate_date DESC);
GRANT SELECT ON public.exchange_rates TO authenticated;
GRANT ALL ON public.exchange_rates TO service_role;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY "fx_read" ON public.exchange_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "fx_admin" ON public.exchange_rates FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ---------- FX Transactions ----------
CREATE TABLE public.fx_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id  uuid REFERENCES public.journals(id),
  from_currency text NOT NULL REFERENCES public.currencies(code),
  to_currency   text NOT NULL REFERENCES public.currencies(code),
  from_amount_cents bigint NOT NULL CHECK (from_amount_cents > 0),
  to_amount_cents   bigint NOT NULL CHECK (to_amount_cents > 0),
  rate_id     uuid REFERENCES public.exchange_rates(id),
  rate_applied numeric(20,10) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
GRANT SELECT, INSERT ON public.fx_transactions TO authenticated;
GRANT ALL ON public.fx_transactions TO service_role;
ALTER TABLE public.fx_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY "fx_tx_finance" ON public.fx_transactions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ---------- FX Revaluations ----------
CREATE TABLE public.fx_revaluations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_end  date NOT NULL,
  base_currency text NOT NULL DEFAULT 'KES' REFERENCES public.currencies(code),
  status      text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  journal_id  uuid REFERENCES public.journals(id),
  totals      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
GRANT SELECT ON public.fx_revaluations TO authenticated;
GRANT ALL ON public.fx_revaluations TO service_role;
ALTER TABLE public.fx_revaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_revaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY "fx_rev_finance" ON public.fx_revaluations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ---------- FX Gain/Loss ----------
CREATE TABLE public.fx_gain_loss (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revaluation_id uuid REFERENCES public.fx_revaluations(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES public.ledger_accounts(id),
  currency    text NOT NULL,
  base_currency text NOT NULL,
  realized_cents   bigint NOT NULL DEFAULT 0,
  unrealized_cents bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fx_gain_loss TO authenticated;
GRANT ALL ON public.fx_gain_loss TO service_role;
ALTER TABLE public.fx_gain_loss ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_gain_loss FORCE ROW LEVEL SECURITY;
CREATE POLICY "fx_gl_finance" ON public.fx_gain_loss FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ---------- Ledger entries: add FX-aware columns ----------
ALTER TABLE public.ledger_entries
  ADD COLUMN base_currency text DEFAULT 'KES',
  ADD COLUMN base_amount_cents bigint,
  ADD COLUMN fx_rate_id uuid REFERENCES public.exchange_rates(id);

-- Backfill base amount = original amount where currency=KES
UPDATE public.ledger_entries SET base_amount_cents = amount_cents WHERE currency = 'KES';

-- ---------- Helper: convert ----------
CREATE OR REPLACE FUNCTION public.convert_amount(_amount_cents bigint, _from text, _to text, _on date DEFAULT current_date)
RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE _rate numeric;
BEGIN
  IF _from = _to THEN RETURN _amount_cents; END IF;
  SELECT rate INTO _rate FROM public.exchange_rates
   WHERE base_currency=_from AND quote_currency=_to AND rate_date <= _on
   ORDER BY rate_date DESC, created_at DESC LIMIT 1;
  IF _rate IS NULL THEN
    -- Try inverse
    SELECT 1/rate INTO _rate FROM public.exchange_rates
     WHERE base_currency=_to AND quote_currency=_from AND rate_date <= _on
     ORDER BY rate_date DESC, created_at DESC LIMIT 1;
  END IF;
  IF _rate IS NULL THEN RAISE EXCEPTION 'No FX rate from % to % on or before %', _from, _to, _on; END IF;
  RETURN round(_amount_cents * _rate);
END $$;
GRANT EXECUTE ON FUNCTION public.convert_amount(bigint, text, text, date) TO authenticated, service_role;

-- ---------- Revaluation RPC ----------
CREATE OR REPLACE FUNCTION public.run_fx_revaluation(_period_end date)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _rev_id uuid := gen_random_uuid();
  _journal uuid := gen_random_uuid();
  _gl_acc uuid;
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

  -- Build per-account current vs revalued KES totals
  FOR _rec IN
    SELECT la.id AS account_id, e.currency,
           sum(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END) AS net_cents,
           sum(CASE WHEN e.direction='DEBIT' THEN e.base_amount_cents ELSE -e.base_amount_cents END) AS net_base_cents
    FROM public.ledger_entries e
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
END $$;
GRANT EXECUTE ON FUNCTION public.run_fx_revaluation(date) TO authenticated, service_role;
