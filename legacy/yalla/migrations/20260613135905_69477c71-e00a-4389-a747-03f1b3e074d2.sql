
-- ============ REVENUE RECOGNITION ============
CREATE TYPE public.revenue_event_type AS ENUM ('RIDE_COMPLETED','DELIVERY_COMPLETED','RENTAL_COMPLETED','REFUND','ADJUSTMENT');
CREATE TYPE public.revenue_allocation_kind AS ENUM ('GROSS_REVENUE','VAT','WHT','DRIVER_LIABILITY','COMMISSION','DEFERRED','DISCOUNT');

CREATE TABLE public.revenue_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   public.revenue_event_type NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  source_ref   text,                 -- ride/delivery/rental id
  driver_id    uuid,
  rider_id     uuid,
  corporate_id uuid,
  gross_amount_cents bigint NOT NULL CHECK (gross_amount_cents > 0),
  currency     text NOT NULL DEFAULT 'KES',
  journal_id   uuid REFERENCES public.journals(id),
  recognized_at timestamptz,
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RECOGNIZED','REVERSED')),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rev_events_type_time ON public.revenue_events(event_type, occurred_at DESC);
CREATE INDEX idx_rev_events_corporate ON public.revenue_events(corporate_id) WHERE corporate_id IS NOT NULL;
GRANT SELECT ON public.revenue_events TO authenticated;
GRANT ALL ON public.revenue_events TO service_role;
ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_events FORCE ROW LEVEL SECURITY;
CREATE POLICY "rev_events_finance" ON public.revenue_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.revenue_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.revenue_events(id) ON DELETE CASCADE,
  kind         public.revenue_allocation_kind NOT NULL,
  amount_cents bigint NOT NULL,
  currency     text NOT NULL DEFAULT 'KES',
  account_code text REFERENCES public.chart_of_accounts(code),
  memo         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rev_alloc_event ON public.revenue_allocations(event_id);
GRANT SELECT ON public.revenue_allocations TO authenticated;
GRANT ALL ON public.revenue_allocations TO service_role;
ALTER TABLE public.revenue_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY "rev_alloc_finance" ON public.revenue_allocations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.commission_calculations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.revenue_events(id) ON DELETE CASCADE,
  driver_id    uuid,
  driver_share_cents bigint NOT NULL CHECK (driver_share_cents >= 0),
  commission_cents   bigint NOT NULL CHECK (commission_cents >= 0),
  commission_rate    numeric(7,4),
  currency     text NOT NULL DEFAULT 'KES',
  calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_event ON public.commission_calculations(event_id);
CREATE INDEX idx_commission_driver ON public.commission_calculations(driver_id, calculated_at DESC);
GRANT SELECT ON public.commission_calculations TO authenticated;
GRANT ALL ON public.commission_calculations TO service_role;
ALTER TABLE public.commission_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_calculations FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_finance" ON public.commission_calculations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[])
         OR driver_id = auth.uid());

-- ============ DISPUTES & CHARGEBACKS ============
CREATE TYPE public.dispute_status AS ENUM ('OPEN','INVESTIGATING','PENDING','RESOLVED','REJECTED','ESCALATED');
CREATE TYPE public.dispute_reason AS ENUM ('FRAUD','DUPLICATE','SERVICE_NOT_RENDERED','OVERCHARGE','UNAUTHORIZED','OTHER');

CREATE TABLE public.payment_disputes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid REFERENCES public.mpesa_transactions(id),
  raised_by    uuid NOT NULL,
  corporate_id uuid,
  reason       public.dispute_reason NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency     text NOT NULL DEFAULT 'KES',
  status       public.dispute_status NOT NULL DEFAULT 'OPEN',
  description  text,
  resolution_notes text,
  resolved_at  timestamptz,
  resolved_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_disputes_status ON public.payment_disputes(status);
CREATE INDEX idx_disputes_raised_by ON public.payment_disputes(raised_by);
GRANT SELECT, INSERT, UPDATE ON public.payment_disputes TO authenticated;
GRANT ALL ON public.payment_disputes TO service_role;
ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_disputes FORCE ROW LEVEL SECURITY;
CREATE POLICY "disputes_owner_read" ON public.payment_disputes FOR SELECT TO authenticated
  USING (raised_by = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE POLICY "disputes_owner_create" ON public.payment_disputes FOR INSERT TO authenticated
  WITH CHECK (raised_by = auth.uid());
CREATE POLICY "disputes_admin_update" ON public.payment_disputes FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TRIGGER trg_disputes_updated_at BEFORE UPDATE ON public.payment_disputes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.chargebacks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid REFERENCES public.payment_disputes(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.mpesa_transactions(id),
  provider     text NOT NULL,
  provider_ref text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency     text NOT NULL DEFAULT 'KES',
  status       text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','ACCEPTED','CONTESTED','LOST','WON')),
  received_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, provider_ref)
);
GRANT SELECT ON public.chargebacks TO authenticated;
GRANT ALL ON public.chargebacks TO service_role;
ALTER TABLE public.chargebacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargebacks FORCE ROW LEVEL SECURITY;
CREATE POLICY "chargebacks_finance" ON public.chargebacks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.investigations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid REFERENCES public.payment_disputes(id) ON DELETE CASCADE,
  assigned_to  uuid,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','CLOSED')),
  findings     text,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.investigations TO authenticated;
GRANT ALL ON public.investigations TO service_role;
ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigations FORCE ROW LEVEL SECURITY;
CREATE POLICY "invest_finance" ON public.investigations FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.evidence_packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid REFERENCES public.payment_disputes(id) ON DELETE CASCADE,
  investigation_id uuid REFERENCES public.investigations(id) ON DELETE SET NULL,
  kind         text NOT NULL,        -- FILE, URL, JSON, LOG
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sha256       text,                 -- hash for tamper detection
  uploaded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.evidence_packages TO authenticated;
GRANT ALL ON public.evidence_packages TO service_role;
ALTER TABLE public.evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY "evidence_finance" ON public.evidence_packages FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
