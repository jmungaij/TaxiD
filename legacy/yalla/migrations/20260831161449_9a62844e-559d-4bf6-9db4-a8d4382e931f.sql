CREATE OR REPLACE FUNCTION public.rec_failure_reconciliation(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hours integer := greatest(1, least(coalesce(p_hours, 24), 720));
  v_since timestamptz;
  v_metrics jsonb;
  v_attempts jsonb;
  v_identity jsonb;
BEGIN
  PERFORM public.require_staff('staff.recruitment.read');
  v_since := now() - make_interval(hours => v_hours);

  SELECT jsonb_build_object(
    'total_requests', count(*),
    'successful', count(*) FILTER (WHERE outcome IN ('success','empty')),
    'error_events', count(*) FILTER (WHERE outcome = 'error'),
    'by_class', coalesce((
      SELECT jsonb_object_agg(cls, n) FROM (
        SELECT coalesce(public.rec_apply_failure_class(error_message), 'TECHNICAL_FAILURE') AS cls, count(*) AS n
        FROM public.rec_public_api_metrics
        WHERE created_at >= v_since AND outcome = 'error'
        GROUP BY 1) q), '{}'::jsonb),
    'by_operation', coalesce((
      SELECT jsonb_object_agg(op, n) FROM (
        SELECT operation AS op, count(*) AS n
        FROM public.rec_public_api_metrics
        WHERE created_at >= v_since AND outcome = 'error'
        GROUP BY 1) q), '{}'::jsonb)
  ) INTO v_metrics
  FROM public.rec_public_api_metrics
  WHERE created_at >= v_since;

  SELECT jsonb_build_object(
    'refusal_events', count(*),
    'business_validation', count(*) FILTER (WHERE failure_class = 'BUSINESS_VALIDATION'),
    'candidate_action_required', count(*) FILTER (WHERE failure_class = 'CANDIDATE_ACTION_REQUIRED'),
    'technical_failures', count(*) FILTER (WHERE failure_class = 'TECHNICAL_FAILURE'),
    'security_failures', count(*) FILTER (WHERE failure_class = 'SECURITY_FAILURE'),
    'other', count(*) FILTER (WHERE failure_class IS NULL
      OR failure_class NOT IN ('BUSINESS_VALIDATION','CANDIDATE_ACTION_REQUIRED','TECHNICAL_FAILURE','SECURITY_FAILURE')),
    'by_error_code', coalesce((
      SELECT jsonb_object_agg(error_code, n) FROM (
        SELECT coalesce(error_code, 'UNCLASSIFIED') AS error_code, count(*) AS n
        FROM public.rec_public_apply_attempts
        WHERE created_at >= v_since AND outcome = 'rejected'
        GROUP BY 1) q), '{}'::jsonb),
    'by_build', coalesce((
      SELECT jsonb_object_agg(build, n) FROM (
        SELECT coalesce(frontend_build_id, 'UNDECLARED') AS build, count(*) AS n
        FROM public.rec_public_apply_attempts
        WHERE created_at >= v_since AND outcome = 'rejected'
        GROUP BY 1) q), '{}'::jsonb)
  ) INTO v_attempts
  FROM public.rec_public_apply_attempts
  WHERE created_at >= v_since AND outcome = 'rejected';

  SELECT jsonb_build_object(
    'unique_candidates', count(DISTINCT email),
    'unique_vacancies', count(DISTINCT vacancy_slug),
    'unique_sessions', count(DISTINCT coalesce(session_ref, email)),
    'total_attempts', count(*),
    'remediation_cases', (SELECT count(*) FROM public.rec_application_remediation_cases WHERE last_failed_at >= v_since)
  ) INTO v_identity
  FROM public.rec_public_apply_attempts
  WHERE created_at >= v_since AND outcome = 'rejected';

  RETURN jsonb_build_object(
    'window_hours', v_hours,
    'since', v_since,
    'computed_at', now(),
    'api', v_metrics,
    'refusals', v_attempts,
    'identity', v_identity);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_failure_reconciliation(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_failure_reconciliation(integer) TO authenticated;