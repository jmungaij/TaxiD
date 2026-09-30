-- ============================ enums ============================
DO $$ BEGIN
  CREATE TYPE public.partner_onboarding_stage AS ENUM
    ('applied','screening','documents_pending','documents_review','contracting','activation','verified','rejected','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_doc_status AS ENUM ('pending','approved','rejected','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_ledger_kind AS ENUM
    ('wallet_topup','order_hold','order_capture','order_release','partner_margin','yalla_margin','tax','supplier_cost','settlement_payout','adjustment','reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_settlement_state AS ENUM ('open','pending_review','approved','paid','reconciled','disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_case_state AS ENUM ('open','in_progress','waiting','escalated','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================ role helpers ============================
CREATE OR REPLACE FUNCTION public.yp_is_finance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','director']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.yp_is_compliance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','operations_admin','director']::app_role[]);
$$;

GRANT EXECUTE ON FUNCTION public.yp_is_finance() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.yp_is_compliance() TO authenticated, service_role;

-- ============================ partners: onboarding state ============================
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS onboarding_stage public.partner_onboarding_stage NOT NULL DEFAULT 'applied',
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

-- ============================ requirement catalogue ============================
CREATE TABLE IF NOT EXISTS public.partner_onboarding_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  partner_types public.partner_type[] NOT NULL DEFAULT '{}',
  is_mandatory boolean NOT NULL DEFAULT true,
  validity_months integer,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_onboarding_requirements TO authenticated;
GRANT ALL ON public.partner_onboarding_requirements TO service_role;
ALTER TABLE public.partner_onboarding_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS por_read ON public.partner_onboarding_requirements;
CREATE POLICY por_read ON public.partner_onboarding_requirements FOR SELECT TO authenticated USING (true);

-- ============================ documents ============================
CREATE TABLE IF NOT EXISTS public.partner_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  requirement_code text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  status public.partner_doc_status NOT NULL DEFAULT 'pending',
  issued_on date,
  expires_at date,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_documents_owner_chk CHECK (partner_id IS NOT NULL OR application_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_partner_documents_partner ON public.partner_documents(partner_id, requirement_code);
CREATE INDEX IF NOT EXISTS idx_partner_documents_application ON public.partner_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_partner_documents_status ON public.partner_documents(status, expires_at);

GRANT SELECT, INSERT, UPDATE ON public.partner_documents TO authenticated;
GRANT ALL ON public.partner_documents TO service_role;
ALTER TABLE public.partner_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_documents_read ON public.partner_documents;
CREATE POLICY partner_documents_read ON public.partner_documents FOR SELECT TO authenticated
USING (public.yp_is_staff() OR (partner_id IS NOT NULL AND public.is_partner_member(partner_id)));

DROP POLICY IF EXISTS partner_documents_insert ON public.partner_documents;
CREATE POLICY partner_documents_insert ON public.partner_documents FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND status = 'pending'
  AND (public.yp_is_staff() OR (partner_id IS NOT NULL AND public.is_partner_member(partner_id)))
);

DROP POLICY IF EXISTS partner_documents_staff_update ON public.partner_documents;
CREATE POLICY partner_documents_staff_update ON public.partner_documents FOR UPDATE TO authenticated
USING (public.yp_is_compliance()) WITH CHECK (public.yp_is_compliance());

-- ============================ wallet ============================
CREATE TABLE IF NOT EXISTS public.partner_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL UNIQUE REFERENCES public.partners(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'KES',
  balance numeric(14,2) NOT NULL DEFAULT 0,
  reserved numeric(14,2) NOT NULL DEFAULT 0,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0,
  low_balance_threshold numeric(14,2) NOT NULL DEFAULT 0,
  is_prefunded boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_wallets TO authenticated;
GRANT ALL ON public.partner_wallets TO service_role;
ALTER TABLE public.partner_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_wallets_read ON public.partner_wallets;
CREATE POLICY partner_wallets_read ON public.partner_wallets FOR SELECT TO authenticated
USING (public.yp_is_staff() OR public.is_partner_member(partner_id));

-- ============================ append-only ledger ============================
CREATE TABLE IF NOT EXISTS public.partner_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  wallet_id uuid REFERENCES public.partner_wallets(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.mobility_orders(id) ON DELETE SET NULL,
  journey_id uuid REFERENCES public.journeys(id) ON DELETE SET NULL,
  settlement_id uuid,
  entry_kind public.partner_ledger_kind NOT NULL,
  direction public.ledger_direction NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'KES',
  balance_after numeric(14,2),
  memo text,
  reference text,
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_ledger_partner ON public.partner_ledger_entries(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_ledger_order ON public.partner_ledger_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_partner_ledger_settlement ON public.partner_ledger_entries(settlement_id);

GRANT SELECT ON public.partner_ledger_entries TO authenticated;
GRANT ALL ON public.partner_ledger_entries TO service_role;
ALTER TABLE public.partner_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_ledger_read ON public.partner_ledger_entries;
CREATE POLICY partner_ledger_read ON public.partner_ledger_entries FOR SELECT TO authenticated
USING (public.yp_is_staff() OR public.is_partner_member(partner_id));

CREATE OR REPLACE FUNCTION public.partner_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'partner_ledger_entries is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_partner_ledger_append_only ON public.partner_ledger_entries;
CREATE TRIGGER trg_partner_ledger_append_only
BEFORE UPDATE OR DELETE ON public.partner_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.partner_ledger_append_only();

-- ============================ settlements ============================
CREATE TABLE IF NOT EXISTS public.partner_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_code text NOT NULL UNIQUE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status public.partner_settlement_state NOT NULL DEFAULT 'open',
  currency text NOT NULL DEFAULT 'KES',
  orders_count integer NOT NULL DEFAULT 0,
  gross_value numeric(14,2) NOT NULL DEFAULT 0,
  supplier_cost numeric(14,2) NOT NULL DEFAULT 0,
  yalla_margin numeric(14,2) NOT NULL DEFAULT 0,
  partner_margin numeric(14,2) NOT NULL DEFAULT 0,
  taxes numeric(14,2) NOT NULL DEFAULT 0,
  payout_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2),
  variance_amount numeric(14,2),
  payment_reference text,
  notes text,
  generated_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_settlements_period_chk CHECK (period_end >= period_start),
  CONSTRAINT partner_settlements_unique_period UNIQUE (partner_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_partner ON public.partner_settlements(partner_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_status ON public.partner_settlements(status);

GRANT SELECT ON public.partner_settlements TO authenticated;
GRANT ALL ON public.partner_settlements TO service_role;
ALTER TABLE public.partner_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_settlements_read ON public.partner_settlements;
CREATE POLICY partner_settlements_read ON public.partner_settlements FOR SELECT TO authenticated
USING (public.yp_is_staff() OR public.is_partner_member(partner_id));

CREATE TABLE IF NOT EXISTS public.partner_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES public.partner_settlements(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.mobility_orders(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  customer_price numeric(14,2) NOT NULL DEFAULT 0,
  supplier_cost numeric(14,2) NOT NULL DEFAULT 0,
  yalla_margin numeric(14,2) NOT NULL DEFAULT 0,
  partner_margin numeric(14,2) NOT NULL DEFAULT 0,
  taxes numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_settlement_lines_unique UNIQUE (settlement_id, order_id)
);
CREATE INDEX IF NOT EXISTS idx_partner_settlement_lines_order ON public.partner_settlement_lines(order_id);
GRANT SELECT ON public.partner_settlement_lines TO authenticated;
GRANT ALL ON public.partner_settlement_lines TO service_role;
ALTER TABLE public.partner_settlement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_settlement_lines_read ON public.partner_settlement_lines;
CREATE POLICY partner_settlement_lines_read ON public.partner_settlement_lines FOR SELECT TO authenticated
USING (public.yp_is_staff() OR public.is_partner_member(partner_id));

ALTER TABLE public.partner_ledger_entries DROP CONSTRAINT IF EXISTS partner_ledger_settlement_fk;
ALTER TABLE public.partner_ledger_entries
  ADD CONSTRAINT partner_ledger_settlement_fk FOREIGN KEY (settlement_id)
  REFERENCES public.partner_settlements(id) ON DELETE SET NULL;

-- ============================ staff work queue ============================
CREATE TABLE IF NOT EXISTS public.partner_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_code text NOT NULL UNIQUE,
  partner_id uuid REFERENCES public.partners(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.mobility_orders(id) ON DELETE CASCADE,
  journey_id uuid REFERENCES public.journeys(id) ON DELETE CASCADE,
  settlement_id uuid REFERENCES public.partner_settlements(id) ON DELETE CASCADE,
  queue text NOT NULL,
  title text NOT NULL,
  detail text,
  priority text NOT NULL DEFAULT 'medium',
  state public.partner_case_state NOT NULL DEFAULT 'open',
  sla_minutes integer NOT NULL DEFAULT 240,
  sla_started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  compliance_flags text[] NOT NULL DEFAULT '{}',
  risk_score numeric(5,2) NOT NULL DEFAULT 0,
  assigned_to uuid,
  escalated_at timestamptz,
  escalation_reason text,
  resolved_at timestamptz,
  resolution_notes text,
  dedupe_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_work_priority_chk CHECK (priority IN ('critical','high','medium','low')),
  CONSTRAINT partner_work_queue_chk CHECK (queue IN ('onboarding','compliance','fulfilment','finance','risk','capacity','support'))
);
CREATE INDEX IF NOT EXISTS idx_partner_work_state ON public.partner_work_items(state, due_at);
CREATE INDEX IF NOT EXISTS idx_partner_work_queue ON public.partner_work_items(queue, state);
CREATE INDEX IF NOT EXISTS idx_partner_work_partner ON public.partner_work_items(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_work_order ON public.partner_work_items(order_id);

GRANT SELECT ON public.partner_work_items TO authenticated;
GRANT ALL ON public.partner_work_items TO service_role;
ALTER TABLE public.partner_work_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_work_items_staff_read ON public.partner_work_items;
CREATE POLICY partner_work_items_staff_read ON public.partner_work_items FOR SELECT TO authenticated
USING (public.yp_is_staff());

CREATE OR REPLACE FUNCTION public.partner_work_set_due_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.due_at := NEW.sla_started_at + (NEW.sla_minutes || ' minutes')::interval;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_partner_work_due_at ON public.partner_work_items;
CREATE TRIGGER trg_partner_work_due_at BEFORE INSERT OR UPDATE ON public.partner_work_items
FOR EACH ROW EXECUTE FUNCTION public.partner_work_set_due_at();

CREATE TABLE IF NOT EXISTS public.partner_work_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.partner_work_items(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_state public.partner_case_state,
  to_state public.partner_case_state,
  note text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_work_events_item ON public.partner_work_events(work_item_id, created_at DESC);
GRANT SELECT ON public.partner_work_events TO authenticated;
GRANT ALL ON public.partner_work_events TO service_role;
ALTER TABLE public.partner_work_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_work_events_staff_read ON public.partner_work_events;
CREATE POLICY partner_work_events_staff_read ON public.partner_work_events FOR SELECT TO authenticated
USING (public.yp_is_staff());

CREATE OR REPLACE FUNCTION public.partner_work_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'partner_work_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_partner_work_events_append_only ON public.partner_work_events;
CREATE TRIGGER trg_partner_work_events_append_only
BEFORE UPDATE OR DELETE ON public.partner_work_events
FOR EACH ROW EXECUTE FUNCTION public.partner_work_events_append_only();

-- ============================ updated_at triggers ============================
CREATE OR REPLACE FUNCTION public.yp_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_partner_documents ON public.partner_documents;
CREATE TRIGGER trg_touch_partner_documents BEFORE UPDATE ON public.partner_documents
FOR EACH ROW EXECUTE FUNCTION public.yp_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_partner_wallets ON public.partner_wallets;
CREATE TRIGGER trg_touch_partner_wallets BEFORE UPDATE ON public.partner_wallets
FOR EACH ROW EXECUTE FUNCTION public.yp_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_partner_settlements ON public.partner_settlements;
CREATE TRIGGER trg_touch_partner_settlements BEFORE UPDATE ON public.partner_settlements
FOR EACH ROW EXECUTE FUNCTION public.yp_touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_partner_work_items ON public.partner_work_items;
CREATE TRIGGER trg_touch_partner_work_items BEFORE UPDATE ON public.partner_work_items
FOR EACH ROW EXECUTE FUNCTION public.yp_touch_updated_at();
