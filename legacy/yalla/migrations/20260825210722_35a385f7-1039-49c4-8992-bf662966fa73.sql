-- ============================================================
-- Commercial Document, Billing, Tax & Audit Orchestration Engine
-- Domain: commercial (docs/DOMAINS.md)
-- Gap-closure layer over the existing spine: commercial_transactions,
-- etims_invoices, corporate_invoices, ops_event_outbox. No duplicate
-- invoice/quote/payment engines are created.
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE public.commercial_document_type AS ENUM (
  'quotation', 'proforma', 'tax_invoice', 'payment_receipt'
);

CREATE TYPE public.commercial_document_status AS ENUM (
  'draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected',
  'expired', 'cancelled', 'issued', 'partially_paid', 'paid',
  'tax_validation', 'etims_pending', 'etims_accepted', 'etims_exception',
  'delivered', 'correction_required', 'superseded', 'voided'
);

-- ---------- Server-side numbering sequences (concurrency-safe) ----------
CREATE SEQUENCE public.commercial_proforma_seq;
CREATE SEQUENCE public.commercial_receipt_seq;

-- ---------- Canonical commercial document registry ----------
CREATE TABLE public.commercial_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number text NOT NULL UNIQUE,
  document_type public.commercial_document_type NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.commercial_transactions(id),
  transaction_ref text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  supersedes_id uuid REFERENCES public.commercial_documents(id),
  source_document_id uuid REFERENCES public.commercial_documents(id),
  source_type text,
  source_ref text,
  source_version integer,
  source_total_cents bigint,
  corporate_id uuid REFERENCES public.corporate_accounts(id),
  customer_user_id uuid,
  currency text NOT NULL DEFAULT 'KES',
  subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  status public.commercial_document_status NOT NULL DEFAULT 'draft',
  document_hash text,
  hash_algorithm text NOT NULL DEFAULT 'sha256',
  storage_ref text,
  etims_invoice_id uuid REFERENCES public.etims_invoices(id),
  payment_ref text,
  recipient_email text,
  idempotency_key text,
  risk_level text NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  approved_by uuid,
  approved_at timestamptz,
  issued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  voided_at timestamptz,
  voided_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, document_type, version)
);
CREATE UNIQUE INDEX commercial_documents_idempotency_uidx
  ON public.commercial_documents (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX commercial_documents_transaction_idx ON public.commercial_documents (transaction_id, document_type);
CREATE INDEX commercial_documents_corporate_idx ON public.commercial_documents (corporate_id) WHERE corporate_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.commercial_documents TO authenticated;
GRANT ALL ON public.commercial_documents TO service_role;

ALTER TABLE public.commercial_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read documents"
  ON public.commercial_documents FOR SELECT TO authenticated
  USING (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

CREATE POLICY "commercial staff write documents"
  ON public.commercial_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

CREATE POLICY "commercial staff update draft documents"
  ON public.commercial_documents FOR UPDATE TO authenticated
  USING (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

CREATE POLICY "customers read own documents"
  ON public.commercial_documents FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid()
    OR (corporate_id IS NOT NULL AND public.is_corporate_member(auth.uid(), corporate_id)));

-- Immutability: once a document leaves the editable states its identity and
-- financial fields are frozen; rows are never deleted (void/supersede instead).
CREATE OR REPLACE FUNCTION public._commercial_document_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial_documents are immutable forensic records: void or supersede, never delete';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('issued','sent','delivered','paid','partially_paid','etims_accepted','superseded','voided')
     AND (
       NEW.document_number IS DISTINCT FROM OLD.document_number
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
       OR NEW.corporate_id IS DISTINCT FROM OLD.corporate_id
       OR NEW.customer_user_id IS DISTINCT FROM OLD.customer_user_id
       OR NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents
       OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents
       OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
       OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
       OR NEW.etims_invoice_id IS DISTINCT FROM OLD.etims_invoice_id
       OR NEW.document_hash IS DISTINCT FROM OLD.document_hash
     ) THEN
    RAISE EXCEPTION 'document % is %: identity and financial fields are immutable', OLD.document_number, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_documents_guard
  BEFORE UPDATE OR DELETE ON public.commercial_documents
  FOR EACH ROW EXECUTE FUNCTION public._commercial_document_guard();

CREATE TRIGGER commercial_documents_touch
  BEFORE UPDATE ON public.commercial_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_commercial_updated_at();

-- ---------- Append-only commercial event stream ----------
CREATE TABLE public.commercial_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.commercial_documents(id),
  transaction_id uuid REFERENCES public.commercial_transactions(id),
  transaction_ref text,
  event_type text NOT NULL CHECK (event_type IN (
    'TRANSACTION_CREATED',
    'QUOTE_CREATED','QUOTE_UPDATED','QUOTE_APPROVED','QUOTE_REJECTED','QUOTE_SENT','QUOTE_ACCEPTED','QUOTE_EXPIRED',
    'PROFORMA_CREATED','PROFORMA_UPDATED','PROFORMA_APPROVED','PROFORMA_REJECTED','PROFORMA_SENT',
    'PAYMENT_INITIATED','PAYMENT_RECEIVED','PAYMENT_MATCHED','PAYMENT_UNMATCHED','PAYMENT_RECONCILED','PAYMENT_FAILED',
    'TAX_INVOICE_REQUESTED','TAX_VALIDATION_STARTED','ETIMS_SUBMISSION_STARTED','ETIMS_ACCEPTED','ETIMS_REJECTED','TAX_INVOICE_ISSUED',
    'PAYMENT_CONFIRMATION_CREATED','PAYMENT_CONFIRMATION_SENT',
    'EMAIL_QUEUED','EMAIL_SENT','EMAIL_DELIVERED','EMAIL_BOUNCED','EMAIL_FAILED',
    'DOCUMENT_VOIDED','DOCUMENT_SUPERSEDED','DOCUMENT_CORRECTED',
    'DOCUMENT_STATUS_CHANGED','ISSUANCE_BLOCKED','COMMERCIAL_VARIANCE_EXCEPTION',
    'AUDIT_EXCEPTION_CREATED','AUDIT_EXCEPTION_RESOLVED'
  )),
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'staff' CHECK (actor_type IN ('staff','customer','system','integration')),
  prev_status text,
  new_status text,
  correlation_id uuid,
  causation_id uuid,
  source_system text NOT NULL DEFAULT 'commercial-document-engine',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_document_events_doc_idx ON public.commercial_document_events (document_id, created_at);
CREATE INDEX commercial_document_events_txn_idx ON public.commercial_document_events (transaction_id, created_at);

GRANT SELECT, INSERT ON public.commercial_document_events TO authenticated;
GRANT ALL ON public.commercial_document_events TO service_role;

ALTER TABLE public.commercial_document_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read document events"
  ON public.commercial_document_events FOR SELECT TO authenticated
  USING (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

CREATE POLICY "commercial staff append document events"
  ON public.commercial_document_events FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

CREATE POLICY "customers read own document events"
  ON public.commercial_document_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.commercial_documents d
    WHERE d.id = commercial_document_events.document_id
      AND (d.customer_user_id = auth.uid()
        OR (d.corporate_id IS NOT NULL AND public.is_corporate_member(auth.uid(), d.corporate_id)))
  ));

CREATE OR REPLACE FUNCTION public._commercial_document_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'commercial_document_events is append-only forensic evidence';
END;
$$;

CREATE TRIGGER commercial_document_events_no_update
  BEFORE UPDATE OR DELETE ON public.commercial_document_events
  FOR EACH ROW EXECUTE FUNCTION public._commercial_document_events_append_only();

-- ---------- Document orchestration policy ----------
CREATE TABLE public.commercial_document_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_line text NOT NULL,
  customer_kind text NOT NULL DEFAULT 'any',
  requires_proforma boolean NOT NULL DEFAULT false,
  requires_etims boolean NOT NULL DEFAULT true,
  requires_payment_before_issue boolean NOT NULL DEFAULT false,
  approval_required_over_cents bigint,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_line, customer_kind)
);

GRANT SELECT ON public.commercial_document_policies TO authenticated;
GRANT ALL ON public.commercial_document_policies TO service_role;

ALTER TABLE public.commercial_document_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read document policies"
  ON public.commercial_document_policies FOR SELECT TO authenticated
  USING (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

INSERT INTO public.commercial_document_policies
  (service_line, customer_kind, requires_proforma, requires_etims, requires_payment_before_issue, approval_required_over_cents)
VALUES
  ('charter',   'corporate',  true,  true, false, 50000000),
  ('charter',   'individual', true,  true, true,  NULL),
  ('corporate', 'corporate',  true,  true, false, NULL),
  ('airport',   'any',        false, true, true,  NULL),
  ('ride_hailing','any',      false, true, true,  NULL),
  ('delivery',  'any',        false, true, true,  NULL),
  ('rental',    'any',        true,  true, true,  NULL);

-- ---------- Numbering ----------
CREATE OR REPLACE FUNCTION public._commercial_document_number(p_type public.commercial_document_type)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT CASE p_type
    WHEN 'quotation'       THEN 'YAL-QTN-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.commercial_quote_number_seq')::text, 6, '0')
    WHEN 'proforma'        THEN 'YAL-PFI-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.commercial_proforma_seq')::text, 6, '0')
    WHEN 'tax_invoice'     THEN 'YAL-INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.etims_invoice_seq')::text, 6, '0')
    WHEN 'payment_receipt' THEN 'YAL-RCP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.commercial_receipt_seq')::text, 6, '0')
  END;
$$;

-- ---------- Issuance with hard blockers + idempotency ----------
CREATE OR REPLACE FUNCTION public.commercial_document_generate(
  p_transaction_id uuid,
  p_document_type text,
  p_idempotency_key text,
  p_source_document_id uuid DEFAULT NULL,
  p_recipient_email text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_type public.commercial_document_type := p_document_type::public.commercial_document_type;
  v_txn public.commercial_transactions%ROWTYPE;
  v_src public.commercial_documents%ROWTYPE;
  v_policy public.commercial_document_policies%ROWTYPE;
  v_existing public.commercial_documents%ROWTYPE;
  v_doc public.commercial_documents%ROWTYPE;
  v_version integer;
  v_status public.commercial_document_status;
  v_blocked text := NULL;
  v_event text;
  v_etims_id uuid;
  v_paid boolean;
BEGIN
  -- Segregation of duties: commercial staff or finance/admin only.
  IF NOT (public.is_commercial_staff()
          OR public.has_any_role(v_actor, ARRAY['admin','finance_admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'not authorized to issue commercial documents';
  END IF;

  -- Idempotency: a retry returns the already-issued document.
  SELECT * INTO v_existing FROM public.commercial_documents WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('idempotent', true, 'document', to_jsonb(v_existing));
  END IF;

  -- Hard blocker: source transaction must exist.
  SELECT * INTO v_txn FROM public.commercial_transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    INSERT INTO public.ops_event_outbox (event_type, source_portal, entity_type, entity_ref, payload, dedupe_key)
    VALUES ('commercial.issuance_blocked', 'staff', 'commercial_transaction', p_transaction_id::text,
            jsonb_build_object('reason', 'missing_source_transaction', 'document_type', p_document_type),
            'commercial-blocked-' || p_transaction_id::text || '-' || p_document_type);
    RAISE EXCEPTION 'hard blocker: source transaction % not found', p_transaction_id;
  END IF;

  -- Orchestration policy for this product/customer combination.
  SELECT * INTO v_policy FROM public.commercial_document_policies
   WHERE active AND service_line = v_txn.service_line
     AND (customer_kind = v_txn.customer_kind OR customer_kind = 'any')
   ORDER BY CASE WHEN customer_kind = v_txn.customer_kind THEN 0 ELSE 1 END
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT * INTO v_policy FROM public.commercial_document_policies
     WHERE active AND service_line = 'charter' AND customer_kind = 'corporate' LIMIT 1;
  END IF;

  -- Source document provenance + variance control.
  IF p_source_document_id IS NOT NULL THEN
    SELECT * INTO v_src FROM public.commercial_documents WHERE id = p_source_document_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'hard blocker: source document % not found', p_source_document_id;
    END IF;
    IF v_src.transaction_id <> p_transaction_id THEN
      RAISE EXCEPTION 'hard blocker: source document belongs to a different transaction';
    END IF;
  END IF;

  v_status := 'draft';

  IF v_type = 'proforma' AND v_src.id IS NOT NULL THEN
    -- Proforma must reconcile with the accepted quotation; variance blocks issuance.
    IF abs(COALESCE(v_txn.customer_charge_cents, v_src.total_cents) - v_src.total_cents) > 100 THEN
      v_blocked := format('commercial variance: transaction total %s differs from source quotation %s',
                          COALESCE(v_txn.customer_charge_cents, -1), v_src.total_cents);
      v_event := 'COMMERCIAL_VARIANCE_EXCEPTION';
    ELSE
      v_status := 'issued';
      v_event := 'PROFORMA_CREATED';
    END IF;

  ELSIF v_type = 'tax_invoice' THEN
    -- eTIMS hard gate: no ISSUED tax invoice without an accepted eTIMS record.
    IF COALESCE(v_policy.requires_etims, true) THEN
      SELECT id INTO v_etims_id FROM public.etims_invoices
       WHERE transaction_id = p_transaction_id AND status = 'SYNCED'
       ORDER BY synced_at DESC NULLS LAST LIMIT 1;
      IF v_etims_id IS NULL THEN
        v_blocked := 'eTIMS gate: no SYNCED eTIMS invoice for this transaction';
        v_status := 'etims_exception';
        v_event := 'ETIMS_REJECTED';
      ELSE
        v_status := 'issued';
        v_event := 'TAX_INVOICE_ISSUED';
      END IF;
    ELSE
      v_status := 'issued';
      v_event := 'TAX_INVOICE_ISSUED';
    END IF;

  ELSIF v_type = 'payment_receipt' THEN
    -- Ghost-receipt prevention: receipt requires reconciled payment evidence.
    SELECT (
      lower(COALESCE(v_txn.payment_status,'')) IN ('paid','reconciled','matched','settled')
      OR EXISTS (SELECT 1 FROM public.mpesa_transactions m
                  WHERE m.account_reference = v_txn.transaction_ref AND m.status = 'SUCCESS')
      OR (v_txn.invoice_table = 'corporate_invoices' AND EXISTS (
           SELECT 1 FROM public.corporate_invoices ci
           WHERE ci.id = v_txn.invoice_id AND ci.status = 'PAID' AND ci.balance_cents = 0))
    ) INTO v_paid;
    IF NOT v_paid THEN
      v_blocked := 'payment gate: no reconciled payment evidence for this transaction';
      v_event := 'PAYMENT_UNMATCHED';
    ELSE
      v_status := 'issued';
      v_event := 'PAYMENT_CONFIRMATION_CREATED';
    END IF;

  ELSE -- quotation
    v_status := 'draft';
    v_event := 'QUOTE_CREATED';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.commercial_documents
   WHERE transaction_id = p_transaction_id AND document_type = v_type;

  INSERT INTO public.commercial_documents (
    document_number, document_type, transaction_id, transaction_ref, version,
    source_document_id, source_type, source_ref, source_version, source_total_cents,
    corporate_id, customer_user_id, currency,
    subtotal_cents, tax_cents, total_cents,
    status, etims_invoice_id, payment_ref, recipient_email, idempotency_key,
    risk_level, issued_at, metadata, created_by
  ) VALUES (
    public._commercial_document_number(v_type), v_type, p_transaction_id, v_txn.transaction_ref, v_version,
    v_src.id, CASE WHEN v_src.id IS NOT NULL THEN v_src.document_type::text END,
    v_src.document_number, v_src.version, v_src.total_cents,
    v_txn.corporate_id, v_txn.customer_user_id, COALESCE(v_txn.currency, 'KES'),
    COALESCE(v_txn.gross_transaction_value_cents, v_txn.customer_charge_cents, 0),
    COALESCE(v_txn.tax_cents, 0),
    COALESCE(v_txn.customer_charge_cents, 0),
    v_status, v_etims_id, v_txn.payment_ref, p_recipient_email, p_idempotency_key,
    CASE WHEN v_blocked IS NULL THEN 'LOW' ELSE 'HIGH' END,
    CASE WHEN v_status = 'issued' THEN now() END,
    p_metadata, v_actor
  ) RETURNING * INTO v_doc;

  INSERT INTO public.commercial_document_events (
    document_id, transaction_id, transaction_ref, event_type, actor_id, actor_type,
    prev_status, new_status, correlation_id, metadata
  ) VALUES (
    v_doc.id, p_transaction_id, v_txn.transaction_ref, v_event, v_actor, 'staff',
    NULL, v_doc.status::text, gen_random_uuid(),
    jsonb_build_object('blocked', v_blocked, 'idempotency_key', p_idempotency_key)
  );

  IF v_blocked IS NOT NULL THEN
    INSERT INTO public.ops_event_outbox (event_type, source_portal, entity_type, entity_id, entity_ref, payload, dedupe_key)
    VALUES ('commercial.issuance_blocked', 'staff', 'commercial_document', v_doc.id, v_doc.document_number,
            jsonb_build_object('reason', v_blocked, 'transaction_ref', v_txn.transaction_ref, 'document_type', p_document_type),
            'commercial-blocked-' || v_doc.id::text);
  END IF;

  RETURN jsonb_build_object('idempotent', false, 'blocked', v_blocked, 'document', to_jsonb(v_doc));
END;
$$;

-- ---------- Strict state machine ----------
CREATE OR REPLACE FUNCTION public.commercial_document_transition(
  p_document_id uuid,
  p_to_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_doc public.commercial_documents%ROWTYPE;
  v_to public.commercial_document_status := p_to_status::public.commercial_document_status;
  v_allowed boolean := false;
BEGIN
  IF NOT (public.is_commercial_staff()
          OR public.has_any_role(v_actor, ARRAY['admin','finance_admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'not authorized to transition commercial documents';
  END IF;

  SELECT * INTO v_doc FROM public.commercial_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document % not found', p_document_id;
  END IF;

  IF v_doc.status IN ('superseded','voided','cancelled','expired') THEN
    RAISE EXCEPTION 'document % is in terminal state %', v_doc.document_number, v_doc.status;
  END IF;

  v_allowed := CASE v_doc.document_type
    WHEN 'quotation' THEN
      (v_doc.status = 'draft'            AND v_to IN ('pending_approval','cancelled')) OR
      (v_doc.status = 'pending_approval' AND v_to IN ('approved','rejected','draft')) OR
      (v_doc.status = 'approved'         AND v_to IN ('sent','expired','cancelled')) OR
      (v_doc.status = 'sent'             AND v_to IN ('accepted','rejected','expired')) OR
      (v_doc.status = 'accepted'         AND v_to IN ('superseded'))
    WHEN 'proforma' THEN
      (v_doc.status = 'draft'            AND v_to IN ('pending_approval','cancelled')) OR
      (v_doc.status = 'pending_approval' AND v_to IN ('approved','rejected','draft')) OR
      (v_doc.status = 'approved'         AND v_to IN ('issued','cancelled')) OR
      (v_doc.status = 'issued'           AND v_to IN ('sent','partially_paid','paid','expired','voided')) OR
      (v_doc.status = 'sent'             AND v_to IN ('partially_paid','paid','expired')) OR
      (v_doc.status = 'partially_paid'   AND v_to IN ('paid','voided'))
    WHEN 'tax_invoice' THEN
      (v_doc.status = 'draft'            AND v_to IN ('tax_validation','cancelled')) OR
      (v_doc.status = 'tax_validation'   AND v_to IN ('etims_pending','correction_required')) OR
      (v_doc.status = 'etims_pending'    AND v_to IN ('etims_accepted','etims_exception')) OR
      (v_doc.status = 'etims_accepted'   AND v_to IN ('issued')) OR
      (v_doc.status = 'etims_exception'  AND v_to IN ('etims_pending','voided')) OR
      (v_doc.status = 'issued'           AND v_to IN ('sent','correction_required')) OR
      (v_doc.status = 'sent'             AND v_to IN ('delivered','correction_required')) OR
      (v_doc.status = 'correction_required' AND v_to IN ('superseded','voided'))
    WHEN 'payment_receipt' THEN
      (v_doc.status = 'issued'           AND v_to IN ('sent','voided')) OR
      (v_doc.status = 'sent'             AND v_to IN ('delivered','voided')) OR
      (v_doc.status = 'draft'            AND v_to IN ('issued','cancelled'))
  END;

  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'invalid transition: % % -> % is not permitted', v_doc.document_type, v_doc.status, v_to;
  END IF;

  UPDATE public.commercial_documents
     SET status = v_to,
         sent_at = CASE WHEN v_to = 'sent' THEN now() ELSE sent_at END,
         delivered_at = CASE WHEN v_to = 'delivered' THEN now() ELSE delivered_at END,
         approved_by = CASE WHEN v_to = 'approved' THEN v_actor ELSE approved_by END,
         approved_at = CASE WHEN v_to = 'approved' THEN now() ELSE approved_at END,
         voided_at = CASE WHEN v_to = 'voided' THEN now() ELSE voided_at END,
         voided_reason = CASE WHEN v_to = 'voided' THEN p_reason ELSE voided_reason END
   WHERE id = v_doc.id
   RETURNING * INTO v_doc;

  INSERT INTO public.commercial_document_events (
    document_id, transaction_id, transaction_ref, event_type, actor_id, actor_type,
    prev_status, new_status, metadata
  ) VALUES (
    v_doc.id, v_doc.transaction_id, v_doc.transaction_ref,
    CASE v_to
      WHEN 'voided' THEN 'DOCUMENT_VOIDED'
      WHEN 'superseded' THEN 'DOCUMENT_SUPERSEDED'
      WHEN 'correction_required' THEN 'DOCUMENT_CORRECTED'
      WHEN 'etims_accepted' THEN 'ETIMS_ACCEPTED'
      WHEN 'etims_exception' THEN 'ETIMS_REJECTED'
      ELSE 'DOCUMENT_STATUS_CHANGED'
    END,
    v_actor, 'staff', NULL, v_to::text,
    jsonb_build_object('reason', p_reason)
  );

  RETURN jsonb_build_object('document', to_jsonb(v_doc));
END;
$$;

-- ---------- Forensic reconstruction ----------
CREATE OR REPLACE FUNCTION public.commercial_document_trace(p_ref text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn public.commercial_transactions%ROWTYPE;
BEGIN
  IF NOT (public.is_commercial_staff()
          OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'not authorized to trace commercial transactions';
  END IF;

  SELECT * INTO v_txn FROM public.commercial_transactions
   WHERE transaction_ref = p_ref OR id::text = p_ref;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'ref', p_ref);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'transaction', to_jsonb(v_txn),
    'documents', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at)
        FROM public.commercial_documents d WHERE d.transaction_id = v_txn.id), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
        FROM public.commercial_document_events e WHERE e.transaction_id = v_txn.id), '[]'::jsonb),
    'lineage', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.stage_no)
        FROM public.commercial_lineage_stages l WHERE l.transaction_id = v_txn.id), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_document_generate(uuid, text, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_document_transition(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_document_trace(text) TO authenticated;