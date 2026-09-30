
CREATE TABLE IF NOT EXISTS public.nav_integrity_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL UNIQUE,
  max_dead_routes integer NOT NULL DEFAULT 0,
  max_registry_mismatch integer NOT NULL DEFAULT 0,
  max_unbound_critical integer NOT NULL DEFAULT 0,
  max_orphan_routes integer NOT NULL DEFAULT 50,
  max_missing_analytics integer NOT NULL DEFAULT 25,
  block_deploy boolean NOT NULL DEFAULT true,
  notify_emails text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nav_integrity_thresholds TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.nav_integrity_thresholds TO authenticated;
GRANT ALL ON public.nav_integrity_thresholds TO service_role;

ALTER TABLE public.nav_integrity_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nav_thresholds read"
  ON public.nav_integrity_thresholds FOR SELECT
  USING (true);

CREATE POLICY "nav_thresholds admin write"
  ON public.nav_integrity_thresholds FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_nav_thresholds_updated_at
  BEFORE UPDATE ON public.nav_integrity_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.nav_integrity_thresholds(environment, max_dead_routes, max_registry_mismatch, max_unbound_critical, max_orphan_routes, max_missing_analytics, block_deploy)
VALUES
  ('development', 20, 100, 20, 100, 100, false),
  ('preview',     10, 50,  10, 75,  75,  false),
  ('production',  0,  0,   0,  50,  25,  true)
ON CONFLICT (environment) DO NOTHING;
