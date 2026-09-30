CREATE TABLE public.charter_webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  events text[] NOT NULL DEFAULT ARRAY['charter.cabin_changed','charter.seats_changed','charter.gallery_selected','charter.ground_package_changed'],
  active boolean NOT NULL DEFAULT true,
  description text,
  last_status text,
  last_delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.charter_webhook_endpoints TO authenticated;
GRANT ALL ON public.charter_webhook_endpoints TO service_role;
ALTER TABLE public.charter_webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage charter webhook endpoints"
ON public.charter_webhook_endpoints FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.charter_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid REFERENCES public.charter_webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_id text NOT NULL,
  booking_id uuid,
  reference text,
  actor_user_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  response_status integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_webhook_deliveries TO authenticated;
GRANT ALL ON public.charter_webhook_deliveries TO service_role;
ALTER TABLE public.charter_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read charter webhook deliveries"
ON public.charter_webhook_deliveries FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_charter_webhook_deliveries_created ON public.charter_webhook_deliveries (created_at DESC);
CREATE UNIQUE INDEX idx_charter_webhook_deliveries_unique ON public.charter_webhook_deliveries (endpoint_id, event_id);

CREATE TRIGGER trg_charter_webhook_endpoints_updated
BEFORE UPDATE ON public.charter_webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_charter_webhook_deliveries_updated
BEFORE UPDATE ON public.charter_webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();