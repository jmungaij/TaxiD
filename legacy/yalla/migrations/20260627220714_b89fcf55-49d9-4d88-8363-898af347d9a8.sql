
CREATE TABLE IF NOT EXISTS public.edge_function_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  correlation_id uuid,
  function_name text NOT NULL,
  user_id uuid,
  method text,
  status_code int NOT NULL,
  latency_ms int NOT NULL,
  error_code text,
  error_message text,
  ip text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.edge_function_invocations TO authenticated;
GRANT ALL ON public.edge_function_invocations TO service_role;

ALTER TABLE public.edge_function_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read edge invocations"
  ON public.edge_function_invocations
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'finance_admin')
  );

CREATE INDEX IF NOT EXISTS idx_efi_created_at ON public.edge_function_invocations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_efi_function_created ON public.edge_function_invocations (function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_efi_status ON public.edge_function_invocations (status_code);
CREATE INDEX IF NOT EXISTS idx_efi_user ON public.edge_function_invocations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_efi_request ON public.edge_function_invocations (request_id);
