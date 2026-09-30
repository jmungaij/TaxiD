CREATE POLICY "capacity photos are viewable"
ON storage.objects FOR SELECT
USING (bucket_id = 'capacity-photos');

CREATE POLICY "operators upload their own capacity photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'capacity-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "operators update their own capacity photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'capacity-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'capacity-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "operators delete their own capacity photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'capacity-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
