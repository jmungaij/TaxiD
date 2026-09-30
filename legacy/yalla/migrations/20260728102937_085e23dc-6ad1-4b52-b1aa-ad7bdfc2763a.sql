ALTER TABLE public.payment_load_qualification_runs
  DROP CONSTRAINT payment_load_qualification_runs_concurrency_tier_check;
ALTER TABLE public.payment_load_qualification_runs
  ADD CONSTRAINT payment_load_qualification_runs_concurrency_tier_check
  CHECK (concurrency_tier = ANY (ARRAY[100, 250, 500, 1000, 5000, 10000, 25000, 50000, 100000]));