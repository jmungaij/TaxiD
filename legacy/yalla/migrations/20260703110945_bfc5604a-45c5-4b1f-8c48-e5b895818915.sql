
CREATE POLICY "finance/admins read mpesa exports"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'mpesa-exports' AND (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  )
);
