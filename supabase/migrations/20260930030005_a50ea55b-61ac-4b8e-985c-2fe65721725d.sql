CREATE OR REPLACE FUNCTION public.has_recon_permission(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.role = ANY (public.recon_permission_roles(_perm)));
$$;
UPDATE public._restore_log SET ok = true, err = null WHERE fn = 'yp_is_finance';