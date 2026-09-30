ALTER TABLE public.delivery_onboarding
  ADD COLUMN IF NOT EXISTS partner_type text NOT NULL DEFAULT 'courier',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS tax_pin text,
  ADD COLUMN IF NOT EXISTS vehicle_types text,
  ADD COLUMN IF NOT EXISTS monthly_volume integer,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_onboarding_status_check'
  ) THEN
    ALTER TABLE public.delivery_onboarding
      ADD CONSTRAINT delivery_onboarding_status_check
      CHECK (status IN ('draft','submitted','in_review','approved','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_onboarding_status
  ON public.delivery_onboarding(status, submitted_at DESC);