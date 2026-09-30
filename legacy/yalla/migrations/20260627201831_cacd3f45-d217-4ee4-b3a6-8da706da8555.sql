
-- Enums
DO $$ BEGIN
  CREATE TYPE public.reconciliation_status_enum AS ENUM ('RECONCILED','MISMATCH','FRAUD_ALERT','ORPHAN','FAILED','PENDING_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reconciliation_case_status AS ENUM ('OPEN','IN_PROGRESS','ESCALATED','RESOLVED','REVERSED','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reconciliation_severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) corporate_financial_reconciliation
CREATE TABLE IF NOT EXISTS public.corporate_financial_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_reference TEXT UNIQUE NOT NULL,
  corporate_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  proof_reference TEXT,
  proof_id UUID,
  mpesa_receipt TEXT,
  expected_amount_cents BIGINT NOT NULL DEFAULT 0,
  proof_amount_cents BIGINT,
  wallet_amount_cents BIGINT,
  cash_ledger_amount_cents BIGINT,
  amount_difference_cents BIGINT NOT NULL DEFAULT 0,
  proof_status TEXT,
  wallet_status TEXT,
  cash_posting_status TEXT,
  proof_exists BOOLEAN NOT NULL DEFAULT FALSE,
  wallet_posted BOOLEAN NOT NULL DEFAULT FALSE,
  ledger_posted BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_receipt BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_status public.reconciliation_status_enum NOT NULL DEFAULT 'PENDING_REVIEW',
  mismatch_reason TEXT,
  severity public.reconciliation_severity NOT NULL DEFAULT 'LOW',
  confidence_score NUMERIC(5,2) NOT NULL DEFAULT 100,
  investigated BOOLEAN NOT NULL DEFAULT FALSE,
  investigation_started_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.corporate_financial_reconciliation TO authenticated;
GRANT ALL ON public.corporate_financial_reconciliation TO service_role;

ALTER TABLE public.corporate_financial_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all reconciliation"
  ON public.corporate_financial_reconciliation FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

CREATE POLICY "Corporate members view own reconciliation"
  ON public.corporate_financial_reconciliation FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.corporate_employees ce
      WHERE ce.corporate_id = corporate_financial_reconciliation.corporate_id
        AND ce.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_cfr_corp_ref ON public.corporate_financial_reconciliation (corp_reference);
CREATE INDEX IF NOT EXISTS idx_cfr_corporate ON public.corporate_financial_reconciliation (corporate_id);
CREATE INDEX IF NOT EXISTS idx_cfr_status ON public.corporate_financial_reconciliation (reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_cfr_mpesa ON public.corporate_financial_reconciliation (mpesa_receipt);
CREATE INDEX IF NOT EXISTS idx_cfr_created ON public.corporate_financial_reconciliation (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfr_severity ON public.corporate_financial_reconciliation (severity);

-- 2) reconciliation_cases
CREATE SEQUENCE IF NOT EXISTS public.reconciliation_case_seq START 100000;

CREATE TABLE IF NOT EXISTS public.reconciliation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id UUID REFERENCES public.corporate_financial_reconciliation(id) ON DELETE CASCADE,
  corp_reference TEXT NOT NULL,
  corporate_id UUID REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  case_number TEXT UNIQUE NOT NULL DEFAULT ('CASE-' || lpad(nextval('public.reconciliation_case_seq')::text, 8, '0')),
  severity public.reconciliation_severity NOT NULL DEFAULT 'MEDIUM',
  status public.reconciliation_case_status NOT NULL DEFAULT 'OPEN',
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0,
  resolution_notes TEXT,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.reconciliation_cases TO authenticated;
GRANT ALL ON public.reconciliation_cases TO service_role;

ALTER TABLE public.reconciliation_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all cases"
  ON public.reconciliation_cases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

CREATE POLICY "Corporate members view own cases"
  ON public.reconciliation_cases FOR SELECT TO authenticated
  USING (
    corporate_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.corporate_employees ce
      WHERE ce.corporate_id = reconciliation_cases.corporate_id
        AND ce.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_rcc_case_number ON public.reconciliation_cases (case_number);
CREATE INDEX IF NOT EXISTS idx_rcc_status ON public.reconciliation_cases (status);
CREATE INDEX IF NOT EXISTS idx_rcc_corporate ON public.reconciliation_cases (corporate_id);
CREATE INDEX IF NOT EXISTS idx_rcc_assigned ON public.reconciliation_cases (assigned_to);
CREATE INDEX IF NOT EXISTS idx_rcc_created ON public.reconciliation_cases (created_at DESC);

-- 3) reconciliation_case_activities (immutable)
CREATE TABLE IF NOT EXISTS public.reconciliation_case_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.reconciliation_cases(id) ON DELETE CASCADE,
  actor UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  note TEXT,
  ip_address TEXT,
  device TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.reconciliation_case_activities TO authenticated;
GRANT ALL ON public.reconciliation_case_activities TO service_role;

ALTER TABLE public.reconciliation_case_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all case activities"
  ON public.reconciliation_case_activities FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

CREATE POLICY "Corporate members view their case activities"
  ON public.reconciliation_case_activities FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reconciliation_cases rc
      JOIN public.corporate_employees ce ON ce.corporate_id = rc.corporate_id
      WHERE rc.id = reconciliation_case_activities.case_id
        AND ce.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated can append activities"
  ON public.reconciliation_case_activities FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin')
  );

CREATE INDEX IF NOT EXISTS idx_rca_case ON public.reconciliation_case_activities (case_id, created_at DESC);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.set_updated_at_recon() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_cfr_updated ON public.corporate_financial_reconciliation;
CREATE TRIGGER trg_cfr_updated BEFORE UPDATE ON public.corporate_financial_reconciliation
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_recon();

DROP TRIGGER IF EXISTS trg_rcc_updated ON public.reconciliation_cases;
CREATE TRIGGER trg_rcc_updated BEFORE UPDATE ON public.reconciliation_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_recon();
