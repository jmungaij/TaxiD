
-- Inside a SECURITY DEFINER routine current_user is the owner, so it cannot be
-- used to identify the caller. Read the request role from the JWT claims and
-- fall back to session_user for direct connections.
CREATE OR REPLACE FUNCTION public.doc_forensics_authorized()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  BEGIN
    v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
  EXCEPTION WHEN others THEN v_role := '';
  END;

  IF v_role = 'service_role' OR session_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN true;
  END IF;

  RETURN auth.uid() IS NOT NULL AND public.has_any_role(
    auth.uid(),
    ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]
  );
END;
$$;
REVOKE ALL ON FUNCTION public.doc_forensics_authorized() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.doc_forensics_authorized() TO authenticated, service_role;
