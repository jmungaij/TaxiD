ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS correlation_id uuid;
CREATE INDEX IF NOT EXISTS audit_logs_correlation_id_idx ON public.audit_logs(correlation_id);