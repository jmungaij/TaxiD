-- Phase 8.4 — Yalla Commercial Decision & Execution Loop
-- Lineage-first: identifiers and authoritative relationships before engines.

CREATE OR REPLACE FUNCTION public.is_commercial_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'finance_admin'::app_role)
      OR public.has_role(auth.uid(), 'operations_admin'::app_role)
$$;

CREATE SEQUENCE IF NOT EXISTS public.commercial_action_seq;

CREATE OR REPLACE FUNCTION public.next_commercial_action_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'YCA-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.commercial_action_seq')::text, 6, '0')
$$;

CREATE TABLE public.commercial_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_ref text NOT NULL UNIQUE DEFAULT public.next_commercial_action_id(),
  title text NOT NULL,
  -- signal -> recommendation -> governance
  signal_kind text NOT NULL,
  signal_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL,
  risk_class text NOT NULL DEFAULT 'low',
  authority_class text NOT NULL DEFAULT 'A0',
  approval_required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'proposed',
  owner_user_id uuid,
  owner_label text,
  -- economics asserted at recommendation time
  expected_revenue_cents bigint,
  expected_contribution_cents bigint,
  expected_conversion_pct numeric,
  confidence_pct numeric,
  provenance text NOT NULL DEFAULT 'MODELLED',
  -- authoritative lineage (no second financial truth: references only)
  customer_ref text,
  opportunity_ref text,
  quote_id uuid,
  booking_id uuid,
  booking_table text,
  dispatch_request_id uuid,
  invoice_id uuid,
  payment_id uuid,
  settlement_id uuid,
  revenue_event_id uuid,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_actions_risk_class_check CHECK (risk_class IN ('low','medium','high','consequential')),
  CONSTRAINT commercial_actions_authority_check CHECK (authority_class IN ('A0','A1','A2','A3','A4','A5')),
  CONSTRAINT commercial_actions_status_check CHECK (status IN ('proposed','awaiting_approval','approved','rejected','executing','executed','measured','closed','rolled_back')),
  CONSTRAINT commercial_actions_provenance_check CHECK (provenance IN ('LIVE','MODELLED','SIMULATED','SEEDED','INCOMPLETE'))
);

GRANT SELECT, INSERT, UPDATE ON public.commercial_actions TO authenticated;
GRANT ALL ON public.commercial_actions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.commercial_action_seq TO authenticated, service_role;
ALTER TABLE public.commercial_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read commercial actions"
  ON public.commercial_actions FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "Commercial staff create commercial actions"
  ON public.commercial_actions FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff());
CREATE POLICY "Commercial staff update commercial actions"
  ON public.commercial_actions FOR UPDATE TO authenticated
  USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());

CREATE INDEX commercial_actions_status_idx ON public.commercial_actions (status, created_at DESC);
CREATE INDEX commercial_actions_owner_idx ON public.commercial_actions (owner_user_id);
CREATE INDEX commercial_actions_booking_idx ON public.commercial_actions (booking_id);

-- A3 Commercial Decision Record ------------------------------------------
CREATE TABLE public.commercial_a3_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.commercial_actions(id) ON DELETE CASCADE,
  situation text NOT NULL,
  analysis text NOT NULL,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  action text NOT NULL,
  approval text,
  accountability text,
  expected_outcome text NOT NULL,
  measurement text NOT NULL,
  review_at timestamptz,
  actual_outcome text,
  learning text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.commercial_a3_records TO authenticated;
GRANT ALL ON public.commercial_a3_records TO service_role;
ALTER TABLE public.commercial_a3_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read A3 records"
  ON public.commercial_a3_records FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "Commercial staff create A3 records"
  ON public.commercial_a3_records FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff());
CREATE POLICY "Commercial staff update A3 records"
  ON public.commercial_a3_records FOR UPDATE TO authenticated
  USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());

CREATE INDEX commercial_a3_records_action_idx ON public.commercial_a3_records (action_id);

-- Outcome measurement ----------------------------------------------------
CREATE TABLE public.commercial_action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.commercial_actions(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL DEFAULT now(),
  expected_revenue_cents bigint,
  actual_revenue_cents bigint,
  expected_contribution_cents bigint,
  actual_contribution_cents bigint,
  expected_fulfilment_pct numeric,
  actual_fulfilment_pct numeric,
  expected_conversion_pct numeric,
  actual_conversion_pct numeric,
  customer_outcome text,
  variance_pct numeric,
  verdict text NOT NULL DEFAULT 'pending',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  learning text,
  measured_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_action_outcomes_verdict_check CHECK (verdict IN ('pending','as_predicted','underperformed','outperformed','not_measurable'))
);

GRANT SELECT, INSERT ON public.commercial_action_outcomes TO authenticated;
GRANT ALL ON public.commercial_action_outcomes TO service_role;
ALTER TABLE public.commercial_action_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read outcomes"
  ON public.commercial_action_outcomes FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "Commercial staff record outcomes"
  ON public.commercial_action_outcomes FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff());

CREATE INDEX commercial_action_outcomes_action_idx ON public.commercial_action_outcomes (action_id, measured_at DESC);

-- Reconciliation exceptions ---------------------------------------------
CREATE TABLE public.commercial_reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  break_kind text NOT NULL,
  stage_from text NOT NULL,
  stage_to text NOT NULL,
  entity_table text NOT NULL,
  entity_id text NOT NULL,
  value_cents bigint,
  severity text NOT NULL DEFAULT 'moderate',
  owner_label text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  root_cause text,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_recon_severity_check CHECK (severity IN ('critical','high','moderate','low')),
  CONSTRAINT commercial_recon_status_check CHECK (status IN ('open','investigating','resolved','accepted_risk')),
  CONSTRAINT commercial_recon_kind_check CHECK (break_kind IN ('missing_linkage','fulfilment_leakage','billing_leakage','settlement_discrepancy','revenue_discrepancy','dashboard_discrepancy'))
);

GRANT SELECT, UPDATE ON public.commercial_reconciliation_exceptions TO authenticated;
GRANT ALL ON public.commercial_reconciliation_exceptions TO service_role;
ALTER TABLE public.commercial_reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read reconciliation exceptions"
  ON public.commercial_reconciliation_exceptions FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "Commercial staff resolve reconciliation exceptions"
  ON public.commercial_reconciliation_exceptions FOR UPDATE TO authenticated
  USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());

CREATE INDEX commercial_recon_status_idx ON public.commercial_reconciliation_exceptions (status, severity, detected_at DESC);
CREATE UNIQUE INDEX commercial_recon_entity_idx ON public.commercial_reconciliation_exceptions (break_kind, entity_table, entity_id) WHERE status <> 'resolved';

-- touch triggers ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_commercial_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_commercial_actions BEFORE UPDATE ON public.commercial_actions
  FOR EACH ROW EXECUTE FUNCTION public.touch_commercial_updated_at();
CREATE TRIGGER touch_commercial_a3 BEFORE UPDATE ON public.commercial_a3_records
  FOR EACH ROW EXECUTE FUNCTION public.touch_commercial_updated_at();
CREATE TRIGGER touch_commercial_recon BEFORE UPDATE ON public.commercial_reconciliation_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_commercial_updated_at();