-- Storage rows cannot be deleted from SQL; expose the orphan inventory instead
-- and keep the row purge in the database.
CREATE OR REPLACE FUNCTION public.public_upload_orphan_objects(_limit integer DEFAULT 500)
 RETURNS TABLE(bucket_id text, name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
  SELECT o.bucket_id, o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'recruitment-applications'
     AND EXISTS (
       SELECT 1 FROM public.rec_public_upload_sessions s
        WHERE s.claimed_application_id IS NULL
          AND s.expires_at < now() - interval '24 hours'
          AND o.name LIKE 'public-applications/%/' || s.id::text || '/%')
  UNION ALL
  SELECT o.bucket_id, o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'crm-portal-inbox'
     AND (storage.foldername(o.name))[1] = 'portal-inbox'
     AND o.created_at < now() - interval '24 hours'
     AND NOT EXISTS (
       SELECT 1 FROM public.contract_portal_invites i
        WHERE i.id::text = (storage.foldername(o.name))[2])
   LIMIT greatest(1, least(coalesce(_limit, 500), 2000));
END;
$function$;

REVOKE ALL ON FUNCTION public.public_upload_orphan_objects(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_upload_orphan_objects(integer) TO authenticated, service_role;

-- Restore the row purge without direct storage deletes (storage protects those).
CREATE OR REPLACE FUNCTION public.purge_expired_public_upload_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  DELETE FROM public.rec_public_upload_sessions s
   WHERE s.claimed_application_id IS NULL
     AND s.expires_at < now() - interval '24 hours'
     AND NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'recruitment-applications'
          AND o.name LIKE 'public-applications/%/' || s.id::text || '/%'
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;