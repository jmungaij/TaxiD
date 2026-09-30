REVOKE ALL ON FUNCTION public.ct_emit_command_event(text,text,uuid,jsonb,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.ct_emit_command_event(text,text,uuid,jsonb,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.ct_emit_command_event(text,text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ct_emit_command_event(text,text,uuid,jsonb,text,text) TO service_role;