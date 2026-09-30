DROP POLICY IF EXISTS "Finance upload corporate guarantee files" ON storage.objects;
CREATE POLICY "Finance upload corporate guarantee files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'corporate-documents'
              AND public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]));