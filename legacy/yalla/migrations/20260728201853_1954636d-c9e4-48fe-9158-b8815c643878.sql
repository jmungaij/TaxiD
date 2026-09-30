CREATE OR REPLACE FUNCTION public.is_charter_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('admin','super_admin','operations_admin','fleet_owner','pricing_manager')
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_charter_staff(uuid) FROM anon;

CREATE POLICY "Charter staff can read evidence docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'charter-evidence' AND public.is_charter_staff(auth.uid()));

CREATE POLICY "Charter staff can upload evidence docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'charter-evidence' AND public.is_charter_staff(auth.uid()));

CREATE POLICY "Charter staff can update evidence docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'charter-evidence' AND public.is_charter_staff(auth.uid()));

CREATE POLICY "Charter staff can delete evidence docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'charter-evidence' AND public.is_charter_staff(auth.uid()));