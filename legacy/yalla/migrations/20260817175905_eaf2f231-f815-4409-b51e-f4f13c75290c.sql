-- Self-test: hardened guard must repair grants after an ALTER FUNCTION.
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM anon;
ALTER FUNCTION public.has_any_role(uuid, app_role[]) STABLE;

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.has_any_role(uuid, app_role[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'hardened guard failed to repair grants on ALTER FUNCTION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_grant_guard_events
    WHERE event_type = 'GRANT_APPLIED'
      AND command_tag = 'ALTER FUNCTION'
      AND function_signature LIKE 'has_any_role(%'
  ) THEN
    RAISE EXCEPTION 'guard did not record the repair event';
  END IF;
END $$;