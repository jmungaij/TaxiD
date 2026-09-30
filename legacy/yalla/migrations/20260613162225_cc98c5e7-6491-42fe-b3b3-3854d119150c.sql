
-- ============================================================================
-- T5: Corporate billing
-- ============================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.corporate_status AS ENUM ('ACTIVE','SUSPENDED','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_period_status AS ENUM ('OPEN','LOCKED','BILLED','SETTLED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_invoice_status AS ENUM ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add corporate_admin role if missing (idempotent)
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'corporate_admin';
EXCEPTION WHEN others THEN NULL; END $$;

-- 1. corporate_accounts
CREATE TABLE IF NOT EXISTS public.corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trading_name text,
  kra_pin text NOT NULL,
  registration_number text,
  billing_email text NOT NULL,
  billing_phone text,
  billing_address text,
  payment_terms_days integer NOT NULL DEFAULT 30,
  credit_limit_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  status public.corporate_status NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kra_pin)
);
GRANT SELECT ON public.corporate_accounts TO authenticated;
GRANT ALL ON public.corporate_accounts TO service_role;
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_accounts_read" ON public.corporate_accounts FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','corporate_admin','super_admin']::app_role[]));

-- 2. corporate_billing_periods
CREATE TABLE IF NOT EXISTS public.corporate_billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status public.corporate_period_status NOT NULL DEFAULT 'OPEN',
  locked_at timestamptz,
  billed_at timestamptz,
  settled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, period_start, period_end),
  CHECK (period_end >= period_start)
);
GRANT SELECT ON public.corporate_billing_periods TO authenticated;
GRANT ALL ON public.corporate_billing_periods TO service_role;
ALTER TABLE public.corporate_billing_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_period_read" ON public.corporate_billing_periods FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','corporate_admin','super_admin']::app_role[]));

-- 3. corporate_invoices
CREATE TABLE IF NOT EXISTS public.corporate_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL REFERENCES public.corporate_billing_periods(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  etims_invoice_id uuid REFERENCES public.etims_invoices(id),
  journal_id uuid REFERENCES public.journals(id),
  status public.corporate_invoice_status NOT NULL DEFAULT 'DRAFT',
  subtotal_cents bigint NOT NULL,
  tax_total_cents bigint NOT NULL,
  adjustments_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL,
  paid_cents bigint NOT NULL DEFAULT 0,
  balance_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  voided_at timestamptz,
  voided_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, period_id)
);
GRANT SELECT ON public.corporate_invoices TO authenticated;
GRANT ALL ON public.corporate_invoices TO service_role;
ALTER TABLE public.corporate_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_inv_read" ON public.corporate_invoices FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','corporate_admin','super_admin']::app_role[]));

-- 4. corporate_invoice_items
CREATE TABLE IF NOT EXISTS public.corporate_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.corporate_invoices(id) ON DELETE RESTRICT,
  line_number integer NOT NULL,
  revenue_event_id uuid REFERENCES public.revenue_events(id),
  source_ref text,
  description text NOT NULL,
  employee_user_id uuid,
  employee_name text,
  department text,
  cost_center text,
  policy_code text,
  trip_origin text,
  trip_destination text,
  trip_started_at timestamptz,
  trip_ended_at timestamptz,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price_cents bigint NOT NULL,
  taxable_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_number)
);
GRANT SELECT ON public.corporate_invoice_items TO authenticated;
GRANT ALL ON public.corporate_invoice_items TO service_role;
ALTER TABLE public.corporate_invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_item_read" ON public.corporate_invoice_items FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','corporate_admin','super_admin']::app_role[]));

-- 5. corporate_invoice_taxes
CREATE TABLE IF NOT EXISTS public.corporate_invoice_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.corporate_invoices(id) ON DELETE RESTRICT,
  tax_scheme_code text NOT NULL,
  tax_rate_bps integer NOT NULL,
  taxable_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, tax_scheme_code, tax_rate_bps)
);
GRANT SELECT ON public.corporate_invoice_taxes TO authenticated;
GRANT ALL ON public.corporate_invoice_taxes TO service_role;
ALTER TABLE public.corporate_invoice_taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_tax_read" ON public.corporate_invoice_taxes FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','corporate_admin','super_admin']::app_role[]));

-- 6. corporate_invoice_adjustments
CREATE TABLE IF NOT EXISTS public.corporate_invoice_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.corporate_invoices(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('CREDIT','DEBIT','WRITE_OFF','DISCOUNT')),
  amount_cents bigint NOT NULL,
  reason text NOT NULL,
  applied_by uuid,
  journal_id uuid REFERENCES public.journals(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.corporate_invoice_adjustments TO authenticated;
GRANT ALL ON public.corporate_invoice_adjustments TO service_role;
ALTER TABLE public.corporate_invoice_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_adj_read" ON public.corporate_invoice_adjustments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','corporate_admin','super_admin']::app_role[]));

-- Append-only triggers
DO $$ BEGIN
  CREATE TRIGGER deny_corp_accounts_delete BEFORE DELETE ON public.corporate_accounts
    FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER deny_corp_period_delete BEFORE DELETE ON public.corporate_billing_periods
    FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER deny_corp_inv_delete BEFORE DELETE ON public.corporate_invoices
    FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER deny_corp_item_delete BEFORE DELETE ON public.corporate_invoice_items
    FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER deny_corp_tax_delete BEFORE DELETE ON public.corporate_invoice_taxes
    FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER deny_corp_adj_delete BEFORE DELETE ON public.corporate_invoice_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- updated_at triggers
DO $$ BEGIN
  CREATE TRIGGER trg_corp_accounts_updated BEFORE UPDATE ON public.corporate_accounts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_corp_period_updated BEFORE UPDATE ON public.corporate_billing_periods
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_corp_inv_updated BEFORE UPDATE ON public.corporate_invoices
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Invoice numbering sequence
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.corporate_invoice_seq;

CREATE OR REPLACE FUNCTION public.next_corporate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n bigint;
BEGIN
  _n := nextval('public.corporate_invoice_seq');
  RETURN 'CORP-' || to_char(now(),'YYYYMM') || '-' || lpad(_n::text, 6, '0');
END $$;
REVOKE ALL ON FUNCTION public.next_corporate_invoice_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_corporate_invoice_number() TO service_role;

-- ============================================================================
-- bill_corporate_period: aggregate ride revenue → corporate invoice + eTIMS + journal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bill_corporate_period(
  _corporate_id uuid,
  _period_id uuid,
  _scheme_code text DEFAULT 'VAT_KE'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _corp record;
  _period record;
  _scheme record;
  _rate record;
  _invoice_id uuid := gen_random_uuid();
  _etims_id uuid;
  _journal_id uuid := gen_random_uuid();
  _ar_account uuid;
  _rev_account uuid;
  _vat_account uuid;
  _subtotal bigint := 0;
  _tax_total bigint := 0;
  _grand_total bigint := 0;
  _line_no int := 0;
  _r record;
  _net bigint;
  _tax bigint;
  _gross bigint;
  _invoice_no text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may run corporate billing';
  END IF;

  SELECT * INTO _corp FROM public.corporate_accounts WHERE id = _corporate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corporate % not found', _corporate_id; END IF;
  IF _corp.status <> 'ACTIVE' THEN RAISE EXCEPTION 'Corporate % is not ACTIVE', _corporate_id; END IF;

  SELECT * INTO _period FROM public.corporate_billing_periods
    WHERE id = _period_id AND corporate_id = _corporate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Period % not found for corporate', _period_id; END IF;
  IF _period.status NOT IN ('OPEN','LOCKED') THEN
    RAISE EXCEPTION 'Period % already %', _period_id, _period.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.corporate_invoices WHERE period_id = _period_id) THEN
    RAISE EXCEPTION 'Period % already billed', _period_id;
  END IF;

  SELECT * INTO _scheme FROM public.tax_schemes WHERE code = _scheme_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax scheme % not found', _scheme_code; END IF;
  SELECT * INTO _rate FROM public.tax_rates
    WHERE scheme_id = _scheme.id
      AND effective_from <= _period.period_end
      AND (effective_to IS NULL OR effective_to >= _period.period_end)
    ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No effective rate for % on %', _scheme_code, _period.period_end; END IF;

  -- Resolve postable accounts
  SELECT id INTO _ar_account  FROM public.ledger_accounts WHERE coa_code = '1210' LIMIT 1;
  SELECT id INTO _rev_account FROM public.ledger_accounts WHERE coa_code = '4100' LIMIT 1;
  SELECT id INTO _vat_account FROM public.ledger_accounts WHERE coa_code = '2210' LIMIT 1;

  -- Create the corporate invoice header (totals filled at end)
  _invoice_no := public.next_corporate_invoice_number();
  INSERT INTO public.corporate_invoices
    (id, corporate_id, period_id, invoice_number, status,
     subtotal_cents, tax_total_cents, total_cents, balance_cents,
     currency, issued_at, due_at)
  VALUES
    (_invoice_id, _corporate_id, _period_id, _invoice_no, 'DRAFT',
     0, 0, 0, 0, _corp.currency, now(),
     now() + (_corp.payment_terms_days || ' days')::interval);

  -- Aggregate every RECOGNIZED revenue_event tagged with this corporate over the period
  FOR _r IN
    SELECT re.*
    FROM public.revenue_events re
    WHERE re.corporate_id = _corporate_id
      AND re.status = 'RECOGNIZED'
      AND re.occurred_at::date BETWEEN _period.period_start AND _period.period_end
      AND NOT EXISTS (
        SELECT 1 FROM public.corporate_invoice_items ci WHERE ci.revenue_event_id = re.id
      )
    ORDER BY re.occurred_at
  LOOP
    _line_no := _line_no + 1;
    _gross := _r.gross_amount_cents;
    _net   := (_gross * 10000) / (10000 + _rate.rate_bps);
    _tax   := _gross - _net;
    _subtotal := _subtotal + _net;
    _tax_total := _tax_total + _tax;
    _grand_total := _grand_total + _gross;

    INSERT INTO public.corporate_invoice_items
      (invoice_id, line_number, revenue_event_id, source_ref, description,
       employee_user_id, department, cost_center, policy_code,
       trip_origin, trip_destination, trip_started_at, trip_ended_at,
       quantity, unit_price_cents, taxable_cents, tax_cents, total_cents, metadata)
    VALUES
      (_invoice_id, _line_no, _r.id, _r.source_ref,
       COALESCE(_r.metadata->>'description','Corporate ride'),
       _r.rider_id,
       _r.metadata->>'department',
       _r.metadata->>'cost_center',
       _r.metadata->>'policy_code',
       _r.metadata->>'trip_origin',
       _r.metadata->>'trip_destination',
       (_r.metadata->>'trip_started_at')::timestamptz,
       (_r.metadata->>'trip_ended_at')::timestamptz,
       1, _net, _net, _tax, _gross, _r.metadata);
  END LOOP;

  IF _line_no = 0 THEN
    -- Nothing to bill; roll back the empty invoice
    DELETE FROM public.corporate_invoices WHERE id = _invoice_id;
    RAISE EXCEPTION 'No recognized revenue for corporate % in period %', _corporate_id, _period_id;
  END IF;

  -- Tax breakdown row
  INSERT INTO public.corporate_invoice_taxes
    (invoice_id, tax_scheme_code, tax_rate_bps, taxable_cents, tax_cents)
  VALUES
    (_invoice_id, _scheme_code, _rate.rate_bps, _subtotal, _tax_total);

  -- Update header totals
  UPDATE public.corporate_invoices
     SET subtotal_cents = _subtotal,
         tax_total_cents = _tax_total,
         total_cents = _grand_total,
         balance_cents = _grand_total,
         status = 'ISSUED'
   WHERE id = _invoice_id;

  -- eTIMS invoice (standalone — corporate, KRA PIN, no single revenue_event)
  _etims_id := gen_random_uuid();
  INSERT INTO public.etims_invoices
    (id, invoice_number, invoice_type, status,
     customer_name, customer_kra_pin, customer_email, customer_phone,
     subtotal_cents, tax_total_cents, total_cents, currency, issued_at, metadata)
  VALUES
    (_etims_id, _invoice_no, 'STANDARD', 'PENDING',
     _corp.legal_name, _corp.kra_pin, _corp.billing_email, _corp.billing_phone,
     _subtotal, _tax_total, _grand_total, _corp.currency, now(),
     jsonb_build_object('corporate_invoice_id', _invoice_id,
                        'period_start', _period.period_start,
                        'period_end', _period.period_end));

  INSERT INTO public.etims_invoice_items
    (invoice_id, line_number, description, quantity, unit_price_cents, discount_cents,
     tax_scheme_code, tax_rate_bps, taxable_cents, tax_cents, total_cents)
  VALUES
    (_etims_id, 1,
     'Corporate rides '||_period.period_start||' – '||_period.period_end||' ('||_line_no||' trips)',
     _line_no, (_subtotal / GREATEST(_line_no,1)), 0,
     _scheme_code, _rate.rate_bps, _subtotal, _tax_total, _grand_total);

  -- Journal: DR Receivable / CR Revenue / CR VAT
  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (_journal_id, 'CORPORATE_BILLING', _invoice_no,
          'Corporate billing '||_corp.legal_name||' '||_period.period_start||'..'||_period.period_end,
          auth.uid());

  INSERT INTO public.journal_lines
    (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (_journal_id, _ar_account,  'DEBIT',  _grand_total, _corp.currency, 'DR Receivable '||_invoice_no, auth.uid()),
    (_journal_id, _rev_account, 'CREDIT', _subtotal,    _corp.currency, 'CR Revenue',                  auth.uid()),
    (_journal_id, _vat_account, 'CREDIT', _tax_total,   _corp.currency, 'CR VAT Payable',              auth.uid());

  PERFORM public.posting_engine_post(_journal_id);

  -- Link
  UPDATE public.corporate_invoices
     SET etims_invoice_id = _etims_id, journal_id = _journal_id
   WHERE id = _invoice_id;

  UPDATE public.corporate_billing_periods
     SET status = 'BILLED', billed_at = now()
   WHERE id = _period_id;

  INSERT INTO public.etims_sync_events (invoice_id, event_type, request_payload)
    VALUES (_etims_id, 'INVOICE_CREATED',
            jsonb_build_object('corporate_invoice_id', _invoice_id,
                               'journal_id', _journal_id,
                               'line_count', _line_no));

  RETURN _invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.bill_corporate_period(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bill_corporate_period(uuid,uuid,text) TO service_role;
