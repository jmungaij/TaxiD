ALTER FUNCTION public.enqueue_analytics_export()   SET search_path = public, extensions;
ALTER FUNCTION public.tg_hash_chain()              SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.training_issue_certificate(uuid, uuid, numeric) SET search_path = public, extensions;