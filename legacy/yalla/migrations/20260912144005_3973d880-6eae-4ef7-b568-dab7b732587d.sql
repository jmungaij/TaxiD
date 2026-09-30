CREATE TABLE IF NOT EXISTS public.rec_public_upload_counters (
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, window_start)
);

GRANT ALL ON public.rec_public_upload_counters TO service_role;
ALTER TABLE public.rec_public_upload_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read public upload counters"
  ON public.rec_public_upload_counters
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.rec_public_upload_counters TO authenticated;

COMMENT ON TABLE public.rec_public_upload_counters IS
  'Atomic throttle counters for anonymous recruitment document uploads. Written only by public.rec_public_upload_reserve (SECURITY DEFINER); no anon grants.';

CREATE OR REPLACE FUNCTION public.rec_public_upload_reserve(_slug text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scopes text[];
  v_windows timestamptz[];
  v_limits integer[];
  v_hits integer;
  i integer;
BEGIN
  IF _slug IS NULL OR length(_slug) = 0 OR length(_slug) > 200 THEN
    RETURN false;
  END IF;

  v_scopes  := ARRAY['slug:' || _slug || ':minute', 'slug:' || _slug || ':hour', 'global:minute', 'global:hour'];
  v_windows := ARRAY[date_trunc('minute', now()), date_trunc('hour', now()), date_trunc('minute', now()), date_trunc('hour', now())]::timestamptz[];
  v_limits  := ARRAY[15, 60, 60, 300];

  FOR i IN 1 .. array_length(v_scopes, 1) LOOP
    INSERT INTO public.rec_public_upload_counters AS c (scope, window_start, hits)
    VALUES (v_scopes[i], v_windows[i], 1)
    ON CONFLICT (scope, window_start)
    DO UPDATE SET hits = c.hits + 1, updated_at = now()
    RETURNING c.hits INTO v_hits;

    IF v_hits > v_limits[i] THEN
      RETURN false;
    END IF;
  END LOOP;

  DELETE FROM public.rec_public_upload_counters
   WHERE window_start < now() - interval '2 days';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_upload_reserve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_upload_reserve(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;

CREATE POLICY "public applicants upload recruitment docs"
  ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'recruitment-applications'
    AND (storage.foldername(name))[1] = 'public-applications'
    AND array_length(storage.foldername(name), 1) = 2
    AND public.rec_public_slug_is_open((storage.foldername(name))[2])
    AND lower(regexp_replace(name, '^.*\.', '')) = ANY (ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'])
    AND public.rec_public_upload_reserve((storage.foldername(name))[2])
  );
