-- ============================================================
-- Commercial Document Engine — forensic hardening
--   1. Strict separation of duties (creator may never action own document)
--   2. Write-once PDF hash seal + attach RPC
--   3. Email dispatch audit trail (table + idempotent record RPC)
--   4. Trace RPC extended with dispatch history
-- ============================================================

-- ---------- 0. Extend the event vocabulary with PDF_SEALED ----------
ALTER TABLE public.commercial_document_events
  DROP CONSTRAINT commercial_document_events_event_type_check;

ALTER TABLE public.commercial_document_events
  ADD CONSTRAINT commercial_document_events_event_type_check CHECK (event_type IN (
    'TRANSACTION_CREATED',
    'QUOTE_CREATED','QUOTE_UPDATED','QUOTE_APPROVED','QUOTE_REJECTED','QUOTE_SENT','QUOTE_ACCEPTED','QUOTE_EXPIRED',
    'PROFORMA_CREATED','PROFORMA_UPDATED','PROFORMA_APPROVED','PROFORMA_REJECTED','PROFORMA_SENT',
    'PAYMENT_INITIATED','PAYMENT_RECEIVED','PAYMENT_MATCHED','PAYMENT_UNMATCHED','PAYMENT_RECONCILED','PAYMENT_FAILED',
    'TAX_INVOICE_REQUESTED','TAX_VALIDATION_STARTED','ETIMS_SUBMISSION_STARTED','ETIMS_ACCEPTED','ETIMS_REJECTED','TAX_INVOICE_ISSUED',
    'PAYMENT_CONFIRMATION_CREATED','PAYMENT_CONFIRMATION_SENT',
    'EMAIL_QUEUED','EMAIL_SENT','EMAIL_DELIVERED','EMAIL_BOUNCED','EMAIL_FAILED',
    'PDF_SEALED',
    'DOCUMENT_VOIDED','DOCUMENT_SUPERSEDED','DOCUMENT_CORRECTED',
    'DOCUMENT_STATUS_CHANGED','ISSUANCE_BLOCKED','COMMERCIAL_VARIANCE_EXCEPTION',
    'AUDIT_EXCEPTION_CREATED','AUDIT_EXCEPTION_RESOLVED'
  ));

-- ---------- 1. Guard: write-once PDF hash; sealing allowed on issued docs ----------
CREATE OR REPLACE FUNCTION public._commercial_document_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial_documents are immutable forensic records: void or supersede, never delete';
  END IF;

  -- The PDF seal is write-once at ANY status: it may be attached while the
  -- hash is still NULL, but never altered or removed afterwards.
  IF NEW.document_hash IS DISTINCT FROM OLD.document_hash AND OLD.document_hash IS NOT NULL THEN
    RAISE EXCEPTION 'document %: the sealed PDF hash is immutable evidence', OLD.document_number;
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
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
     ) THEN
    RAISE EXCEPTION 'document % is %: identity and financial fields are immutable', OLD.document_number, OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- 2. Strict separation of duties in the state machine ----------
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

  -- Separation of duties (four-eyes): the officer who created a document can
  -- never approve or transition it — a different commercial officer must
  -- action it. System actors (auth.uid() IS NULL: eTIMS webhooks,
  -- reconciliation jobs) are exempt so automation is never blocked.
  IF v_actor IS NOT NULL AND v_doc.created_by IS NOT NULL AND v_actor = v_doc.created_by THEN
    RAISE EXCEPTION 'separation of duties: % was created by you — a different commercial officer must approve or transition it (four-eyes control)', v_doc.document_number;
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

-- ---------- 3. Email dispatch audit trail ----------
CREATE TABLE public.commercial_document_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.commercial_documents(id),
  transaction_id uuid NOT NULL REFERENCES public.commercial_transactions(id),
  transaction_ref text NOT NULL,
  -- Idempotency/correlation key: one logical email = one row; retries update it.
  message_id text NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  template_key text NOT NULL,
  template_version text NOT NULL DEFAULT '1.0',
  pdf_sha256 text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','bounced','failed','suppressed')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  error_message text,
  provider text NOT NULL DEFAULT 'smtp2go',
  provider_message_id text,
  actor_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_document_dispatches_message_uidx UNIQUE (message_id),
  CONSTRAINT commercial_document_dispatches_hash_fmt
    CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX commercial_document_dispatches_doc_idx
  ON public.commercial_document_dispatches (document_id, created_at);
CREATE INDEX commercial_document_dispatches_txn_idx
  ON public.commercial_document_dispatches (transaction_id, created_at);

GRANT SELECT, INSERT, UPDATE ON public.commercial_document_dispatches TO authenticated;
GRANT ALL ON public.commercial_document_dispatches TO service_role;

ALTER TABLE public.commercial_document_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff manage dispatches"
  ON public.commercial_document_dispatches FOR ALL TO authenticated
  USING (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]))
  WITH CHECK (public.is_commercial_staff()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::public.app_role[]));

CREATE POLICY "customers read own dispatches"
  ON public.commercial_document_dispatches FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.commercial_documents d
    WHERE d.id = commercial_document_dispatches.document_id
      AND (d.customer_user_id = auth.uid()
        OR (d.corporate_id IS NOT NULL AND public.is_corporate_member(auth.uid(), d.corporate_id)))
  ));

-- Forensic guard: no deletes; identity fields immutable once sent; attempts monotonic.
CREATE OR REPLACE FUNCTION public._commercial_document_dispatch_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commercial_document_dispatches is append-only forensic evidence';
  END IF;
  IF OLD.status IN ('sent','delivered') AND (
       NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.message_id IS DISTINCT FROM OLD.message_id
       OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
       OR NEW.subject IS DISTINCT FROM OLD.subject
       OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
     ) THEN
    RAISE EXCEPTION 'dispatch % is %: recipient, subject and artifact hash are immutable once sent', OLD.message_id, OLD.status;
  END IF;
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'dispatch %: attempt_count cannot move backwards', OLD.message_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_document_dispatches_guard
  BEFORE UPDATE OR DELETE ON public.commercial_document_dispatches
  FOR EACH ROW EXECUTE FUNCTION public._commercial_document_dispatch_guard();

CREATE TRIGGER commercial_document_dispatches_touch
  BEFORE UPDATE ON public.commercial_document_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.touch_commercial_updated_at();

-- ---------- 4. Write-once PDF seal RPC ----------
CREATE OR REPLACE FUNCTION public.commercial_document_attach_hash(
  p_document_id uuid,
  p_sha256 text,
  p_byte_size integer DEFAULT NULL,
  p_storage_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_doc public.commercial_documents%ROWTYPE;
BEGIN
  IF NOT (public.is_commercial_staff()
          OR public.has_any_role(v_actor, ARRAY['admin','finance_admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'not authorized to seal commercial documents';
  END IF;

  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid sha256 digest — expected 64 lowercase hex characters';
  END IF;

  SELECT * INTO v_doc FROM public.commercial_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document % not found', p_document_id;
  END IF;

  IF v_doc.status IN ('voided','superseded','cancelled','expired') THEN
    RAISE EXCEPTION 'cannot seal a % document', v_doc.status;
  END IF;

  -- Idempotent re-seal with the identical artifact; tamper on any mismatch.
  IF v_doc.document_hash IS NOT NULL THEN
    IF v_doc.document_hash = p_sha256 THEN
      RETURN jsonb_build_object('idempotent', true, 'document', to_jsonb(v_doc));
    END IF;
    RAISE EXCEPTION 'pdf hash mismatch: % is already sealed with a different artifact — possible tampering', v_doc.document_number;
  END IF;

  UPDATE public.commercial_documents
     SET document_hash = p_sha256,
         hash_algorithm = 'sha256',
         storage_ref = COALESCE(p_storage_ref, storage_ref),
         metadata = metadata || jsonb_build_object('pdf_byte_size', p_byte_size, 'sealed_at', now())
   WHERE id = v_doc.id
   RETURNING * INTO v_doc;

  INSERT INTO public.commercial_document_events (
    document_id, transaction_id, transaction_ref, event_type, actor_id, actor_type,
    prev_status, new_status, metadata
  ) VALUES (
    v_doc.id, v_doc.transaction_id, v_doc.transaction_ref, 'PDF_SEALED', v_actor, 'staff',
    v_doc.status::text, v_doc.status::text,
    jsonb_build_object('sha256', p_sha256, 'byte_size', p_byte_size)
  );

  RETURN jsonb_build_object('idempotent', false, 'document', to_jsonb(v_doc));
END;
$$;

-- ---------- 5. Idempotent dispatch recorder ----------
CREATE OR REPLACE FUNCTION public.commercial_document_dispatch_record(
  p_document_id uuid,
  p_message_id text,
  p_recipient_email text,
  p_subject text,
  p_template_key text,
  p_template_version text DEFAULT '1.0',
  p_pdf_sha256 text DEFAULT NULL,
  p_status text DEFAULT 'queued',
  p_error text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_doc public.commercial_documents%ROWTYPE;
  v_row public.commercial_document_dispatches%ROWTYPE;
  v_event text;
BEGIN
  IF NOT (public.is_commercial_staff()
          OR public.has_any_role(v_actor, ARRAY['admin','finance_admin','super_admin']::public.app_role[])) THEN
    RAISE EXCEPTION 'not authorized to record commercial dispatches';
  END IF;

  SELECT * INTO v_doc FROM public.commercial_documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document % not found', p_document_id;
  END IF;

  -- Artifact binding: a dispatch may only carry the document's sealed hash.
  IF v_doc.document_hash IS NOT NULL AND p_pdf_sha256 IS NOT NULL
     AND p_pdf_sha256 <> v_doc.document_hash THEN
    RAISE EXCEPTION 'dispatch hash mismatch: the artifact being sent does not match the sealed PDF hash of %', v_doc.document_number;
  END IF;

  v_event := CASE p_status
    WHEN 'queued'    THEN 'EMAIL_QUEUED'
    WHEN 'sent'      THEN 'EMAIL_SENT'
    WHEN 'delivered' THEN 'EMAIL_DELIVERED'
    WHEN 'bounced'   THEN 'EMAIL_BOUNCED'
    ELSE 'EMAIL_FAILED'
  END;

  SELECT * INTO v_row FROM public.commercial_document_dispatches
   WHERE message_id = p_message_id FOR UPDATE;

  IF FOUND THEN
    -- Retry of the same logical email: identical binding required.
    IF v_row.document_id <> p_document_id THEN
      RAISE EXCEPTION 'message_id % is already bound to a different document', p_message_id;
    END IF;
    IF v_row.pdf_sha256 IS NOT NULL AND p_pdf_sha256 IS NOT NULL
       AND v_row.pdf_sha256 <> p_pdf_sha256 THEN
      RAISE EXCEPTION 'dispatch artifact mismatch on retry for message % — possible tampering', p_message_id;
    END IF;
    UPDATE public.commercial_document_dispatches
       SET status = p_status,
           attempt_count = attempt_count + 1,
           last_attempt_at = now(),
           error_message = p_error,
           provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
           pdf_sha256 = COALESCE(pdf_sha256, p_pdf_sha256)
     WHERE id = v_row.id
     RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.commercial_document_dispatches (
      document_id, transaction_id, transaction_ref, message_id,
      recipient_email, subject, template_key, template_version,
      pdf_sha256, status, attempt_count, last_attempt_at,
      error_message, provider_message_id, actor_id
    ) VALUES (
      v_doc.id, v_doc.transaction_id, v_doc.transaction_ref, p_message_id,
      p_recipient_email, p_subject, p_template_key, p_template_version,
      COALESCE(p_pdf_sha256, v_doc.document_hash), p_status,
      CASE WHEN p_status = 'queued' THEN 0 ELSE 1 END,
      CASE WHEN p_status = 'queued' THEN NULL ELSE now() END,
      p_error, p_provider_message_id, v_actor
    ) RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.commercial_document_events (
    document_id, transaction_id, transaction_ref, event_type, actor_id, actor_type,
    prev_status, new_status, metadata
  ) VALUES (
    v_doc.id, v_doc.transaction_id, v_doc.transaction_ref, v_event, v_actor, 'staff',
    NULL, v_row.status,
    jsonb_build_object(
      'message_id', p_message_id,
      'recipient', p_recipient_email,
      'template', p_template_key || '@' || p_template_version,
      'attempt', v_row.attempt_count,
      'error', p_error
    )
  );

  RETURN jsonb_build_object('dispatch', to_jsonb(v_row), 'event', v_event);
END;
$$;

-- ---------- 6. Trace: include the dispatch history ----------
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
    'dispatches', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at)
        FROM public.commercial_document_dispatches x WHERE x.transaction_id = v_txn.id), '[]'::jsonb),
    'lineage', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) ORDER BY l.stage_no)
        FROM public.commercial_lineage_stages l WHERE l.transaction_id = v_txn.id), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.commercial_document_transition(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_document_attach_hash(uuid, text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_document_dispatch_record(uuid, text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_document_trace(text) TO authenticated;