ALTER TABLE public.corporate_employees
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;