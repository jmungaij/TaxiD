
-- Trigger function: not meant to be called directly
REVOKE EXECUTE ON FUNCTION public.enforce_mpesa_user_immutable_fields() FROM PUBLIC, anon, authenticated;

-- Role helper: used inside policies (runs as owner regardless); deny direct callers
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
