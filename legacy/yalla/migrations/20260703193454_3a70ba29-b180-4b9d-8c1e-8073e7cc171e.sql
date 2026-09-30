-- === rename_feature_flag =====================================================
CREATE TABLE public.rename_feature_flag (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  ramp_percent integer NOT NULL DEFAULT 0 CHECK (ramp_percent BETWEEN 0 AND 100),
  allowed_country_codes text[] NOT NULL DEFAULT '{}',
  allowed_tenant_ids uuid[] NOT NULL DEFAULT '{}',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.rename_feature_flag TO authenticated;
GRANT UPDATE, INSERT ON public.rename_feature_flag TO authenticated;
GRANT ALL ON public.rename_feature_flag TO service_role;

ALTER TABLE public.rename_feature_flag ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may READ the flag (client needs it to pick a session-key path).
CREATE POLICY "rename_flag_read_any_authenticated"
  ON public.rename_feature_flag FOR SELECT
  TO authenticated
  USING (true);

-- Only super_admins may INSERT/UPDATE the flag row.
CREATE POLICY "rename_flag_write_super_admin"
  ON public.rename_feature_flag FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- Seed the singleton row (disabled, 0% ramp, no kill switch).
INSERT INTO public.rename_feature_flag (singleton, enabled, kill_switch, ramp_percent, notes)
VALUES (true, false, false, 0, 'Initial row — rename OFF until SRE opens the window.')
ON CONFLICT (singleton) DO NOTHING;

-- === rename_backfill_verifications ==========================================
CREATE TABLE public.rename_backfill_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL CHECK (trigger IN ('scheduled','manual')),
  triggered_by uuid REFERENCES auth.users(id),
  tables jsonb NOT NULL DEFAULT '[]'::jsonb,
  divergent_rows integer NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rename_backfill_verifications TO authenticated;
GRANT ALL ON public.rename_backfill_verifications TO service_role;

ALTER TABLE public.rename_backfill_verifications ENABLE ROW LEVEL SECURITY;

-- Any admin / super_admin / finance_admin may view the verification history.
CREATE POLICY "verifications_read_admin"
  ON public.rename_backfill_verifications FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_admin'::app_role)
  );
-- No client write policy — only service_role (edge function) can insert.

CREATE INDEX rename_backfill_verifications_ran_at_idx
  ON public.rename_backfill_verifications (ran_at DESC);

-- === updated_at trigger reuse ================================================
CREATE OR REPLACE FUNCTION public.rename_flag_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = COALESCE(NEW.updated_by, auth.uid());
  RETURN NEW;
END;
$$;

CREATE TRIGGER rename_flag_touch
  BEFORE UPDATE ON public.rename_feature_flag
  FOR EACH ROW EXECUTE FUNCTION public.rename_flag_touch_updated_at();