-- ============================================================
-- 1. CLIENT CONTRACT PORTAL
-- ============================================================
CREATE TABLE public.contract_portal_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  recipient_email text,
  recipient_name text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  opened_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.contract_portal_invites TO authenticated;
GRANT ALL ON public.contract_portal_invites TO service_role;
ALTER TABLE public.contract_portal_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal invites readable by contract readers"
  ON public.contract_portal_invites FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
                 WHERE c.id = contract_portal_invites.contract_id AND public._contract_may_read(c.*)));

CREATE POLICY "portal invites created by contract readers"
  ON public.contract_portal_invites FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
                      WHERE c.id = contract_portal_invites.contract_id AND public._contract_may_read(c.*)));

CREATE POLICY "portal invites revocable by contract readers"
  ON public.contract_portal_invites FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
                 WHERE c.id = contract_portal_invites.contract_id AND public._contract_may_read(c.*)));

CREATE INDEX contract_portal_invites_contract_idx ON public.contract_portal_invites (contract_id);

CREATE TRIGGER contract_portal_invites_touch
  BEFORE UPDATE ON public.contract_portal_invites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Issue a portal link. Returns the one-time token; only its hash is stored.
CREATE OR REPLACE FUNCTION public.contract_portal_invite_create(
  _contract uuid, _email text DEFAULT NULL, _name text DEFAULT NULL, _days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.commercial_contract_instances; v_token text; v_id uuid;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_read(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.contract_portal_invites
    (contract_id, token_hash, recipient_email, recipient_name, expires_at, created_by, created_staff_id)
  VALUES (c.id, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), NULLIF(trim(_email), ''),
          NULLIF(trim(_name), ''), now() + make_interval(days => greatest(1, least(coalesce(_days, 30), 120))),
          auth.uid(), public._my_staff_member_id())
  RETURNING id INTO v_id;

  INSERT INTO public.contract_events (contract_id, event_type, from_status, to_status, reason, source, actor_id, actor_staff_id)
  VALUES (c.id, 'PORTAL_LINK_ISSUED', c.status, c.status,
          'Client portal link issued' || coalesce(' to ' || NULLIF(trim(_email), ''), ''), 'portal',
          auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'invite_id', v_id, 'token', v_token,
                            'path', '/contract-portal/' || v_token);
END $$;

-- Anonymous, token-bearing read of a single contract summary.
CREATE OR REPLACE FUNCTION public.contract_portal_open(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE inv public.contract_portal_invites; c public.commercial_contract_instances;
BEGIN
  IF coalesce(length(trim(coalesce(_token, ''))), 0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  END IF;
  SELECT * INTO inv FROM public.contract_portal_invites
   WHERE token_hash = encode(sha256(convert_to(trim(_token), 'utf8')), 'hex');
  IF inv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF inv.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = inv.contract_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;

  UPDATE public.contract_portal_invites SET opened_at = coalesce(opened_at, now()) WHERE id = inv.id;

  RETURN jsonb_build_object(
    'ok', true,
    'completed', inv.completed_at IS NOT NULL,
    'completed_at', inv.completed_at,
    'recipient_name', inv.recipient_name,
    'recipient_email', inv.recipient_email,
    'upload_prefix', 'portal-inbox/' || inv.id::text || '/',
    'contract', jsonb_build_object(
      'contract_number', c.contract_number,
      'title', c.title,
      'customer', c.customer_legal_name,
      'status', c.status,
      'value_amount', c.value_amount,
      'currency', c.currency,
      'value_type', c.value_type,
      'payment_terms', c.payment_terms,
      'term_start', c.term_start,
      'term_end', c.term_end,
      'effective_date', c.effective_date,
      'company_signatory', c.company_signatory
    ));
END $$;

-- Anonymous, token-bearing acceptance: files the signed copy and closes signature.
CREATE OR REPLACE FUNCTION public.contract_portal_submit(
  _token text, _accepted_by text, _accepted_title text, _signed_on date,
  _storage_path text DEFAULT NULL, _file_name text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE inv public.contract_portal_invites; c public.commercial_contract_instances;
        v_prefix text; v_version integer; v_signed date; v_staff uuid; v_work uuid;
BEGIN
  IF coalesce(length(trim(coalesce(_token, ''))), 0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  END IF;
  SELECT * INTO inv FROM public.contract_portal_invites
   WHERE token_hash = encode(sha256(convert_to(trim(_token), 'utf8')), 'hex') FOR UPDATE;
  IF inv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF inv.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;
  IF inv.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_SUBMITTED'); END IF;

  IF coalesce(length(trim(coalesce(_accepted_by, ''))), 0) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNATORY_NAME_REQUIRED');
  END IF;
  IF _storage_path IS NULL OR trim(_storage_path) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNED_COPY_REQUIRED');
  END IF;

  v_prefix := 'portal-inbox/' || inv.id::text || '/';
  IF position(v_prefix in _storage_path) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UPLOAD_PATH_REJECTED');
  END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = inv.contract_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF c.activated_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_ALREADY_ACTIVE'); END IF;

  v_signed := least(coalesce(_signed_on, current_date), current_date);

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.contract_documents WHERE contract_id = c.id AND document_type = 'executed';

  INSERT INTO public.contract_documents
    (contract_id, document_type, version, storage_bucket, storage_path, file_name, status, source, notes)
  VALUES (c.id, 'executed', v_version, 'crm-documents', trim(_storage_path),
          NULLIF(trim(coalesce(_file_name, '')), ''), 'received', 'client_portal',
          'Uploaded by ' || trim(_accepted_by) || coalesce(' — ' || NULLIF(trim(coalesce(_notes, '')), ''), ''));

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.contract_documents WHERE contract_id = c.id AND document_type = 'acceptance_evidence';

  INSERT INTO public.contract_documents
    (contract_id, document_type, version, external_reference, status, source, notes)
  VALUES (c.id, 'acceptance_evidence', v_version, 'PORTAL/' || inv.id::text, 'received', 'client_portal',
          'Accepted in the client portal by ' || trim(_accepted_by)
            || coalesce(', ' || NULLIF(trim(coalesce(_accepted_title, '')), ''), '')
            || coalesce(' <' || inv.recipient_email || '>', ''));

  UPDATE public.commercial_contract_instances
     SET status = 'executed',
         customer_signatory = coalesce(customer_signatory, trim(_accepted_by)),
         customer_signatory_email = coalesce(customer_signatory_email, inv.recipient_email),
         signature_method = coalesce(signature_method, 'client_portal'),
         signature_date = coalesce(signature_date, v_signed),
         execution_date = coalesce(execution_date, v_signed),
         revenue_period = coalesce(revenue_period, to_char(v_signed, 'YYYY-MM')),
         updated_at = now()
   WHERE id = c.id;

  UPDATE public.contract_portal_invites SET completed_at = now() WHERE id = inv.id;

  INSERT INTO public.contract_events (contract_id, event_type, from_status, to_status, reason, source, after_state)
  VALUES (c.id, 'CLIENT_PORTAL_ACCEPTANCE', c.status, 'executed',
          'Signed copy uploaded and acceptance confirmed by ' || trim(_accepted_by), 'portal',
          jsonb_build_object('invite_id', inv.id, 'storage_path', trim(_storage_path), 'signed_on', v_signed));

  v_staff := c.owner_staff_id;
  IF v_staff IS NOT NULL THEN
    v_work := public._sales_work_ensure(
      v_staff, 'contract_onboarding',
      'Onboard ' || coalesce(c.customer_legal_name, 'customer') || ' — signed copy received',
      'The client uploaded the signed copy of ' || coalesce(c.contract_number, 'the contract')
        || ' and confirmed acceptance in the portal. Complete onboarding to activate the contract and record revenue.',
      'commercial_contract_instances', c.id, c.contract_number, 'high', 1440);
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 'executed', 'contract_number', c.contract_number,
                            'work_item_id', v_work);
END $$;

REVOKE ALL ON FUNCTION public.contract_portal_open(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contract_portal_submit(text, text, text, date, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contract_portal_open(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_portal_submit(text, text, text, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_portal_invite_create(uuid, text, text, integer) TO authenticated;

-- Write-only anonymous drop box for portal uploads (no read, no list).
CREATE POLICY "portal inbox anonymous upload"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'crm-documents' AND name LIKE 'portal-inbox/%');

-- ============================================================
-- 2. ONBOARDING COMPLETION → REVENUE + ACTIVE
-- ============================================================
CREATE OR REPLACE FUNCTION public.contract_onboarding_complete(_work_item uuid, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE w public.staff_work_items; c public.commercial_contract_instances;
        v_activate jsonb; v_lifecycle jsonb := NULL;
BEGIN
  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item FOR UPDATE;
  IF w.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'TASK_NOT_FOUND'); END IF;
  IF w.source_table <> 'commercial_contract_instances' OR w.source_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_A_CONTRACT_TASK');
  END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = w.source_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  IF c.activated_at IS NULL THEN
    v_activate := public.contract_activate(c.id, coalesce(_notes, 'Onboarding completed'));
    IF (v_activate->>'ok')::boolean IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ACTIVATION_BLOCKED', 'activation', v_activate);
    END IF;
  ELSE
    v_activate := jsonb_build_object('ok', true, 'already_activated', true);
  END IF;

  UPDATE public.staff_work_items
     SET status = 'completed', completed_at = coalesce(completed_at, now()),
         outcome = coalesce(outcome, 'onboarding_complete'),
         resolution_notes = coalesce(_notes, resolution_notes), updated_at = now()
   WHERE id = w.id;

  UPDATE public.commercial_contract_instances
     SET status = 'active', updated_at = now()
   WHERE id = c.id AND status IN ('contracted', 'executed');

  UPDATE public.crm_accounts SET lifecycle_stage = 'active', updated_at = now()
   WHERE id = c.account_id AND lifecycle_stage <> 'active';

  IF c.opportunity_id IS NOT NULL THEN
    UPDATE public.commercial_opportunities SET stage = 'won', updated_at = now()
     WHERE id = c.opportunity_id AND stage NOT IN ('won', 'lost');
  END IF;

  IF c.lead_id IS NOT NULL THEN
    BEGIN
      v_lifecycle := public.commercial_lifecycle_advance(
        c.lead_id, 'SERVICE_ACTIVE', c.value_amount,
        'Onboarding completed for ' || coalesce(c.contract_number, 'contract'), false);
    EXCEPTION WHEN OTHERS THEN
      v_lifecycle := jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
  END IF;

  INSERT INTO public.contract_events (contract_id, event_type, from_status, to_status, reason, source, actor_id, actor_staff_id)
  VALUES (c.id, 'ONBOARDING_COMPLETED', c.status, 'active',
          coalesce(_notes, 'Onboarding completed; contract active'), 'onboarding',
          auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'contract_id', c.id, 'contract_number', c.contract_number,
                            'status', 'active', 'activation', v_activate, 'lifecycle', v_lifecycle);
END $$;

GRANT EXECUTE ON FUNCTION public.contract_onboarding_complete(uuid, text) TO authenticated;

-- ============================================================
-- 3. REVENUE BY EMPLOYEE
-- ============================================================
CREATE OR REPLACE FUNCTION public.contract_revenue_by_employee(_month text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_month text := coalesce(NULLIF(trim(coalesce(_month, '')), ''), to_char(current_date, 'YYYY-MM'));
        v_rows jsonb;
BEGIN
  IF NOT (public.has_staff_permission('staff.commercial.read')
          OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;

  WITH owners AS (
    SELECT DISTINCT owner_staff_id AS staff_id FROM public.commercial_contract_instances
     WHERE owner_staff_id IS NOT NULL AND coalesce(is_test, false) = false
    UNION
    SELECT DISTINCT staff_member_id FROM public.contract_revenue_events WHERE staff_member_id IS NOT NULL
  ),
  contracted AS (
    SELECT owner_staff_id AS staff_id,
           count(*) FILTER (WHERE status NOT IN ('declined', 'superseded', 'terminated')) AS contracts,
           coalesce(sum(value_amount) FILTER (WHERE status NOT IN ('declined', 'superseded', 'terminated')), 0) AS contracted_value,
           count(*) FILTER (WHERE activated_at IS NOT NULL) AS activated_contracts,
           count(*) FILTER (WHERE status IN ('sent_to_customer', 'shared', 'customer_review', 'under_negotiation',
                                             'signature_pending', 'partially_signed', 'customer_accepted')) AS awaiting_signature,
           count(*) FILTER (WHERE status = 'executed' AND activated_at IS NULL) AS awaiting_activation
      FROM public.commercial_contract_instances
     WHERE owner_staff_id IS NOT NULL AND coalesce(is_test, false) = false
     GROUP BY owner_staff_id
  ),
  revenue AS (
    SELECT r.staff_member_id AS staff_id,
           coalesce(sum(r.amount), 0) AS activated_revenue_total,
           coalesce(sum(r.amount) FILTER (WHERE r.revenue_period = v_month), 0) AS activated_revenue_month
      FROM public.contract_revenue_events r
      JOIN public.commercial_contract_instances c ON c.id = r.contract_id
     WHERE r.staff_member_id IS NOT NULL AND coalesce(c.is_test, false) = false
     GROUP BY r.staff_member_id
  )
  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.activated_revenue_total DESC, t.contracted_value DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT o.staff_id AS owner_staff_id,
             coalesce(sm.full_name, 'Unassigned') AS owner_name,
             sm.staff_code AS owner_code,
             coalesce(ct.contracts, 0)::int AS contracts,
             coalesce(ct.contracted_value, 0)::numeric AS contracted_value,
             coalesce(ct.activated_contracts, 0)::int AS activated_contracts,
             coalesce(ct.awaiting_signature, 0)::int AS awaiting_signature,
             coalesce(ct.awaiting_activation, 0)::int AS awaiting_activation,
             coalesce(rv.activated_revenue_total, 0)::numeric AS activated_revenue_total,
             coalesce(rv.activated_revenue_month, 0)::numeric AS activated_revenue_month
        FROM owners o
        LEFT JOIN public.staff_members sm ON sm.id = o.staff_id
        LEFT JOIN contracted ct ON ct.staff_id = o.staff_id
        LEFT JOIN revenue rv ON rv.staff_id = o.staff_id
    ) t;

  RETURN jsonb_build_object('ok', true, 'month', v_month, 'currency', 'KES', 'rows', v_rows);
END $$;

GRANT EXECUTE ON FUNCTION public.contract_revenue_by_employee(text) TO authenticated;

-- ============================================================
-- 4. AMENDMENT BILLING
-- ============================================================
CREATE TABLE public.contract_amendment_billing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amendment_id uuid NOT NULL UNIQUE REFERENCES public.contract_amendments(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.tax_invoices(id) ON DELETE SET NULL,
  work_item_id uuid,
  amount_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'invoice_raised',
  created_by uuid,
  created_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.contract_amendment_billing TO authenticated;
GRANT ALL ON public.contract_amendment_billing TO service_role;
ALTER TABLE public.contract_amendment_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "amendment billing readable by contract readers"
  ON public.contract_amendment_billing FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
                 WHERE c.id = contract_amendment_billing.contract_id AND public._contract_may_read(c.*)));

CREATE INDEX contract_amendment_billing_contract_idx ON public.contract_amendment_billing (contract_id);

CREATE TRIGGER contract_amendment_billing_touch
  BEFORE UPDATE ON public.contract_amendment_billing
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.contract_amendment_billing_board()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (public.has_staff_permission('staff.commercial.read')
          OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT a.id AS amendment_id, a.amendment_no, a.amendment_type, a.reason, a.effective_date,
             a.value_before, a.value_after, a.value_delta, a.currency, a.revenue_period, a.created_at,
             c.id AS contract_id, c.contract_number, c.customer_legal_name AS customer,
             c.payment_terms, c.owner_staff_id, sm.full_name AS owner_name,
             b.id AS billing_id, b.status AS billing_status, b.invoice_id, b.work_item_id,
             i.invoice_no, i.status AS invoice_status, i.total_cents, i.paid_cents, i.due_date,
             (b.id IS NULL AND coalesce(a.value_delta, 0) > 0) AS needs_invoice
        FROM public.contract_amendments a
        JOIN public.commercial_contract_instances c ON c.id = a.contract_id
        LEFT JOIN public.staff_members sm ON sm.id = c.owner_staff_id
        LEFT JOIN public.contract_amendment_billing b ON b.amendment_id = a.id
        LEFT JOIN public.tax_invoices i ON i.id = b.invoice_id
       WHERE coalesce(c.is_test, false) = false
       ORDER BY a.created_at DESC
       LIMIT 300
    ) t;

  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END $$;

GRANT EXECUTE ON FUNCTION public.contract_amendment_billing_board() TO authenticated;

-- Raise one draft invoice plus a payment task for a value-increasing amendment.
CREATE OR REPLACE FUNCTION public.contract_amendment_bill(_amendment uuid, _due_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.contract_amendments; c public.commercial_contract_instances;
        v_existing public.contract_amendment_billing; v_invoice uuid; v_cents bigint;
        v_staff uuid; v_work uuid; v_billing uuid; v_desc text;
BEGIN
  SELECT * INTO a FROM public.contract_amendments WHERE id = _amendment;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AMENDMENT_NOT_FOUND'); END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = a.contract_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  SELECT * INTO v_existing FROM public.contract_amendment_billing WHERE amendment_id = a.id;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_billed', true, 'billing_id', v_existing.id,
                              'invoice_id', v_existing.invoice_id, 'work_item_id', v_existing.work_item_id);
  END IF;

  IF coalesce(a.value_delta, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_BILLABLE_VALUE',
                              'detail', 'This change does not increase the contract value, so no invoice is due.');
  END IF;

  v_cents := round(a.value_delta * 100)::bigint;
  v_staff := coalesce(c.owner_staff_id, public._my_staff_member_id());
  v_desc := 'Contract ' || coalesce(c.contract_number, '') || ' amendment ' || a.amendment_no
            || ' — ' || coalesce(a.reason, 'agreed change');

  INSERT INTO public.tax_invoices
    (status, lead_id, customer_company, customer_email, customer_contact_person, contract_reference,
     payment_terms, currency, service_from, due_date, notes, owner_staff_id, created_by, is_test,
     subtotal_cents, vat_cents, total_cents)
  VALUES ('draft', c.lead_id, coalesce(c.customer_legal_name, 'Customer'), c.customer_signatory_email,
          c.customer_signatory, c.contract_number, c.payment_terms, coalesce(a.currency, c.currency, 'KES'),
          coalesce(a.effective_date, current_date),
          current_date + make_interval(days => greatest(1, least(coalesce(_due_days, 14), 120))),
          v_desc, v_staff, auth.uid(), coalesce(c.is_test, false), 0, 0, 0)
  RETURNING id INTO v_invoice;

  INSERT INTO public.tax_invoice_lines
    (invoice_id, line_no, description, service_date, qty, unit_rate_cents, amount_cents)
  VALUES (v_invoice, 1, v_desc, coalesce(a.effective_date, current_date), 1, v_cents, v_cents);

  UPDATE public.tax_invoices
     SET subtotal_cents = v_cents,
         vat_cents = round(v_cents * coalesce(vat_rate, 16) / 100.0)::bigint,
         total_cents = v_cents + round(v_cents * coalesce(vat_rate, 16) / 100.0)::bigint
   WHERE id = v_invoice;

  INSERT INTO public.tax_invoice_events (invoice_id, event, status_after, actor_id, note)
  VALUES (v_invoice, 'CREATED', 'draft', auth.uid(), 'Raised from contract amendment ' || a.amendment_no);

  IF v_staff IS NOT NULL THEN
    v_work := public._sales_work_ensure(
      v_staff, 'amendment_collection',
      'Collect amendment ' || a.amendment_no || ' — ' || coalesce(c.customer_legal_name, 'customer'),
      v_desc || '. A draft invoice was raised for ' || coalesce(a.currency, 'KES') || ' '
        || to_char(a.value_delta, 'FM999,999,999,990') || '. Issue it, send it and confirm payment.',
      'tax_invoices', v_invoice, c.contract_number, 'high', 2880);
  END IF;

  INSERT INTO public.contract_amendment_billing
    (amendment_id, contract_id, invoice_id, work_item_id, amount_cents, currency, status, created_by, created_staff_id)
  VALUES (a.id, c.id, v_invoice, v_work, v_cents, coalesce(a.currency, c.currency, 'KES'), 'invoice_raised',
          auth.uid(), public._my_staff_member_id())
  RETURNING id INTO v_billing;

  INSERT INTO public.contract_events (contract_id, event_type, from_status, to_status, reason, source, actor_id, actor_staff_id, after_state)
  VALUES (c.id, 'AMENDMENT_BILLED', c.status, c.status, v_desc, 'billing', auth.uid(), public._my_staff_member_id(),
          jsonb_build_object('amendment_id', a.id, 'invoice_id', v_invoice, 'amount_cents', v_cents));

  RETURN jsonb_build_object('ok', true, 'billing_id', v_billing, 'invoice_id', v_invoice,
                            'work_item_id', v_work, 'amount_cents', v_cents);
END $$;

GRANT EXECUTE ON FUNCTION public.contract_amendment_bill(uuid, integer) TO authenticated;