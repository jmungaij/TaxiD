ALTER TABLE public.charter_bookings
  ADD COLUMN IF NOT EXISTS mpesa_receipt text,
  ADD COLUMN IF NOT EXISTS checkout_request_id text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE INDEX IF NOT EXISTS charter_bookings_checkout_idx ON public.charter_bookings (checkout_request_id);

CREATE TABLE IF NOT EXISTS public.charter_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.charter_bookings(id) ON DELETE SET NULL,
  reference text,
  checkout_request_id text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  result_code integer,
  result_desc text,
  mpesa_receipt text,
  amount_kes numeric,
  applied_status text NOT NULL,
  outcome text NOT NULL DEFAULT 'applied',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_payment_events TO authenticated;
GRANT ALL ON public.charter_payment_events TO service_role;
ALTER TABLE public.charter_payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read charter payment events"
  ON public.charter_payment_events FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.charter_bookings b
      WHERE b.id = charter_payment_events.booking_id AND b.user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.charter_document_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_number text NOT NULL UNIQUE,
  fingerprint text NOT NULL,
  template_version text NOT NULL,
  document_kind text NOT NULL DEFAULT 'receipt',
  reference text NOT NULL,
  booking_id uuid REFERENCES public.charter_bookings(id) ON DELETE SET NULL,
  file_name text,
  amount_kes numeric,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_document_registry TO authenticated;
GRANT ALL ON public.charter_document_registry TO service_role;
ALTER TABLE public.charter_document_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read charter document registry"
  ON public.charter_document_registry FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.charter_bookings b
      WHERE b.id = charter_document_registry.booking_id AND b.user_id = auth.uid()
    )
  );

CREATE TRIGGER charter_payment_events_touch
  BEFORE UPDATE ON public.charter_payment_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER charter_document_registry_touch
  BEFORE UPDATE ON public.charter_document_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();