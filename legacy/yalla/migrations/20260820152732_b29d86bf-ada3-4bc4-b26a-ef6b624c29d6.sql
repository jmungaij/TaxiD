-- 1) Chart of accounts: restrict reads to finance/admin roles
DROP POLICY IF EXISTS coa_read_authenticated ON public.chart_of_accounts;
CREATE POLICY coa_read_finance_admin ON public.chart_of_accounts
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role]));

-- 2) Internal architecture registries: staff/admin reads only
DROP POLICY IF EXISTS "modules readable" ON public.system_modules;
CREATE POLICY modules_read_admin ON public.system_modules
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

DROP POLICY IF EXISTS "services readable" ON public.service_registry;
CREATE POLICY services_read_admin ON public.service_registry
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

DROP POLICY IF EXISTS "features readable" ON public.feature_registry;
CREATE POLICY features_read_admin ON public.feature_registry
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

DROP POLICY IF EXISTS "deps readable" ON public.dependency_registry;
CREATE POLICY deps_read_admin ON public.dependency_registry
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

-- 3) Recruitment public uploads: bind each upload to a genuinely open vacancy slug
CREATE OR REPLACE FUNCTION public.rec_public_slug_is_open(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.rec_public_vacancies() pv WHERE pv.public_slug = p_slug);
$$;

REVOKE ALL ON FUNCTION public.rec_public_slug_is_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_slug_is_open(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;
CREATE POLICY "public applicants upload recruitment docs" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'recruitment-applications'
  AND (storage.foldername(name))[1] = 'public-applications'
  AND array_length(storage.foldername(name), 1) = 2
  AND public.rec_public_slug_is_open((storage.foldername(name))[2])
  AND lower(regexp_replace(name, '^.*\.', '')) IN
      ('pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt')
);