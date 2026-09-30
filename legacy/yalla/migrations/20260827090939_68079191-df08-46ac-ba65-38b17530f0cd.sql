REVOKE ALL ON FUNCTION public._logistics_service_config_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._logistics_service_config_audit() TO service_role;