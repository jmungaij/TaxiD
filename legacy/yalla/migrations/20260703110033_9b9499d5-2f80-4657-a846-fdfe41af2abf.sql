
ALTER TABLE public.mpesa_stk_attempts
  ADD COLUMN IF NOT EXISTS final_result_code integer,
  ADD COLUMN IF NOT EXISTS final_result_desc text,
  ADD COLUMN IF NOT EXISTS final_receipt text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_mismatch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciliation_notes text;

CREATE INDEX IF NOT EXISTS mpesa_stk_attempts_checkout_idx
  ON public.mpesa_stk_attempts (checkout_request_id);
CREATE INDEX IF NOT EXISTS mpesa_stk_attempts_environment_idx
  ON public.mpesa_stk_attempts (environment, created_at DESC);
