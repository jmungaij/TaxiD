CREATE OR REPLACE FUNCTION public.partner_wl_owns_evidence_object(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid;
BEGIN
  BEGIN
    v_partner := (storage.foldername(_name))[1]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN public.partner_api_is_member(v_partner) OR public.has_role(auth.uid(),'admin');
END;
$$;

CREATE OR REPLACE FUNCTION public.partner_wl_manages_evidence_object(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_partner uuid;
BEGIN
  BEGIN
    v_partner := (storage.foldername(_name))[1]::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN public.partner_api_is_manager(v_partner) OR public.has_role(auth.uid(),'admin');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_wl_owns_evidence_object(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_wl_manages_evidence_object(text) FROM anon;

DROP POLICY IF EXISTS "wl evidence read own partner files" ON storage.objects;
CREATE POLICY "wl evidence read own partner files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'partner-wl-evidence' AND public.partner_wl_owns_evidence_object(name));

DROP POLICY IF EXISTS "wl evidence upload by managers" ON storage.objects;
CREATE POLICY "wl evidence upload by managers" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'partner-wl-evidence' AND public.partner_wl_manages_evidence_object(name));