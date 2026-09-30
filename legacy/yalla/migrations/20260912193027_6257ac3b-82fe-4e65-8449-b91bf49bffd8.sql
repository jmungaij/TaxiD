-- Isolate anonymous client uploads in their own bucket so they are never written
-- into the bucket staff treat as trusted internal CRM storage.

-- 1. Rate/shape guard now counts objects in the isolated bucket.
CREATE OR REPLACE FUNCTION public.contract_portal_upload_allowed(_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
              WHERE o.bucket_id = 'crm-portal-inbox'
                AND (storage.foldername(o.name))[1] = 'portal-inbox'
                AND (storage.foldername(o.name))[2] = s.invite_id::text) < 10
       AND (SELECT count(*) FROM storage.objects o
              WHERE o.bucket_id = 'crm-portal-inbox'
                AND (storage.foldername(o.name))[1] = 'portal-inbox'
                AND (storage.foldername(o.name))[2] = s.invite_id::text
                AND o.created_at > now() - interval '1 hour') < 20
      FROM ok_shape s
  ), false);
$function$;

-- 2. Anonymous uploads move to the isolated bucket; the shared CRM bucket no
--    longer accepts unauthenticated writes at all.
DROP POLICY IF EXISTS "portal inbox anonymous upload" ON storage.objects;

CREATE POLICY "portal inbox isolated anonymous upload"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'crm-portal-inbox'
  AND (storage.foldername(name))[1] = 'portal-inbox'
  AND public.contract_portal_upload_allowed(name)
  AND ((metadata IS NULL) OR ((metadata ->> 'mimetype') IS NULL) OR (lower(metadata ->> 'mimetype') = ANY (ARRAY[
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png','image/jpeg','image/webp','image/heic','image/heif'])))
  AND ((metadata IS NULL) OR ((metadata ->> 'size') IS NULL) OR ((metadata ->> 'size')::bigint <= 26214400))
);

-- Staff may read what clients dropped; no client-side update or delete exists.
CREATE POLICY "Staff can read portal inbox files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'crm-portal-inbox' AND public.is_staff_portal_member(auth.uid()));

-- 3. The portal RPCs now name the isolated bucket.
CREATE OR REPLACE FUNCTION public.contract_portal_open(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE inv public.contract_portal_invites; c public.commercial_contract_instances;
BEGIN
  IF coalesce(length(trim(coalesce(_token, ''))), 0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  END IF;
  SELECT * INTO inv FROM public.contract_portal_invites
   WHERE token_hash = encode(sha256(convert_to(trim(_token), 'utf8')), 'hex');
  IF inv.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF inv.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = inv.contract_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;

  UPDATE public.contract_portal_invites SET opened_at = coalesce(opened_at, now()) WHERE id = inv.id;

  RETURN jsonb_build_object(
    'ok', true,
    'completed', inv.completed_at IS NOT NULL,
    'completed_at', inv.completed_at,
    'recipient_name', inv.recipient_name,
    'recipient_email', inv.recipient_email,
    'upload_bucket', 'crm-portal-inbox',
    'upload_prefix', 'portal-inbox/' || inv.id::text || '/',
    'contract', jsonb_build_object(
      'contract_number', c.contract_number,
      'title', c.title,
      'customer', c.customer_legal_name,
      'status', c.status,
      'value_amount', c.value_amount,
      'currency', c.currency,
      'value_type', c.value_type,
      'payment_terms', c.payment_terms,
      'term_start', c.term_start,
      'term_end', c.term_end,
      'effective_date', c.effective_date,
      'company_signatory', c.company_signatory
    ));
END $function$;