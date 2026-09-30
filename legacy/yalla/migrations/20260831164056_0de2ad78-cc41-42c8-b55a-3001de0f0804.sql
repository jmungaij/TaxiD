-- ============================================================
-- 1. PUBLICATION GATE REGISTER (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rec_publication_gate_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  vacancy_slug text,
  gate text NOT NULL CHECK (gate IN ('VALIDATION','CONTRACT','E2E')),
  outcome text NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  content_version integer,
  requirement_version integer,
  build_id text,
  suite text,
  cases_total integer,
  cases_passed integer,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_publication_gate_runs TO authenticated;
GRANT ALL ON public.rec_publication_gate_runs TO service_role;
ALTER TABLE public.rec_publication_gate_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rec_publication_gate_runs' AND policyname='gate_runs_staff_read') THEN
    CREATE POLICY gate_runs_staff_read ON public.rec_publication_gate_runs
      FOR SELECT TO authenticated USING (public.rec_can_read());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rec_gate_runs_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Publication gate evidence is append-only.';
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_gate_runs_append_only ON public.rec_publication_gate_runs;
CREATE TRIGGER trg_rec_gate_runs_append_only
  BEFORE UPDATE OR DELETE ON public.rec_publication_gate_runs
  FOR EACH ROW EXECUTE FUNCTION public.rec_gate_runs_append_only();

CREATE INDEX IF NOT EXISTS idx_rec_gate_runs_vacancy ON public.rec_publication_gate_runs (vacancy_id, gate, created_at DESC);

-- ============================================================
-- 2. GATE STATUS (validation + contract + live E2E evidence)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_publication_gate_status(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_req record;
  v_e2e public.rec_publication_gate_runs;
  v_val text[] := '{}';
  v_con text[] := '{}';
  v_e2e_block text[] := '{}';
  v_has_blueprint boolean;
  v_max_age interval := interval '14 days';
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN
    RETURN jsonb_build_object('verdict','UNKNOWN','reason','Vacancy not found.');
  END IF;

  -- (a) VALIDATION
  IF v.approval_status <> 'approved' THEN
    v_val := v_val || format('Approval is %s — the vacancy must be approved.', v.approval_status);
  END IF;
  IF v.status <> 'open' THEN
    v_val := v_val || format('Vacancy status is %s — only an open vacancy can be published.', v.status);
  END IF;
  IF coalesce(btrim(v.public_slug), '') = '' THEN
    v_val := v_val || 'The vacancy has no public link (slug).';
  END IF;
  IF v.position_id IS NULL AND coalesce(btrim(v.position_exception_reason), '') = '' THEN
    v_val := v_val || 'Link an approved org position, or record a position exception reason.';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.rec_blueprints b WHERE b.vacancy_id = v.id AND b.status = 'active')
    INTO v_has_blueprint;
  IF NOT v_has_blueprint THEN
    v_val := v_val || 'No active application blueprint — candidates would have no form to complete.';
  END IF;

  -- (b) CONTRACT: an active requirement set bound to the current vacancy content
  SELECT rs.version, rs.vacancy_content_version
    INTO v_req
  FROM public.rec_document_requirement_sets rs
  WHERE rs.vacancy_id = v.id AND rs.status = 'active'
  ORDER BY rs.version DESC LIMIT 1;

  SELECT * INTO c FROM public.rec_application_contract WHERE id;

  IF v_req.version IS NULL THEN
    v_con := v_con || 'No active document requirement set — the requirement contract is undefined.';
  ELSIF coalesce(v_req.vacancy_content_version, -1) <> coalesce(v.content_version, -1) THEN
    v_con := v_con || format(
      'The requirement set was built for vacancy content v%s but the vacancy is now v%s — republish the requirement set.',
      coalesce(v_req.vacancy_content_version, 0), coalesce(v.content_version, 0));
  END IF;
  IF c.id IS NULL THEN
    v_con := v_con || 'No authoritative careers application contract is configured.';
  ELSIF coalesce(c.careers_build_id, '') = '' THEN
    v_con := v_con || 'No careers build is registered as current — the stale-bundle handshake cannot be evaluated.';
  END IF;

  -- (c) E2E: a passing synthetic run against the CURRENT content version
  SELECT * INTO v_e2e
  FROM public.rec_publication_gate_runs r
  WHERE r.vacancy_id = v.id AND r.gate = 'E2E'
  ORDER BY r.created_at DESC LIMIT 1;

  IF v_e2e.id IS NULL THEN
    v_e2e_block := v_e2e_block || 'No end-to-end application run has been recorded for this vacancy.';
  ELSE
    IF v_e2e.outcome <> 'PASS' THEN
      v_e2e_block := v_e2e_block || format('The last end-to-end run failed (%s of %s cases passed).',
        coalesce(v_e2e.cases_passed, 0), coalesce(v_e2e.cases_total, 0));
    END IF;
    IF coalesce(v_e2e.content_version, -1) <> coalesce(v.content_version, -1) THEN
      v_e2e_block := v_e2e_block || format(
        'The end-to-end run covered vacancy content v%s; the vacancy is now v%s — rerun the matrix.',
        coalesce(v_e2e.content_version, 0), coalesce(v.content_version, 0));
    END IF;
    IF v_e2e.created_at < now() - v_max_age THEN
      v_e2e_block := v_e2e_block || format('The end-to-end evidence is older than %s.', v_max_age::text);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'vacancy_id', v.id,
    'vacancy_no', v.vacancy_no,
    'title', v.title,
    'public_slug', v.public_slug,
    'content_version', v.content_version,
    'publication_status', v.publication_status,
    'checked_at', now(),
    'gates', jsonb_build_object(
      'validation', jsonb_build_object('passed', array_length(v_val,1) IS NULL, 'blockers', to_jsonb(v_val)),
      'contract', jsonb_build_object(
        'passed', array_length(v_con,1) IS NULL,
        'blockers', to_jsonb(v_con),
        'requirement_version', v_req.version,
        'authoritative_build_id', c.careers_build_id),
      'e2e', jsonb_build_object(
        'passed', array_length(v_e2e_block,1) IS NULL,
        'blockers', to_jsonb(v_e2e_block),
        'run_id', v_e2e.id,
        'suite', v_e2e.suite,
        'cases_total', v_e2e.cases_total,
        'cases_passed', v_e2e.cases_passed,
        'executed_at', v_e2e.created_at)
    ),
    'blockers', to_jsonb(v_val || v_con || v_e2e_block),
    'verdict', CASE WHEN array_length(v_val || v_con || v_e2e_block, 1) IS NULL THEN 'READY' ELSE 'BLOCKED' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rec_publication_gate_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_publication_gate_status(uuid) TO authenticated;

-- ============================================================
-- 3. GATE RUN RECORDER (staff / harness only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_record_publication_gate_run(
  p_vacancy uuid,
  p_gate text,
  p_outcome text,
  p_suite text DEFAULT NULL,
  p_cases_total integer DEFAULT NULL,
  p_cases_passed integer DEFAULT NULL,
  p_build_id text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.rec_vacancies;
  v_req integer;
  v_id uuid;
BEGIN
  IF NOT (public.rec_is_hiring_authority() OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Not authorised to record publication gate evidence.';
  END IF;
  IF upper(coalesce(p_gate,'')) NOT IN ('VALIDATION','CONTRACT','E2E') THEN
    RAISE EXCEPTION 'Unknown gate %', p_gate;
  END IF;
  IF upper(coalesce(p_outcome,'')) NOT IN ('PASS','FAIL') THEN
    RAISE EXCEPTION 'Outcome must be PASS or FAIL.';
  END IF;

  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  SELECT rs.version INTO v_req FROM public.rec_document_requirement_sets rs
  WHERE rs.vacancy_id = v.id AND rs.status = 'active' ORDER BY rs.version DESC LIMIT 1;

  INSERT INTO public.rec_publication_gate_runs
    (vacancy_id, vacancy_slug, gate, outcome, content_version, requirement_version,
     build_id, suite, cases_total, cases_passed, evidence, executed_by)
  VALUES (v.id, v.public_slug, upper(p_gate), upper(p_outcome), v.content_version, v_req,
          left(nullif(btrim(p_build_id), ''), 80), left(nullif(btrim(p_suite), ''), 120),
          p_cases_total, p_cases_passed, coalesce(p_evidence, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('recorded', true, 'run_id', v_id,
                            'content_version', v.content_version, 'requirement_version', v_req);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_record_publication_gate_run(uuid, text, text, text, integer, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_record_publication_gate_run(uuid, text, text, text, integer, integer, text, jsonb) TO authenticated;

-- ============================================================
-- 4. PUBLISH PATH NOW ENFORCES THE FULL GATE
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_vacancy_set_publication(p_vacancy uuid, p_publish boolean, p_reason text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.rec_vacancies;
  v_blockers text[] := '{}';
  v_visible boolean;
  v_gate jsonb;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'Not authorised to change publication state.';
  END IF;
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  IF p_publish THEN
    v_gate := public.rec_publication_gate_status(p_vacancy);
    SELECT coalesce(array_agg(b), '{}') INTO v_blockers
    FROM jsonb_array_elements_text(v_gate->'blockers') AS t(b);

    INSERT INTO public.rec_audit_events(action, object_type, object_id, new_state, context)
    VALUES ('publication_requested', 'vacancy', p_vacancy,
            jsonb_build_object('publication_status', v.publication_status),
            jsonb_build_object('reason', coalesce(p_reason, ''), 'gate', v_gate));

    IF array_length(v_blockers, 1) > 0 THEN
      INSERT INTO public.rec_audit_events(action, object_type, object_id, context)
      VALUES ('publication_failed', 'vacancy', p_vacancy,
              jsonb_build_object('blockers', to_jsonb(v_blockers), 'gate', v_gate));
      RETURN jsonb_build_object('ok', false, 'status', 'PUBLICATION_FAILED',
                                'vacancy_id', p_vacancy, 'blockers', to_jsonb(v_blockers),
                                'gate', v_gate);
    END IF;

    INSERT INTO public.rec_audit_events(action, object_type, object_id, context)
    VALUES ('publication_validated', 'vacancy', p_vacancy, jsonb_build_object('gate', v_gate));

    UPDATE public.rec_vacancies
       SET publication_status = 'published',
           published_at = COALESCE(published_at, now()),
           published_by = COALESCE(published_by, auth.uid())
     WHERE id = p_vacancy;
  ELSE
    UPDATE public.rec_vacancies SET publication_status = 'paused' WHERE id = p_vacancy;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rec_vacancies x
    WHERE x.id = p_vacancy AND x.approval_status = 'approved'
      AND x.publication_status = 'published' AND x.status = 'open'
      AND x.published_at IS NOT NULL
  ) INTO v_visible;

  INSERT INTO public.rec_audit_events(action, object_type, object_id, new_state, context)
  VALUES (CASE WHEN p_publish THEN 'publication_succeeded' ELSE 'publication_paused' END,
          'vacancy', p_vacancy,
          jsonb_build_object('publication_status', CASE WHEN p_publish THEN 'published' ELSE 'paused' END),
          jsonb_build_object('careers_visible', v_visible, 'reason', COALESCE(p_reason, '')));

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN NOT p_publish THEN 'PAUSED'
                   WHEN v_visible THEN 'PUBLISHED'
                   ELSE 'PUBLISHED_WITH_RECONCILIATION_PENDING' END,
    'vacancy_id', p_vacancy,
    'careers_visible', v_visible,
    'gate', v_gate,
    'blockers', to_jsonb(v_blockers)
  );
END;
$$;

-- ============================================================
-- 5. CANDIDATE CONTINUATION TOKEN + NOTIFICATIONS
-- ============================================================
ALTER TABLE public.rec_application_remediation_cases
  ADD COLUMN IF NOT EXISTS access_token text;

UPDATE public.rec_application_remediation_cases
   SET access_token = encode(gen_random_bytes(18), 'hex')
 WHERE access_token IS NULL;

ALTER TABLE public.rec_application_remediation_cases
  ALTER COLUMN access_token SET DEFAULT encode(gen_random_bytes(18), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS idx_rec_remediation_token
  ON public.rec_application_remediation_cases (access_token);
CREATE INDEX IF NOT EXISTS idx_rec_remediation_email
  ON public.rec_application_remediation_cases (email, vacancy_slug);

CREATE TABLE IF NOT EXISTS public.rec_candidate_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remediation_case_id uuid REFERENCES public.rec_application_remediation_cases(id) ON DELETE SET NULL,
  email text NOT NULL,
  vacancy_slug text,
  kind text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  continue_url text,
  delivery_status text NOT NULL DEFAULT 'QUEUED',
  provider_message_id text,
  error text,
  build_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);

GRANT SELECT ON public.rec_candidate_notifications TO authenticated;
GRANT ALL ON public.rec_candidate_notifications TO service_role;
ALTER TABLE public.rec_candidate_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rec_candidate_notifications' AND policyname='candidate_notifications_staff_read') THEN
    CREATE POLICY candidate_notifications_staff_read ON public.rec_candidate_notifications
      FOR SELECT TO authenticated USING (public.rec_can_read());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rec_candidate_notifications_email
  ON public.rec_candidate_notifications (email, created_at DESC);

-- Queues a candidate-facing message when their own browser is blocked by the
-- compatibility handshake. The candidate's work is preserved and the message
-- carries a private continuation token, never another candidate's data.
CREATE OR REPLACE FUNCTION public.rec_notify_compatibility_block(
  p_slug text,
  p_email text,
  p_verdict text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_build_id text DEFAULT NULL,
  p_session_ref text DEFAULT NULL,
  p_documents jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(nullif(btrim(p_email), ''));
  v_slug text := nullif(btrim(p_slug), '');
  v_vac uuid;
  v_title text;
  v_case public.rec_application_remediation_cases;
  v_recent integer;
  v_id uuid;
  v_subject text;
  v_body text;
  v_url text;
BEGIN
  IF v_email IS NULL OR v_email NOT LIKE '%_@_%._%' THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'email_required');
  END IF;

  SELECT count(*) INTO v_recent FROM public.rec_candidate_notifications
   WHERE email = v_email AND created_at > now() - interval '1 hour';
  IF v_recent >= 3 THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'rate_limited');
  END IF;

  SELECT id, title INTO v_vac, v_title FROM public.rec_vacancies WHERE public_slug = v_slug;

  INSERT INTO public.rec_application_remediation_cases
    (vacancy_id, vacancy_slug, email, cause, error_code, missing, documents_preserved)
  VALUES (v_vac, v_slug, v_email, 'SYSTEM_REMEDIATION_REQUIRED',
          coalesce(nullif(btrim(p_verdict), ''), 'BUILD_TOO_OLD'),
          '[]'::jsonb, coalesce(p_documents, '[]'::jsonb))
  ON CONFLICT (vacancy_slug, email) DO UPDATE
    SET last_failed_at = now(),
        cause = 'SYSTEM_REMEDIATION_REQUIRED',
        error_code = excluded.error_code,
        documents_preserved = CASE
          WHEN jsonb_array_length(excluded.documents_preserved) > 0 THEN excluded.documents_preserved
          ELSE public.rec_application_remediation_cases.documents_preserved END,
        status = CASE WHEN public.rec_application_remediation_cases.status IN ('COMPLETED','CLOSED_NO_ACTION')
                      THEN public.rec_application_remediation_cases.status ELSE 'OPEN' END
  RETURNING * INTO v_case;

  v_url := '/careers/continue?token=' || v_case.access_token;
  v_subject := 'Your application for ' || coalesce(v_title, 'a Yalla Mobility role') || ' is saved — one step to finish';
  v_body :=
    'Hello,' || E'\n\n' ||
    'You were stopped by a technical compatibility check on our careers site, not by anything you did wrong. ' ||
    'Everything you had entered' ||
    CASE WHEN jsonb_array_length(coalesce(p_documents, '[]'::jsonb)) > 0
         THEN ', including the documents you uploaded,' ELSE '' END ||
    ' has been preserved.' || E'\n\n' ||
    'To continue:' || E'\n' ||
    '1. Open your saved application: ' || v_url || E'\n' ||
    '2. Reload the page once so your browser picks up the current application form.' || E'\n' ||
    '3. Complete any outstanding requirements shown there and submit.' || E'\n\n' ||
    'Reference: ' || coalesce(v_case.id::text, '-') || E'\n' ||
    'If you need help, reply to this message and our recruitment team will assist.' || E'\n\n' ||
    'Yalla Mobility Recruitment';

  INSERT INTO public.rec_candidate_notifications
    (remediation_case_id, email, vacancy_slug, kind, subject, body, continue_url, build_id)
  VALUES (v_case.id, v_email, v_slug, 'COMPATIBILITY_BLOCK', v_subject, v_body, v_url,
          left(nullif(btrim(p_build_id), ''), 80))
  RETURNING id INTO v_id;

  UPDATE public.rec_application_remediation_cases
     SET candidate_notified_at = now() WHERE id = v_case.id;

  RETURN jsonb_build_object(
    'queued', true, 'notification_id', v_id, 'remediation_case_id', v_case.id,
    'continue_token', v_case.access_token, 'continue_url', v_url,
    'subject', v_subject, 'body', v_body, 'email', v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_notify_compatibility_block(text, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_notify_compatibility_block(text, text, text, text, text, text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rec_notification_mark_dispatched(
  p_id uuid, p_status text, p_provider_message_id text DEFAULT NULL, p_error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.rec_candidate_notifications
     SET delivery_status = left(coalesce(p_status, 'UNKNOWN'), 20),
         provider_message_id = left(nullif(btrim(p_provider_message_id), ''), 200),
         error = left(nullif(btrim(p_error), ''), 400),
         dispatched_at = now()
   WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_notification_mark_dispatched(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_notification_mark_dispatched(uuid, text, text, text) TO service_role;

-- ============================================================
-- 6. TOKEN-SCOPED REMEDIATION CENTRE LOOKUP (candidate facing)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_public_remediation_case(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.rec_application_remediation_cases;
  v_title text;
  v_open boolean := false;
BEGIN
  IF coalesce(btrim(p_token), '') = '' OR length(btrim(p_token)) < 24 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_case FROM public.rec_application_remediation_cases
   WHERE access_token = btrim(p_token);
  IF v_case.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT title, (approval_status = 'approved' AND publication_status = 'published'
                 AND status = 'open' AND published_at IS NOT NULL)
    INTO v_title, v_open
  FROM public.rec_vacancies WHERE public_slug = v_case.vacancy_slug;

  RETURN jsonb_build_object(
    'found', true,
    'case_id', v_case.id,
    'email', v_case.email,
    'vacancy_slug', v_case.vacancy_slug,
    'vacancy_title', v_title,
    'vacancy_open', coalesce(v_open, false),
    'cause', v_case.cause,
    'error_code', v_case.error_code,
    'status', v_case.status,
    'missing', coalesce(v_case.missing, '[]'::jsonb),
    'documents_preserved', coalesce(v_case.documents_preserved, '[]'::jsonb),
    'attempt_count', v_case.attempt_count,
    'first_failed_at', v_case.first_failed_at,
    'last_failed_at', v_case.last_failed_at,
    'completed_at', v_case.completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_remediation_case(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_remediation_case(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rec_public_remediation_resume(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_case public.rec_application_remediation_cases;
BEGIN
  SELECT * INTO v_case FROM public.rec_application_remediation_cases
   WHERE access_token = btrim(coalesce(p_token, ''));
  IF v_case.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  UPDATE public.rec_application_remediation_cases
     SET candidate_resumed_at = now(),
         status = CASE WHEN status IN ('COMPLETED','CLOSED_NO_ACTION') THEN status ELSE 'IN_PROGRESS' END
   WHERE id = v_case.id;
  RETURN jsonb_build_object('ok', true, 'vacancy_slug', v_case.vacancy_slug, 'email', v_case.email);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_remediation_resume(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_remediation_resume(text) TO anon, authenticated;

-- ============================================================
-- 7. SINGLE-CALL APPLICATION BOOTSTRAP (latency)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_public_apply_bootstrap(
  p_slug text,
  p_client jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'contract', public.rec_public_application_contract(p_slug, p_client),
    'blueprint', public.rec_public_application_blueprint(p_slug),
    'detail', public.rec_public_vacancy_detail(p_slug),
    'server_time', now()
  );
$$;

REVOKE ALL ON FUNCTION public.rec_public_apply_bootstrap(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_apply_bootstrap(text, jsonb) TO anon, authenticated;

-- ============================================================
-- 8. PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rec_vacancies_public_projection
  ON public.rec_vacancies (publication_status, approval_status, status, published_at DESC)
  WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rec_vacancies_slug ON public.rec_vacancies (public_slug);
CREATE INDEX IF NOT EXISTS idx_rec_api_metrics_recent
  ON public.rec_public_api_metrics (operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_apply_attempts_recent
  ON public.rec_public_apply_attempts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_blueprints_active
  ON public.rec_blueprints (vacancy_id, status);
CREATE INDEX IF NOT EXISTS idx_rec_requirement_sets_active
  ON public.rec_document_requirement_sets (vacancy_id, status, version DESC);
