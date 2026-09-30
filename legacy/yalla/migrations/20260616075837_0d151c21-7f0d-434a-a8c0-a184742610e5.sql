
-- Helper inline: bucket list
-- For each bucket, owner-by-prefix policy + admin override.

-- Drop existing if present then create (idempotent)
DO $$
DECLARE b text;
BEGIN
  FOR b IN SELECT unnest(ARRAY['driver-documents','vehicle-documents','driver-photos','inspection-reports','verification-files']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', b||'_owner');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', b||'_admin');
  END LOOP;
END $$;

CREATE POLICY "driver-documents_owner" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'driver-documents' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'driver-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "driver-documents_admin" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'driver-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (bucket_id = 'driver-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE POLICY "vehicle-documents_owner" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-documents' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'vehicle-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "vehicle-documents_admin" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'vehicle-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (bucket_id = 'vehicle-documents' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE POLICY "driver-photos_owner" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'driver-photos' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'driver-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "driver-photos_admin" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'driver-photos' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (bucket_id = 'driver-photos' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE POLICY "inspection-reports_owner" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'inspection-reports' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'inspection-reports' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "inspection-reports_admin" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'inspection-reports' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (bucket_id = 'inspection-reports' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE POLICY "verification-files_owner" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'verification-files' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'verification-files' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "verification-files_admin" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'verification-files' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (bucket_id = 'verification-files' AND public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
