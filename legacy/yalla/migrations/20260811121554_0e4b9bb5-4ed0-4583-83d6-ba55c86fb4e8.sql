-- Staff document store access. Files are stored under <staff_id>/<file>.
CREATE OR REPLACE FUNCTION public.owns_staff_folder(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members s
    WHERE s.user_id = auth.uid()
      AND s.id::text = split_part(_path, '/', 1)
  );
$$;

CREATE POLICY "admins manage staff documents storage"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'staff-documents' AND public.is_platform_admin())
WITH CHECK (bucket_id = 'staff-documents' AND public.is_platform_admin());

CREATE POLICY "employees read own staff documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'staff-documents' AND public.owns_staff_folder(name));

CREATE POLICY "employees upload own staff documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'staff-documents' AND public.owns_staff_folder(name));

-- tighten the audit guard function flagged by the linter
CREATE OR REPLACE FUNCTION public.block_org_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'org_audit_log is append-only'; END; $$;
