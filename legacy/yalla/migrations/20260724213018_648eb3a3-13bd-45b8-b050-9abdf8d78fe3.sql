
CREATE OR REPLACE FUNCTION public.record_edge_function_invocation(
  p_function_name text,
  p_status_code int,
  p_latency_ms int,
  p_deployment_id text,
  p_ts timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.edge_function_registry AS r (
    function_name, deployment_id, first_seen_at, last_invocation_at,
    last_success_at, last_failure_at,
    invocation_count, success_count, failure_count, avg_latency_ms, health_status, updated_at
  ) VALUES (
    p_function_name, p_deployment_id, p_ts, p_ts,
    CASE WHEN p_status_code < 400 THEN p_ts ELSE NULL END,
    CASE WHEN p_status_code >= 400 THEN p_ts ELSE NULL END,
    1,
    CASE WHEN p_status_code < 400 THEN 1 ELSE 0 END,
    CASE WHEN p_status_code >= 400 THEN 1 ELSE 0 END,
    p_latency_ms,
    CASE WHEN p_status_code >= 500 THEN 'degraded' WHEN p_status_code < 400 THEN 'healthy' ELSE 'degraded' END,
    p_ts
  )
  ON CONFLICT (function_name) DO UPDATE SET
    deployment_id = EXCLUDED.deployment_id,
    last_invocation_at = EXCLUDED.last_invocation_at,
    last_success_at = COALESCE(EXCLUDED.last_success_at, r.last_success_at),
    last_failure_at = COALESCE(EXCLUDED.last_failure_at, r.last_failure_at),
    invocation_count = COALESCE(r.invocation_count, 0) + 1,
    success_count = COALESCE(r.success_count, 0) + CASE WHEN p_status_code < 400 THEN 1 ELSE 0 END,
    failure_count = COALESCE(r.failure_count, 0) + CASE WHEN p_status_code >= 400 THEN 1 ELSE 0 END,
    avg_latency_ms = ((COALESCE(r.avg_latency_ms, 0) * COALESCE(r.invocation_count, 0)) + p_latency_ms) / (COALESCE(r.invocation_count, 0) + 1),
    health_status = CASE
      WHEN p_status_code >= 500 THEN 'degraded'
      WHEN p_status_code < 400 AND (COALESCE(r.failure_count, 0) = 0 OR (COALESCE(r.success_count, 0) + 1)::numeric / NULLIF(COALESCE(r.invocation_count, 0) + 1, 0) >= 0.99) THEN 'healthy'
      ELSE COALESCE(r.health_status, 'degraded')
    END,
    updated_at = p_ts;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_edge_function_invocation(text, int, int, text, timestamptz) TO service_role;
