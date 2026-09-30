CREATE POLICY "rec_migration_files_staff_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'recruitment-migration' AND public.rec_can_read());

CREATE POLICY "rec_migration_files_staff_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'recruitment-migration' AND public.rec_can_write());

CREATE POLICY "rec_migration_files_staff_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'recruitment-migration' AND public.rec_can_write())
WITH CHECK (bucket_id = 'recruitment-migration' AND public.rec_can_write());

CREATE POLICY "rec_migration_files_admin_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'recruitment-migration' AND public.has_role(auth.uid(), 'admin'::app_role));