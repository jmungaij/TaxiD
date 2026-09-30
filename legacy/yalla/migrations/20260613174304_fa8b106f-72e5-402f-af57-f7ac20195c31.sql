
-- ============================================================
-- T8: Driver Tax + eTIMS + Payout Operating System
-- ============================================================

-- ---------- ENUMS ----------
CREATE TYPE public.driver_tax_regime AS ENUM (
  'TOT',         -- Turnover Tax (under KES 25M annual)
  'INCOME_TAX',  -- Income Tax (over 25M, business income)
  'PAYE',        -- Employed driver model
  'EXEMPT'
);

CREATE TYPE public.driver_tax_profile_status AS ENUM ('PENDING','ACTIVE','SUSPENDED','DEREGISTERED');

CREATE TYPE public.driver_tax_liability_status AS ENUM ('OPEN','PARTIAL','PAID','OVERDUE','WAIVED');

CREATE TYPE public.driver_tax_return_status AS ENUM ('DRAFT','FILED','ACCEPTED','REJECTED','AMENDED');

CREATE TYPE public.driver_etims_invoice_status AS ENUM (
  'PENDING','SUBMITTED','ACCEPTED','REJECTED','RETRYING','FAILED','VOIDED','REFUNDED'
);

CREATE TYPE public.driver_payout_method_type AS ENUM ('MPESA','BANK_TRANSFER','CARD');

CREATE TYPE public.driver_payout_status AS ENUM (
  'PENDING','QUEUED','PROCESSING','SUCCESS','FAILED','REVERSED','CANCELLED'
);

CREATE TYPE public.driver_payout_batch_status AS ENUM (
  'OPEN','LOCKED','SUBMITTED','SETTLED','RECONCILED','FAILED'
);

-- ============================================================
-- DRIVER TAX PROFILES
-- ============================================================
CREATE TABLE public.driver_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  kra_pin text NOT NULL,
  current_regime public.driver_tax_regime NOT NULL DEFAULT 'TOT',
  vat_registered boolean NOT NULL DEFAULT false,
  vat_number text,
  annual_turnover_cents bigint NOT NULL DEFAULT 0,
  status public.driver_tax_profile_status NOT NULL DEFAULT 'PENDING',
  registered_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_tax_profiles TO authenticated;
GRANT ALL ON public.driver_tax_profiles TO service_role;
ALTER TABLE public.driver_tax_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own tax profile" ON public.driver_tax_profiles
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- TAX ELECTIONS (versioned)
-- ============================================================
CREATE TABLE public.driver_tax_elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  regime public.driver_tax_regime NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  elected_at timestamptz NOT NULL DEFAULT now(),
  elected_by uuid,
  document_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_tax_elections_driver ON public.driver_tax_elections(driver_id, effective_from DESC);
GRANT SELECT ON public.driver_tax_elections TO authenticated;
GRANT ALL ON public.driver_tax_elections TO service_role;
ALTER TABLE public.driver_tax_elections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own elections" ON public.driver_tax_elections
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- TAX LIABILITIES
-- ============================================================
CREATE TABLE public.driver_tax_liabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  scheme_code text NOT NULL,                 -- TOT, VAT_KE, HOUSING_LEVY, INCOME_TAX_KE
  taxable_cents bigint NOT NULL DEFAULT 0,
  rate_bps int NOT NULL,
  amount_cents bigint NOT NULL DEFAULT 0,
  paid_cents bigint NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  status public.driver_tax_liability_status NOT NULL DEFAULT 'OPEN',
  journal_id uuid REFERENCES public.journals(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, period_start, period_end, scheme_code)
);
CREATE INDEX idx_driver_tax_liab_driver ON public.driver_tax_liabilities(driver_id, due_date);
CREATE INDEX idx_driver_tax_liab_status ON public.driver_tax_liabilities(status, due_date);
GRANT SELECT ON public.driver_tax_liabilities TO authenticated;
GRANT ALL ON public.driver_tax_liabilities TO service_role;
ALTER TABLE public.driver_tax_liabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own liabilities" ON public.driver_tax_liabilities
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- TAX PAYMENTS
-- ============================================================
CREATE TABLE public.driver_tax_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id uuid NOT NULL REFERENCES public.driver_tax_liabilities(id) ON DELETE RESTRICT,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  journal_id uuid REFERENCES public.journals(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_tax_payments_liab ON public.driver_tax_payments(liability_id);
GRANT SELECT ON public.driver_tax_payments TO authenticated;
GRANT ALL ON public.driver_tax_payments TO service_role;
ALTER TABLE public.driver_tax_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own tax payments" ON public.driver_tax_payments
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- TAX RETURNS
-- ============================================================
CREATE TABLE public.driver_tax_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheme_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  regime public.driver_tax_regime NOT NULL,
  gross_cents bigint NOT NULL DEFAULT 0,
  taxable_cents bigint NOT NULL DEFAULT 0,
  tax_due_cents bigint NOT NULL DEFAULT 0,
  status public.driver_tax_return_status NOT NULL DEFAULT 'DRAFT',
  filed_at timestamptz,
  acknowledgement_ref text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, scheme_code, period_start, period_end)
);
GRANT SELECT ON public.driver_tax_returns TO authenticated;
GRANT ALL ON public.driver_tax_returns TO service_role;
ALTER TABLE public.driver_tax_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own returns" ON public.driver_tax_returns
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- HOUSING LEVY (1.5% employee + 1.5% platform contribution model)
-- ============================================================
CREATE TABLE public.driver_housing_levy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_cents bigint NOT NULL DEFAULT 0,
  employee_levy_cents bigint NOT NULL DEFAULT 0,
  employer_levy_cents bigint NOT NULL DEFAULT 0,
  total_levy_cents bigint GENERATED ALWAYS AS (employee_levy_cents + employer_levy_cents) STORED,
  status public.driver_tax_liability_status NOT NULL DEFAULT 'OPEN',
  liability_id uuid REFERENCES public.driver_tax_liabilities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, period_start, period_end)
);
GRANT SELECT ON public.driver_housing_levy TO authenticated;
GRANT ALL ON public.driver_housing_levy TO service_role;
ALTER TABLE public.driver_housing_levy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own housing levy" ON public.driver_housing_levy
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- DRIVER eTIMS PROFILES
-- ============================================================
CREATE TABLE public.driver_etims_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  kra_pin text NOT NULL,
  etims_branch_id text,
  device_serial text,
  registered boolean NOT NULL DEFAULT false,
  registered_at timestamptz,
  consent_given_at timestamptz,
  consent_revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_etims_profiles TO authenticated;
GRANT ALL ON public.driver_etims_profiles TO service_role;
ALTER TABLE public.driver_etims_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own etims profile" ON public.driver_etims_profiles
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- DRIVER eTIMS INVOICES (per-ride driver-side invoice stream)
-- ============================================================
CREATE SEQUENCE public.driver_etims_invoice_seq START 1;

CREATE TABLE public.driver_etims_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  revenue_event_id uuid REFERENCES public.revenue_events(id),
  platform_invoice_id uuid REFERENCES public.etims_invoices(id),
  status public.driver_etims_invoice_status NOT NULL DEFAULT 'PENDING',
  gross_cents bigint NOT NULL,
  net_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  tax_scheme_code text NOT NULL DEFAULT 'TOT',
  tax_rate_bps int NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  issued_at timestamptz NOT NULL DEFAULT now(),
  kra_invoice_no text,
  kra_qr_code text,
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_etims_inv_driver ON public.driver_etims_invoices(driver_id, issued_at DESC);
CREATE INDEX idx_driver_etims_inv_status ON public.driver_etims_invoices(status);
GRANT SELECT ON public.driver_etims_invoices TO authenticated;
GRANT ALL ON public.driver_etims_invoices TO service_role;
ALTER TABLE public.driver_etims_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own etims invoices" ON public.driver_etims_invoices
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- deny-delete
CREATE TRIGGER trg_driver_etims_inv_no_delete BEFORE DELETE ON public.driver_etims_invoices
  FOR EACH ROW EXECUTE FUNCTION public.deny_etims_delete();

-- ============================================================
-- DRIVER eTIMS SUBMISSIONS / SYNC EVENTS / FAILURES / RETRIES
-- ============================================================
CREATE TABLE public.driver_etims_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.driver_etims_invoices(id) ON DELETE CASCADE,
  attempt_no int NOT NULL,
  request_payload jsonb,
  response_payload jsonb,
  http_status int,
  succeeded boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_etims_sub_invoice ON public.driver_etims_submissions(invoice_id, attempt_no);
GRANT SELECT ON public.driver_etims_submissions TO authenticated;
GRANT ALL ON public.driver_etims_submissions TO service_role;
ALTER TABLE public.driver_etims_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own etims submissions" ON public.driver_etims_submissions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.driver_etims_invoices i WHERE i.id = invoice_id AND (i.driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))));

CREATE TABLE public.driver_etims_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.driver_etims_invoices(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_etims_sync_events TO authenticated;
GRANT ALL ON public.driver_etims_sync_events TO service_role;
ALTER TABLE public.driver_etims_sync_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own etims sync" ON public.driver_etims_sync_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.driver_etims_invoices i WHERE i.id = invoice_id AND (i.driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))));

CREATE TABLE public.driver_etims_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.driver_etims_invoices(id) ON DELETE CASCADE,
  error_code text,
  error_message text NOT NULL,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_etims_failures TO authenticated;
GRANT ALL ON public.driver_etims_failures TO service_role;
ALTER TABLE public.driver_etims_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance sees driver etims failures" ON public.driver_etims_failures
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.driver_etims_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.driver_etims_invoices(id) ON DELETE CASCADE,
  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'PENDING',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_etims_retries_due ON public.driver_etims_retries(status, next_attempt_at);
GRANT SELECT ON public.driver_etims_retries TO authenticated;
GRANT ALL ON public.driver_etims_retries TO service_role;
ALTER TABLE public.driver_etims_retries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance sees driver etims retries" ON public.driver_etims_retries
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- DRIVER PAYOUT METHODS
-- ============================================================
CREATE TABLE public.driver_payout_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_type public.driver_payout_method_type NOT NULL,
  msisdn text,
  bank_code text,
  bank_account text,
  account_name text,
  verified boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_driver_payout_method_default ON public.driver_payout_methods(driver_id) WHERE is_default = true;
GRANT SELECT, INSERT, UPDATE ON public.driver_payout_methods TO authenticated;
GRANT ALL ON public.driver_payout_methods TO service_role;
ALTER TABLE public.driver_payout_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers manage own payout methods" ON public.driver_payout_methods
  FOR ALL TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- DRIVER PAYOUT BATCHES
-- ============================================================
CREATE SEQUENCE public.driver_payout_batch_seq START 1;

CREATE TABLE public.driver_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number text NOT NULL UNIQUE,
  provider text NOT NULL,                    -- MPESA_B2C, BANK_BULK
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  total_count int NOT NULL DEFAULT 0,
  total_amount_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  status public.driver_payout_batch_status NOT NULL DEFAULT 'OPEN',
  provider_batch_ref text,
  submitted_at timestamptz,
  settled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_payout_batches TO authenticated;
GRANT ALL ON public.driver_payout_batches TO service_role;
ALTER TABLE public.driver_payout_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance sees payout batches" ON public.driver_payout_batches
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- DRIVER PAYOUTS
-- ============================================================
CREATE TABLE public.driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  method_id uuid NOT NULL REFERENCES public.driver_payout_methods(id),
  batch_id uuid REFERENCES public.driver_payout_batches(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  status public.driver_payout_status NOT NULL DEFAULT 'PENDING',
  reference text,
  provider_txn_id text,
  journal_id uuid REFERENCES public.journals(id),
  reversal_of uuid REFERENCES public.driver_payouts(id),
  tax_withheld_cents bigint NOT NULL DEFAULT 0,
  net_payout_cents bigint GENERATED ALWAYS AS (amount_cents - tax_withheld_cents) STORED,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_payouts_driver ON public.driver_payouts(driver_id, created_at DESC);
CREATE INDEX idx_driver_payouts_status ON public.driver_payouts(status);
CREATE INDEX idx_driver_payouts_batch ON public.driver_payouts(batch_id);
GRANT SELECT ON public.driver_payouts TO authenticated;
GRANT ALL ON public.driver_payouts TO service_role;
ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers see own payouts" ON public.driver_payouts
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- PAYOUT FAILURES / REVERSALS / RECONCILIATION
-- ============================================================
CREATE TABLE public.driver_payout_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.driver_payouts(id) ON DELETE CASCADE,
  error_code text,
  error_message text NOT NULL,
  retry_count int NOT NULL DEFAULT 0,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_payout_failures TO authenticated;
GRANT ALL ON public.driver_payout_failures TO service_role;
ALTER TABLE public.driver_payout_failures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance sees payout failures" ON public.driver_payout_failures
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.driver_payout_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES public.driver_payouts(id) ON DELETE CASCADE,
  reason text NOT NULL,
  reversal_journal_id uuid REFERENCES public.journals(id),
  initiated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_payout_reversals TO authenticated;
GRANT ALL ON public.driver_payout_reversals TO service_role;
ALTER TABLE public.driver_payout_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance sees payout reversals" ON public.driver_payout_reversals
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.driver_payout_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.driver_payout_batches(id),
  expected_count int NOT NULL,
  actual_count int NOT NULL,
  expected_amount_cents bigint NOT NULL,
  actual_amount_cents bigint NOT NULL,
  variance_cents bigint GENERATED ALWAYS AS (expected_amount_cents - actual_amount_cents) STORED,
  status text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_payout_reconciliation TO authenticated;
GRANT ALL ON public.driver_payout_reconciliation TO service_role;
ALTER TABLE public.driver_payout_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance sees payout reconciliation" ON public.driver_payout_reconciliation
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- DENY-DELETE on financial tables (append-only)
-- ============================================================
CREATE TRIGGER trg_driver_tax_liab_no_delete BEFORE DELETE ON public.driver_tax_liabilities
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
CREATE TRIGGER trg_driver_tax_pay_no_delete BEFORE DELETE ON public.driver_tax_payments
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
CREATE TRIGGER trg_driver_payouts_no_delete BEFORE DELETE ON public.driver_payouts
  FOR EACH ROW EXECUTE FUNCTION public.deny_etims_delete();

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER trg_dtp_uat BEFORE UPDATE ON public.driver_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dtl_uat BEFORE UPDATE ON public.driver_tax_liabilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dtr_uat BEFORE UPDATE ON public.driver_tax_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dhl_uat BEFORE UPDATE ON public.driver_housing_levy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dep_uat BEFORE UPDATE ON public.driver_etims_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dei_uat BEFORE UPDATE ON public.driver_etims_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_der_uat BEFORE UPDATE ON public.driver_etims_retries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dpm_uat BEFORE UPDATE ON public.driver_payout_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dpb_uat BEFORE UPDATE ON public.driver_payout_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_dp_uat BEFORE UPDATE ON public.driver_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Regime classification (Kenya thresholds; TOT < 25M)
CREATE OR REPLACE FUNCTION public.driver_classify_regime(_annual_turnover_cents bigint)
RETURNS public.driver_tax_regime
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN _annual_turnover_cents < 2500000000 THEN 'TOT'::public.driver_tax_regime  -- KES 25,000,000
    ELSE 'INCOME_TAX'::public.driver_tax_regime
  END
$$;

-- Numbering helpers
CREATE OR REPLACE FUNCTION public.next_driver_etims_invoice_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n bigint;
BEGIN
  _n := nextval('public.driver_etims_invoice_seq');
  RETURN 'DRV-' || to_char(now(),'YYYYMM') || '-' || lpad(_n::text, 8, '0');
END $$;

CREATE OR REPLACE FUNCTION public.next_driver_payout_batch_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n bigint;
BEGIN
  _n := nextval('public.driver_payout_batch_seq');
  RETURN 'DPB-' || to_char(now(),'YYYYMMDD') || '-' || lpad(_n::text, 5, '0');
END $$;

-- ============================================================
-- driver_accrue_tax_for_revenue
-- Accrues TOT (3%) or INCOME_TAX (placeholder rate) liability
-- against the period bucket for a recognized revenue event.
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_accrue_tax_for_revenue(_revenue_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _rev record;
  _profile record;
  _regime public.driver_tax_regime;
  _rate_bps int;
  _scheme text;
  _tax_cents bigint;
  _period_start date;
  _period_end date;
  _due date;
  _liab_id uuid;
BEGIN
  SELECT * INTO _rev FROM public.revenue_events WHERE id = _revenue_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revenue event % not found', _revenue_event_id; END IF;
  IF _rev.driver_id IS NULL THEN RAISE EXCEPTION 'Revenue event % has no driver', _revenue_event_id; END IF;
  IF _rev.status <> 'RECOGNIZED' THEN RAISE EXCEPTION 'Revenue event not RECOGNIZED'; END IF;

  SELECT * INTO _profile FROM public.driver_tax_profiles WHERE driver_id = _rev.driver_id;
  IF NOT FOUND THEN
    -- Auto-create a default TOT profile
    INSERT INTO public.driver_tax_profiles (driver_id, kra_pin, current_regime, status)
    VALUES (_rev.driver_id, COALESCE(_rev.metadata->>'driver_kra_pin','UNKNOWN'), 'TOT', 'PENDING')
    RETURNING * INTO _profile;
  END IF;

  _regime := _profile.current_regime;
  IF _regime = 'TOT' THEN
    _rate_bps := 300;  -- 3%
    _scheme := 'TOT';
  ELSIF _regime = 'INCOME_TAX' THEN
    _rate_bps := 3000; -- 30% placeholder on net business income
    _scheme := 'INCOME_TAX_KE';
  ELSIF _regime = 'PAYE' THEN
    _rate_bps := 2500; -- 25% placeholder banded
    _scheme := 'PAYE_KE';
  ELSE
    RETURN NULL;
  END IF;

  _tax_cents := (_rev.gross_amount_cents * _rate_bps) / 10000;
  _period_start := date_trunc('month', _rev.occurred_at)::date;
  _period_end := (date_trunc('month', _rev.occurred_at) + interval '1 month - 1 day')::date;
  _due := _period_end + interval '20 days';

  INSERT INTO public.driver_tax_liabilities
    (driver_id, period_start, period_end, scheme_code, rate_bps, taxable_cents, amount_cents, due_date, metadata)
  VALUES
    (_rev.driver_id, _period_start, _period_end, _scheme, _rate_bps,
     _rev.gross_amount_cents, _tax_cents, _due,
     jsonb_build_object('source_revenue_event', _revenue_event_id))
  ON CONFLICT (driver_id, period_start, period_end, scheme_code)
  DO UPDATE SET
    taxable_cents = public.driver_tax_liabilities.taxable_cents + EXCLUDED.taxable_cents,
    amount_cents  = public.driver_tax_liabilities.amount_cents  + EXCLUDED.amount_cents,
    updated_at    = now()
  RETURNING id INTO _liab_id;

  RETURN _liab_id;
END $$;

-- ============================================================
-- driver_payout_create
-- Finance / admin RPC: creates a payout in QUEUED state,
-- posts journal DR Driver Payable / CR Bank Clearing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_payout_create(
  _driver_id uuid,
  _amount_cents bigint,
  _method_id uuid,
  _batch_id uuid DEFAULT NULL,
  _memo text DEFAULT 'Driver payout'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _payout_id uuid := gen_random_uuid();
  _journal_id uuid := gen_random_uuid();
  _payable uuid;
  _bank uuid;
  _method record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may create payouts';
  END IF;
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT * INTO _method FROM public.driver_payout_methods WHERE id = _method_id AND driver_id = _driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout method not found for driver'; END IF;

  -- 2110 Driver Payables / 1110 Bank Clearing (create if missing)
  SELECT id INTO _payable FROM public.ledger_accounts WHERE coa_code = '2110' LIMIT 1;
  IF _payable IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('DRIVER_PAYABLE','Driver Payables','LIABILITY','KES','2110') RETURNING id INTO _payable;
  END IF;
  SELECT id INTO _bank FROM public.ledger_accounts WHERE coa_code = '1110' LIMIT 1;
  IF _bank IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('BANK_CLEARING','Bank/Payout Clearing','ASSET','KES','1110') RETURNING id INTO _bank;
  END IF;

  INSERT INTO public.driver_payouts
    (id, driver_id, method_id, batch_id, amount_cents, currency, status,
     requested_by, approved_by, approved_at, metadata)
  VALUES
    (_payout_id, _driver_id, _method_id, _batch_id, _amount_cents, 'KES', 'QUEUED',
     auth.uid(), auth.uid(), now(),
     jsonb_build_object('memo', _memo));

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (_journal_id, 'DRIVER_PAYOUT', _payout_id::text, _memo, auth.uid());

  INSERT INTO public.journal_lines
    (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (_journal_id, _payable, 'DEBIT',  _amount_cents, 'KES', 'DR Driver payable (payout '||_payout_id||')', auth.uid()),
    (_journal_id, _bank,    'CREDIT', _amount_cents, 'KES', 'CR Bank clearing',                            auth.uid());

  PERFORM public.posting_engine_post(_journal_id);

  UPDATE public.driver_payouts SET journal_id = _journal_id WHERE id = _payout_id;

  IF _batch_id IS NOT NULL THEN
    UPDATE public.driver_payout_batches
       SET total_count = total_count + 1,
           total_amount_cents = total_amount_cents + _amount_cents
     WHERE id = _batch_id;
  END IF;

  RETURN _payout_id;
END $$;

-- ============================================================
-- driver_payout_batch_reconcile
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_payout_batch_reconcile(_batch_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _b record;
  _actual_count int;
  _actual_amount bigint;
  _status text;
  _rec_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO _b FROM public.driver_payout_batches WHERE id = _batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch % not found', _batch_id; END IF;

  SELECT count(*), COALESCE(sum(amount_cents),0)
    INTO _actual_count, _actual_amount
  FROM public.driver_payouts
  WHERE batch_id = _batch_id AND status = 'SUCCESS';

  _status := CASE
    WHEN _actual_count = _b.total_count AND _actual_amount = _b.total_amount_cents THEN 'OK'
    WHEN abs(_b.total_amount_cents - _actual_amount) < 100 THEN 'VARIANCE'
    ELSE 'FAILED'
  END;

  INSERT INTO public.driver_payout_reconciliation
    (id, batch_id, expected_count, actual_count, expected_amount_cents, actual_amount_cents, status)
  VALUES (_rec_id, _batch_id, _b.total_count, _actual_count,
          _b.total_amount_cents, _actual_amount, _status);

  IF _status = 'OK' THEN
    UPDATE public.driver_payout_batches SET status = 'RECONCILED', settled_at = COALESCE(settled_at, now())
      WHERE id = _batch_id;
  END IF;

  RETURN _rec_id;
END $$;
