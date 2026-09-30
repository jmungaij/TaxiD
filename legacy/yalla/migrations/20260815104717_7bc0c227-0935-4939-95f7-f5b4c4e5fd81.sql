CREATE OR REPLACE FUNCTION public.ap360_capabilities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_admin boolean;
  v_approver boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false, 'staff', false, 'can_view', false,
      'can_edit_draft', false, 'can_submit', false, 'can_approve', false,
      'can_reject', false, 'can_publish', false, 'can_archive', false,
      'can_compare', false, 'roles', '[]'::jsonb,
      'reason', 'Sign in with a Yalla staff account to view pricing governance.');
  END IF;

  v_staff := public.is_staff_portal_member(v_uid);
  v_admin := public.is_platform_admin();
  v_approver := public.has_any_role(v_uid, ARRAY['super_admin'::app_role,'finance_admin'::app_role]);

  RETURN jsonb_build_object(
    'authenticated', true,
    'staff', v_staff,
    'can_view', v_staff,
    'can_edit_draft', v_admin,
    'can_submit', v_admin,
    'can_approve', v_approver,
    'can_reject', v_approver,
    'can_publish', v_approver,
    'can_archive', v_approver,
    'can_compare', v_staff,
    'roles', COALESCE((SELECT jsonb_agg(role::text ORDER BY role::text)
                       FROM public.user_roles WHERE user_id = v_uid), '[]'::jsonb),
    'reason', CASE
      WHEN NOT v_staff THEN 'Asset Pricing 360 is restricted to Yalla staff portal members.'
      WHEN NOT v_admin THEN 'Viewing only — editing and submitting pricing requires a platform administrator role.'
      WHEN NOT v_approver THEN 'You can prepare and submit pricing; approval and publication require super admin or finance admin.'
      ELSE 'Full pricing governance authority.'
    END);
END $function$;

REVOKE ALL ON FUNCTION public.ap360_capabilities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ap360_capabilities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ap360_capabilities() TO service_role;