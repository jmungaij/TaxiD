-- Schema drift fixes for D6.3 stabilization sprint

ALTER TABLE public.dispatch_assignments
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.ledger_accounts
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.payment_reliability_forecasts
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS window_end   timestamptz;

-- Backfill window_end using computed_at so existing rows are queryable by the qualification job.
UPDATE public.payment_reliability_forecasts
  SET window_end = computed_at
  WHERE window_end IS NULL;

CREATE INDEX IF NOT EXISTS payment_reliability_forecasts_window_end_idx
  ON public.payment_reliability_forecasts (window_end DESC);
