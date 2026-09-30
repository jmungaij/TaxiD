REVOKE EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.validate_rls_definer_grants() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_public_read_violations(text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_table_columns(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_table_columns(jsonb) FROM authenticated;