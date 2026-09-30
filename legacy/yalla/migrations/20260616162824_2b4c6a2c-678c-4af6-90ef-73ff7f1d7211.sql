
-- delivery-documents bucket: path layout is {user_id}/{module}/{doc_id}/{filename}
CREATE POLICY "delivery_docs_own_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'delivery-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'compliance_admin'::app_role, 'operations_admin'::app_role])
    )
  );

CREATE POLICY "delivery_docs_own_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "delivery_docs_own_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'delivery-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'compliance_admin'::app_role, 'operations_admin'::app_role])
    )
  )
  WITH CHECK (
    bucket_id = 'delivery-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'compliance_admin'::app_role, 'operations_admin'::app_role])
    )
  );

CREATE POLICY "delivery_docs_own_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'delivery-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'compliance_admin'::app_role, 'operations_admin'::app_role])
    )
  );
