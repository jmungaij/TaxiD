ALTER TABLE public.edge_function_invocations
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS span_id text,
  ADD COLUMN IF NOT EXISTS parent_span_id text,
  ADD COLUMN IF NOT EXISTS tenant_id text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS cold_start boolean,
  ADD COLUMN IF NOT EXISTS request_bytes int,
  ADD COLUMN IF NOT EXISTS response_bytes int,
  ADD COLUMN IF NOT EXISTS retry_count int,
  ADD COLUMN IF NOT EXISTS queue_time_ms int,
  ADD COLUMN IF NOT EXISTS cpu_time_ms int,
  ADD COLUMN IF NOT EXISTS memory_mb int,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS deployment_id text,
  ADD COLUMN IF NOT EXISTS route_path text,
  ADD COLUMN IF NOT EXISTS event_type text;

CREATE INDEX IF NOT EXISTS idx_efi_trace ON public.edge_function_invocations (trace_id);
CREATE INDEX IF NOT EXISTS idx_efi_tenant_created ON public.edge_function_invocations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_efi_correlation ON public.edge_function_invocations (correlation_id);