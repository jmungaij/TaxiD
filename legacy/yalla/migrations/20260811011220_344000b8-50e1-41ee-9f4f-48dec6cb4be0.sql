-- 8.4.10 Commercial Transaction Spine ---------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.commercial_transaction_seq;

CREATE OR REPLACE FUNCTION public.next_commercial_transaction_id()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'YTX-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.commercial_transaction_seq')::text, 6, '0')
$$;

-- Assisted / enterprise commercial path -------------------------------------
CREATE TABLE public.commercial_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_ref text NOT NULL UNIQUE,
  stage text NOT NULL DEFAULT 'lead',
  title text NOT NULL,
  customer_kind text NOT NULL DEFAULT 'corporate',
  corporate_id uuid,
  customer_user_id uuid,
  customer_label text,
  source text NOT NULL DEFAULT 'inbound',
  source_ref text,
  expected_value_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  probability_pct numeric,
  quote_id uuid,
  owner_user_id uuid,
  lost_reason text,
  provenance text NOT NULL DEFAULT 'LIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_opportunities_stage_check CHECK (stage = ANY (ARRAY['lead','qualified','opportunity','quoted','offered','accepted','won','lost'])),
  CONSTRAINT commercial_opportunities_customer_kind_check CHECK (customer_kind = ANY (ARRAY['corporate','individual','partner','government'])),
  CONSTRAINT commercial_opportunities_provenance_check CHECK (provenance = ANY (ARRAY['LIVE','MODELLED','SIMULATED','SEEDED','INCOMPLETE']))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_opportunities TO authenticated;
GRANT ALL ON public.commercial_opportunities TO service_role;
ALTER TABLE public.commercial_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read opportunities" ON public.commercial_opportunities
  FOR SELECT TO authenticated USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write opportunities" ON public.commercial_opportunities
  FOR ALL TO authenticated USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE TRIGGER trg_commercial_opportunities_updated_at BEFORE UPDATE ON public.commercial_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Canonical commercial transaction ------------------------------------------
CREATE TABLE public.commercial_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_ref text NOT NULL UNIQUE DEFAULT public.next_commercial_transaction_id(),
  origin_path text NOT NULL DEFAULT 'direct_digital',
  service_line text NOT NULL,
  status text NOT NULL DEFAULT 'intent',

  -- parties
  customer_kind text NOT NULL DEFAULT 'individual',
  customer_user_id uuid,
  corporate_id uuid,
  provider_kind text,
  provider_ref text,
  driver_id uuid,
  vehicle_id uuid,

  -- lineage keys (authoritative records, never recomputed truth)
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  demand_intent_ref text,
  quote_id uuid,
  offer_ref text,
  commitment_id uuid,
  booking_id uuid,
  booking_table text,
  dispatch_assignment_id uuid,
  invoice_id uuid,
  invoice_table text,
  payment_id uuid,
  payment_table text,
  settlement_id uuid,
  revenue_event_id uuid,
  commercial_action_id uuid REFERENCES public.commercial_actions(id) ON DELETE SET NULL,

  -- economics waterfall (cents, single currency per transaction)
  currency text NOT NULL DEFAULT 'KES',
  customer_charge_cents bigint,
  gross_transaction_value_cents bigint,
  tax_cents bigint NOT NULL DEFAULT 0,
  adjustment_cents bigint NOT NULL DEFAULT 0,
  partner_entitlement_cents bigint,
  platform_revenue_cents bigint,
  payment_cost_cents bigint NOT NULL DEFAULT 0,
  refund_cents bigint NOT NULL DEFAULT 0,
  incentive_cents bigint NOT NULL DEFAULT 0,
  contribution_cents bigint,

  -- fulfilment / eligibility
  committed_at timestamptz,
  accepted_at timestamptz,
  booked_at timestamptz,
  fulfilled_at timestamptz,
  fulfilment_source text,
  financially_eligible boolean NOT NULL DEFAULT false,
  eligibility_reason text,
  recognised_at timestamptz,
  cancelled_at timestamptz,

  provenance text NOT NULL DEFAULT 'LIVE',
  economics_complete boolean NOT NULL DEFAULT false,
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_transactions_origin_check CHECK (origin_path = ANY (ARRAY['assisted_enterprise','direct_digital','backfill'])),
  CONSTRAINT commercial_transactions_status_check CHECK (status = ANY (ARRAY['intent','offered','committed','accepted','booked','orchestrating','fulfilled','invoiced','paid','settled','recognised','closed','cancelled','failed'])),
  CONSTRAINT commercial_transactions_customer_kind_check CHECK (customer_kind = ANY (ARRAY['corporate','individual','partner','government'])),
  CONSTRAINT commercial_transactions_provenance_check CHECK (provenance = ANY (ARRAY['LIVE','MODELLED','SIMULATED','SEEDED','INCOMPLETE'])),
  CONSTRAINT commercial_transactions_booking_unique UNIQUE (booking_table, booking_id)
);
CREATE INDEX commercial_transactions_status_idx ON public.commercial_transactions (status, created_at DESC);
CREATE INDEX commercial_transactions_customer_idx ON public.commercial_transactions (customer_user_id);
CREATE INDEX commercial_transactions_corporate_idx ON public.commercial_transactions (corporate_id);
CREATE INDEX commercial_transactions_eligible_idx ON public.commercial_transactions (financially_eligible, recognised_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_transactions TO authenticated;
GRANT ALL ON public.commercial_transactions TO service_role;
ALTER TABLE public.commercial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read transactions" ON public.commercial_transactions
  FOR SELECT TO authenticated USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write transactions" ON public.commercial_transactions
  FOR ALL TO authenticated USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE TRIGGER trg_commercial_transactions_updated_at BEFORE UPDATE ON public.commercial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8.4.11 Capacity commitment -> booking -------------------------------------
CREATE TABLE public.capacity_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_ref text NOT NULL UNIQUE,
  transaction_id uuid REFERENCES public.commercial_transactions(id) ON DELETE SET NULL,
  service_line text NOT NULL,
  provider_kind text NOT NULL DEFAULT 'driver',
  provider_ref text,
  driver_id uuid,
  vehicle_id uuid,
  resource_ref text,
  customer_user_id uuid,
  corporate_id uuid,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  price_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  released_at timestamptz,
  booking_id uuid,
  booking_table text,
  offer_ref text,
  dispatch_request_id uuid,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capacity_commitments_status_check CHECK (status = ANY (ARRAY['reserved','accepted','booked','expired','released','cancelled'])),
  CONSTRAINT capacity_commitments_window_check CHECK (window_end >= window_start),
  CONSTRAINT capacity_commitments_price_check CHECK (price_cents >= 0)
);
CREATE INDEX capacity_commitments_status_idx ON public.capacity_commitments (status, expires_at);
CREATE INDEX capacity_commitments_transaction_idx ON public.capacity_commitments (transaction_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_commitments TO authenticated;
GRANT ALL ON public.capacity_commitments TO service_role;
ALTER TABLE public.capacity_commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read commitments" ON public.capacity_commitments
  FOR SELECT TO authenticated USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write commitments" ON public.capacity_commitments
  FOR ALL TO authenticated USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE TRIGGER trg_capacity_commitments_updated_at BEFORE UPDATE ON public.capacity_commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.commercial_transactions
  ADD CONSTRAINT commercial_transactions_commitment_fkey
  FOREIGN KEY (commitment_id) REFERENCES public.capacity_commitments(id) ON DELETE SET NULL;

-- 8.4.13 Configurable, auditable revenue recognition rules -------------------
CREATE TABLE public.revenue_recognition_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  service_line text NOT NULL,
  description text NOT NULL,
  requires_fulfilment boolean NOT NULL DEFAULT true,
  requires_payment boolean NOT NULL DEFAULT false,
  requires_invoice boolean NOT NULL DEFAULT false,
  requires_settlement boolean NOT NULL DEFAULT false,
  requires_economics_complete boolean NOT NULL DEFAULT true,
  recognise_gross boolean NOT NULL DEFAULT false,
  min_amount_cents bigint NOT NULL DEFAULT 0,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_recognition_rules TO authenticated;
GRANT ALL ON public.revenue_recognition_rules TO service_role;
ALTER TABLE public.revenue_recognition_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read recognition rules" ON public.revenue_recognition_rules
  FOR SELECT TO authenticated USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write recognition rules" ON public.revenue_recognition_rules
  FOR ALL TO authenticated USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE TRIGGER trg_revenue_recognition_rules_updated_at BEFORE UPDATE ON public.revenue_recognition_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8.4.14 Settlement obligations ----------------------------------------------
CREATE TABLE public.settlement_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.commercial_transactions(id) ON DELETE CASCADE,
  provider_kind text NOT NULL DEFAULT 'driver',
  provider_ref text,
  driver_id uuid,
  entitlement_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  calculation jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'calculated',
  payable_at timestamptz,
  payout_id uuid,
  paid_cents bigint,
  paid_at timestamptz,
  reconciled_at timestamptz,
  variance_cents bigint,
  variance_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_obligations_status_check CHECK (status = ANY (ARRAY['calculated','payable','paid','reconciled','variance','disputed','void'])),
  CONSTRAINT settlement_obligations_transaction_unique UNIQUE (transaction_id, provider_ref)
);
CREATE INDEX settlement_obligations_status_idx ON public.settlement_obligations (status, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settlement_obligations TO authenticated;
GRANT ALL ON public.settlement_obligations TO service_role;
ALTER TABLE public.settlement_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read settlement obligations" ON public.settlement_obligations
  FOR SELECT TO authenticated USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write settlement obligations" ON public.settlement_obligations
  FOR ALL TO authenticated USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE TRIGGER trg_settlement_obligations_updated_at BEFORE UPDATE ON public.settlement_obligations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8.4.16 Economic exception engine -------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.commercial_exception_seq;

CREATE TABLE public.commercial_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_ref text NOT NULL UNIQUE DEFAULT ('EXC-' || lpad(nextval('public.commercial_exception_seq')::text, 6, '0')),
  transaction_id uuid REFERENCES public.commercial_transactions(id) ON DELETE SET NULL,
  transaction_ref text,
  stage text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  value_at_risk_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  loss_probability_pct numeric NOT NULL DEFAULT 50,
  customer_impact text NOT NULL DEFAULT 'none',
  operational_impact text NOT NULL DEFAULT 'low',
  strategic_weight numeric NOT NULL DEFAULT 1,
  priority_score numeric,
  sla_hours numeric NOT NULL DEFAULT 24,
  sla_due_at timestamptz,
  owner_team text NOT NULL DEFAULT 'finance',
  owner_user_id uuid,
  root_cause text,
  recommended_action text,
  escalation_level integer NOT NULL DEFAULT 0,
  notified_at timestamptz,
  notification_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  financial_impact_cents bigint,
  learning_outcome text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_exceptions_severity_check CHECK (severity = ANY (ARRAY['low','medium','high','critical'])),
  CONSTRAINT commercial_exceptions_status_check CHECK (status = ANY (ARRAY['open','acknowledged','in_progress','escalated','resolved','accepted_risk','void'])),
  CONSTRAINT commercial_exceptions_notification_check CHECK (notification_status = ANY (ARRAY['pending','sent','failed','suppressed'])),
  CONSTRAINT commercial_exceptions_dedup UNIQUE (transaction_id, kind, status)
);
CREATE INDEX commercial_exceptions_priority_idx ON public.commercial_exceptions (status, priority_score DESC NULLS LAST);
CREATE INDEX commercial_exceptions_sla_idx ON public.commercial_exceptions (sla_due_at) WHERE status <> 'resolved';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_exceptions TO authenticated;
GRANT ALL ON public.commercial_exceptions TO service_role;
ALTER TABLE public.commercial_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commercial staff read exceptions" ON public.commercial_exceptions
  FOR SELECT TO authenticated USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write exceptions" ON public.commercial_exceptions
  FOR ALL TO authenticated USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE TRIGGER trg_commercial_exceptions_updated_at BEFORE UPDATE ON public.commercial_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();