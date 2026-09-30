CREATE TABLE public.partner_api_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  credential_id uuid REFERENCES public.partner_api_credentials(id) ON DELETE SET NULL,
  environment public.partner_api_environment NOT NULL DEFAULT 'sandbox',
  event_type text NOT NULL,
  event_id text NOT NULL,
  delivery_id text NOT NULL,
  correlation_id text NOT NULL,
  endpoint_url text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  max_attempts integer NOT NULL DEFAULT 8,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
  failure_category text
    CHECK (failure_category IN (
      'none', 'signature_mismatch', 'timestamp_out_of_tolerance', 'malformed_header',
      'missing_header', 'duplicate_event', 'http_4xx', 'http_5xx',
      'connection_error', 'timeout', 'tls_error', 'payload_rejected'
    )),
  http_status integer,
  response_ms integer,
  signature_version text NOT NULL DEFAULT 'v1',
  signature_valid boolean,
  timestamp_skew_seconds integer,
  payload_preview text,
  error_detail text,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (delivery_id, attempt)
);

CREATE INDEX idx_partner_api_webhook_deliveries_lookup
  ON public.partner_api_webhook_deliveries(partner_id, environment, created_at DESC);
CREATE INDEX idx_partner_api_webhook_deliveries_correlation
  ON public.partner_api_webhook_deliveries(correlation_id);

GRANT SELECT ON public.partner_api_webhook_deliveries TO authenticated;
GRANT ALL ON public.partner_api_webhook_deliveries TO service_role;

ALTER TABLE public.partner_api_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner members read own webhook deliveries"
ON public.partner_api_webhook_deliveries
FOR SELECT
TO authenticated
USING (public.partner_api_is_member(partner_id));