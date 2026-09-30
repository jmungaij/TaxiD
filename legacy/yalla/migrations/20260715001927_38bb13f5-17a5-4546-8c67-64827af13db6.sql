
-- Exceptions register
CREATE TABLE IF NOT EXISTS public.paf_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  justification text NOT NULL,
  compensating_controls text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','revoked')),
  expires_at timestamptz NOT NULL,
  linked_run_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.paf_exceptions TO authenticated;
GRANT ALL ON public.paf_exceptions TO service_role;

ALTER TABLE public.paf_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage PAF exceptions"
  ON public.paf_exceptions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_paf_exceptions_status_expires
  ON public.paf_exceptions(status, expires_at);

-- Remediation approvals
CREATE TABLE IF NOT EXISTS public.paf_remediation_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  resource text NOT NULL,
  severity text NOT NULL,
  sql_text text NOT NULL,
  sql_hash text NOT NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','deferred')),
  decision_notes text,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.paf_remediation_approvals TO authenticated;
GRANT ALL ON public.paf_remediation_approvals TO service_role;

ALTER TABLE public.paf_remediation_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage PAF remediation approvals"
  ON public.paf_remediation_approvals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_paf_remediation_approvals_run
  ON public.paf_remediation_approvals(run_id);

-- Auto-expire trigger for exceptions
CREATE OR REPLACE FUNCTION public.paf_expire_exceptions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.paf_exceptions
    SET status = 'expired', updated_at = now()
    WHERE status = 'approved' AND expires_at < now();
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at_paf_exceptions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_paf_exceptions_updated ON public.paf_exceptions;
CREATE TRIGGER trg_paf_exceptions_updated
  BEFORE UPDATE ON public.paf_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_paf_exceptions();
