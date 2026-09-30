-- 1. Authoritative careers application contract (singleton row).
CREATE TABLE IF NOT EXISTS public.rec_application_contract (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  api_contract_version integer NOT NULL DEFAULT 1,
  application_schema_version integer NOT NULL DEFAULT 1,
  minimum_supported_client_version integer NOT NULL DEFAULT 1,
  requirement_schema_version integer NOT NULL DEFAULT 1,
  careers_build_id text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_application_contract TO anon;
GRANT SELECT ON public.rec_application_contract TO authenticated;
GRANT ALL ON public.rec_application_contract TO service_role;
ALTER TABLE public.rec_application_contract ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rec_application_contract' AND policyname = 'contract_public_read') THEN
    CREATE POLICY contract_public_read ON public.rec_application_contract FOR SELECT USING (true);
  END IF;
END $$;

INSERT INTO public.rec_application_contract (id, api_contract_version, application_schema_version, minimum_supported_client_version, requirement_schema_version, notes)
VALUES (true, 1, 1, 1, 1, 'Baseline contract established with INC-2026-08-31-RECRUITMENT-APPLICATION remediation.')
ON CONFLICT (id) DO NOTHING;

-- 2. Forensic provenance on refusal + telemetry records.
ALTER TABLE public.rec_public_apply_attempts
  ADD COLUMN IF NOT EXISTS frontend_build_id text,
  ADD COLUMN IF NOT EXISTS api_contract_version integer,
  ADD COLUMN IF NOT EXISTS application_schema_version integer,
  ADD COLUMN IF NOT EXISTS session_ref text;

ALTER TABLE public.rec_public_api_metrics
  ADD COLUMN IF NOT EXISTS client_build_id text,
  ADD COLUMN IF NOT EXISTS api_contract_version integer,
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS failure_class text;

-- 3. Telemetry entrypoint gains build provenance (server timestamps only).
CREATE OR REPLACE FUNCTION public.rec_log_public_api(
  p_operation text,
  p_duration_ms integer,
  p_outcome text,
  p_slug text DEFAULT NULL,
  p_row_count integer DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_build_id text DEFAULT NULL,
  p_api_contract_version integer DEFAULT NULL,
  p_request_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.rec_public_api_metrics
    (operation, slug, duration_ms, outcome, row_count, error_message,
     client_build_id, api_contract_version, request_id, failure_class)
  VALUES (
    left(coalesce(p_operation, 'unknown'), 60),
    left(nullif(btrim(p_slug), ''), 200),
    greatest(0, coalesce(p_duration_ms, 0)),
    left(coalesce(p_outcome, 'unknown'), 20),
    p_row_count,
    left(p_error_message, 400),
    left(nullif(btrim(p_build_id), ''), 80),
    p_api_contract_version,
    left(nullif(btrim(p_request_id), ''), 80),
    CASE WHEN p_error_message IS NULL THEN NULL
         ELSE public.rec_apply_failure_class(p_error_message) END);
END;
$$;

-- 4. Refusal recorder keeps client provenance. Timestamps remain server-side.
CREATE OR REPLACE FUNCTION public.rec_record_apply_refusal(
  p_slug text,
  p_email text,
  p_message text,
  p_error_code text DEFAULT NULL,
  p_missing jsonb DEFAULT '[]'::jsonb,
  p_documents jsonb DEFAULT '[]'::jsonb,
  p_step text DEFAULT NULL,
  p_build_id text DEFAULT NULL,
  p_api_contract_version integer DEFAULT NULL,
  p_application_schema_version integer DEFAULT NULL,
  p_session_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(nullif(btrim(p_email), ''));
  v_slug text := nullif(btrim(p_slug), '');
  v_class text := public.rec_apply_failure_class(p_message);
  v_vac uuid;
  v_recent integer;
  v_case uuid;
BEGIN
  IF v_slug IS NULL OR v_email IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'slug_and_email_required');
  END IF;

  SELECT count(*) INTO v_recent FROM public.rec_public_apply_attempts
  WHERE email = v_email AND created_at > now() - interval '1 hour';
  IF v_recent > 40 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'rate_limited');
  END IF;

  SELECT id INTO v_vac FROM public.rec_vacancies WHERE public_slug = v_slug;

  INSERT INTO public.rec_public_apply_attempts
    (email, vacancy_slug, outcome, reason, error_code, failure_class, missing,
     documents_supplied, current_step, frontend_build_id, api_contract_version,
     application_schema_version, session_ref)
  VALUES
    (v_email, v_slug, 'rejected', left(coalesce(p_message, 'unknown'), 400),
     coalesce(nullif(btrim(p_error_code), ''), 'UNCLASSIFIED'), v_class,
     coalesce(p_missing, '[]'::jsonb), coalesce(p_documents, '[]'::jsonb),
     nullif(btrim(p_step), ''),
     left(nullif(btrim(p_build_id), ''), 80), p_api_contract_version,
     p_application_schema_version, left(nullif(btrim(p_session_ref), ''), 80));

  INSERT INTO public.rec_application_remediation_cases
    (vacancy_id, vacancy_slug, email, cause, error_code, missing, documents_preserved)
  VALUES (
    v_vac, v_slug, v_email,
    CASE WHEN v_class IN ('TECHNICAL_FAILURE','SECURITY_FAILURE','COMPATIBILITY_FAILURE')
      THEN 'SYSTEM_REMEDIATION_REQUIRED' ELSE 'CANDIDATE_ACTION_REQUIRED' END,
    coalesce(nullif(btrim(p_error_code), ''), 'UNCLASSIFIED'),
    coalesce(p_missing, '[]'::jsonb), coalesce(p_documents, '[]'::jsonb))
  ON CONFLICT (vacancy_slug, email) DO UPDATE
    SET attempt_count = public.rec_application_remediation_cases.attempt_count + 1,
        last_failed_at = now(),
        error_code = excluded.error_code,
        missing = excluded.missing,
        documents_preserved = CASE
          WHEN jsonb_array_length(excluded.documents_preserved) > 0
            THEN excluded.documents_preserved
          ELSE public.rec_application_remediation_cases.documents_preserved END,
        cause = excluded.cause,
        status = CASE WHEN public.rec_application_remediation_cases.status IN ('COMPLETED','CLOSED_NO_ACTION')
                      THEN public.rec_application_remediation_cases.status ELSE 'OPEN' END
  RETURNING id INTO v_case;

  RETURN jsonb_build_object(
    'recorded', true, 'failure_class', v_class, 'remediation_case_id', v_case);
END;
$$;

-- 5. Compatibility handshake executed before an application may begin.
CREATE OR REPLACE FUNCTION public.rec_public_application_contract(
  p_slug text DEFAULT NULL,
  p_client jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.rec_application_contract;
  v_client_api integer := nullif(p_client->>'api_contract_version', '')::integer;
  v_client_schema integer := nullif(p_client->>'application_schema_version', '')::integer;
  v_req_version integer;
  v_vac_version integer;
  v_verdict text := 'COMPATIBLE';
  v_reason text := NULL;
BEGIN
  SELECT * INTO c FROM public.rec_application_contract WHERE id;

  IF p_slug IS NOT NULL THEN
    SELECT rs.version, rs.vacancy_content_version
      INTO v_req_version, v_vac_version
    FROM public.rec_document_requirement_sets rs
    JOIN public.rec_vacancies v ON v.id = rs.vacancy_id
    WHERE v.public_slug = btrim(p_slug) AND rs.status = 'active'
    ORDER BY rs.version DESC
    LIMIT 1;
  END IF;

  IF v_client_api IS NULL OR v_client_schema IS NULL THEN
    v_verdict := 'BUILD_TOO_OLD';
    v_reason := 'The application page did not declare a contract version.';
  ELSIF v_client_api < c.minimum_supported_client_version THEN
    v_verdict := 'BUILD_TOO_OLD';
    v_reason := 'This application form is from an older release of the careers site.';
  ELSIF v_client_api > c.api_contract_version OR v_client_schema > c.application_schema_version THEN
    v_verdict := 'APPLICATION_CONTRACT_INCOMPATIBLE';
    v_reason := 'This application form is newer than the recruitment service it is talking to.';
  ELSIF v_client_schema < c.application_schema_version THEN
    v_verdict := 'BUILD_TOO_OLD';
    v_reason := 'The application requirements have been updated since this page was loaded.';
  END IF;

  RETURN jsonb_build_object(
    'verdict', v_verdict,
    'reason', v_reason,
    'server_time', now(),
    'authoritative', jsonb_build_object(
      'api_contract_version', c.api_contract_version,
      'application_schema_version', c.application_schema_version,
      'minimum_supported_client_version', c.minimum_supported_client_version,
      'requirement_schema_version', c.requirement_schema_version,
      'careers_build_id', c.careers_build_id),
    'vacancy', jsonb_build_object(
      'slug', nullif(btrim(p_slug), ''),
      'requirement_version', v_req_version,
      'vacancy_content_version', v_vac_version),
    'client', jsonb_build_object(
      'api_contract_version', v_client_api,
      'application_schema_version', v_client_schema,
      'build_id', left(nullif(btrim(p_client->>'build_id'), ''), 80)));
END;
$$;

-- 6. Failure population reconciliation: every event lands in exactly one class.
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

  -- API telemetry population (one row per request).
  SELECT jsonb_build_object(
    'total_requests', count(*),
    'successful', count(*) FILTER (WHERE outcome IN ('success','empty')),
    'error_events', count(*) FILTER (WHERE outcome = 'error'),
    'by_class', coalesce(jsonb_object_agg(k.failure_class, k.n) FILTER (WHERE k.failure_class IS NOT NULL), '{}'::jsonb),
    'by_operation', coalesce(jsonb_object_agg(o.operation, o.n) FILTER (WHERE o.operation IS NOT NULL), '{}'::jsonb)
  ) INTO v_metrics
  FROM public.rec_public_api_metrics m
  LEFT JOIN LATERAL (
    SELECT public.rec_apply_failure_class(m.error_message) AS failure_class,
           count(*) OVER () AS n
    WHERE m.outcome = 'error'
  ) k ON true
  LEFT JOIN LATERAL (SELECT m.operation AS operation, 1 AS n WHERE m.outcome = 'error') o ON true
  WHERE m.created_at >= v_since;

  -- Refusal population (one row per refused submission attempt).
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

  -- Events are not people: report distinct populations separately.
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
GRANT EXECUTE ON FUNCTION public.rec_public_application_contract(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_log_public_api(text, integer, text, text, integer, text, text, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_record_apply_refusal(text, text, text, text, jsonb, jsonb, text, text, integer, integer, text) TO anon, authenticated;