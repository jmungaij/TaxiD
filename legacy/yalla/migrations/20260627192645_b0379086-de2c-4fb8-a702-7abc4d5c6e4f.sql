
DO $$ BEGIN
  CREATE POLICY "paybill_proofs_member_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'paybill-proofs'
      AND EXISTS (
        SELECT 1 FROM public.corporate_employees ce
        WHERE ce.user_id = auth.uid()
          AND ce.status = 'active'
          AND ce.corporate_id::text = (storage.foldername(name))[1]
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "paybill_proofs_member_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'paybill-proofs'
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.corporate_employees ce
          WHERE ce.user_id = auth.uid()
            AND ce.status = 'active'
            AND ce.corporate_id::text = (storage.foldername(name))[1]
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
