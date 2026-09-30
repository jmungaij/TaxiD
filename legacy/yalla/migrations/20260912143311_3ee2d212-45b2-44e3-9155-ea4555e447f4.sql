-- 1) Contact rate limits: make fail-closed posture explicit
REVOKE ALL ON public.contact_rate_limits FROM anon;
REVOKE ALL ON public.contact_rate_limits FROM authenticated;
GRANT SELECT ON public.contact_rate_limits TO authenticated; -- admin read policy only
GRANT ALL ON public.contact_rate_limits TO service_role;
COMMENT ON TABLE public.contact_rate_limits IS
  'Written only by service_role from the contact-submission / logistics-enquiry edge functions. No client insert/update path; authenticated SELECT is restricted to admins by RLS.';

-- 2) Client contract portal inbox: bind uploads to a live invite, allowed types and volume caps
CREATE OR REPLACE FUNCTION public.contract_portal_upload_allowed(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH parts AS (
    SELECT storage.foldername(_name) AS f
  ), ok_shape AS (
    SELECT (array_length(f,1) = 2 AND f[1] = 'portal-inbox') AS shaped,
           CASE WHEN array_length(f,1) = 2
                     AND f[2] ~ '^[0-9a-fA-F-]{36}$'
                THEN f[2]::uuid END AS invite_id
      FROM parts
  )
  SELECT COALESCE((
    SELECT s.shaped
       AND s.invite_id IS NOT NULL
       AND lower(regexp_replace(_name, '^.*\.', '')) = ANY (
             ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif'])
       AND EXISTS (
             SELECT 1 FROM public.contract_portal_invites i
              WHERE i.id = s.invite_id
                AND i.revoked_at IS NULL
                AND i.completed_at IS NULL
                AND i.expires_at > now())
       AND (SELECT count(*) FROM storage.objects o
              WHERE o.bucket_id = 'crm-documents'
                AND (storage.foldername(o.name))[1] = 'portal-inbox'
                AND (storage.foldername(o.name))[2] = s.invite_id::text) < 10
       AND (SELECT count(*) FROM storage.objects o
              WHERE o.bucket_id = 'crm-documents'
                AND (storage.foldername(o.name))[1] = 'portal-inbox'
                AND (storage.foldername(o.name))[2] = s.invite_id::text
                AND o.created_at > now() - interval '1 hour') < 20
      FROM ok_shape s
  ), false);
$$;

REVOKE ALL ON FUNCTION public.contract_portal_upload_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contract_portal_upload_allowed(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "portal inbox anonymous upload" ON storage.objects;
CREATE POLICY "portal inbox anonymous upload" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'crm-documents'
  AND (storage.foldername(name))[1] = 'portal-inbox'
  AND public.contract_portal_upload_allowed(name)
);

-- 3) Recruitment public uploads: add a global hourly ceiling on top of the per-vacancy cap
CREATE OR REPLACE FUNCTION public.rec_public_upload_global_within_limit()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (
    SELECT count(*) FROM storage.objects o
     WHERE o.bucket_id = 'recruitment-applications'
       AND (storage.foldername(o.name))[1] = 'public-applications'
       AND o.created_at > now() - interval '1 hour'
  ) < 600;
$$;

REVOKE ALL ON FUNCTION public.rec_public_upload_global_within_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_upload_global_within_limit() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;
CREATE POLICY "public applicants upload recruitment docs" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'recruitment-applications'
  AND (storage.foldername(name))[1] = 'public-applications'
  AND array_length(storage.foldername(name), 1) = 2
  AND public.rec_public_slug_is_open((storage.foldername(name))[2])
  AND public.rec_public_upload_within_limit((storage.foldername(name))[2])
  AND public.rec_public_upload_global_within_limit()
  AND lower(regexp_replace(name, '^.*\.', '')) = ANY (ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'])
);