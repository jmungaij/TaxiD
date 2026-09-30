-- Strict-boolean hardening: these authority helpers could return NULL
-- (unknown) for a signed-in non-staff caller. Callers use `IF NOT guard()`,
-- where NULL is not TRUE and the guard silently passed. Every helper below now
-- returns a definite true/false, denying anonymous callers explicitly.

CREATE OR REPLACE FUNCTION public._ai_is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(current_setting('role', true) = 'service_role', false)
      OR coalesce(auth.role()::text, '') = 'service_role'
      OR session_user::text IN ('postgres', 'supabase_admin', 'service_role');
$function$;

CREATE OR REPLACE FUNCTION public._driver_finance_staff()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR (
      auth.uid() IS NOT NULL AND (
        public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])
        OR public.has_staff_permission('staff.finance.charge.manage')
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public._invoice_can_read(_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR (
      auth.uid() IS NOT NULL AND (
        public.is_platform_admin()
        OR public.has_staff_permission('staff.commercial.read')
        OR (_owner IS NOT NULL AND public.is_my_staff_record(_owner))
      )
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public._invoice_can_write(_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR (
      auth.uid() IS NOT NULL AND (
        public.is_platform_admin()
        OR public.has_staff_permission('staff.commercial.write')
        OR (_owner IS NOT NULL AND public.is_my_staff_record(_owner))
      )
    ),
    false
  );
$function$;