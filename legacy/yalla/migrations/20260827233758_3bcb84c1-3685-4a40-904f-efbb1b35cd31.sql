REVOKE ALL ON FUNCTION public.legal_record_event(text,text,uuid,text,text,text,text,text,boolean,jsonb,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legal_record_event(text,text,uuid,text,text,text,text,text,boolean,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.legal_expiry_horizon() FROM anon;
REVOKE ALL ON FUNCTION public.legal_readiness_matrix() FROM anon;

REVOKE ALL ON FUNCTION public._legal_events_append_only() FROM PUBLIC, anon, authenticated;