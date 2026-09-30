ALTER VIEW public.v_ai_pipeline_health SET (security_invoker = true);
ALTER VIEW public.v_ai_non_action_register SET (security_invoker = true);

REVOKE ALL ON FUNCTION public._ai_is_worker() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_context_hash(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._ai_context_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_finding_record(text,text,text,jsonb,numeric,text,uuid,text,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_context_assemble(uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_model_invocation_record(text,text,text,text,uuid,uuid,integer,integer,integer,numeric,numeric,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_recommendation_ground(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_non_action_record(text,text,jsonb,uuid,uuid,uuid,jsonb,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_context_revalidate(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._ai_is_worker() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_context_hash(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_finding_record(text,text,text,jsonb,numeric,text,uuid,text,uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_context_assemble(uuid,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_model_invocation_record(text,text,text,text,uuid,uuid,integer,integer,integer,numeric,numeric,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_recommendation_ground(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_non_action_record(text,text,jsonb,uuid,uuid,uuid,jsonb,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_context_revalidate(uuid) TO authenticated, service_role;