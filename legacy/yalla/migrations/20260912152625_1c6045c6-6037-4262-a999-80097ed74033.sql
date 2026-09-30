
-- 1. Harden the two anonymous upload policies with declared content-type and size ceilings.

DROP POLICY IF EXISTS "portal inbox anonymous upload" ON storage.objects;
CREATE POLICY "portal inbox anonymous upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'crm-documents'
  AND (storage.foldername(name))[1] = 'portal-inbox'
  AND public.contract_portal_upload_allowed(name)
  AND (
    metadata IS NULL
    OR metadata->>'mimetype' IS NULL
    OR lower(metadata->>'mimetype') = ANY (ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png','image/jpeg','image/webp','image/heic','image/heif'
    ])
  )
  AND (
    metadata IS NULL
    OR metadata->>'size' IS NULL
    OR (metadata->>'size')::bigint <= 26214400
  )
);

DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;
CREATE POLICY "public applicants upload recruitment docs"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'recruitment-applications'
  AND (storage.foldername(name))[1] = 'public-applications'
  AND array_length(storage.foldername(name), 1) = 2
  AND public.rec_public_slug_is_open((storage.foldername(name))[2])
  AND lower(regexp_replace(name, '^.*\.', '')) = ANY (ARRAY[
    'pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'
  ])
  AND (
    metadata IS NULL
    OR metadata->>'mimetype' IS NULL
    OR lower(metadata->>'mimetype') = ANY (ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png','image/jpeg','image/webp','image/heic','image/heif',
      'text/plain'
    ])
  )
  AND (
    metadata IS NULL
    OR metadata->>'size' IS NULL
    OR (metadata->>'size')::bigint <= 10485760
  )
  AND public.rec_public_upload_reserve((storage.foldername(name))[2])
);

-- 2. Review surface: anonymous uploads that were never claimed by a record.

CREATE OR REPLACE VIEW public.v_unclaimed_public_uploads
WITH (security_invoker = true) AS
SELECT
  o.bucket_id,
  o.name AS storage_path,
  o.created_at,
  COALESCE((o.metadata->>'size')::bigint, 0) AS size_bytes,
  o.metadata->>'mimetype' AS mimetype
FROM storage.objects o
WHERE (
    (o.bucket_id = 'recruitment-applications' AND (storage.foldername(o.name))[1] = 'public-applications')
    OR (o.bucket_id = 'crm-documents' AND (storage.foldername(o.name))[1] = 'portal-inbox')
  )
  AND o.created_at < now() - interval '24 hours'
  AND NOT EXISTS (SELECT 1 FROM public.rec_candidate_documents d WHERE d.storage_path = o.name)
  AND NOT EXISTS (SELECT 1 FROM public.crm_document_versions v WHERE v.storage_path = o.name);

GRANT SELECT ON public.v_unclaimed_public_uploads TO authenticated;
GRANT SELECT ON public.v_unclaimed_public_uploads TO service_role;

-- 3. Cleanup routine for abandoned uploads (admin / service_role only).

CREATE OR REPLACE FUNCTION public.purge_unclaimed_public_uploads(_older_than interval DEFAULT interval '7 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  IF _older_than < interval '24 hours' THEN
    RAISE EXCEPTION 'refusing to purge uploads younger than 24 hours';
  END IF;

  WITH doomed AS (
    SELECT o.id
    FROM storage.objects o
    WHERE (
        (o.bucket_id = 'recruitment-applications' AND (storage.foldername(o.name))[1] = 'public-applications')
        OR (o.bucket_id = 'crm-documents' AND (storage.foldername(o.name))[1] = 'portal-inbox')
      )
      AND o.created_at < now() - _older_than
      AND NOT EXISTS (SELECT 1 FROM public.rec_candidate_documents d WHERE d.storage_path = o.name)
      AND NOT EXISTS (SELECT 1 FROM public.crm_document_versions v WHERE v.storage_path = o.name)
  )
  DELETE FROM storage.objects o USING doomed WHERE o.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_unclaimed_public_uploads(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_unclaimed_public_uploads(interval) FROM anon;
REVOKE ALL ON FUNCTION public.purge_unclaimed_public_uploads(interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_unclaimed_public_uploads(interval) TO service_role;
