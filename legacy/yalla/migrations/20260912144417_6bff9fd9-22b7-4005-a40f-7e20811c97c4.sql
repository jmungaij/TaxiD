CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'super_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.staff_role_permissions srp ON srp.role = ur.role
      WHERE ur.user_id = auth.uid() AND srp.permission_key = _perm
    ),
    false
  );
$function$;

COMMENT ON FUNCTION public.has_staff_permission(text) IS
  'Shared RLS authority helper. Deny-by-default: always returns false (never NULL) for anonymous callers.';

CREATE OR REPLACE FUNCTION public.rls_helper_integrity()
RETURNS TABLE (
  helper_name text,
  signature text,
  is_definer boolean,
  has_fixed_search_path boolean,
  is_mutating boolean,
  roles text[],
  denies_unknown_actor boolean,
  definition_md5 text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_deny boolean;
BEGIN
  IF NOT (
    coalesce(auth.role()::text, '') = 'service_role'
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.prosecdef,
           p.provolatile,
           coalesce(array_to_string(p.proconfig, ','), '') AS cfg,
           md5(pg_get_functiondef(p.oid)) AS def_md5
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'has_role', 'has_any_role', 'has_staff_permission', 'require_staff',
         'has_corporate_role', 'has_governance_access',
         'is_platform_admin', 'is_platform_staff', 'is_staff_member'
       )
     ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
  LOOP
    v_deny := NULL;
    BEGIN
      IF r.proname = 'has_role' THEN
        SELECT public.has_role(NULL::uuid, 'admin'::app_role) IS NOT TRUE INTO v_deny;
      ELSIF r.proname = 'has_any_role' THEN
        SELECT public.has_any_role(NULL::uuid, ARRAY['admin']::app_role[]) IS NOT TRUE INTO v_deny;
      ELSIF r.proname = 'is_platform_staff' THEN
        SELECT public.is_platform_staff(NULL::uuid) IS NOT TRUE INTO v_deny;
      ELSIF r.proname = 'has_governance_access' THEN
        SELECT public.has_governance_access(NULL::uuid, '__none__', '__none__') IS NOT TRUE INTO v_deny;
      END IF;
    EXCEPTION WHEN others THEN
      v_deny := NULL;
    END;

    helper_name := r.proname;
    signature := r.args;
    is_definer := r.prosecdef;
    has_fixed_search_path := r.cfg LIKE '%search_path=%';
    is_mutating := r.provolatile = 'v';
    roles := ARRAY_REMOVE(ARRAY[
      CASE WHEN has_function_privilege('anon', r.oid, 'EXECUTE') THEN 'anon' END,
      CASE WHEN has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN 'authenticated' END,
      CASE WHEN has_function_privilege('service_role', r.oid, 'EXECUTE') THEN 'service_role' END
    ], NULL);
    denies_unknown_actor := v_deny;
    definition_md5 := r.def_md5;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.rls_helper_integrity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_helper_integrity() TO authenticated, service_role;
