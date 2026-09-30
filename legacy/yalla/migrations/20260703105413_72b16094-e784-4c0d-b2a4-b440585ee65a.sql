CREATE TABLE IF NOT EXISTS public.mpesa_stk_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_attempt_id UUID NULL,
  user_id UUID NULL,
  idempotency_key TEXT NULL,
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  environment TEXT NOT NULL,
  shortcode TEXT NULL,
  phone_masked TEXT NULL,
  amount_cents INTEGER NULL,
  account_reference TEXT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  outcome TEXT NOT NULL,
  http_status INTEGER NULL,
  daraja_response JSONB NULL,
  merchant_request_id TEXT NULL,
  checkout_request_id TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  latency_ms INTEGER NULL,
  will_retry BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.mpesa_stk_attempts TO authenticated;
GRANT ALL ON public.mpesa_stk_attempts TO service_role;

ALTER TABLE public.mpesa_stk_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view stk attempts"
ON public.mpesa_stk_attempts
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'finance_admin')
);

CREATE INDEX IF NOT EXISTS mpesa_stk_attempts_created_at_idx
  ON public.mpesa_stk_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS mpesa_stk_attempts_idem_idx
  ON public.mpesa_stk_attempts (idempotency_key);
CREATE INDEX IF NOT EXISTS mpesa_stk_attempts_payment_idx
  ON public.mpesa_stk_attempts (payment_attempt_id);
CREATE INDEX IF NOT EXISTS mpesa_stk_attempts_outcome_idx
  ON public.mpesa_stk_attempts (outcome, created_at DESC);