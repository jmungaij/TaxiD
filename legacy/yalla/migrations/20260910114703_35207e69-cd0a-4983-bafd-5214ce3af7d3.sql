CREATE POLICY provider_docs_own_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY provider_docs_own_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY provider_docs_own_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'provider-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY provider_docs_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'provider-documents'
         AND ((storage.foldername(name))[1] = auth.uid()::text
              OR public.has_role(auth.uid(),'admin')
              OR public.has_role(auth.uid(),'super_admin')
              OR public.has_role(auth.uid(),'operations_admin')));