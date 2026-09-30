-- ============================================================
-- Recruitment 360 — application failure forensics & remediation
-- ============================================================

-- 1. Attempt evidence: structured, not a free-text reason only.
ALTER TABLE public.rec_public_apply_attempts
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS failure_class text,
  ADD COLUMN IF NOT EXISTS missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS documents_supplied jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_step text,
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE INDEX IF NOT EXISTS idx_rec_apply_attempts_created
  ON public.rec_public_apply_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_apply_attempts_outcome
  ON public.rec_public_apply_attempts (outcome, created_at DESC);

-- 2. Deterministic failure classification. Business validation is NOT an outage.
CREATE OR REPLACE FUNCTION public.rec_apply_failure_class(p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_message IS NULL OR btrim(p_message) = '' THEN 'TECHNICAL_FAILURE'
    WHEN p_message ~* 'missing mandatory documents|document(s)? (is|are)? ?required|Missing:' THEN 'BUSINESS_VALIDATION'
    WHEN p_message ~* 'already applied|duplicate' THEN 'BUSINESS_VALIDATION'
    WHEN p_message ~* 'no longer open|not published|closed|deadline' THEN 'BUSINESS_VALIDATION'
    WHEN p_message ~* 'file type is not accepted|15 MB|appears to be empty|format is invalid|enter a valid' THEN 'CANDIDATE_ACTION_REQUIRED'
    WHEN p_message ~* 'permission denied|not authoris|not authoriz|jwt|row-level security' THEN 'SECURITY_FAILURE'
    WHEN p_message ~* 'failed to fetch|network|timeout|timed out|502|503|504|connection' THEN 'TECHNICAL_FAILURE'
    ELSE 'TECHNICAL_FAILURE'
  END;
$$;

REVOKE ALL ON FUNCTION public.rec_apply_failure_class(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_apply_failure_class(text) TO authenticated, service_role;

-- 3. Remediation register — preserves the original attempt, never rewrites it.
CREATE TABLE IF NOT EXISTS public.rec_application_remediation_cases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  vacancy_slug text NOT NULL,
  email text NOT NULL,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE SET NULL,
  cause text NOT NULL DEFAULT 'CANDIDATE_ACTION_REQUIRED'
    CHECK (cause IN ('CANDIDATE_ACTION_REQUIRED','SYSTEM_REMEDIATION_REQUIRED','SECURITY_REVIEW_REQUIRED')),
  error_code text,
  missing jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents_preserved jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempt_count integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','CANDIDATE_NOTIFIED','RESUMED','COMPLETED','CLOSED_NO_ACTION')),
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  candidate_notified_at timestamptz,
  candidate_resumed_at timestamptz,
  completed_at timestamptz,
  resolution text,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_slug, email)
);

GRANT SELECT ON public.rec_application_remediation_cases TO authenticated;
GRANT ALL ON public.rec_application_remediation_cases TO service_role;

ALTER TABLE public.rec_application_remediation_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read remediation cases"
  ON public.rec_application_remediation_cases FOR SELECT
  TO authenticated USING (public.rec_can_read());

CREATE POLICY "rec staff resolve remediation cases"
  ON public.rec_application_remediation_cases FOR UPDATE
  TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

CREATE TRIGGER trg_rec_remediation_touch
  BEFORE UPDATE ON public.rec_application_remediation_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_rec_remediation_status
  ON public.rec_application_remediation_cases (status, last_failed_at DESC);

-- 4. Public entry point: record a refused attempt OUTSIDE the aborted transaction.
--    The submission transaction rolls back on RAISE, so the client re-reports the
--    refusal here. Evidence is append-only; the remediation case coalesces repeats.
CREATE OR REPLACE FUNCTION public.rec_record_apply_refusal(
  p_slug text,
  p_email text,
  p_message text,
  p_error_code text DEFAULT NULL,
  p_missing jsonb DEFAULT '[]'::jsonb,
  p_documents jsonb DEFAULT '[]'::jsonb,
  p_step text DEFAULT NULL
)
RETURNS jsonb
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

  -- Abuse ceiling: forensics, not a firehose.
  SELECT count(*) INTO v_recent FROM public.rec_public_apply_attempts
  WHERE email = v_email AND created_at > now() - interval '1 hour';
  IF v_recent > 40 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'rate_limited');
  END IF;

  SELECT id INTO v_vac FROM public.rec_vacancies WHERE public_slug = v_slug;

  INSERT INTO public.rec_public_apply_attempts
    (email, vacancy_slug, outcome, reason, error_code, failure_class, missing, documents_supplied, current_step)
  VALUES
    (v_email, v_slug, 'rejected', left(coalesce(p_message, 'unknown'), 400),
     coalesce(nullif(btrim(p_error_code), ''), 'UNCLASSIFIED'), v_class,
     coalesce(p_missing, '[]'::jsonb), coalesce(p_documents, '[]'::jsonb),
     nullif(btrim(p_step), ''));

  -- The candidate keeps one case per vacancy: never a second candidate, never a
  -- second application, and the original failure timestamp is preserved.
  INSERT INTO public.rec_application_remediation_cases
    (vacancy_id, vacancy_slug, email, cause, error_code, missing, documents_preserved)
  VALUES (
    v_vac, v_slug, v_email,
    CASE WHEN v_class IN ('TECHNICAL_FAILURE','SECURITY_FAILURE')
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

REVOKE ALL ON FUNCTION public.rec_record_apply_refusal(text,text,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_record_apply_refusal(text,text,text,text,jsonb,jsonb,text)
  TO anon, authenticated, service_role;

-- 5. A submitted application closes its own remediation case.
CREATE OR REPLACE FUNCTION public.rec_close_remediation_on_submit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_slug text; v_email text;
BEGIN
  SELECT v.public_slug, lower(c.email) INTO v_slug, v_email
  FROM public.rec_vacancies v, public.rec_candidates c
  WHERE v.id = NEW.vacancy_id AND c.id = NEW.candidate_id;

  IF v_slug IS NOT NULL AND v_email IS NOT NULL THEN
    UPDATE public.rec_application_remediation_cases
       SET status = 'COMPLETED', completed_at = now(), application_id = NEW.id,
           resolution = coalesce(resolution, 'Application submitted successfully')
     WHERE vacancy_slug = v_slug AND email = v_email AND status <> 'COMPLETED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_close_remediation ON public.rec_applications;
CREATE TRIGGER trg_rec_close_remediation
  AFTER INSERT ON public.rec_applications
  FOR EACH ROW EXECUTE FUNCTION public.rec_close_remediation_on_submit();

-- 6. Publication health: technical failure and business validation are different
--    incidents and are no longer summed into one "API failures" number.
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

  -- Latency excludes business-validation refusals: a refused application is a
  -- fast, correct answer, not a slow or broken endpoint.
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
  WHERE created_at > now() - interval '24 hours';

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
    'failure_classes', v_classes,
    'recent_failures', v_failures,
    'applications', v_attempts,
    'remediation', v_remediation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rec_publication_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_publication_health() TO authenticated, service_role;