CREATE OR REPLACE FUNCTION public.rec_notify_compatibility_block(p_slug text, p_email text, p_verdict text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_build_id text DEFAULT NULL::text, p_session_ref text DEFAULT NULL::text, p_documents jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Anonymous callers can only re-notify an existing case; they can never
    -- replace its preserved documents, error code or status.
    SET last_failed_at = now()
  RETURNING * INTO v_case;

  v_url := '/careers/continue?token=' || v_case.access_token;
  v_subject := 'Your application for ' || coalesce(v_title, 'a Yalla Mobility role') || ' is saved — one step to finish';
  v_body :=
    'Hello,' || E'\n\n' ||
    'You were stopped by a technical compatibility check on our careers site, not by anything you did wrong. ' ||
    'Everything you had entered' ||
    CASE WHEN jsonb_array_length(coalesce(v_case.documents_preserved, '[]'::jsonb)) > 0
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
$function$;