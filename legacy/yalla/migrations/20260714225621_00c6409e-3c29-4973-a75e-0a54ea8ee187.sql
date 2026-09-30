ALTER TABLE public.assurance_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES public.assurance_runs(id) ON DELETE SET NULL;
ALTER TABLE public.assurance_runs ADD COLUMN IF NOT EXISTS rerun_modules TEXT[];
CREATE INDEX IF NOT EXISTS idx_assurance_runs_parent ON public.assurance_runs(parent_run_id);