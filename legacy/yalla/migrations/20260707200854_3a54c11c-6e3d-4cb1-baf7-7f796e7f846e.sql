
CREATE TABLE public.corporate_role_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  corporate_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.corporate_employees(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_email TEXT,
  previous_role TEXT,
  new_role TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_corporate_role_audit_corp ON public.corporate_role_audit_log(corporate_id, created_at DESC);
CREATE INDEX idx_corporate_role_audit_emp  ON public.corporate_role_audit_log(employee_id, created_at DESC);

GRANT SELECT, INSERT ON public.corporate_role_audit_log TO authenticated;
GRANT ALL ON public.corporate_role_audit_log TO service_role;

ALTER TABLE public.corporate_role_audit_log ENABLE ROW LEVEL SECURITY;

-- Corporate admins can read audit entries for their own corporate account.
CREATE POLICY "Corporate admins read own role audit"
ON public.corporate_role_audit_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.corporate_employees e
    WHERE e.corporate_id = corporate_role_audit_log.corporate_id
      AND e.user_id = auth.uid()
      AND e.role = 'corporate_admin'
      AND e.status = 'active'
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);

-- Corporate admins can append audit entries when they change roles in their own corporate.
CREATE POLICY "Corporate admins insert own role audit"
ON public.corporate_role_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.corporate_employees e
    WHERE e.corporate_id = corporate_role_audit_log.corporate_id
      AND e.user_id = auth.uid()
      AND e.role = 'corporate_admin'
      AND e.status = 'active'
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
);
