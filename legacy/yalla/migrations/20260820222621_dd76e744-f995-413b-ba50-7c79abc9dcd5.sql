CREATE OR REPLACE FUNCTION public.intern_certify_authorised()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.intern_programme_authority(auth.uid())
      OR (auth.uid() IS NULL AND current_user IN ('postgres','service_role','supabase_admin'));
$$;
REVOKE ALL ON FUNCTION public.intern_certify_authorised() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intern_certify_authorised() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_certify_suite() TO service_role, postgres;