
-- Admins full access
CREATE POLICY "Admins read evidence storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reconciliation-evidence' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write evidence storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reconciliation-evidence' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update evidence storage" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'reconciliation-evidence' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete evidence storage" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'reconciliation-evidence' AND public.has_role(auth.uid(), 'admin'));

-- Corporates: only within /corp/{corporate_id}/...
CREATE POLICY "Corp read own evidence storage" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'reconciliation-evidence'
    AND (storage.foldername(name))[1] = 'corp'
    AND (storage.foldername(name))[2] IN (
      SELECT corporate_id::text FROM public.corporate_employees WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "Corp upload own evidence storage" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reconciliation-evidence'
    AND (storage.foldername(name))[1] = 'corp'
    AND (storage.foldername(name))[2] IN (
      SELECT corporate_id::text FROM public.corporate_employees WHERE user_id = auth.uid()
    )
  );
