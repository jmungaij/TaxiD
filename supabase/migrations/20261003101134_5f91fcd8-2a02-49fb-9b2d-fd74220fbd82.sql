DELETE FROM public.corporate_documents WHERE doc_type NOT IN ('certificate_of_incorporation','cr12','kra_pin');
ALTER TABLE public.corporate_documents DROP CONSTRAINT IF EXISTS corporate_documents_doc_type_check;
ALTER TABLE public.corporate_documents ADD CONSTRAINT corporate_documents_doc_type_check CHECK (doc_type IN ('certificate_of_incorporation','cr12','kra_pin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_documents TO authenticated;
GRANT SELECT, INSERT ON public.corporate_document_audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.corporate_document_notification_prefs TO authenticated;

CREATE POLICY "Company managers add documents" ON public.corporate_documents FOR INSERT TO authenticated
  WITH CHECK (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) AND status = 'pending');
CREATE POLICY "Company managers update documents" ON public.corporate_documents FOR UPDATE TO authenticated
  USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id))
  WITH CHECK (private.is_corporate_manager_or_admin(auth.uid(), corporate_id));
CREATE POLICY "Company managers delete unapproved documents" ON public.corporate_documents FOR DELETE TO authenticated
  USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id) AND status <> 'approved');

CREATE OR REPLACE FUNCTION private.corporate_documents_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF private.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]) OR auth.uid() IS NULL THEN
    IF NEW.status IN ('approved','rejected') AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      NEW.reviewed_by := auth.uid(); NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Only TaxiD reviewers can approve or reject documents';
    END IF;
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
      NEW.status := 'pending'; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.reviewer_notes := NULL;
    ELSE
      NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at; NEW.reviewer_notes := OLD.reviewer_notes;
    END IF;
  ELSE
    NEW.status := 'pending'; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS corporate_documents_guard ON public.corporate_documents;
CREATE TRIGGER corporate_documents_guard BEFORE INSERT OR UPDATE ON public.corporate_documents
  FOR EACH ROW EXECUTE FUNCTION private.corporate_documents_guard();

CREATE POLICY "Company members write audit" ON public.corporate_document_audit_log FOR INSERT TO authenticated
  WITH CHECK (private.is_corporate_member(auth.uid(), corporate_id) AND actor_id = auth.uid());
CREATE POLICY "Users manage own notification prefs" ON public.corporate_document_notification_prefs FOR ALL TO authenticated
  USING (user_id = auth.uid() AND private.is_corporate_member(auth.uid(), corporate_id))
  WITH CHECK (user_id = auth.uid() AND private.is_corporate_member(auth.uid(), corporate_id));

CREATE POLICY "corp docs read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'corporate-documents' AND (
    private.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role])
    OR private.is_corporate_member(auth.uid(), ((storage.foldername(name))[1])::uuid)));
CREATE POLICY "corp docs upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'corporate-documents' AND (storage.foldername(name))[2] IN ('certificate_of_incorporation','cr12','kra_pin')
    AND private.is_corporate_manager_or_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));
CREATE POLICY "corp docs delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'corporate-documents' AND (
    private.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role])
    OR private.is_corporate_manager_or_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)));