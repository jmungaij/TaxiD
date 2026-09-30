CREATE OR REPLACE FUNCTION public.rec_publication_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_public_ids uuid[];
  v_mismatches jsonb;
  v_latency jsonb;
  v_uploads jsonb;
  v_failures jsonb;
  v_attempts jsonb;
  v_classes jsonb;
  v_remediation jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not authorised to read recruitment publication health';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_public_ids FROM public.rec_public_vacancies();

  SELECT coalesce(jsonb_agg(m ORDER BY m->>'severity', m->>'vacancy_no'), '[]'::jsonb) INTO v_mismatches
  FROM (
    SELECT jsonb_build_object(
      'vacancy_id', v.id, 'vacancy_no', v.vacancy_no, 'title', v.title,
      'approval_status', v.approval_status, 'publication_status', v.publication_status,
      'status', v.status, 'public_slug', v.public_slug, 'published_at', v.published_at,
      'visible_publicly', v.id = ANY(v_public_ids),
      'issue', CASE
        WHEN v.publication_status = 'published' AND v.public_slug IS NULL THEN 'published_without_public_slug'
        WHEN v.publication_status = 'published' AND v.published_at IS NULL THEN 'published_without_timestamp'
        WHEN v.publication_status = 'published' AND v.approval_status <> 'approved' THEN 'published_but_not_approved'
        WHEN v.publication_status = 'published' AND v.status <> 'open' THEN 'published_but_not_open'
        WHEN v.publication_status = 'published' AND v.approval_status = 'approved' AND v.status = 'open'
             AND NOT (v.id = ANY(v_public_ids)) THEN 'expected_public_but_hidden'
        WHEN v.publication_status <> 'published' AND v.id = ANY(v_public_ids) THEN 'unpublished_but_visible'
        ELSE NULL END,
      'severity', CASE
        WHEN v.publication_status <> 'published' AND v.id = ANY(v_public_ids) THEN 'critical'
        WHEN v.publication_status = 'published' AND v.approval_status = 'approved' AND v.status = 'open'
             AND NOT (v.id = ANY(v_public_ids)) THEN 'critical'
        ELSE 'warning' END
    ) AS m
    FROM public.rec_vacancies v
  ) s
  WHERE (s.m->>'issue') IS NOT NULL;

  -- Read/submit latency only. A 15 MB certificate upload is a different budget
  -- and was the sole reason the reported p95 breached the website budget.
  SELECT jsonb_build_object(
    'window_hours', 24,
    'requests', count(*),
    'errors', count(*) FILTER (
      WHERE outcome = 'error'
        AND public.rec_apply_failure_class(error_message) IN ('TECHNICAL_FAILURE','SECURITY_FAILURE')),
    'validation_refusals', count(*) FILTER (
      WHERE outcome = 'error'
        AND public.rec_apply_failure_class(error_message) NOT IN ('TECHNICAL_FAILURE','SECURITY_FAILURE')),
    'avg_ms', round(coalesce(avg(duration_ms), 0)),
    'p95_ms', coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms), 0),
    'max_ms', coalesce(max(duration_ms), 0)
  ) INTO v_latency
  FROM public.rec_public_api_metrics
  WHERE created_at > now() - interval '24 hours'
    AND operation <> 'upload_document';

  SELECT jsonb_build_object(
    'window_hours', 24,
    'requests', count(*),
    'errors', count(*) FILTER (WHERE outcome = 'error'),
    'avg_ms', round(coalesce(avg(duration_ms), 0)),
    'p95_ms', coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms), 0),
    'max_ms', coalesce(max(duration_ms), 0)
  ) INTO v_uploads
  FROM public.rec_public_api_metrics
  WHERE created_at > now() - interval '24 hours'
    AND operation = 'upload_document';

  SELECT coalesce(jsonb_object_agg(cls, n), '{}'::jsonb) INTO v_classes
  FROM (
    SELECT public.rec_apply_failure_class(error_message) AS cls, count(*) AS n
    FROM public.rec_public_api_metrics
    WHERE outcome = 'error' AND created_at > now() - interval '24 hours'
    GROUP BY 1
  ) c;

  SELECT coalesce(jsonb_agg(f), '[]'::jsonb) INTO v_failures
  FROM (
    SELECT jsonb_build_object('operation', operation, 'slug', slug, 'error_message', error_message,
                              'failure_class', public.rec_apply_failure_class(error_message),
                              'duration_ms', duration_ms, 'created_at', created_at) AS f
    FROM public.rec_public_api_metrics
    WHERE outcome = 'error' AND created_at > now() - interval '7 days'
    ORDER BY created_at DESC LIMIT 25
  ) x;

  SELECT jsonb_build_object(
    'window_hours', 24,
    'accepted', count(*) FILTER (WHERE outcome = 'accepted'),
    'duplicate', count(*) FILTER (WHERE outcome = 'duplicate'),
    'rejected', count(*) FILTER (WHERE outcome = 'rejected'),
    'top_rejections', coalesce((
      SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', c))
      FROM (SELECT coalesce(error_code, reason) AS reason, count(*) c
            FROM public.rec_public_apply_attempts
            WHERE outcome = 'rejected' AND created_at > now() - interval '24 hours'
            GROUP BY 1 ORDER BY c DESC LIMIT 5) r
    ), '[]'::jsonb)
  ) INTO v_attempts
  FROM public.rec_public_apply_attempts
  WHERE created_at > now() - interval '24 hours';

  SELECT jsonb_build_object(
    'open', count(*) FILTER (WHERE status IN ('OPEN','CANDIDATE_NOTIFIED','RESUMED')),
    'candidate_action', count(*) FILTER (WHERE status IN ('OPEN','CANDIDATE_NOTIFIED','RESUMED')
                                          AND cause = 'CANDIDATE_ACTION_REQUIRED'),
    'system_remediation', count(*) FILTER (WHERE status IN ('OPEN','CANDIDATE_NOTIFIED','RESUMED')
                                            AND cause = 'SYSTEM_REMEDIATION_REQUIRED'),
    'completed', count(*) FILTER (WHERE status = 'COMPLETED'),
    'total', count(*)
  ) INTO v_remediation
  FROM public.rec_application_remediation_cases;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'public_count', coalesce(array_length(v_public_ids, 1), 0),
    'total_vacancies', (SELECT count(*) FROM public.rec_vacancies),
    'mismatches', v_mismatches,
    'mismatch_count', jsonb_array_length(v_mismatches),
    'critical_count', (SELECT count(*) FROM jsonb_array_elements(v_mismatches) e WHERE e->>'severity' = 'critical'),
    'latency', v_latency,
    'uploads', v_uploads,
    'failure_classes', v_classes,
    'recent_failures', v_failures,
    'applications', v_attempts,
    'remediation', v_remediation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rec_publication_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_publication_health() TO authenticated, service_role;