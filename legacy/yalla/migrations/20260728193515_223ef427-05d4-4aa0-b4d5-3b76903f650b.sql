CREATE TABLE public.charter_pricing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('quote','booking','inventory')),
  entity_id uuid,
  reference text,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  category_slug text,
  asset_name text,
  previous_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text,
  total numeric,
  evidence_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_pricing_audit TO authenticated;
GRANT ALL ON public.charter_pricing_audit TO service_role;

ALTER TABLE public.charter_pricing_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charter_pricing_audit_read" ON public.charter_pricing_audit
FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE INDEX idx_charter_pricing_audit_entity ON public.charter_pricing_audit (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_charter_pricing_audit_actor ON public.charter_pricing_audit (actor_id, created_at DESC);

ALTER TABLE public.charter_bookings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.charter_bookings;