
ALTER TABLE public.payment_alerts
  ADD COLUMN IF NOT EXISTS acknowledgement_note text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_by uuid;
