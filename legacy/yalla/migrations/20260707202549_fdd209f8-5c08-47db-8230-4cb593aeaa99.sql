
CREATE POLICY "Corp members read own doc files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'corporate-documents'
    AND (
      public.is_corporate_manager_or_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
      OR public.has_role(auth.uid(),'admin'::app_role)
    )
  );

CREATE POLICY "Corp members upload own doc files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'corporate-documents'
    AND public.is_corporate_manager_or_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "Corp members delete own doc files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'corporate-documents'
    AND (
      public.is_corporate_manager_or_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
      OR public.has_role(auth.uid(),'admin'::app_role)
    )
  );
