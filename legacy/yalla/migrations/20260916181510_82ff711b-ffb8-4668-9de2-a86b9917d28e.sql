-- 1. Shared rate-limit ledger reused for the contract portal inbox as well.
CREATE OR REPLACE FUNCTION public.contract_portal_upload_allowed(_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_f text[];
  v_invite uuid;
  v_ip text;
  v_minute timestamptz := date_trunc('minute', now());
  v_hour timestamptz := date_trunc('hour', now());
BEGIN
  IF _name IS NULL THEN RETURN false; END IF;
  v_f := storage.foldername(_name);

  IF array_length(v_f, 1) <> 2 OR v_f[1] <> 'portal-inbox' THEN
    RETURN false;
  END IF;
  IF v_f[2] !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  v_invite := v_f[2]::uuid;

  IF lower(regexp_replace(_name, '^.*\.', '')) <> ALL (
       ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif']) THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
        SELECT 1 FROM public.contract_portal_invites i
         WHERE i.id = v_invite
           AND i.revoked_at IS NULL
           AND i.completed_at IS NULL
           AND i.expires_at > now()) THEN
    RETURN false;
  END IF;

  -- Per-invite ceilings (unchanged behaviour for a legitimate client).
  IF (SELECT count(*) FROM storage.objects o
        WHERE o.bucket_id = 'crm-portal-inbox'
          AND (storage.foldername(o.name))[1] = 'portal-inbox'
          AND (storage.foldername(o.name))[2] = v_invite::text) >= 10 THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM storage.objects o
        WHERE o.bucket_id = 'crm-portal-inbox'
          AND (storage.foldername(o.name))[1] = 'portal-inbox'
          AND (storage.foldername(o.name))[2] = v_invite::text
          AND o.created_at > now() - interval '1 hour') >= 20 THEN
    RETURN false;
  END IF;

  -- Client and global ceilings: rotating invite identifiers can no longer be
  -- used to bypass the per-invite caps and flood the bucket.
  v_ip := public.rec_public_client_fingerprint();
  IF NOT public.rec_public_upload_bump('portal:ip:' || v_ip || ':minute', v_minute, 8) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('portal:ip:' || v_ip || ':hour', v_hour, 30) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('portal:global:minute', v_minute, 40) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('portal:global:hour', v_hour, 200) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

-- 2. Unclaimed sessions and their orphaned objects are actually removed.
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

  -- Files uploaded against a session that was never claimed by an application
  -- are junk after the grace window; remove them so abuse cannot accumulate.
  DELETE FROM storage.objects o
   WHERE o.bucket_id = 'recruitment-applications'
     AND EXISTS (
       SELECT 1 FROM public.rec_public_upload_sessions s
        WHERE s.claimed_application_id IS NULL
          AND s.expires_at < now() - interval '24 hours'
          AND o.name LIKE 'public-applications/%/' || s.id::text || '/%');

  DELETE FROM public.rec_public_upload_sessions s
   WHERE s.claimed_application_id IS NULL
     AND s.expires_at < now() - interval '24 hours'
     AND NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'recruitment-applications'
          AND o.name LIKE 'public-applications/%/' || s.id::text || '/%'
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Portal inbox files belonging to invites that are revoked, completed long
  -- ago, or expired past the grace window are equally junk.
  DELETE FROM storage.objects o
   WHERE o.bucket_id = 'crm-portal-inbox'
     AND (storage.foldername(o.name))[1] = 'portal-inbox'
     AND o.created_at < now() - interval '24 hours'
     AND NOT EXISTS (
       SELECT 1 FROM public.contract_portal_invites i
        WHERE i.id::text = (storage.foldername(o.name))[2]);

  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_public_upload_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_public_upload_sessions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_portal_upload_allowed(text) TO anon, authenticated, service_role;