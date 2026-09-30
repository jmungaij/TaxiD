CREATE TABLE public.rental_quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  token text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('SELF_DRIVE','CHAUFFEUR')),
  asset_class text NOT NULL,
  band_label text NOT NULL,
  seats integer,
  pricing_version integer NOT NULL,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_hash text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  rental_days integer NOT NULL CHECK (rental_days BETWEEN 1 AND 365),
  extra_hours integer NOT NULL DEFAULT 0 CHECK (extra_hours BETWEEN 0 AND 12),
  expected_km integer NOT NULL DEFAULT 0 CHECK (expected_km >= 0 AND expected_km <= 100000),
  pickup_location text NOT NULL,
  notes text,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  company_name text,
  base_kes numeric(14,2) NOT NULL,
  extra_hours_kes numeric(14,2) NOT NULL DEFAULT 0,
  excess_km_kes numeric(14,2) NOT NULL DEFAULT 0,
  discount_kes numeric(14,2) NOT NULL DEFAULT 0,
  vat_kes numeric(14,2) NOT NULL,
  total_kes numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'QUOTED'
    CHECK (status IN ('QUOTED','AWAITING_PAYMENT','PAID','CONFIRMED','EXPIRED','CANCELLED')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
  amount_paid_kes numeric(14,2) NOT NULL DEFAULT 0,
  mpesa_receipt text,
  paid_at timestamptz,
  expires_at timestamptz NOT NULL,
  source_page text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rental_quote_requests_status ON public.rental_quote_requests (status, created_at DESC);
CREATE INDEX idx_rental_quote_requests_email ON public.rental_quote_requests (lower(contact_email));

GRANT SELECT ON public.rental_quote_requests TO authenticated;
GRANT UPDATE ON public.rental_quote_requests TO authenticated;
GRANT ALL ON public.rental_quote_requests TO service_role;
ALTER TABLE public.rental_quote_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read rental quotes" ON public.rental_quote_requests
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read'));

CREATE POLICY "Commercial staff update rental quotes" ON public.rental_quote_requests
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.commercial.write'))
  WITH CHECK (public.has_staff_permission('staff.commercial.write'));

CREATE TABLE public.rental_quote_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.rental_quote_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rental_quote_events_quote ON public.rental_quote_events (quote_id, created_at DESC);

GRANT SELECT ON public.rental_quote_events TO authenticated;
GRANT ALL ON public.rental_quote_events TO service_role;
ALTER TABLE public.rental_quote_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read rental quote events" ON public.rental_quote_events
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read'));

CREATE OR REPLACE FUNCTION public._rental_quote_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rental_quote_events is append-only';
END;
$$;

CREATE TRIGGER trg_rental_quote_events_append_only
  BEFORE UPDATE OR DELETE ON public.rental_quote_events
  FOR EACH ROW EXECUTE FUNCTION public._rental_quote_events_append_only();

CREATE OR REPLACE FUNCTION public._rental_quote_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rental_quote_touch
  BEFORE UPDATE ON public.rental_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public._rental_quote_touch();

-- Public read of ONE quote by its private link token. Never lists quotes.
CREATE OR REPLACE FUNCTION public.rental_quote_open(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q public.rental_quote_requests; expired boolean;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN jsonb_build_object('found', false, 'reason_code', 'INVALID_TOKEN');
  END IF;

  SELECT * INTO q FROM public.rental_quote_requests WHERE token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason_code', 'QUOTE_NOT_FOUND');
  END IF;

  expired := q.expires_at < now() AND q.payment_status <> 'paid';

  RETURN jsonb_build_object(
    'found', true,
    'reference', q.reference,
    'category', q.category,
    'asset_class', q.asset_class,
    'band_label', q.band_label,
    'seats', q.seats,
    'pricing_version', q.pricing_version,
    'pricing_snapshot', q.pricing_snapshot,
    'start_date', q.start_date,
    'end_date', q.end_date,
    'rental_days', q.rental_days,
    'extra_hours', q.extra_hours,
    'expected_km', q.expected_km,
    'pickup_location', q.pickup_location,
    'notes', q.notes,
    'contact_name', q.contact_name,
    'contact_email', q.contact_email,
    'contact_phone', q.contact_phone,
    'company_name', q.company_name,
    'base_kes', q.base_kes,
    'extra_hours_kes', q.extra_hours_kes,
    'excess_km_kes', q.excess_km_kes,
    'discount_kes', q.discount_kes,
    'vat_kes', q.vat_kes,
    'total_kes', q.total_kes,
    'currency', q.currency,
    'status', CASE WHEN expired THEN 'EXPIRED' ELSE q.status END,
    'payment_status', q.payment_status,
    'amount_paid_kes', q.amount_paid_kes,
    'mpesa_receipt', q.mpesa_receipt,
    'paid_at', q.paid_at,
    'expires_at', q.expires_at,
    'expired', expired,
    'created_at', q.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rental_quote_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rental_quote_open(text) TO anon, authenticated, service_role;

-- Settlement reads the verified M-Pesa ledger only (written solely by the
-- signed Daraja callback). The browser can never mark a quote paid.
CREATE OR REPLACE FUNCTION public.rental_quote_settle_payment(_reference text, _checkout_request_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE q public.rental_quote_requests; t public.mpesa_transactions; paid_kes numeric(14,2);
BEGIN
  SELECT * INTO q FROM public.rental_quote_requests
   WHERE reference = upper(coalesce(_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'QUOTE_NOT_FOUND');
  END IF;

  IF q.payment_status = 'paid' THEN
    RETURN jsonb_build_object('settled', true, 'reason_code', 'ALREADY_SETTLED', 'reference', q.reference);
  END IF;

  SELECT * INTO t FROM public.mpesa_transactions
   WHERE status = 'SUCCESS'
     AND deleted_at IS NULL
     AND upper(coalesce(account_reference,'')) = q.reference
     AND (_checkout_request_id IS NULL OR checkout_request_id = _checkout_request_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'NO_VERIFIED_PAYMENT', 'reference', q.reference);
  END IF;

  paid_kes := round(t.amount_cents::numeric / 100, 2);
  IF paid_kes < q.total_kes THEN
    INSERT INTO public.rental_quote_events (quote_id, event_type, detail)
    VALUES (q.id, 'PAYMENT_SHORTFALL', jsonb_build_object('amount_paid_kes', paid_kes, 'total_kes', q.total_kes));
    RETURN jsonb_build_object('settled', false, 'reason_code', 'AMOUNT_SHORTFALL',
      'reference', q.reference, 'amount_paid_kes', paid_kes, 'total_kes', q.total_kes);
  END IF;

  UPDATE public.rental_quote_requests
     SET payment_status = 'paid',
         status = 'CONFIRMED',
         amount_paid_kes = paid_kes,
         mpesa_receipt = t.mpesa_receipt,
         paid_at = coalesce(t.updated_at, now())
   WHERE id = q.id;

  INSERT INTO public.rental_quote_events (quote_id, event_type, detail)
  VALUES (q.id, 'PAYMENT_CONFIRMED', jsonb_build_object(
    'amount_paid_kes', paid_kes, 'mpesa_receipt', t.mpesa_receipt,
    'checkout_request_id', t.checkout_request_id));

  RETURN jsonb_build_object('settled', true, 'reason_code', 'SETTLED', 'reference', q.reference,
    'amount_paid_kes', paid_kes, 'mpesa_receipt', t.mpesa_receipt);
END;
$$;

REVOKE ALL ON FUNCTION public.rental_quote_settle_payment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rental_quote_settle_payment(text, text) TO service_role;