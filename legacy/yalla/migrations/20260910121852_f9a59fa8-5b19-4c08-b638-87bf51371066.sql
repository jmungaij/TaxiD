CREATE OR REPLACE FUNCTION public.capacity_photo_is_published(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.provider_capacity c
    WHERE c.status = 'PUBLISHED'
      AND _path = ANY (coalesce(c.photo_paths, '{}'::text[]))
  );
$$;

REVOKE ALL ON FUNCTION public.capacity_photo_is_published(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capacity_photo_is_published(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "capacity photos readable by signed-in users" ON storage.objects;

CREATE POLICY "capacity photos readable by owner staff or when published"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'capacity-photos'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.capacity_can_approve(auth.uid())
    OR public.capacity_photo_is_published(name)
  )
);