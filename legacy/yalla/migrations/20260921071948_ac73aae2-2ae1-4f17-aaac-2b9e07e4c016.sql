REVOKE EXECUTE ON FUNCTION public.public_upload_volume_evaluate(text,text,timestamptz,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_upload_volume_sweep() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_public_upload_volume_watch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_upload_scope_ceiling(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_upload_volume_evaluate(text,text,timestamptz,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_upload_volume_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_public_upload_volume_watch() TO service_role;
GRANT EXECUTE ON FUNCTION public.public_upload_scope_ceiling(text,text) TO authenticated, service_role;
