-- 1. Upload session register (server-issued binding between an anonymous
--    uploader and one open vacancy). Accessed only through definer functions.
CREATE TABLE IF NOT EXISTS public.rec_public_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_slug text NOT NULL,
  file_count integer NOT NULL DEFAULT 0,
  claimed_application_id uuid,
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rec_public_upload_sessions_slug_idx
  ON public.rec_public_upload_sessions (vacancy_slug, created_at DESC);

GRANT ALL ON public.rec_public_upload_sessions TO service_role;
ALTER TABLE public.rec_public_upload_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read public upload sessions" ON public.rec_public_upload_sessions;
CREATE POLICY "Staff read public upload sessions"
  ON public.rec_public_upload_sessions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
GRANT SELECT ON public.rec_public_upload_sessions TO authenticated;

-- 2. Issue a session. Only for a currently open vacancy, rate limited.
CREATE OR REPLACE FUNCTION public.rec_public_upload_session_open(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hits integer;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_slug IS NULL OR length(p_slug) = 0 OR length(p_slug) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SLUG');
  END IF;

  IF NOT public.rec_public_slug_is_open(p_slug) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VACANCY_NOT_OPEN');
  END IF;

  -- session issuance ceiling: 30/hour per vacancy, 200/hour globally
  INSERT INTO public.rec_public_upload_counters AS c (scope, window_start, hits)
  VALUES ('session:' || p_slug || ':hour', date_trunc('hour', now()), 1)
  ON CONFLICT (scope, window_start) DO UPDATE SET hits = c.hits + 1, updated_at = now()
  RETURNING c.hits INTO v_hits;
  IF v_hits > 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.rec_public_upload_counters AS c (scope, window_start, hits)
  VALUES ('session:global:hour', date_trunc('hour', now()), 1)
  ON CONFLICT (scope, window_start) DO UPDATE SET hits = c.hits + 1, updated_at = now()
  RETURNING c.hits INTO v_hits;
  IF v_hits > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.rec_public_upload_sessions (vacancy_slug)
  VALUES (p_slug)
  RETURNING id, expires_at INTO v_id, v_expires;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_id,
    'prefix', 'public-applications/' || p_slug || '/' || v_id::text || '/',
    'expires_at', v_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_upload_session_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_upload_session_open(text) TO anon, authenticated, service_role;

-- 3. Per-upload authorisation used by the storage policy.
CREATE OR REPLACE FUNCTION public.rec_public_upload_session_allow(p_slug text, p_session text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_row public.rec_public_upload_sessions;
BEGIN
  IF p_slug IS NULL OR p_session IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    v_id := p_session::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  SELECT * INTO v_row
    FROM public.rec_public_upload_sessions
   WHERE id = v_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN RETURN false; END IF;
  IF v_row.vacancy_slug <> p_slug THEN RETURN false; END IF;
  IF v_row.expires_at <= now() THEN RETURN false; END IF;
  IF v_row.claimed_application_id IS NOT NULL THEN RETURN false; END IF;
  IF v_row.file_count >= 10 THEN RETURN false; END IF;

  UPDATE public.rec_public_upload_sessions
     SET file_count = file_count + 1, updated_at = now()
   WHERE id = v_id;

  RETURN public.rec_public_upload_reserve(p_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_upload_session_allow(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_upload_session_allow(text, text) TO anon, authenticated, service_role;

-- 4. Storage policy: uploads must sit inside a live session folder.
DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;
CREATE POLICY "public applicants upload recruitment docs"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'recruitment-applications'
  AND (storage.foldername(name))[1] = 'public-applications'
  AND array_length(storage.foldername(name), 1) = 3
  AND lower(regexp_replace(name, '^.*\.', '')) = ANY (ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'])
  AND (
    metadata IS NULL OR (metadata ->> 'mimetype') IS NULL
    OR lower(metadata ->> 'mimetype') = ANY (ARRAY[
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png','image/jpeg','image/webp','image/heic','image/heif','text/plain'])
  )
  AND (
    metadata IS NULL OR (metadata ->> 'size') IS NULL
    OR (metadata ->> 'size')::bigint <= 10485760
  )
  AND public.rec_public_upload_session_allow(
        (storage.foldername(name))[2],
        (storage.foldername(name))[3])
);

-- 5. A submitted application claims its upload session.
CREATE OR REPLACE FUNCTION public.rec_claim_public_upload_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parts text[];
  v_id uuid;
BEGIN
  IF NEW.storage_path IS NULL THEN RETURN NEW; END IF;
  v_parts := string_to_array(NEW.storage_path, '/');
  IF array_length(v_parts, 1) < 4 OR v_parts[1] <> 'public-applications' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_id := v_parts[3]::uuid;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  UPDATE public.rec_public_upload_sessions
     SET claimed_application_id = COALESCE(NEW.application_id, claimed_application_id),
         claimed_at = COALESCE(claimed_at, now()),
         updated_at = now()
   WHERE id = v_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_claim_public_upload_session ON public.rec_candidate_documents;
CREATE TRIGGER trg_rec_claim_public_upload_session
AFTER INSERT ON public.rec_candidate_documents
FOR EACH ROW EXECUTE FUNCTION public.rec_claim_public_upload_session();

-- 6. Housekeeping: drop expired, unclaimed session records with no stored files.
CREATE OR REPLACE FUNCTION public.purge_expired_public_upload_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'storage'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.purge_expired_public_upload_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_public_upload_sessions() TO service_role;