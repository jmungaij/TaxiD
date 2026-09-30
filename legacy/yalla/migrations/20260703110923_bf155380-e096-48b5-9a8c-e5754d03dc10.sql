
CREATE TABLE IF NOT EXISTS public.mpesa_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  format text NOT NULL CHECK (format IN ('csv','pdf')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed','expired')),
  row_count integer,
  file_path text,
  download_url text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mpesa_export_jobs TO authenticated;
GRANT ALL ON public.mpesa_export_jobs TO service_role;
ALTER TABLE public.mpesa_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance/admins view export jobs" ON public.mpesa_export_jobs
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR
  public.has_role(auth.uid(),'super_admin') OR
  public.has_role(auth.uid(),'finance_admin')
);
CREATE POLICY "finance/admins queue export jobs" ON public.mpesa_export_jobs
FOR INSERT TO authenticated WITH CHECK (
  requested_by = auth.uid() AND (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  )
);
CREATE POLICY "finance/admins cancel own export jobs" ON public.mpesa_export_jobs
FOR UPDATE TO authenticated USING (
  requested_by = auth.uid() AND (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  )
) WITH CHECK (requested_by = auth.uid());

CREATE INDEX IF NOT EXISTS mpesa_export_jobs_status_idx
  ON public.mpesa_export_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS mpesa_export_jobs_requested_by_idx
  ON public.mpesa_export_jobs (requested_by, created_at DESC);

CREATE OR REPLACE FUNCTION public.mpesa_export_jobs_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_mpesa_export_jobs_touch ON public.mpesa_export_jobs;
CREATE TRIGGER trg_mpesa_export_jobs_touch BEFORE UPDATE ON public.mpesa_export_jobs
FOR EACH ROW EXECUTE FUNCTION public.mpesa_export_jobs_touch();

CREATE TABLE IF NOT EXISTS public.mpesa_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  window_minutes integer NOT NULL DEFAULT 60,
  checked_count integer NOT NULL DEFAULT 0,
  reconciled_count integer NOT NULL DEFAULT 0,
  mismatch_count integer NOT NULL DEFAULT 0,
  still_pending_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mpesa_reconciliation_runs TO authenticated;
GRANT ALL ON public.mpesa_reconciliation_runs TO service_role;
ALTER TABLE public.mpesa_reconciliation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance/admins view reconciliation runs" ON public.mpesa_reconciliation_runs
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR
  public.has_role(auth.uid(),'super_admin') OR
  public.has_role(auth.uid(),'finance_admin')
);

CREATE INDEX IF NOT EXISTS mpesa_reconciliation_runs_started_idx
  ON public.mpesa_reconciliation_runs (started_at DESC);
