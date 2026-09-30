UPDATE public.ai_model_registry
   SET active = true, configured = true,
       notes = 'Deterministic internal reasoning path (no LLM): recommendations are derived from the authoritative dispatch matching engine and fleet capacity records.',
       updated_at = now()
 WHERE code = 'logistics-ops-rules';

UPDATE public.ai_agents SET enabled = true, updated_at = now() WHERE code = 'CAPACITY';

UPDATE public.ai_agent_versions v SET active = true
 WHERE v.agent_id = (SELECT id FROM public.ai_agents WHERE code = 'CAPACITY') AND v.version = 1;