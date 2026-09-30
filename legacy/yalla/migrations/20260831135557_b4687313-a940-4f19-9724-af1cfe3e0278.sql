CREATE TABLE IF NOT EXISTS public.fin_cert_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_request_id text NOT NULL,
  merchant_request_id text,
  result_code integer,
  result_desc text,
  amount numeric,
  mpesa_receipt text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'daraja_sandbox',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_cert_callbacks_checkout_idx
  ON public.fin_cert_callbacks (checkout_request_id, received_at DESC);

GRANT SELECT, INSERT ON public.fin_cert_callbacks TO service_role;

ALTER TABLE public.fin_cert_callbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cert callbacks service only"
  ON public.fin_cert_callbacks FOR SELECT TO authenticated
  USING (false);

CREATE OR REPLACE FUNCTION public._fin_cert_callbacks_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'fin_cert_callbacks is append-only';
END;
$$;

DROP TRIGGER IF EXISTS fin_cert_callbacks_append_only ON public.fin_cert_callbacks;
CREATE TRIGGER fin_cert_callbacks_append_only
  BEFORE UPDATE OR DELETE ON public.fin_cert_callbacks
  FOR EACH ROW EXECUTE FUNCTION public._fin_cert_callbacks_append_only();