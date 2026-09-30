CREATE TABLE IF NOT EXISTS public.platform_certification_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  maturity_score integer NOT NULL,
  release_approved boolean NOT NULL DEFAULT false,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_certification_snapshots_generated_at_idx
  ON public.platform_certification_snapshots (generated_at DESC);
CREATE INDEX IF NOT EXISTS platform_certification_snapshots_snapshot_id_idx
  ON public.platform_certification_snapshots (snapshot_id);

GRANT SELECT ON public.platform_certification_snapshots TO authenticated;
GRANT ALL ON public.platform_certification_snapshots TO service_role;

ALTER TABLE public.platform_certification_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read certification snapshots" ON public.platform_certification_snapshots;
CREATE POLICY "Admins can read certification snapshots"
  ON public.platform_certification_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));