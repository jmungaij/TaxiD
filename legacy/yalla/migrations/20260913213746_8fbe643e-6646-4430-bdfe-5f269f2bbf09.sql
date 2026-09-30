ALTER FUNCTION public.identity_probe_run(text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.identity_probe_run(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_probe_run(text) TO service_role;