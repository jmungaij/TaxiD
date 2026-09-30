CREATE SEQUENCE IF NOT EXISTS public.tax_invoice_no_seq;
CREATE SEQUENCE IF NOT EXISTS public.payment_receipt_no_seq;

-- ============================ TAX INVOICES ============================
CREATE TABLE public.tax_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','issued','sent','part_paid','paid','cancelled')),
  lead_id uuid,
  proforma_id uuid REFERENCES public.proforma_invoices(id) ON DELETE SET NULL,
  customer_company text NOT NULL DEFAULT '',
  customer_address text,
  customer_pin text,
  customer_contact_person text,
  customer_email text,
  customer_phone text,
  customer_ref text,
  quote_reference text,
  contract_reference text,
  lpo_reference text,
  service_from date,
  service_to date,
  payment_terms text NOT NULL DEFAULT 'Payment due within 14 days of invoice date',
  currency text NOT NULL DEFAULT 'KES',
  vat_rate numeric NOT NULL DEFAULT 16,
  vat_inclusive boolean NOT NULL DEFAULT false,
  issue_date date,
  due_date date,
  notes text,
  authorised_name text,
  authorised_title text,
  subtotal_cents bigint NOT NULL DEFAULT 0,
  vat_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL DEFAULT 0,
  paid_cents bigint NOT NULL DEFAULT 0,
  owner_staff_id uuid,
  created_by uuid,
  submitted_at timestamptz,
  submitted_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  approval_note text,
  sole_approver boolean NOT NULL DEFAULT false,
  issued_at timestamptz,
  sent_to text,
  sent_at timestamptz,
  pdf_sha256 text,
  cancel_reason text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.tax_invoices TO authenticated;
GRANT ALL ON public.tax_invoices TO service_role;
ALTER TABLE public.tax_invoices ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tax_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.tax_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  description text NOT NULL DEFAULT '',
  service_date date,
  vehicle_category text,
  qty numeric NOT NULL DEFAULT 1,
  unit_rate_cents bigint NOT NULL DEFAULT 0,
  amount_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tax_invoice_lines (invoice_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_invoice_lines TO authenticated;
GRANT ALL ON public.tax_invoice_lines TO service_role;
ALTER TABLE public.tax_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.tax_invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.tax_invoices(id) ON DELETE CASCADE,
  event text NOT NULL,
  status_before text,
  status_after text,
  actor_id uuid,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tax_invoice_events (invoice_id, created_at DESC);
GRANT SELECT ON public.tax_invoice_events TO authenticated;
GRANT ALL ON public.tax_invoice_events TO service_role;
ALTER TABLE public.tax_invoice_events ENABLE ROW LEVEL SECURITY;

-- ============================ PAYMENT RECEIPTS ============================
CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text UNIQUE,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','sent','void')),
  invoice_id uuid NOT NULL REFERENCES public.tax_invoices(id) ON DELETE RESTRICT,
  lead_id uuid,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  method text NOT NULL DEFAULT 'BANK_TRANSFER'
    CHECK (method IN ('MPESA','BANK_TRANSFER','CHEQUE','CASH','CARD','OTHER')),
  payment_reference text,
  received_on date NOT NULL DEFAULT current_date,
  received_from text,
  notes text,
  authorised_name text,
  authorised_title text,
  owner_staff_id uuid,
  created_by uuid,
  sent_to text,
  sent_at timestamptz,
  pdf_sha256 text,
  void_reason text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payment_receipts (invoice_id);
GRANT SELECT, INSERT, UPDATE ON public.payment_receipts TO authenticated;
GRANT ALL ON public.payment_receipts TO service_role;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.payment_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.payment_receipts(id) ON DELETE CASCADE,
  event text NOT NULL,
  status_before text,
  status_after text,
  actor_id uuid,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payment_receipt_events (receipt_id, created_at DESC);
GRANT SELECT ON public.payment_receipt_events TO authenticated;
GRANT ALL ON public.payment_receipt_events TO service_role;
ALTER TABLE public.payment_receipt_events ENABLE ROW LEVEL SECURITY;

-- ============================ AUTHORITY ============================
CREATE OR REPLACE FUNCTION public._invoice_can_write(_owner uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.is_platform_admin()
      OR public.has_staff_permission('staff.commercial.write')
      OR (_owner IS NOT NULL AND _owner = public._my_staff_member_id());
END $$;
REVOKE ALL ON FUNCTION public._invoice_can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._invoice_can_write(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._invoice_can_read(_owner uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.is_platform_admin()
      OR public.has_staff_permission('staff.commercial.read')
      OR (_owner IS NOT NULL AND _owner = public._my_staff_member_id());
END $$;
REVOKE ALL ON FUNCTION public._invoice_can_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._invoice_can_read(uuid) TO authenticated;

-- RLS: all real work goes through the RPCs below; direct reads follow authority.
CREATE POLICY "invoice readers" ON public.tax_invoices FOR SELECT TO authenticated
  USING (public._invoice_can_read(owner_staff_id));
CREATE POLICY "invoice line readers" ON public.tax_invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tax_invoices i WHERE i.id = invoice_id AND public._invoice_can_read(i.owner_staff_id)));
CREATE POLICY "invoice history readers" ON public.tax_invoice_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tax_invoices i WHERE i.id = invoice_id AND public._invoice_can_read(i.owner_staff_id)));
CREATE POLICY "receipt readers" ON public.payment_receipts FOR SELECT TO authenticated
  USING (public._invoice_can_read(owner_staff_id));
CREATE POLICY "receipt history readers" ON public.payment_receipt_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.payment_receipts r WHERE r.id = receipt_id AND public._invoice_can_read(r.owner_staff_id)));

-- ============================ APPEND-ONLY HISTORY ============================
CREATE OR REPLACE FUNCTION public._invoice_events_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'HISTORY_IS_APPEND_ONLY';
END $$;
CREATE TRIGGER tax_invoice_events_append_only
  BEFORE UPDATE OR DELETE ON public.tax_invoice_events
  FOR EACH ROW EXECUTE FUNCTION public._invoice_events_append_only();
CREATE TRIGGER payment_receipt_events_append_only
  BEFORE UPDATE OR DELETE ON public.payment_receipt_events
  FOR EACH ROW EXECUTE FUNCTION public._invoice_events_append_only();

CREATE OR REPLACE FUNCTION public._invoice_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER tax_invoices_touch BEFORE UPDATE ON public.tax_invoices
  FOR EACH ROW EXECUTE FUNCTION public._invoice_touch();
CREATE TRIGGER payment_receipts_touch BEFORE UPDATE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public._invoice_touch();

-- ============================ INVOICE RPCS ============================
CREATE OR REPLACE FUNCTION public.invoice_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices; v jsonb;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_read(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT to_jsonb(r) || jsonb_build_object(
    'can_write', public._invoice_can_write(r.owner_staff_id),
    'balance_cents', r.total_cents - r.paid_cents,
    'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no)
                       FROM public.tax_invoice_lines l WHERE l.invoice_id = _id), '[]'::jsonb),
    'receipts', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at)
                       FROM public.payment_receipts p WHERE p.invoice_id = _id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
                       FROM public.tax_invoice_events e WHERE e.invoice_id = _id), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.invoice_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_get(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb; v_staff uuid := public._my_staff_member_id(); v_wide boolean;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin();
  IF NOT v_wide AND v_staff IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'scope', CASE WHEN v_wide THEN 'all' ELSE 'mine' END,
    'can_create', public._invoice_can_write(v_staff),
    'can_approve', public._proforma_can_approve(),
    'outstanding_cents', COALESCE((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
        WHERE (v_wide OR i.owner_staff_id = v_staff)
          AND i.status IN ('issued','sent','part_paid')), 0),
    'invoices', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object(
               'balance_cents', i.total_cents - i.paid_cents,
               'line_count', (SELECT count(*) FROM public.tax_invoice_lines l WHERE l.invoice_id = i.id))
             ORDER BY i.created_at DESC)
      FROM public.tax_invoices i WHERE v_wide OR i.owner_staff_id = v_staff), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.invoice_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid := NULLIF(p->>'id','')::uuid; r public.tax_invoices;
        v_staff uuid := public._my_staff_member_id(); v_new boolean := false;
        v_rate numeric; v_incl boolean; v_gross bigint := 0; v_sub bigint; v_vat bigint;
        l jsonb; v_i integer := 0;
BEGIN
  IF v_id IS NULL THEN
    IF NOT public._invoice_can_write(v_staff) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    INSERT INTO public.tax_invoices (owner_staff_id, created_by) VALUES (v_staff, auth.uid())
      RETURNING * INTO r;
    v_id := r.id; v_new := true;
  ELSE
    SELECT * INTO r FROM public.tax_invoices WHERE id = v_id;
    IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
    IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    IF r.status <> 'draft' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_CAN_BE_EDITED'; END IF;
  END IF;

  v_rate := COALESCE((p->>'vat_rate')::numeric, r.vat_rate);
  v_incl := COALESCE((p->>'vat_inclusive')::boolean, r.vat_inclusive);

  UPDATE public.tax_invoices SET
    lead_id = COALESCE(NULLIF(p->>'lead_id','')::uuid, lead_id),
    proforma_id = COALESCE(NULLIF(p->>'proforma_id','')::uuid, proforma_id),
    customer_company = COALESCE(p->>'customer_company', customer_company),
    customer_address = COALESCE(p->>'customer_address', customer_address),
    customer_pin = COALESCE(p->>'customer_pin', customer_pin),
    customer_contact_person = COALESCE(p->>'customer_contact_person', customer_contact_person),
    customer_email = COALESCE(p->>'customer_email', customer_email),
    customer_phone = COALESCE(p->>'customer_phone', customer_phone),
    customer_ref = COALESCE(p->>'customer_ref', customer_ref),
    quote_reference = COALESCE(p->>'quote_reference', quote_reference),
    contract_reference = COALESCE(p->>'contract_reference', contract_reference),
    lpo_reference = COALESCE(p->>'lpo_reference', lpo_reference),
    service_from = COALESCE(NULLIF(p->>'service_from','')::date, service_from),
    service_to = COALESCE(NULLIF(p->>'service_to','')::date, service_to),
    payment_terms = COALESCE(NULLIF(p->>'payment_terms',''), payment_terms),
    currency = COALESCE(NULLIF(p->>'currency',''), currency),
    vat_rate = v_rate,
    vat_inclusive = v_incl,
    due_date = COALESCE(NULLIF(p->>'due_date','')::date, due_date),
    notes = COALESCE(p->>'notes', notes),
    authorised_name = COALESCE(p->>'authorised_name', authorised_name),
    authorised_title = COALESCE(p->>'authorised_title', authorised_title)
  WHERE id = v_id;

  IF p ? 'lines' THEN
    DELETE FROM public.tax_invoice_lines WHERE invoice_id = v_id;
    FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines','[]'::jsonb)) LOOP
      IF COALESCE(TRIM(l->>'description'),'') = '' THEN CONTINUE; END IF;
      v_i := v_i + 1;
      INSERT INTO public.tax_invoice_lines
        (invoice_id, line_no, description, service_date, vehicle_category, qty, unit_rate_cents, amount_cents)
      VALUES (v_id, v_i, l->>'description', NULLIF(l->>'service_date','')::date, NULLIF(l->>'vehicle_category',''),
              COALESCE((l->>'qty')::numeric, 1), COALESCE((l->>'unit_rate_cents')::bigint, 0),
              round(COALESCE((l->>'qty')::numeric,1) * COALESCE((l->>'unit_rate_cents')::bigint,0)));
    END LOOP;
  END IF;

  SELECT COALESCE(sum(amount_cents),0) INTO v_gross FROM public.tax_invoice_lines WHERE invoice_id = v_id;
  IF v_incl THEN
    v_sub := round(v_gross / (1 + v_rate/100.0)); v_vat := v_gross - v_sub;
    UPDATE public.tax_invoices SET subtotal_cents = v_sub, vat_cents = v_vat, total_cents = v_gross WHERE id = v_id;
  ELSE
    v_vat := round(v_gross * v_rate / 100.0);
    UPDATE public.tax_invoices SET subtotal_cents = v_gross, vat_cents = v_vat, total_cents = v_gross + v_vat WHERE id = v_id;
  END IF;

  INSERT INTO public.tax_invoice_events (invoice_id, event, status_after, actor_id)
    VALUES (v_id, CASE WHEN v_new THEN 'CREATED' ELSE 'SAVED' END, 'draft', auth.uid());

  RETURN public.invoice_get(v_id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_save(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public._invoice_assert_complete(_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF COALESCE(TRIM(r.customer_company),'') = '' THEN RAISE EXCEPTION 'CUSTOMER_NAME_REQUIRED'; END IF;
  IF COALESCE(r.customer_email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'CUSTOMER_EMAIL_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tax_invoice_lines WHERE invoice_id = _id) THEN
    RAISE EXCEPTION 'AT_LEAST_ONE_LINE_REQUIRED'; END IF;
  IF r.total_cents <= 0 THEN RAISE EXCEPTION 'TOTAL_MUST_BE_GREATER_THAN_ZERO'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._invoice_assert_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._invoice_assert_complete(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_submit(_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_CAN_BE_SENT_FOR_REVIEW'; END IF;
  PERFORM public._invoice_assert_complete(_id);
  UPDATE public.tax_invoices SET status='pending_approval', submitted_at=now(), submitted_by=auth.uid(),
    approved_at=NULL, approved_by=NULL, approval_note=NULL, sole_approver=false WHERE id=_id;
  INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, note)
    VALUES (_id, 'SENT_FOR_APPROVAL', 'draft', 'pending_approval', auth.uid(), NULLIF(TRIM(_note),''));
  RETURN public.invoice_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_submit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_submit(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_decide(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices; v_sole boolean := false;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_approve() THEN RAISE EXCEPTION 'NOT_AUTHORISED_TO_APPROVE'; END IF;
  IF r.status <> 'pending_approval' THEN RAISE EXCEPTION 'ONLY_AN_INVOICE_IN_REVIEW_CAN_BE_DECIDED'; END IF;
  IF _approve AND COALESCE(r.submitted_by, r.created_by) = auth.uid() THEN
    IF public.is_platform_admin() THEN v_sole := true; ELSE RAISE EXCEPTION 'FOUR_EYES_REQUIRED'; END IF;
  END IF;
  IF NOT _approve AND COALESCE(TRIM(_note),'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  IF _approve THEN
    PERFORM public._invoice_assert_complete(_id);
    UPDATE public.tax_invoices SET status='approved', approved_at=now(), approved_by=auth.uid(),
      approval_note=NULLIF(TRIM(_note),''), sole_approver=v_sole WHERE id=_id;
    INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, note, detail)
      VALUES (_id,'APPROVED','pending_approval','approved',auth.uid(),NULLIF(TRIM(_note),''),
              jsonb_build_object('sole_approver', v_sole));
  ELSE
    UPDATE public.tax_invoices SET status='draft', submitted_at=NULL, submitted_by=NULL WHERE id=_id;
    INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, note)
      VALUES (_id,'SENT_BACK','pending_approval','draft',auth.uid(),TRIM(_note));
  END IF;
  RETURN public.invoice_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_decide(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_issue(_id uuid, _due_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices; v_no text;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status = 'draft' THEN RAISE EXCEPTION 'MUST_BE_SENT_FOR_APPROVAL_FIRST'; END IF;
  IF r.status = 'pending_approval' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED_BEFORE_ISSUE'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'ALREADY_ISSUED'; END IF;
  PERFORM public._invoice_assert_complete(_id);

  v_no := 'YAL-INV-' || to_char(now(),'YYYY') || '-'
          || lpad(nextval('public.tax_invoice_no_seq')::text, 6, '0');
  UPDATE public.tax_invoices SET status='issued', invoice_no=v_no, issued_at=now(),
    issue_date = COALESCE(issue_date, current_date),
    due_date = COALESCE(due_date, current_date + GREATEST(COALESCE(_due_days,14),1))
  WHERE id=_id;
  INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id,'ISSUED','approved','issued',auth.uid(), jsonb_build_object('invoice_no', v_no));

  IF r.lead_id IS NOT NULL THEN
    BEGIN
      PERFORM public.commercial_lifecycle_evidence_add(r.lead_id, 'invoice', v_no, _id, 'tax_invoices',
        'Issued from the invoice register');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN public.invoice_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_issue(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_issue(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_cancel(_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF COALESCE(TRIM(_reason),'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF r.status = 'cancelled' THEN RAISE EXCEPTION 'ALREADY_CANCELLED'; END IF;
  IF r.paid_cents > 0 THEN RAISE EXCEPTION 'CANNOT_CANCEL_A_PAID_INVOICE'; END IF;
  UPDATE public.tax_invoices SET status='cancelled', cancel_reason=TRIM(_reason) WHERE id=_id;
  INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, note)
    VALUES (_id,'CANCELLED',r.status,'cancelled',auth.uid(),TRIM(_reason));
  RETURN public.invoice_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_cancel(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invoice_record_dispatch(_id uuid, _to text, _sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices;
BEGIN
  SELECT * INTO r FROM public.tax_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status NOT IN ('issued','sent','part_paid') THEN RAISE EXCEPTION 'ISSUE_THE_INVOICE_FIRST'; END IF;
  UPDATE public.tax_invoices
     SET status = CASE WHEN r.status = 'issued' THEN 'sent' ELSE r.status END,
         sent_to = _to, sent_at = now(), pdf_sha256 = _sha256
   WHERE id = _id;
  INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id,'SENT',r.status, CASE WHEN r.status='issued' THEN 'sent' ELSE r.status END, auth.uid(),
            jsonb_build_object('to',_to,'pdf_sha256',_sha256));
  RETURN public.invoice_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.invoice_record_dispatch(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_record_dispatch(uuid, text, text) TO authenticated;

-- ============================ RECEIPT RPCS ============================
CREATE OR REPLACE FUNCTION public.receipt_record(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.tax_invoices; v_inv uuid := NULLIF(p->>'invoice_id','')::uuid;
        v_amount bigint := COALESCE((p->>'amount_cents')::bigint, 0);
        v_no text; v_id uuid; v_paid bigint; v_status text;
BEGIN
  IF v_inv IS NULL THEN RAISE EXCEPTION 'INVOICE_REQUIRED'; END IF;
  SELECT * INTO r FROM public.tax_invoices WHERE id = v_inv;
  IF r.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status NOT IN ('issued','sent','part_paid') THEN RAISE EXCEPTION 'ISSUE_THE_INVOICE_FIRST'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_MUST_BE_GREATER_THAN_ZERO'; END IF;
  IF v_amount > (r.total_cents - r.paid_cents) THEN RAISE EXCEPTION 'AMOUNT_EXCEEDS_THE_BALANCE'; END IF;

  v_no := 'YAL-RCT-' || to_char(now(),'YYYY') || '-'
          || lpad(nextval('public.payment_receipt_no_seq')::text, 6, '0');

  INSERT INTO public.payment_receipts
    (receipt_no, invoice_id, lead_id, amount_cents, currency, method, payment_reference,
     received_on, received_from, notes, authorised_name, authorised_title, owner_staff_id, created_by)
  VALUES (v_no, v_inv, r.lead_id, v_amount, r.currency,
     COALESCE(NULLIF(p->>'method',''),'BANK_TRANSFER'), NULLIF(p->>'payment_reference',''),
     COALESCE(NULLIF(p->>'received_on','')::date, current_date),
     COALESCE(NULLIF(p->>'received_from',''), r.customer_company), NULLIF(p->>'notes',''),
     NULLIF(p->>'authorised_name',''), NULLIF(p->>'authorised_title',''),
     r.owner_staff_id, auth.uid())
  RETURNING id INTO v_id;

  v_paid := r.paid_cents + v_amount;
  v_status := CASE WHEN v_paid >= r.total_cents THEN 'paid' ELSE 'part_paid' END;
  UPDATE public.tax_invoices SET paid_cents = v_paid, status = v_status WHERE id = v_inv;

  INSERT INTO public.payment_receipt_events (receipt_id, event, status_after, actor_id, detail)
    VALUES (v_id,'RECORDED','issued',auth.uid(), jsonb_build_object('receipt_no',v_no,'amount_cents',v_amount));
  INSERT INTO public.tax_invoice_events (invoice_id, event, status_before, status_after, actor_id, detail)
    VALUES (v_inv,'PAYMENT_RECEIVED', r.status, v_status, auth.uid(),
            jsonb_build_object('receipt_no',v_no,'amount_cents',v_amount,'paid_cents',v_paid));

  IF r.lead_id IS NOT NULL THEN
    BEGIN
      PERFORM public.commercial_lifecycle_evidence_add(r.lead_id, 'payment', v_no, v_id, 'payment_receipts',
        'Receipt recorded against ' || COALESCE(r.invoice_no,'invoice'));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN public.receipt_get(v_id);
END $$;

CREATE OR REPLACE FUNCTION public.receipt_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.payment_receipts; v jsonb;
BEGIN
  SELECT * INTO r FROM public.payment_receipts WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_read(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT to_jsonb(r) || jsonb_build_object(
    'can_write', public._invoice_can_write(r.owner_staff_id),
    'invoice', (SELECT jsonb_build_object('id',i.id,'invoice_no',i.invoice_no,'status',i.status,
                 'total_cents',i.total_cents,'paid_cents',i.paid_cents,
                 'customer_company',i.customer_company,'customer_email',i.customer_email,
                 'customer_address',i.customer_address,'customer_pin',i.customer_pin)
                FROM public.tax_invoices i WHERE i.id = r.invoice_id),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
                        FROM public.payment_receipt_events e WHERE e.receipt_id = _id), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.receipt_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receipt_get(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.receipt_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receipt_record(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.receipt_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb; v_staff uuid := public._my_staff_member_id(); v_wide boolean;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin();
  IF NOT v_wide AND v_staff IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'scope', CASE WHEN v_wide THEN 'all' ELSE 'mine' END,
    'collected_cents', COALESCE((SELECT sum(amount_cents) FROM public.payment_receipts
        WHERE status <> 'void' AND (v_wide OR owner_staff_id = v_staff)), 0),
    'receipts', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
               'invoice_no', (SELECT i.invoice_no FROM public.tax_invoices i WHERE i.id = p.invoice_id),
               'customer_company', (SELECT i.customer_company FROM public.tax_invoices i WHERE i.id = p.invoice_id))
             ORDER BY p.created_at DESC)
      FROM public.payment_receipts p WHERE v_wide OR p.owner_staff_id = v_staff), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.receipt_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receipt_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.receipt_record_dispatch(_id uuid, _to text, _sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.payment_receipts;
BEGIN
  SELECT * INTO r FROM public.payment_receipts WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RECEIPT_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status = 'void' THEN RAISE EXCEPTION 'RECEIPT_IS_VOID'; END IF;
  UPDATE public.payment_receipts SET status='sent', sent_to=_to, sent_at=now(), pdf_sha256=_sha256 WHERE id=_id;
  INSERT INTO public.payment_receipt_events (receipt_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id,'SENT',r.status,'sent',auth.uid(), jsonb_build_object('to',_to,'pdf_sha256',_sha256));
  RETURN public.receipt_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.receipt_record_dispatch(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receipt_record_dispatch(uuid, text, text) TO authenticated;