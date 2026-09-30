REVOKE ALL ON FUNCTION public.lg_can_approve(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lg_can_approve(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public._lg_dossier_notify() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lg_touch_map() FROM PUBLIC, anon, authenticated;
