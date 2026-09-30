
-- =========================================================================
-- T1: Tax core schema
-- =========================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.tax_scheme_kind AS ENUM ('VAT','REVERSE_CHARGE_VAT','WITHHOLDING','CORPORATE','DIGITAL_SERVICE','ZERO_RATED','EXEMPT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tax_period_status AS ENUM ('OPEN','LOCKED','CLOSED','FILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tax_audit_event AS ENUM ('INSERT','UPDATE','STATUS_CHANGE','ADJUSTMENT','EXEMPTION_GRANTED','EXEMPTION_REVOKED','CALCULATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. tax_schemes ----------------------------------------------------------
CREATE TABLE public.tax_schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind public.tax_scheme_kind NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'KE',
  description text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tax_schemes TO authenticated;
GRANT ALL ON public.tax_schemes TO service_role;
ALTER TABLE public.tax_schemes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_schemes" ON public.tax_schemes FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_schemes_updated BEFORE UPDATE ON public.tax_schemes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. tax_rates ------------------------------------------------------------
CREATE TABLE public.tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES public.tax_schemes(id) ON DELETE RESTRICT,
  rate_bps int NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  jurisdiction text NOT NULL DEFAULT 'KE',
  currency text NOT NULL DEFAULT 'KES',
  effective_from date NOT NULL,
  effective_to date,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_tax_rates_lookup ON public.tax_rates(scheme_id, jurisdiction, effective_from DESC);
GRANT SELECT ON public.tax_rates TO authenticated;
GRANT ALL ON public.tax_rates TO service_role;
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_rates" ON public.tax_rates FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_rates_updated BEFORE UPDATE ON public.tax_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. tax_rules ------------------------------------------------------------
CREATE TABLE public.tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL,
  version int NOT NULL DEFAULT 1,
  scheme_id uuid NOT NULL REFERENCES public.tax_schemes(id),
  predicate jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, version)
);
GRANT SELECT ON public.tax_rules TO authenticated;
GRANT ALL ON public.tax_rules TO service_role;
ALTER TABLE public.tax_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_rules" ON public.tax_rules FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_rules_updated BEFORE UPDATE ON public.tax_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. tax_periods ----------------------------------------------------------
CREATE TABLE public.tax_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES public.tax_schemes(id),
  jurisdiction text NOT NULL DEFAULT 'KE',
  period_start date NOT NULL,
  period_end date NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('MONTHLY','QUARTERLY','ANNUAL')),
  status public.tax_period_status NOT NULL DEFAULT 'OPEN',
  filed_at timestamptz,
  filed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (scheme_id, jurisdiction, period_start, period_end)
);
GRANT SELECT ON public.tax_periods TO authenticated;
GRANT ALL ON public.tax_periods TO service_role;
ALTER TABLE public.tax_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_periods" ON public.tax_periods FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_periods_updated BEFORE UPDATE ON public.tax_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. tax_calculations (append-only audit of engine runs) ------------------
CREATE TABLE public.tax_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES public.tax_schemes(id),
  rate_id uuid NOT NULL REFERENCES public.tax_rates(id),
  source_kind text NOT NULL,                -- 'ride','wallet_txn','corporate_invoice','adjustment'
  source_id uuid,
  subject_user_id uuid,                     -- customer/corporate id (nullable)
  amount_cents bigint NOT NULL,             -- pre-tax base
  tax_cents bigint NOT NULL,                -- computed tax
  total_cents bigint NOT NULL,              -- amount + tax (or net of WHT)
  currency text NOT NULL DEFAULT 'KES',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_snapshot jsonb NOT NULL,             -- frozen copy of rate at calc time
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by uuid
);
CREATE INDEX idx_tax_calc_source ON public.tax_calculations(source_kind, source_id);
CREATE INDEX idx_tax_calc_subject ON public.tax_calculations(subject_user_id, calculated_at DESC);
GRANT SELECT ON public.tax_calculations TO authenticated;
GRANT ALL ON public.tax_calculations TO service_role;
ALTER TABLE public.tax_calculations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_calculations" ON public.tax_calculations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
-- Append-only: deny UPDATE/DELETE for everyone except service_role
CREATE OR REPLACE FUNCTION public.deny_tax_mutation()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Tax records are append-only; create an adjustment instead';
END $$;
CREATE TRIGGER trg_tax_calc_no_update BEFORE UPDATE OR DELETE ON public.tax_calculations
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

-- 6. transaction_taxes ----------------------------------------------------
CREATE TABLE public.transaction_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id uuid NOT NULL REFERENCES public.tax_calculations(id),
  mpesa_transaction_id uuid REFERENCES public.mpesa_transactions(id),
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  journal_id uuid REFERENCES public.journals(id),
  scheme_code text NOT NULL,
  tax_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_txn_taxes_mpesa ON public.transaction_taxes(mpesa_transaction_id);
CREATE INDEX idx_txn_taxes_journal ON public.transaction_taxes(journal_id);
GRANT SELECT ON public.transaction_taxes TO authenticated;
GRANT ALL ON public.transaction_taxes TO service_role;
ALTER TABLE public.transaction_taxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view transaction_taxes" ON public.transaction_taxes FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_txn_taxes_no_update BEFORE UPDATE OR DELETE ON public.transaction_taxes
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

-- 7. tax_exemptions -------------------------------------------------------
CREATE TABLE public.tax_exemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id uuid NOT NULL REFERENCES public.tax_schemes(id),
  subject_kind text NOT NULL CHECK (subject_kind IN ('user','corporate','category')),
  subject_id uuid,
  subject_code text,
  reason text NOT NULL,
  certificate_url text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES auth.users(id),
  revoked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tax_exemptions TO authenticated;
GRANT ALL ON public.tax_exemptions TO service_role;
ALTER TABLE public.tax_exemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_exemptions" ON public.tax_exemptions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_exemptions_updated BEFORE UPDATE ON public.tax_exemptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. tax_adjustments (append-only) ----------------------------------------
CREATE TABLE public.tax_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id uuid REFERENCES public.tax_calculations(id),
  period_id uuid REFERENCES public.tax_periods(id),
  scheme_id uuid NOT NULL REFERENCES public.tax_schemes(id),
  delta_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  reason text NOT NULL,
  approved_by uuid REFERENCES auth.users(id),
  journal_id uuid REFERENCES public.journals(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tax_adjustments TO authenticated;
GRANT ALL ON public.tax_adjustments TO service_role;
ALTER TABLE public.tax_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_adjustments" ON public.tax_adjustments FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_adjustments_no_update BEFORE UPDATE OR DELETE ON public.tax_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

-- 9. tax_audit_logs (append-only) -----------------------------------------
CREATE TABLE public.tax_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL,                -- 'tax_calculations','tax_rates','tax_exemptions',...
  entity_id uuid,
  event_type public.tax_audit_event NOT NULL,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'user',
  ip_address inet,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tax_audit_entity ON public.tax_audit_logs(entity_kind, entity_id, created_at DESC);
GRANT SELECT ON public.tax_audit_logs TO authenticated;
GRANT ALL ON public.tax_audit_logs TO service_role;
ALTER TABLE public.tax_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance view tax_audit_logs" ON public.tax_audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_tax_audit_no_mutation BEFORE UPDATE OR DELETE ON public.tax_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

-- =========================================================================
-- Tax engine: pure rate lookup + calculation, returns calculation id
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tax_engine_calculate(
  _scheme_code text,
  _source_kind text,
  _source_id uuid,
  _amount_cents bigint,
  _currency text DEFAULT 'KES',
  _subject_user_id uuid DEFAULT NULL,
  _on_date date DEFAULT CURRENT_DATE,
  _inputs jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _scheme record;
  _rate record;
  _tax_cents bigint;
  _total_cents bigint;
  _calc_id uuid := gen_random_uuid();
  _exempt boolean := false;
BEGIN
  SELECT * INTO _scheme FROM public.tax_schemes WHERE code = _scheme_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax scheme % not found or inactive', _scheme_code; END IF;

  -- Check active exemption
  IF _subject_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tax_exemptions
      WHERE scheme_id = _scheme.id
        AND subject_kind = 'user'
        AND subject_id = _subject_user_id
        AND active = true
        AND effective_from <= _on_date
        AND (effective_to IS NULL OR effective_to >= _on_date)
    ) INTO _exempt;
  END IF;

  IF _exempt OR _scheme.kind IN ('EXEMPT','ZERO_RATED') THEN
    INSERT INTO public.tax_calculations
      (id, scheme_id, rate_id, source_kind, source_id, subject_user_id,
       amount_cents, tax_cents, total_cents, currency, inputs, rate_snapshot, calculated_by)
    SELECT _calc_id, _scheme.id, tr.id, _source_kind, _source_id, _subject_user_id,
           _amount_cents, 0, _amount_cents, _currency, _inputs,
           jsonb_build_object('exempt', true, 'reason', _scheme.kind), auth.uid()
    FROM public.tax_rates tr
    WHERE tr.scheme_id = _scheme.id
    ORDER BY tr.effective_from DESC LIMIT 1;
    RETURN _calc_id;
  END IF;

  -- Pick the rate effective on _on_date
  SELECT * INTO _rate FROM public.tax_rates
   WHERE scheme_id = _scheme.id
     AND jurisdiction = _scheme.jurisdiction
     AND effective_from <= _on_date
     AND (effective_to IS NULL OR effective_to >= _on_date)
   ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tax rate for scheme % on %', _scheme_code, _on_date;
  END IF;

  -- VAT / DST / Corporate: tax = base * rate
  -- Withholding: tax = base * rate, total = base - tax (subtracted from payout)
  _tax_cents := (_amount_cents * _rate.rate_bps) / 10000;
  IF _scheme.kind = 'WITHHOLDING' THEN
    _total_cents := _amount_cents - _tax_cents;
  ELSE
    _total_cents := _amount_cents + _tax_cents;
  END IF;

  INSERT INTO public.tax_calculations
    (id, scheme_id, rate_id, source_kind, source_id, subject_user_id,
     amount_cents, tax_cents, total_cents, currency, inputs, rate_snapshot, calculated_by)
  VALUES
    (_calc_id, _scheme.id, _rate.id, _source_kind, _source_id, _subject_user_id,
     _amount_cents, _tax_cents, _total_cents, _currency, _inputs,
     to_jsonb(_rate), auth.uid());

  -- Audit
  INSERT INTO public.tax_audit_logs (entity_kind, entity_id, event_type, new_value, actor_id, actor_type)
  VALUES ('tax_calculations', _calc_id, 'CALCULATION',
          jsonb_build_object('scheme', _scheme_code, 'amount_cents', _amount_cents, 'tax_cents', _tax_cents),
          auth.uid(),
          CASE WHEN auth.uid() IS NULL THEN 'service' ELSE 'user' END);

  RETURN _calc_id;
END $$;

-- =========================================================================
-- Seed Kenya schemes + rates (DML inside DDL migration is fine for seeds)
-- =========================================================================
INSERT INTO public.tax_schemes (code, name, kind, jurisdiction, description) VALUES
  ('VAT_KE',          'Kenya VAT (Standard)',     'VAT',                 'KE', 'Standard VAT on rideshare, delivery, rentals'),
  ('VAT_KE_ZERO',     'Kenya VAT (Zero-Rated)',   'ZERO_RATED',          'KE', 'Zero-rated services per KRA schedule'),
  ('VAT_KE_EXEMPT',   'Kenya VAT (Exempt)',       'EXEMPT',              'KE', 'Exempt services per KRA schedule'),
  ('VAT_KE_REVERSE',  'Kenya Reverse-Charge VAT', 'REVERSE_CHARGE_VAT',  'KE', 'Imported services reverse charge'),
  ('WHT_KE_DRIVER',   'Kenya WHT (Driver Payouts)','WITHHOLDING',        'KE', 'WHT on driver commissions/payouts'),
  ('DST_KE',          'Kenya Digital Service Tax','DIGITAL_SERVICE',     'KE', 'DST 1.5% on digital marketplace fees'),
  ('CIT_KE',          'Kenya Corporate Income Tax','CORPORATE',          'KE', 'Annual corporate income tax')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.tax_rates (scheme_id, rate_bps, jurisdiction, currency, effective_from, notes)
SELECT id, 1600, 'KE', 'KES', '2026-01-01'::date, 'Standard VAT 16%' FROM public.tax_schemes WHERE code='VAT_KE'
ON CONFLICT DO NOTHING;

INSERT INTO public.tax_rates (scheme_id, rate_bps, jurisdiction, currency, effective_from, notes)
SELECT id, 0, 'KE', 'KES', '2026-01-01'::date, 'Zero-rated' FROM public.tax_schemes WHERE code='VAT_KE_ZERO'
ON CONFLICT DO NOTHING;

INSERT INTO public.tax_rates (scheme_id, rate_bps, jurisdiction, currency, effective_from, notes)
SELECT id, 0, 'KE', 'KES', '2026-01-01'::date, 'Exempt' FROM public.tax_schemes WHERE code='VAT_KE_EXEMPT'
ON CONFLICT DO NOTHING;

INSERT INTO public.tax_rates (scheme_id, rate_bps, jurisdiction, currency, effective_from, notes)
SELECT id, 500, 'KE', 'KES', '2026-01-01'::date, 'WHT 5% on driver payouts' FROM public.tax_schemes WHERE code='WHT_KE_DRIVER'
ON CONFLICT DO NOTHING;

INSERT INTO public.tax_rates (scheme_id, rate_bps, jurisdiction, currency, effective_from, notes)
SELECT id, 150, 'KE', 'KES', '2026-01-01'::date, 'DST 1.5%' FROM public.tax_schemes WHERE code='DST_KE'
ON CONFLICT DO NOTHING;

INSERT INTO public.tax_rates (scheme_id, rate_bps, jurisdiction, currency, effective_from, notes)
SELECT id, 3000, 'KE', 'KES', '2026-01-01'::date, 'CIT 30%' FROM public.tax_schemes WHERE code='CIT_KE'
ON CONFLICT DO NOTHING;

-- Seed current month VAT period
INSERT INTO public.tax_periods (scheme_id, jurisdiction, period_start, period_end, cadence, status)
SELECT id, 'KE', date_trunc('month', CURRENT_DATE)::date,
       (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
       'MONTHLY', 'OPEN'
FROM public.tax_schemes WHERE code='VAT_KE'
ON CONFLICT DO NOTHING;
