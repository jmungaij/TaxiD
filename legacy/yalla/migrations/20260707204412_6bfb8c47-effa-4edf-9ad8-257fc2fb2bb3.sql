
-- Audit log for KYB document lifecycle events
CREATE TABLE IF NOT EXISTS public.corporate_document_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  corporate_id UUID NOT NULL,
  document_id UUID,
  doc_type TEXT,
  action TEXT NOT NULL, -- upload | replace | view | delete | approve | reject | status_change
  actor_id UUID,
  actor_role TEXT,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.corporate_document_audit_log TO authenticated;
GRANT ALL ON public.corporate_document_audit_log TO service_role;

ALTER TABLE public.corporate_document_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corp members read own doc audit"
  ON public.corporate_document_audit_log FOR SELECT
  USING (
    public.is_corporate_manager_or_admin(auth.uid(), corporate_id)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Corp members insert own doc audit"
  ON public.corporate_document_audit_log FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND (
      public.is_corporate_manager_or_admin(auth.uid(), corporate_id)
      OR public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

CREATE INDEX IF NOT EXISTS idx_corp_doc_audit_corp_created
  ON public.corporate_document_audit_log(corporate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corp_doc_audit_doc
  ON public.corporate_document_audit_log(document_id);
