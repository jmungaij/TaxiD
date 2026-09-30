REVOKE EXECUTE ON FUNCTION public.is_commercial_staff() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_commercial_staff() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.next_commercial_action_id() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.next_commercial_action_id() TO authenticated, service_role;