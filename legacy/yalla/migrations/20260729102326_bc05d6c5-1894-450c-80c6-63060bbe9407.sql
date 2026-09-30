CREATE TABLE public.charter_pricing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version INTEGER NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  actor_email TEXT,
  note TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version)
);

GRANT SELECT ON public.charter_pricing_config TO anon;
GRANT SELECT ON public.charter_pricing_config TO authenticated;
GRANT ALL ON public.charter_pricing_config TO service_role;

ALTER TABLE public.charter_pricing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charter_pricing_config_public_read"
ON public.charter_pricing_config FOR SELECT
TO anon, authenticated
USING (true);

CREATE INDEX charter_pricing_config_effective_idx
ON public.charter_pricing_config (effective_at DESC, version DESC);