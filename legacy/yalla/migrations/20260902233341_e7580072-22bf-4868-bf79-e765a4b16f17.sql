REVOKE ALL ON FUNCTION public._freight_hub_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._freight_hub_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._freight_hub_append_only() TO service_role;
GRANT EXECUTE ON FUNCTION public._freight_hub_touch() TO service_role;