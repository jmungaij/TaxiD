CREATE OR REPLACE FUNCTION public.partner_api_credential_issue(_partner_id uuid, _environment partner_api_environment, _label text, _scopes text[] DEFAULT '{}'::text[], _tier text DEFAULT 'integrate'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_secret text;
  v_client_id text;
  v_row public.partner_api_credentials;
BEGIN
  IF NOT (public.partner_api_is_manager(_partner_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorised to issue partner API credentials';
  END IF;

  v_client_id := 'yc_' || CASE WHEN _environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
                 || replace(gen_random_uuid()::text, '-', '');
  v_secret := 'ys_' || CASE WHEN _environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
              || encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.partner_api_credentials (
    partner_id, environment, label, client_id, secret_hash, secret_fingerprint,
    scopes, tier, created_by,
    rate_limit_per_min, monthly_quota
  ) VALUES (
    _partner_id, _environment, _label, v_client_id,
    encode(digest(v_secret, 'sha256'), 'hex'),
    right(v_secret, 6),
    COALESCE(_scopes, '{}'), COALESCE(_tier, 'integrate'), auth.uid(),
    CASE _tier WHEN 'infrastructure' THEN 25000 WHEN 'scale' THEN 10000 ELSE 2000 END,
    CASE _tier WHEN 'infrastructure' THEN 5000000 WHEN 'scale' THEN 2000000 ELSE 500000 END
  ) RETURNING * INTO v_row;

  INSERT INTO public.partner_api_credential_audit (credential_id, partner_id, action, environment, actor_id, metadata)
  VALUES (v_row.id, _partner_id, 'created', _environment, auth.uid(),
          jsonb_build_object('label', _label, 'scopes', COALESCE(_scopes, '{}'), 'tier', _tier));

  RETURN jsonb_build_object(
    'credential_id', v_row.id,
    'client_id', v_row.client_id,
    'client_secret', v_secret,
    'environment', _environment,
    'scopes', v_row.scopes,
    'tier', v_row.tier
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_api_credential_rotate(_credential_id uuid, _grace_hours integer DEFAULT 24, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old public.partner_api_credentials;
  v_secret text;
  v_client_id text;
  v_new public.partner_api_credentials;
BEGIN
  SELECT * INTO v_old FROM public.partner_api_credentials WHERE id = _credential_id;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'credential not found';
  END IF;
  IF NOT (public.partner_api_is_manager(v_old.partner_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorised to rotate partner API credentials';
  END IF;
  IF v_old.status = 'revoked' THEN
    RAISE EXCEPTION 'cannot rotate a revoked credential';
  END IF;

  v_client_id := 'yc_' || CASE WHEN v_old.environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
                 || replace(gen_random_uuid()::text, '-', '');
  v_secret := 'ys_' || CASE WHEN v_old.environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
              || encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.partner_api_credentials (
    partner_id, environment, label, client_id, secret_hash, secret_fingerprint,
    scopes, tier, created_by, rotated_from, rotated_at,
    rate_limit_per_min, monthly_quota
  ) VALUES (
    v_old.partner_id, v_old.environment, v_old.label, v_client_id,
    encode(digest(v_secret, 'sha256'), 'hex'), right(v_secret, 6),
    v_old.scopes, v_old.tier, auth.uid(), v_old.id, now(),
    v_old.rate_limit_per_min, v_old.monthly_quota
  ) RETURNING * INTO v_new;

  UPDATE public.partner_api_credentials
     SET status = 'rotating',
         grace_expires_at = now() + make_interval(hours => GREATEST(0, COALESCE(_grace_hours, 24))),
         updated_at = now()
   WHERE id = v_old.id;

  INSERT INTO public.partner_api_credential_audit (credential_id, partner_id, action, environment, actor_id, reason, metadata)
  VALUES (v_new.id, v_old.partner_id, 'rotated', v_old.environment, auth.uid(), _reason,
          jsonb_build_object('replaces', v_old.client_id, 'grace_hours', COALESCE(_grace_hours, 24)));

  RETURN jsonb_build_object(
    'credential_id', v_new.id,
    'client_id', v_new.client_id,
    'client_secret', v_secret,
    'environment', v_new.environment,
    'replaces_client_id', v_old.client_id,
    'grace_expires_at', now() + make_interval(hours => GREATEST(0, COALESCE(_grace_hours, 24)))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rec_profession_attempt_issue(p_application uuid, p_template uuid DEFAULT NULL::uuid, p_valid_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE a public.rec_applications; t public.rec_assessment_templates;
        v_attempt public.rec_profession_attempts; v_no integer; v_token text; v_max numeric := 0;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to issue assessments';
  END IF;

  SELECT * INTO a FROM public.rec_applications WHERE id = p_application;
  IF a.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  IF p_template IS NOT NULL THEN
    SELECT * INTO t FROM public.rec_assessment_templates WHERE id = p_template;
  ELSE
    SELECT * INTO t FROM public.rec_assessment_templates
     WHERE vacancy_id = a.vacancy_id AND status = 'active' AND retired_at IS NULL
     ORDER BY version DESC LIMIT 1;
  END IF;
  IF t.id IS NULL THEN RAISE EXCEPTION 'no active assessment paper for this vacancy'; END IF;

  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_no
    FROM public.rec_profession_attempts WHERE application_id = p_application AND template_id = t.id;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO public.rec_profession_attempts(
    application_id, vacancy_id, candidate_id, template_id, template_key, template_version,
    attempt_no, attempt_token, band_rules, issued_by, expires_at)
  VALUES (a.id, a.vacancy_id, a.candidate_id, t.id, t.template_key, t.version,
          v_no, v_token, t.band_rules, auth.uid(),
          now() + make_interval(days => GREATEST(COALESCE(p_valid_days, 7), 1)))
  RETURNING * INTO v_attempt;

  INSERT INTO public.rec_profession_responses(
    attempt_id, question_id, question_key, question_version, question_type, question_snapshot,
    competency_code, competency_label, max_marks, critical_min, mandatory, sort_order, scoring_mode)
  SELECT v_attempt.id, q.id, q.question_key, q.version, q.question_type, to_jsonb(q),
         q.competency_code, q.competency_label, i.max_marks, i.critical_min, i.mandatory, i.sort_order,
         CASE WHEN q.question_type IN ('knowledge','multiple_choice') AND q.answer_key IS NOT NULL
              THEN 'auto' ELSE 'rubric' END
    FROM public.rec_assessment_template_items i
    JOIN public.rec_question_bank q ON q.id = i.question_id
   WHERE i.template_id = t.id AND q.publication_status = 'published';

  SELECT COALESCE(SUM(max_marks), 0) INTO v_max
    FROM public.rec_profession_responses WHERE attempt_id = v_attempt.id;
  IF v_max = 0 THEN RAISE EXCEPTION 'this paper has no published questions'; END IF;

  UPDATE public.rec_profession_attempts SET max_score = v_max WHERE id = v_attempt.id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id, 'attempt_token', v_token, 'attempt_no', v_no,
    'template_key', t.template_key, 'template_version', t.version,
    'max_score', v_max, 'expires_at', v_attempt.expires_at);
END; $function$;

CREATE OR REPLACE FUNCTION public.sales_lead_contact_link(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _lead_id uuid := (p->>'lead_id')::uuid; _tok text;
BEGIN
  IF NOT public._sales_lead_writable(_lead_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT contact_token INTO _tok FROM public.sales_leads WHERE id = _lead_id;
  IF _tok IS NULL THEN
    _tok := encode(extensions.gen_random_bytes(24), 'hex');
    UPDATE public.sales_leads SET contact_token = _tok, updated_at = now() WHERE id = _lead_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'token', _tok);
END $function$;