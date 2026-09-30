-- =========================================================================
-- PHASE 7 — FREIGHT AUDIT, BILLING & FINANCIAL RECONCILIATION
-- Financial truth layer over the EXISTING logistics + M-Pesa authorities.
-- No duplicate payment engine: mpesa_transactions / payment_attempts remain
-- the payment authority and are only REFERENCED from allocations.
-- =========================================================================

-- ---------- enums ----------
DO $$ BEGIN
  CREATE TYPE public.freight_quote_status AS ENUM ('DRAFT','ISSUED','ACCEPTED','EXPIRED','SUPERSEDED','WITHDRAWN','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_charge_status AS ENUM ('CALCULATED','PENDING_REVIEW','APPROVED','INVOICED','PAID','SETTLED','VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_charge_party AS ENUM ('CUSTOMER','CARRIER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_invoice_status AS ENUM ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_alloc_state AS ENUM ('ALLOCATED','PARTIAL','OVERPAYMENT','UNDERPAYMENT','UNMATCHED','REVERSED','DUPLICATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_settlement_status AS ENUM ('CALCULATED','PENDING_REVIEW','APPROVED','PAID','REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_finding_severity AS ENUM ('INFO','MINOR','MAJOR','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_finding_state AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED','WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.freight_config_state AS ENUM ('CONFIGURED','OWNER_CONFIGURATION_REQUIRED','PROVIDER_CONFIGURATION_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- shared touch trigger ----------
CREATE OR REPLACE FUNCTION public._freight_fin_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------- permissions ----------
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
  ('staff.finance.read','finance','read','View freight charges, invoices, settlements and reconciliation'),
  ('staff.finance.charge.manage','finance','charge.manage','Create, review, approve, adjust and void freight charges'),
  ('staff.finance.invoice.manage','finance','invoice.manage','Build, issue and void freight invoices'),
  ('staff.finance.payment.allocate','finance','payment.allocate','Allocate received payments to freight invoices'),
  ('staff.finance.settlement.approve','finance','settlement.approve','Approve and pay carrier settlements'),
  ('staff.finance.audit.run','finance','audit.run','Run freight audit and three-way reconciliation'),
  ('staff.finance.config.manage','finance','config.manage','Manage billing, tax and provider configuration')
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['admin','finance_admin','finance_manager'] LOOP
    IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
               WHERE t.typname='app_role' AND e.enumlabel=r) THEN
      INSERT INTO public.staff_role_permissions (role, permission_key)
      SELECT r::public.app_role, k FROM unnest(ARRAY[
        'staff.finance.read','staff.finance.charge.manage','staff.finance.invoice.manage',
        'staff.finance.payment.allocate','staff.finance.settlement.approve',
        'staff.finance.audit.run','staff.finance.config.manage']) k
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- =========================================================================
-- 1. BILLING / PROVIDER CONFIGURATION (never a HOLD)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_billing_config (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  state public.freight_config_state NOT NULL DEFAULT 'OWNER_CONFIGURATION_REQUIRED',
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_role text,
  guidance text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.freight_billing_config TO authenticated;
GRANT ALL ON public.freight_billing_config TO service_role;
ALTER TABLE public.freight_billing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read billing config" ON public.freight_billing_config
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE POLICY "finance staff write billing config" ON public.freight_billing_config
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.finance.config.manage'))
  WITH CHECK (public.has_staff_permission('staff.finance.config.manage'));
CREATE TRIGGER trg_freight_billing_config_touch BEFORE UPDATE ON public.freight_billing_config
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

INSERT INTO public.freight_billing_config (key,label,category,state,owner_role,guidance) VALUES
 ('invoice.numbering','Invoice numbering scheme','billing','CONFIGURED','finance','Prefix and sequence for freight invoice numbers'),
 ('tax.vat_rate','VAT rate and registration','tax','OWNER_CONFIGURATION_REQUIRED','finance','KRA VAT rate and PIN used on freight invoices'),
 ('tax.etims_endpoint','eTIMS submission endpoint','tax','PROVIDER_CONFIGURATION_REQUIRED','finance','KRA eTIMS OSCU submit path and credentials'),
 ('settlement.bank_account','Carrier settlement disbursement account','settlement','OWNER_CONFIGURATION_REQUIRED','finance','Bank / M-Pesa B2B account used to pay carriers'),
 ('payment.provider.mpesa','M-Pesa payment authority','payment','CONFIGURED','finance','Existing Yalla M-Pesa engine is the payment authority; freight only references it'),
 ('payment.provider.card','Card acquiring provider','payment','PROVIDER_CONFIGURATION_REQUIRED','finance','Card provider credentials for freight invoices'),
 ('currency.base','Base reporting currency','billing','CONFIGURED','finance','KES base currency for freight billing')
ON CONFLICT (key) DO NOTHING;
UPDATE public.freight_billing_config SET value='{"prefix":"FIN","pad":6}'::jsonb WHERE key='invoice.numbering' AND value='{}'::jsonb;
UPDATE public.freight_billing_config SET value='{"code":"KES"}'::jsonb WHERE key='currency.base' AND value='{}'::jsonb;

-- =========================================================================
-- 2. FREIGHT QUOTES — immutable commercial snapshot
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_reference text NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  status public.freight_quote_status NOT NULL DEFAULT 'DRAFT',
  owner_user_id uuid,
  corporate_account_id uuid,
  order_id uuid,
  requirement_id uuid,
  offering_code text NOT NULL,
  rate_card_id uuid,
  rate_plan_version integer,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  quoted_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  valid_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  superseded_by_quote_id uuid REFERENCES public.freight_quotes(id),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_freight_quotes_owner ON public.freight_quotes(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_freight_quotes_order ON public.freight_quotes(order_id);
GRANT SELECT, INSERT, UPDATE ON public.freight_quotes TO authenticated;
GRANT ALL ON public.freight_quotes TO service_role;
ALTER TABLE public.freight_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers read own freight quotes" ON public.freight_quotes
  FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "finance staff read freight quotes" ON public.freight_quotes
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE POLICY "finance staff manage freight quotes" ON public.freight_quotes
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.finance.charge.manage'))
  WITH CHECK (public.has_staff_permission('staff.finance.charge.manage'));
CREATE TRIGGER trg_freight_quotes_touch BEFORE UPDATE ON public.freight_quotes
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

-- Historical immutability: once issued, the priced snapshot is frozen forever.
CREATE OR REPLACE FUNCTION public._freight_quote_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
       OR NEW.quoted_amount IS DISTINCT FROM OLD.quoted_amount
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.rate_card_id IS DISTINCT FROM OLD.rate_card_id
       OR NEW.rate_plan_version IS DISTINCT FROM OLD.rate_plan_version THEN
      RAISE EXCEPTION 'freight quote % is immutable after issue (retro-pricing refused)', OLD.quote_reference;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_freight_quote_immutable BEFORE UPDATE ON public.freight_quotes
  FOR EACH ROW EXECUTE FUNCTION public._freight_quote_immutable();

-- =========================================================================
-- 3. CHARGES + append-only events + adjustments
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_number text NOT NULL UNIQUE,
  party public.freight_charge_party NOT NULL,
  status public.freight_charge_status NOT NULL DEFAULT 'CALCULATED',
  customer_user_id uuid,
  corporate_account_id uuid,
  carrier_id uuid REFERENCES public.carrier_profiles(id),
  order_id uuid,
  package_id uuid REFERENCES public.packages(id),
  booking_id uuid REFERENCES public.freight_bookings(id),
  award_id uuid REFERENCES public.freight_awards(id),
  manifest_id uuid REFERENCES public.logistics_manifests(id),
  route_id uuid,
  stop_id uuid,
  quote_id uuid REFERENCES public.freight_quotes(id),
  rate_card_id uuid REFERENCES public.carrier_rate_cards(id),
  rate_line_id uuid REFERENCES public.carrier_rate_lines(id),
  charge_code text NOT NULL,
  basis public.freight_pricing_basis NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_rate numeric(14,4) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  commercial_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  operational_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_code text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id text,
  idempotency_key text NOT NULL UNIQUE,
  invoice_id uuid,
  settlement_id uuid,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_freight_charges_party_status ON public.freight_charges(party, status);
CREATE INDEX IF NOT EXISTS idx_freight_charges_booking ON public.freight_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_freight_charges_customer ON public.freight_charges(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_freight_charges_carrier ON public.freight_charges(carrier_id);
GRANT SELECT ON public.freight_charges TO authenticated;
GRANT ALL ON public.freight_charges TO service_role;
ALTER TABLE public.freight_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers read own freight charges" ON public.freight_charges
  FOR SELECT TO authenticated USING (party = 'CUSTOMER' AND customer_user_id = auth.uid());
CREATE POLICY "carriers read own freight charges" ON public.freight_charges
  FOR SELECT TO authenticated
  USING (party = 'CARRIER' AND carrier_id IS NOT NULL AND public._carrier_is_member(carrier_id));
CREATE POLICY "finance staff read freight charges" ON public.freight_charges
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE TRIGGER trg_freight_charges_touch BEFORE UPDATE ON public.freight_charges
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

CREATE TABLE IF NOT EXISTS public.freight_charge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.freight_charges(id) ON DELETE CASCADE,
  from_status public.freight_charge_status,
  to_status public.freight_charge_status NOT NULL,
  reason_code text,
  note text,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'staff',
  correlation_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_freight_charge_events_charge ON public.freight_charge_events(charge_id, created_at DESC);
GRANT SELECT ON public.freight_charge_events TO authenticated;
GRANT ALL ON public.freight_charge_events TO service_role;
ALTER TABLE public.freight_charge_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read charge events" ON public.freight_charge_events
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));

CREATE OR REPLACE FUNCTION public._freight_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'financial history is append-only (%).', TG_TABLE_NAME;
END $$;
CREATE TRIGGER trg_freight_charge_events_append_only
  BEFORE UPDATE OR DELETE ON public.freight_charge_events
  FOR EACH ROW EXECUTE FUNCTION public._freight_append_only();

CREATE TABLE IF NOT EXISTS public.freight_charge_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.freight_charges(id),
  kind text NOT NULL CHECK (kind IN ('CREDIT','DEBIT','REVERSAL')),
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  reason_code text NOT NULL,
  reason_note text,
  requested_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  correlation_id uuid,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.freight_charge_adjustments TO authenticated;
GRANT ALL ON public.freight_charge_adjustments TO service_role;
ALTER TABLE public.freight_charge_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read adjustments" ON public.freight_charge_adjustments
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE TRIGGER trg_freight_adjustments_no_delete
  BEFORE DELETE ON public.freight_charge_adjustments
  FOR EACH ROW EXECUTE FUNCTION public._freight_append_only();

-- =========================================================================
-- 4. INVOICES + LINES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  party public.freight_charge_party NOT NULL DEFAULT 'CUSTOMER',
  status public.freight_invoice_status NOT NULL DEFAULT 'DRAFT',
  customer_user_id uuid,
  corporate_account_id uuid,
  carrier_id uuid REFERENCES public.carrier_profiles(id),
  currency text NOT NULL DEFAULT 'KES',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  paid_total numeric(14,2) NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  issued_at timestamptz,
  due_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_freight_invoices_customer ON public.freight_invoices(customer_user_id);
GRANT SELECT ON public.freight_invoices TO authenticated;
GRANT ALL ON public.freight_invoices TO service_role;
ALTER TABLE public.freight_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers read own freight invoices" ON public.freight_invoices
  FOR SELECT TO authenticated USING (customer_user_id = auth.uid());
CREATE POLICY "carriers read own freight invoices" ON public.freight_invoices
  FOR SELECT TO authenticated
  USING (carrier_id IS NOT NULL AND public._carrier_is_member(carrier_id));
CREATE POLICY "finance staff read freight invoices" ON public.freight_invoices
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE TRIGGER trg_freight_invoices_touch BEFORE UPDATE ON public.freight_invoices
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

CREATE TABLE IF NOT EXISTS public.freight_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.freight_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  charge_id uuid NOT NULL REFERENCES public.freight_charges(id),
  description text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1,
  unit_rate numeric(14,4) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_no),
  UNIQUE (invoice_id, charge_id)
);
GRANT SELECT ON public.freight_invoice_lines TO authenticated;
GRANT ALL ON public.freight_invoice_lines TO service_role;
ALTER TABLE public.freight_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read freight invoice lines with invoice" ON public.freight_invoice_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.freight_invoices i WHERE i.id = invoice_id AND (
      i.customer_user_id = auth.uid()
      OR (i.carrier_id IS NOT NULL AND public._carrier_is_member(i.carrier_id))
      OR public.has_staff_permission('staff.finance.read'))));
CREATE TRIGGER trg_freight_invoice_lines_append_only
  BEFORE UPDATE OR DELETE ON public.freight_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public._freight_append_only();

-- =========================================================================
-- 5. PAYMENT ALLOCATIONS — references the EXISTING payment authority only
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES public.freight_invoices(id),
  invoice_line_id uuid REFERENCES public.freight_invoice_lines(id),
  payment_attempt_id uuid REFERENCES public.payment_attempts(id),
  mpesa_transaction_id uuid REFERENCES public.mpesa_transactions(id),
  provider text NOT NULL DEFAULT 'mpesa',
  provider_reference text,
  provider_status text,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  state public.freight_alloc_state NOT NULL,
  unmatched_reason text,
  correlation_id uuid,
  request_id text,
  idempotency_key text NOT NULL UNIQUE,
  allocated_by uuid,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_attempt_id IS NOT NULL OR mpesa_transaction_id IS NOT NULL OR provider_reference IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_freight_alloc_invoice ON public.freight_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_freight_alloc_provider_ref ON public.freight_payment_allocations(provider, provider_reference);
GRANT SELECT ON public.freight_payment_allocations TO authenticated;
GRANT ALL ON public.freight_payment_allocations TO service_role;
ALTER TABLE public.freight_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read allocations" ON public.freight_payment_allocations
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE POLICY "customers read own allocations" ON public.freight_payment_allocations
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.freight_invoices i WHERE i.id = invoice_id AND i.customer_user_id = auth.uid()));
CREATE TRIGGER trg_freight_alloc_touch BEFORE UPDATE ON public.freight_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

-- =========================================================================
-- 6. CARRIER SETTLEMENTS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_carrier_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_number text NOT NULL UNIQUE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id),
  contract_id uuid REFERENCES public.carrier_contracts(id),
  status public.freight_settlement_status NOT NULL DEFAULT 'CALCULATED',
  currency text NOT NULL DEFAULT 'KES',
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  adjustments_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_payable numeric(14,2) NOT NULL DEFAULT 0,
  carrier_claimed_amount numeric(14,2),
  variance_amount numeric(14,2) NOT NULL DEFAULT 0,
  payout_reference text,
  paid_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.freight_carrier_settlements TO authenticated;
GRANT ALL ON public.freight_carrier_settlements TO service_role;
ALTER TABLE public.freight_carrier_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "carriers read own settlements" ON public.freight_carrier_settlements
  FOR SELECT TO authenticated USING (public._carrier_is_member(carrier_id));
CREATE POLICY "finance staff read settlements" ON public.freight_carrier_settlements
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE TRIGGER trg_freight_settlements_touch BEFORE UPDATE ON public.freight_carrier_settlements
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

CREATE TABLE IF NOT EXISTS public.freight_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.freight_carrier_settlements(id) ON DELETE CASCADE,
  charge_id uuid REFERENCES public.freight_charges(id),
  booking_id uuid REFERENCES public.freight_bookings(id),
  description text NOT NULL,
  eligible_amount numeric(14,2) NOT NULL DEFAULT 0,
  adjustment_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, charge_id)
);
GRANT SELECT ON public.freight_settlement_lines TO authenticated;
GRANT ALL ON public.freight_settlement_lines TO service_role;
ALTER TABLE public.freight_settlement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read settlement lines with settlement" ON public.freight_settlement_lines
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.freight_carrier_settlements s WHERE s.id = settlement_id AND (
      public._carrier_is_member(s.carrier_id) OR public.has_staff_permission('staff.finance.read'))));
CREATE TRIGGER trg_freight_settlement_lines_append_only
  BEFORE UPDATE OR DELETE ON public.freight_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION public._freight_append_only();

-- =========================================================================
-- 7. FREIGHT AUDIT RUNS + FINDINGS
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'window',
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  bookings_scanned integer NOT NULL DEFAULT 0,
  charges_scanned integer NOT NULL DEFAULT 0,
  invoices_scanned integer NOT NULL DEFAULT 0,
  findings integer NOT NULL DEFAULT 0,
  critical integer NOT NULL DEFAULT 0,
  balanced boolean NOT NULL DEFAULT true,
  triggered_by uuid,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.freight_audit_runs TO authenticated;
GRANT ALL ON public.freight_audit_runs TO service_role;
ALTER TABLE public.freight_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read audit runs" ON public.freight_audit_runs
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));

CREATE TABLE IF NOT EXISTS public.freight_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.freight_audit_runs(id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  severity public.freight_finding_severity NOT NULL DEFAULT 'MAJOR',
  state public.freight_finding_state NOT NULL DEFAULT 'OPEN',
  booking_id uuid REFERENCES public.freight_bookings(id),
  award_id uuid REFERENCES public.freight_awards(id),
  charge_id uuid REFERENCES public.freight_charges(id),
  invoice_id uuid REFERENCES public.freight_invoices(id),
  settlement_id uuid REFERENCES public.freight_carrier_settlements(id),
  carrier_id uuid REFERENCES public.carrier_profiles(id),
  expected_amount numeric(14,2),
  actual_amount numeric(14,2),
  variance_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  detail text NOT NULL,
  source_records jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  owner_role text,
  resolution_notes text,
  resolution_evidence jsonb,
  resolved_by uuid,
  resolved_at timestamptz,
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_finding_fingerprint
  ON public.freight_audit_findings(fingerprint) WHERE fingerprint IS NOT NULL AND state = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_freight_findings_state ON public.freight_audit_findings(state, severity);
GRANT SELECT ON public.freight_audit_findings TO authenticated;
GRANT ALL ON public.freight_audit_findings TO service_role;
ALTER TABLE public.freight_audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read audit findings" ON public.freight_audit_findings
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE TRIGGER trg_freight_findings_touch BEFORE UPDATE ON public.freight_audit_findings
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

-- =========================================================================
-- 8. THREE-WAY RECONCILIATION
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.freight_recon_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  transactions_scanned integer NOT NULL DEFAULT 0,
  exceptions integer NOT NULL DEFAULT 0,
  critical integer NOT NULL DEFAULT 0,
  balanced boolean NOT NULL DEFAULT true,
  triggered_by uuid,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.freight_recon_runs TO authenticated;
GRANT ALL ON public.freight_recon_runs TO service_role;
ALTER TABLE public.freight_recon_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read recon runs" ON public.freight_recon_runs
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));

CREATE TABLE IF NOT EXISTS public.freight_recon_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.freight_recon_runs(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.freight_bookings(id),
  order_id uuid,
  carrier_id uuid REFERENCES public.carrier_profiles(id),
  reason_code text NOT NULL,
  severity public.freight_finding_severity NOT NULL DEFAULT 'MAJOR',
  state public.freight_finding_state NOT NULL DEFAULT 'OPEN',
  expected_amount numeric(14,2) NOT NULL DEFAULT 0,
  charged_amount numeric(14,2) NOT NULL DEFAULT 0,
  invoiced_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  settled_amount numeric(14,2) NOT NULL DEFAULT 0,
  carrier_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  variance_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  detail text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_notes text,
  resolved_by uuid,
  resolved_at timestamptz,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_freight_recon_exc_state ON public.freight_recon_exceptions(state, severity);
GRANT SELECT ON public.freight_recon_exceptions TO authenticated;
GRANT ALL ON public.freight_recon_exceptions TO service_role;
ALTER TABLE public.freight_recon_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance staff read recon exceptions" ON public.freight_recon_exceptions
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.finance.read'));
CREATE TRIGGER trg_freight_recon_exc_touch BEFORE UPDATE ON public.freight_recon_exceptions
  FOR EACH ROW EXECUTE FUNCTION public._freight_fin_touch();

-- ---------- numbering sequences ----------
CREATE SEQUENCE IF NOT EXISTS public.freight_charge_seq;
CREATE SEQUENCE IF NOT EXISTS public.freight_invoice_seq;
CREATE SEQUENCE IF NOT EXISTS public.freight_settlement_seq;
CREATE SEQUENCE IF NOT EXISTS public.freight_quote_seq;
GRANT USAGE ON SEQUENCE public.freight_charge_seq, public.freight_invoice_seq,
  public.freight_settlement_seq, public.freight_quote_seq TO service_role;