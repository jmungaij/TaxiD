DROP POLICY IF EXISTS partner_docs_read ON storage.objects;
CREATE POLICY partner_docs_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'partner-documents'
  AND (public.yp_is_staff() OR public.is_partner_member(NULLIF(split_part(name,'/',1),'')::uuid))
);

DROP POLICY IF EXISTS partner_docs_insert ON storage.objects;
CREATE POLICY partner_docs_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'partner-documents'
  AND (public.yp_is_staff() OR public.is_partner_member(NULLIF(split_part(name,'/',1),'')::uuid))
);
