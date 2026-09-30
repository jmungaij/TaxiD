-- ============================================================
-- PROFORMA INVOICE REGISTER
-- ============================================================
CREATE TABLE public.proforma_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_no text UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','sent','accepted','expired','void')),
  customer_company text NOT NULL DEFAULT '',
  customer_address text,
  customer_pin text,
  customer_contact_person text,
  customer_email text,
  customer_phone text,
  customer_ref text,
  quote_reference text,
  contract_reference text,
  service_from date,
  service_to date,
  payment_terms text NOT NULL DEFAULT '50% Advance, Balance within 30 Days',
  currency text NOT NULL DEFAULT 'KES',
  vat_rate numeric(5,2) NOT NULL DEFAULT 16.00,
  vat_inclusive boolean NOT NULL DEFAULT false,
  issue_date date,
  valid_until date,
  notes text,
  authorised_name text,
  authorised_title text,
  account_id uuid,
  lead_id uuid,
  opportunity_id uuid,
  subtotal_cents bigint NOT NULL DEFAULT 0,
  vat_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL DEFAULT 0,
  owner_staff_id uuid,
  created_by uuid,
  issued_at timestamptz,
  sent_at timestamptz,
  sent_to text,
  pdf_sha256 text,
  void_reason text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.proforma_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_id uuid NOT NULL REFERENCES public.proforma_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  description text NOT NULL DEFAULT '',
  service_date date,
  vehicle_category text,
  qty numeric(12,2) NOT NULL DEFAULT 1,
  unit_rate_cents bigint NOT NULL DEFAULT 0,
  amount_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proforma_id, line_no)
);

CREATE TABLE public.proforma_invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_id uuid NOT NULL REFERENCES public.proforma_invoices(id) ON DELETE CASCADE,
  event text NOT NULL,
  status_before text,
  status_after text,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proforma_status ON public.proforma_invoices(status, created_at DESC);
CREATE INDEX idx_proforma_owner ON public.proforma_invoices(owner_staff_id);
CREATE INDEX idx_proforma_lines_parent ON public.proforma_invoice_lines(proforma_id, line_no);
CREATE INDEX idx_proforma_events_parent ON public.proforma_invoice_events(proforma_id, created_at DESC);

CREATE SEQUENCE public.proforma_no_seq;

GRANT SELECT ON public.proforma_invoices TO authenticated;
GRANT SELECT ON public.proforma_invoice_lines TO authenticated;
GRANT SELECT ON public.proforma_invoice_events TO authenticated;
GRANT ALL ON public.proforma_invoices TO service_role;
GRANT ALL ON public.proforma_invoice_lines TO service_role;
GRANT ALL ON public.proforma_invoice_events TO service_role;
GRANT USAGE ON SEQUENCE public.proforma_no_seq TO service_role;

ALTER TABLE public.proforma_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoice_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read proformas"
  ON public.proforma_invoices FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read'));
CREATE POLICY "commercial staff read proforma lines"
  ON public.proforma_invoice_lines FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read'));
CREATE POLICY "commercial staff read proforma events"
  ON public.proforma_invoice_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read'));

-- append-only history
CREATE OR REPLACE FUNCTION public._proforma_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'PROFORMA_HISTORY_IS_APPEND_ONLY';
END $$;
CREATE TRIGGER trg_proforma_events_append_only
  BEFORE UPDATE OR DELETE ON public.proforma_invoice_events
  FOR EACH ROW EXECUTE FUNCTION public._proforma_events_append_only();

CREATE OR REPLACE FUNCTION public._proforma_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_proforma_touch
  BEFORE UPDATE ON public.proforma_invoices
  FOR EACH ROW EXECUTE FUNCTION public._proforma_touch();

-- ------------------------------------------------------------
-- authority helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._proforma_can_write(_owner uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_platform_admin() THEN RETURN true; END IF;
  IF public.is_commercial_staff() THEN RETURN true; END IF;
  IF _owner IS NOT NULL AND public.is_my_staff_record(_owner) THEN RETURN true; END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._proforma_can_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._proforma_can_write(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- save (create or edit a draft) — server recomputes every figure
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proforma_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := NULLIF(p->>'id','')::uuid;
  v_staff uuid := public._my_staff_member_id();
  v_status text;
  v_owner uuid;
  v_sub bigint := 0;
  v_vat bigint := 0;
  v_total bigint := 0;
  v_rate numeric := COALESCE((p->>'vat_rate')::numeric, 16);
  v_incl boolean := COALESCE((p->>'vat_inclusive')::boolean, false);
  v_line jsonb;
  v_no integer := 0;
  v_amount bigint;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT status, owner_staff_id INTO v_status, v_owner
      FROM public.proforma_invoices WHERE id = v_id;
    IF v_status IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
    IF NOT public._proforma_can_write(v_owner) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    IF v_status <> 'draft' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_CAN_BE_EDITED'; END IF;
  ELSE
    IF NOT public._proforma_can_write(v_staff) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
    INSERT INTO public.proforma_invoices (owner_staff_id, created_by)
      VALUES (v_staff, auth.uid())
      RETURNING id INTO v_id;
    INSERT INTO public.proforma_invoice_events (proforma_id, event, status_after, actor_id)
      VALUES (v_id, 'CREATED', 'draft', auth.uid());
  END IF;

  UPDATE public.proforma_invoices SET
    customer_company        = COALESCE(NULLIF(p->>'customer_company',''), customer_company),
    customer_address        = COALESCE(p->>'customer_address', customer_address),
    customer_pin            = COALESCE(p->>'customer_pin', customer_pin),
    customer_contact_person = COALESCE(p->>'customer_contact_person', customer_contact_person),
    customer_email          = COALESCE(p->>'customer_email', customer_email),
    customer_phone          = COALESCE(p->>'customer_phone', customer_phone),
    customer_ref            = COALESCE(p->>'customer_ref', customer_ref),
    quote_reference         = COALESCE(p->>'quote_reference', quote_reference),
    contract_reference      = COALESCE(p->>'contract_reference', contract_reference),
    service_from            = COALESCE(NULLIF(p->>'service_from','')::date, service_from),
    service_to              = COALESCE(NULLIF(p->>'service_to','')::date, service_to),
    payment_terms           = COALESCE(NULLIF(p->>'payment_terms',''), payment_terms),
    currency                = COALESCE(NULLIF(p->>'currency',''), currency),
    vat_rate                = v_rate,
    vat_inclusive           = v_incl,
    valid_until             = COALESCE(NULLIF(p->>'valid_until','')::date, valid_until),
    notes                   = COALESCE(p->>'notes', notes),
    authorised_name         = COALESCE(p->>'authorised_name', authorised_name),
    authorised_title        = COALESCE(p->>'authorised_title', authorised_title),
    account_id              = COALESCE(NULLIF(p->>'account_id','')::uuid, account_id),
    lead_id                 = COALESCE(NULLIF(p->>'lead_id','')::uuid, lead_id)
  WHERE id = v_id;

  IF p ? 'lines' THEN
    DELETE FROM public.proforma_invoice_lines WHERE proforma_id = v_id;
    FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines','[]'::jsonb))
    LOOP
      IF COALESCE(NULLIF(TRIM(v_line->>'description'),''), '') = '' THEN CONTINUE; END IF;
      v_no := v_no + 1;
      v_amount := ROUND(COALESCE((v_line->>'qty')::numeric,1)
                        * COALESCE((v_line->>'unit_rate_cents')::numeric,0))::bigint;
      INSERT INTO public.proforma_invoice_lines
        (proforma_id, line_no, description, service_date, vehicle_category, qty, unit_rate_cents, amount_cents)
      VALUES (v_id, v_no, TRIM(v_line->>'description'),
              NULLIF(v_line->>'service_date','')::date,
              NULLIF(v_line->>'vehicle_category',''),
              COALESCE((v_line->>'qty')::numeric,1),
              COALESCE((v_line->>'unit_rate_cents')::bigint,0),
              v_amount);
    END LOOP;
  END IF;

  SELECT COALESCE(SUM(amount_cents),0) INTO v_total
    FROM public.proforma_invoice_lines WHERE proforma_id = v_id;

  IF v_incl THEN
    v_sub := ROUND(v_total / (1 + v_rate/100))::bigint;
    v_vat := v_total - v_sub;
  ELSE
    v_sub := v_total;
    v_vat := ROUND(v_total * v_rate/100)::bigint;
    v_total := v_sub + v_vat;
  END IF;

  UPDATE public.proforma_invoices
     SET subtotal_cents = v_sub, vat_cents = v_vat, total_cents = v_total
   WHERE id = v_id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_after, actor_id, detail)
    VALUES (v_id, 'SAVED', 'draft', auth.uid(),
            jsonb_build_object('subtotal_cents', v_sub, 'vat_cents', v_vat, 'total_cents', v_total));

  RETURN public.proforma_get(v_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_save(jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- read one
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proforma_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT to_jsonb(i)
       || jsonb_build_object(
            'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no)
                                 FROM public.proforma_invoice_lines l WHERE l.proforma_id = i.id), '[]'::jsonb),
            'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
                                 FROM public.proforma_invoice_events e WHERE e.proforma_id = i.id), '[]'::jsonb),
            'can_write', public._proforma_can_write(i.owner_staff_id))
    INTO v FROM public.proforma_invoices i WHERE i.id = _id;
  IF v IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.proforma_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_get(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- list
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proforma_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'can_create', public._proforma_can_write(public._my_staff_member_id()),
    'invoices', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object(
               'line_count', (SELECT count(*) FROM public.proforma_invoice_lines l WHERE l.proforma_id = i.id))
             ORDER BY i.created_at DESC)
      FROM public.proforma_invoices i), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.proforma_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_list() TO authenticated, service_role;

-- ------------------------------------------------------------
-- issue — assigns the official number and locks the figures
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proforma_issue(_id uuid, _valid_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.proforma_invoices;
  v_no text;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'ALREADY_ISSUED'; END IF;
  IF COALESCE(TRIM(r.customer_company),'') = '' THEN RAISE EXCEPTION 'CUSTOMER_NAME_REQUIRED'; END IF;
  IF COALESCE(r.customer_email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'CUSTOMER_EMAIL_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proforma_invoice_lines WHERE proforma_id = _id) THEN
    RAISE EXCEPTION 'AT_LEAST_ONE_LINE_REQUIRED';
  END IF;
  IF r.total_cents <= 0 THEN RAISE EXCEPTION 'TOTAL_MUST_BE_GREATER_THAN_ZERO'; END IF;

  v_no := 'PI-' || to_char(now(), 'YYYY') || '-'
          || lpad(nextval('public.proforma_no_seq')::text, 6, '0');

  UPDATE public.proforma_invoices
     SET status = 'issued', proforma_no = v_no, issued_at = now(),
         issue_date = COALESCE(issue_date, current_date),
         valid_until = COALESCE(valid_until, current_date + GREATEST(COALESCE(_valid_days,14),1))
   WHERE id = _id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id, 'ISSUED', 'draft', 'issued', auth.uid(), jsonb_build_object('proforma_no', v_no));

  RETURN public.proforma_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_issue(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_issue(uuid, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- record the transmission (called after the file has been sent)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proforma_record_dispatch(
  _id uuid, _to text, _pdf_sha256 text, _provider_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.proforma_invoices;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status NOT IN ('issued','sent') THEN RAISE EXCEPTION 'ISSUE_THE_PROFORMA_FIRST'; END IF;

  UPDATE public.proforma_invoices
     SET status = 'sent', sent_at = now(), sent_to = _to,
         pdf_sha256 = COALESCE(pdf_sha256, _pdf_sha256)
   WHERE id = _id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id, 'SENT_TO_CUSTOMER', r.status, 'sent', auth.uid(),
            jsonb_build_object('recipient', _to, 'pdf_sha256', _pdf_sha256, 'provider_ref', _provider_ref));

  RETURN public.proforma_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_record_dispatch(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_record_dispatch(uuid, text, text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- void
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proforma_void(_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.proforma_invoices;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status = 'void' THEN RAISE EXCEPTION 'ALREADY_VOID'; END IF;
  IF COALESCE(TRIM(_reason),'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  UPDATE public.proforma_invoices SET status = 'void', void_reason = _reason WHERE id = _id;
  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, note)
    VALUES (_id, 'VOIDED', r.status, 'void', auth.uid(), _reason);
  RETURN public.proforma_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_void(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_void(uuid, text) TO authenticated, service_role;