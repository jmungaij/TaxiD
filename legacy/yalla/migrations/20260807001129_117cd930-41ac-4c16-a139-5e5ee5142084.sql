DROP POLICY IF EXISTS "Finance reads reversal evidence" ON storage.objects;
CREATE POLICY "Finance reads reversal evidence" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'wallet-reversal-evidence'
         AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Finance uploads reversal evidence" ON storage.objects;
CREATE POLICY "Finance uploads reversal evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'wallet-reversal-evidence'
         AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));