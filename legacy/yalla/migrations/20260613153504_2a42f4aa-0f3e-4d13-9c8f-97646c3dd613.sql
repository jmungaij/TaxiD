-- ============================================================
-- T2: eTIMS Invoice Schema + Status Machine
-- ============================================================

-- 1) Enums --------------------------------------------------------------
CREATE TYPE public.etims_invoice_status AS ENUM (
  'PENDING','SYNCING','RETRYING','SYNCED','FAILED','VOIDED','REFUNDED'
);

CREATE TYPE public.etims_invoice_type AS ENUM (
  'SALE','CREDIT_NOTE','DEBIT_NOTE','REFUND'
);

CREATE TYPE public.etims_sync_event_type AS ENUM (
  'SUBMIT_ATTEMPT','SUBMIT_SUCCESS','SUBMIT_FAILURE',
  'WEBHOOK_ACK','WEBHOOK_REJECT','MANUAL_RESYNC','VOID','REFUND'
);

CREATE TYPE public.tax_submission_status AS ENUM (
  'DRAFT','SUBMITTED','ACKNOWLEDGED','REJECTED','AMENDED'
);

CREATE TYPE public.tax_reconciliation_status AS ENUM (
  'OK','VARIANCE','FAILED'
);

-- 2) etims_invoices -----------------------------------------------------
CREATE TABLE public.etims_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number        text NOT NULL UNIQUE,                   -- internal sequential
  kra_invoice_number    text UNIQUE,                            -- assigned by KRA
  kra_control_unit_id   text,                                   -- CU serial
  kra_signature         text,                                   -- KRA digital signature
  qr_code_payload       text,                                   -- QR content
  invoice_type          public.etims_invoice_type NOT NULL DEFAULT 'SALE',
  status                public.etims_invoice_status NOT NULL DEFAULT 'PENDING',
  -- Linked source
  revenue_event_id      uuid,                                   -- FK soft (revenue_events)
  transaction_id        uuid,                                   -- FK soft (mpesa_transactions)
  journal_id            uuid,                                   -- FK soft (journals)
  -- Parties
  customer_user_id      uuid,
  customer_name         text NOT NULL,
  customer_kra_pin      text,
  customer_email        text,
  customer_phone        text,
  -- Amounts (cents)
  subtotal_cents        bigint NOT NULL CHECK (subtotal_cents >= 0),
  tax_total_cents       bigint NOT NULL DEFAULT 0 CHECK (tax_total_cents >= 0),
  total_cents           bigint NOT NULL CHECK (total_cents >= 0),
  currency              text NOT NULL DEFAULT 'KES',
  -- Reference to original invoice (for credit/debit notes & refunds)
  references_invoice_id uuid REFERENCES public.etims_invoices(id),
  -- Operational
  issued_at             timestamptz NOT NULL DEFAULT now(),
  synced_at             timestamptz,
  voided_at             timestamptz,
  voided_reason         text,
  last_error            text,
  retry_count           int NOT NULL DEFAULT 0,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etims_invoices_status      ON public.etims_invoices(status);
CREATE INDEX idx_etims_invoices_issued      ON public.etims_invoices(issued_at DESC);
CREATE INDEX idx_etims_invoices_customer    ON public.etims_invoices(customer_user_id);
CREATE INDEX idx_etims_invoices_revenue     ON public.etims_invoices(revenue_event_id);
CREATE INDEX idx_etims_invoices_transaction ON public.etims_invoices(transaction_id);

GRANT SELECT ON public.etims_invoices TO authenticated;
GRANT ALL    ON public.etims_invoices TO service_role;
ALTER TABLE public.etims_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etims_invoices_finance_read" ON public.etims_invoices
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- 3) etims_invoice_items ------------------------------------------------
CREATE TABLE public.etims_invoice_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES public.etims_invoices(id) ON DELETE CASCADE,
  line_number       int  NOT NULL,
  description       text NOT NULL,
  hs_code           text,                                       -- KRA HS code (optional)
  item_code         text,
  quantity          numeric(18,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents  bigint NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents    bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_scheme_code   text NOT NULL REFERENCES public.tax_schemes(code),
  tax_rate_bps      int  NOT NULL DEFAULT 0 CHECK (tax_rate_bps >= 0),
  taxable_cents     bigint NOT NULL CHECK (taxable_cents >= 0),
  tax_cents         bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents       bigint NOT NULL CHECK (total_cents >= 0),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_number)
);
CREATE INDEX idx_etims_items_invoice ON public.etims_invoice_items(invoice_id);

GRANT SELECT ON public.etims_invoice_items TO authenticated;
GRANT ALL    ON public.etims_invoice_items TO service_role;
ALTER TABLE public.etims_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etims_items_finance_read" ON public.etims_invoice_items
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- 4) etims_sync_events --------------------------------------------------
CREATE TABLE public.etims_sync_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL REFERENCES public.etims_invoices(id) ON DELETE CASCADE,
  event_type      public.etims_sync_event_type NOT NULL,
  attempt_number  int NOT NULL DEFAULT 1,
  request_payload jsonb,
  response_status int,
  response_payload jsonb,
  duration_ms     int,
  error_code      text,
  error_message   text,
  actor_id        uuid,
  actor_type      text NOT NULL DEFAULT 'service',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etims_sync_events_invoice ON public.etims_sync_events(invoice_id, created_at DESC);
CREATE INDEX idx_etims_sync_events_type    ON public.etims_sync_events(event_type, created_at DESC);

GRANT SELECT ON public.etims_sync_events TO authenticated;
GRANT ALL    ON public.etims_sync_events TO service_role;
ALTER TABLE public.etims_sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etims_sync_events_finance_read" ON public.etims_sync_events
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- 5) etims_webhooks -----------------------------------------------------
CREATE TABLE public.etims_webhooks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid REFERENCES public.etims_invoices(id) ON DELETE SET NULL,
  source              text NOT NULL DEFAULT 'TAX_KE',
  event_type          text NOT NULL,
  raw_headers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload         jsonb NOT NULL,
  signature           text,
  signature_verified  boolean NOT NULL DEFAULT false,
  processed           boolean NOT NULL DEFAULT false,
  processed_at        timestamptz,
  processing_error    text,
  remote_address      text,
  received_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etims_webhooks_invoice ON public.etims_webhooks(invoice_id);
CREATE INDEX idx_etims_webhooks_unprocessed ON public.etims_webhooks(processed, received_at) WHERE processed = false;

GRANT SELECT ON public.etims_webhooks TO authenticated;
GRANT ALL    ON public.etims_webhooks TO service_role;
ALTER TABLE public.etims_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etims_webhooks_finance_read" ON public.etims_webhooks
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- 6) etims_retry_queue --------------------------------------------------
CREATE TABLE public.etims_retry_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid NOT NULL UNIQUE REFERENCES public.etims_invoices(id) ON DELETE CASCADE,
  attempt        int  NOT NULL DEFAULT 0,
  max_attempts   int  NOT NULL DEFAULT 12,                      -- cap ~72h with exponential backoff
  next_retry_at  timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error     text,
  abandoned      boolean NOT NULL DEFAULT false,
  abandoned_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_etims_retry_due ON public.etims_retry_queue(next_retry_at) WHERE abandoned = false;

GRANT SELECT ON public.etims_retry_queue TO authenticated;
GRANT ALL    ON public.etims_retry_queue TO service_role;
ALTER TABLE public.etims_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etims_retry_finance_read" ON public.etims_retry_queue
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- 7) tax_submissions ----------------------------------------------------
CREATE TABLE public.tax_submissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id           uuid NOT NULL REFERENCES public.tax_periods(id),
  scheme_id           uuid NOT NULL REFERENCES public.tax_schemes(id),
  submission_type     text NOT NULL,                            -- 'VAT_RETURN','WHT_RETURN','DST_RETURN', etc.
  status              public.tax_submission_status NOT NULL DEFAULT 'DRAFT',
  total_taxable_cents bigint NOT NULL DEFAULT 0,
  total_tax_cents     bigint NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'KES',
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  kra_reference       text,
  kra_response        jsonb,
  submitted_at        timestamptz,
  acknowledged_at     timestamptz,
  submitted_by        uuid,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, scheme_id, submission_type)
);
CREATE INDEX idx_tax_submissions_status ON public.tax_submissions(status);

GRANT SELECT ON public.tax_submissions TO authenticated;
GRANT ALL    ON public.tax_submissions TO service_role;
ALTER TABLE public.tax_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_submissions_finance_read" ON public.tax_submissions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- 8) tax_reconciliations ------------------------------------------------
CREATE TABLE public.tax_reconciliations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id             uuid NOT NULL REFERENCES public.tax_periods(id),
  scheme_id             uuid NOT NULL REFERENCES public.tax_schemes(id),
  ledger_total_cents    bigint NOT NULL DEFAULT 0,
  etims_total_cents     bigint NOT NULL DEFAULT 0,
  kra_total_cents       bigint NOT NULL DEFAULT 0,
  variance_cents        bigint NOT NULL DEFAULT 0,
  status                public.tax_reconciliation_status NOT NULL DEFAULT 'OK',
  details               jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_by                uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tax_recon_period ON public.tax_reconciliations(period_id, scheme_id);

GRANT SELECT ON public.tax_reconciliations TO authenticated;
GRANT ALL    ON public.tax_reconciliations TO service_role;
ALTER TABLE public.tax_reconciliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax_recon_finance_read" ON public.tax_reconciliations
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

-- ============================================================
-- 9) updated_at triggers
-- ============================================================
CREATE TRIGGER trg_etims_invoices_updated_at
  BEFORE UPDATE ON public.etims_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_etims_retry_updated_at
  BEFORE UPDATE ON public.etims_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tax_submissions_updated_at
  BEFORE UPDATE ON public.tax_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 10) Status transition enforcement
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_etims_invoice_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF (OLD.status, NEW.status) IN (
       ('PENDING'::etims_invoice_status,  'SYNCING'::etims_invoice_status),
       ('PENDING'::etims_invoice_status,  'VOIDED'::etims_invoice_status),
       ('SYNCING'::etims_invoice_status,  'SYNCED'::etims_invoice_status),
       ('SYNCING'::etims_invoice_status,  'RETRYING'::etims_invoice_status),
       ('SYNCING'::etims_invoice_status,  'FAILED'::etims_invoice_status),
       ('RETRYING'::etims_invoice_status, 'SYNCING'::etims_invoice_status),
       ('RETRYING'::etims_invoice_status, 'SYNCED'::etims_invoice_status),
       ('RETRYING'::etims_invoice_status, 'FAILED'::etims_invoice_status),
       ('FAILED'::etims_invoice_status,   'RETRYING'::etims_invoice_status),
       ('FAILED'::etims_invoice_status,   'VOIDED'::etims_invoice_status),
       ('SYNCED'::etims_invoice_status,   'REFUNDED'::etims_invoice_status),
       ('SYNCED'::etims_invoice_status,   'VOIDED'::etims_invoice_status)
     ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Illegal eTIMS invoice status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_etims_invoice_status_transition
  BEFORE UPDATE OF status ON public.etims_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_etims_invoice_status_transition();

-- ============================================================
-- 11) Append-only: restrict updates on etims_invoices financial fields
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_etims_invoice_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.invoice_number       IS DISTINCT FROM OLD.invoice_number
  OR NEW.invoice_type         IS DISTINCT FROM OLD.invoice_type
  OR NEW.subtotal_cents       IS DISTINCT FROM OLD.subtotal_cents
  OR NEW.tax_total_cents      IS DISTINCT FROM OLD.tax_total_cents
  OR NEW.total_cents          IS DISTINCT FROM OLD.total_cents
  OR NEW.currency             IS DISTINCT FROM OLD.currency
  OR NEW.customer_user_id     IS DISTINCT FROM OLD.customer_user_id
  OR NEW.customer_kra_pin     IS DISTINCT FROM OLD.customer_kra_pin
  OR NEW.revenue_event_id     IS DISTINCT FROM OLD.revenue_event_id
  OR NEW.transaction_id       IS DISTINCT FROM OLD.transaction_id
  OR NEW.journal_id           IS DISTINCT FROM OLD.journal_id
  OR NEW.references_invoice_id IS DISTINCT FROM OLD.references_invoice_id
  OR NEW.issued_at            IS DISTINCT FROM OLD.issued_at
  OR NEW.created_at           IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'eTIMS invoice financial/identity fields are immutable after creation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_etims_invoice_immutable
  BEFORE UPDATE ON public.etims_invoices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_etims_invoice_immutable_fields();

-- ============================================================
-- 12) Deny DELETE / mutation on append-only tables
-- ============================================================
CREATE OR REPLACE FUNCTION public.deny_etims_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'eTIMS records are append-only; void or refund instead of deleting';
END $$;

CREATE TRIGGER trg_etims_invoices_no_delete
  BEFORE DELETE ON public.etims_invoices
  FOR EACH ROW EXECUTE FUNCTION public.deny_etims_delete();

CREATE TRIGGER trg_etims_sync_events_no_mutation
  BEFORE UPDATE OR DELETE ON public.etims_sync_events
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

CREATE TRIGGER trg_etims_webhooks_no_delete
  BEFORE DELETE ON public.etims_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.deny_etims_delete();

CREATE TRIGGER trg_tax_recon_no_mutation
  BEFORE UPDATE OR DELETE ON public.tax_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

-- ============================================================
-- 13) Items: enforce totals consistency
-- ============================================================
CREATE OR REPLACE FUNCTION public.assert_etims_item_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE _expected_tax bigint;
BEGIN
  _expected_tax := (NEW.taxable_cents * NEW.tax_rate_bps) / 10000;
  IF abs(NEW.tax_cents - _expected_tax) > 1 THEN
    RAISE EXCEPTION 'eTIMS item tax_cents=% does not match taxable*rate=%', NEW.tax_cents, _expected_tax;
  END IF;
  IF NEW.total_cents <> NEW.taxable_cents + NEW.tax_cents THEN
    RAISE EXCEPTION 'eTIMS item total_cents=% != taxable+tax=%',
      NEW.total_cents, NEW.taxable_cents + NEW.tax_cents;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_etims_items_totals
  BEFORE INSERT OR UPDATE ON public.etims_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.assert_etims_item_totals();
