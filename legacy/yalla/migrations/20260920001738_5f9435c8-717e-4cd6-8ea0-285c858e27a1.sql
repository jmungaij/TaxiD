CREATE OR REPLACE FUNCTION public.is_commercial_staff()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR public.has_role(auth.uid(), 'finance_admin'::app_role)
      OR public.has_role(auth.uid(), 'operations_admin'::app_role)
      OR public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.crm.manage')
    , false)
$function$;