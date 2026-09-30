
-- Version history for corporate KYB documents
CREATE TABLE IF NOT EXISTS public.corporate_document_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL,
  corporate_id UUID NOT NULL,
  doc_type TEXT NOT NULL,
  document_number TEXT,
  expiry_date DATE,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL,
  reviewer_notes TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  uploaded_by UUID,
  version_number INT NOT NULL DEFAULT 1,
  reason TEXT, -- e.g. 'replaced', 'deleted', 'status_change'
  snapshotted_by UUID,
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.corporate_document_versions TO authenticated;
GRANT ALL ON public.corporate_document_versions TO service_role;
ALTER TABLE public.corporate_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corp members read own doc versions"
  ON public.corporate_document_versions FOR SELECT
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id)
      OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Corp members insert own doc versions"
  ON public.corporate_document_versions FOR INSERT
  WITH CHECK (public.is_corporate_manager_or_admin(auth.uid(), corporate_id)
           OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_corp_doc_versions_doc
  ON public.corporate_document_versions(document_id, version_number DESC);

-- Trigger: snapshot current row before UPDATE (storage/file changed OR status changed)
CREATE OR REPLACE FUNCTION public.snapshot_corporate_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_version INT;
  change_reason TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
      change_reason := 'replaced';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      change_reason := 'status_change';
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    change_reason := 'deleted';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
    FROM public.corporate_document_versions WHERE document_id = OLD.id;

  INSERT INTO public.corporate_document_versions(
    document_id, corporate_id, doc_type, document_number, expiry_date,
    storage_path, original_name, mime, size_bytes, status,
    reviewer_notes, reviewed_by, reviewed_at, uploaded_by,
    version_number, reason, snapshotted_by
  ) VALUES (
    OLD.id, OLD.corporate_id, OLD.doc_type, OLD.document_number, OLD.expiry_date,
    OLD.storage_path, OLD.original_name, OLD.mime, OLD.size_bytes, OLD.status,
    OLD.reviewer_notes, OLD.reviewed_by, OLD.reviewed_at, OLD.uploaded_by,
    next_version, change_reason, auth.uid()
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_corp_doc_update ON public.corporate_documents;
CREATE TRIGGER trg_snapshot_corp_doc_update
  BEFORE UPDATE ON public.corporate_documents
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_corporate_document();

DROP TRIGGER IF EXISTS trg_snapshot_corp_doc_delete ON public.corporate_documents;
CREATE TRIGGER trg_snapshot_corp_doc_delete
  BEFORE DELETE ON public.corporate_documents
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_corporate_document();

-- In-app notifications for KYB document events (expiry alerts, etc.)
CREATE TABLE IF NOT EXISTS public.corporate_document_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  corporate_id UUID NOT NULL,
  document_id UUID,
  doc_type TEXT,
  kind TEXT NOT NULL, -- 'expiring_soon' | 'expired' | 'reviewed'
  severity TEXT NOT NULL DEFAULT 'info', -- info | warning | critical
  title TEXT NOT NULL,
  body TEXT,
  expiry_date DATE,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, dedupe_key)
);
GRANT SELECT, UPDATE ON public.corporate_document_notifications TO authenticated;
GRANT ALL ON public.corporate_document_notifications TO service_role;
ALTER TABLE public.corporate_document_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Corp members read own doc notifications"
  ON public.corporate_document_notifications FOR SELECT
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id)
      OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Corp members mark own notifications read"
  ON public.corporate_document_notifications FOR UPDATE
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id))
  WITH CHECK (public.is_corporate_manager_or_admin(auth.uid(), corporate_id));

CREATE INDEX IF NOT EXISTS idx_corp_doc_notif_corp_created
  ON public.corporate_document_notifications(corporate_id, created_at DESC);
