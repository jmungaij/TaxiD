-- Defense in depth for the anonymous recruitment upload path.
-- Previously the only ceilings were per-vacancy, global, and per-session file
-- count, so a single anonymous client could burn the shared budgets and any
-- gap in the session window was unbounded by client identity.

CREATE OR REPLACE FUNCTION public.rec_public_client_fingerprint()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_headers json;
  v_raw text;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    v_raw := coalesce(
      nullif(btrim(split_part(coalesce(v_headers ->> 'cf-connecting-ip', ''), ',', 1)), ''),
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-real-ip', ''), ',', 1)), ''),
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
    );
  END IF;

  IF v_raw IS NULL THEN
    BEGIN
      v_raw := host(inet_client_addr());
    EXCEPTION WHEN others THEN
      v_raw := NULL;
    END;
  END IF;

  IF v_raw IS NULL OR length(v_raw) = 0 OR length(v_raw) > 200 THEN
    -- Unknown origin is one shared bucket, deliberately not an exemption.
    RETURN 'unknown';
  END IF;

  RETURN left(md5('yalla-rec-upload:' || lower(v_raw)), 16);
END;
$function$;

REVOKE ALL ON FUNCTION public.rec_public_client_fingerprint() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_public_client_fingerprint() FROM anon;
REVOKE ALL ON FUNCTION public.rec_public_client_fingerprint() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rec_public_client_fingerprint() TO service_role;

CREATE OR REPLACE FUNCTION public.rec_public_upload_bump(_scope text, _window timestamptz, _limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hits integer;
BEGIN
  INSERT INTO public.rec_public_upload_counters AS c (scope, window_start, hits)
  VALUES (_scope, _window, 1)
  ON CONFLICT (scope, window_start)
  DO UPDATE SET hits = c.hits + 1, updated_at = now()
  RETURNING c.hits INTO v_hits;

  RETURN v_hits <= _limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.rec_public_upload_bump(text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_public_upload_bump(text, timestamptz, integer) FROM anon;
REVOKE ALL ON FUNCTION public.rec_public_upload_bump(text, timestamptz, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rec_public_upload_bump(text, timestamptz, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.rec_public_upload_reserve(_slug text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text;
  v_minute timestamptz := date_trunc('minute', now());
  v_hour timestamptz := date_trunc('hour', now());
BEGIN
  IF _slug IS NULL OR length(_slug) = 0 OR length(_slug) > 200 THEN
    RETURN false;
  END IF;

  v_ip := public.rec_public_client_fingerprint();

  -- Hard per-client ceiling first: an abusive client is stopped before it can
  -- consume the shared per-vacancy and global budgets.
  IF NOT public.rec_public_upload_bump('ip:' || v_ip || ':minute', v_minute, 8) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('ip:' || v_ip || ':hour', v_hour, 30) THEN
    RETURN false;
  END IF;

  IF NOT public.rec_public_upload_bump('slug:' || _slug || ':minute', v_minute, 15) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('slug:' || _slug || ':hour', v_hour, 60) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('global:minute', v_minute, 60) THEN
    RETURN false;
  END IF;
  IF NOT public.rec_public_upload_bump('global:hour', v_hour, 300) THEN
    RETURN false;
  END IF;

  DELETE FROM public.rec_public_upload_counters
   WHERE window_start < now() - interval '2 days';

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rec_public_upload_session_open(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text;
  v_hour timestamptz := date_trunc('hour', now());
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF p_slug IS NULL OR length(p_slug) = 0 OR length(p_slug) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SLUG');
  END IF;

  IF NOT public.rec_public_slug_is_open(p_slug) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VACANCY_NOT_OPEN');
  END IF;

  v_ip := public.rec_public_client_fingerprint();

  -- 6 sessions/hour per client, 30/hour per vacancy, 200/hour globally.
  IF NOT public.rec_public_upload_bump('session:ip:' || v_ip || ':hour', v_hour, 6) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  IF NOT public.rec_public_upload_bump('session:' || p_slug || ':hour', v_hour, 30) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;
  IF NOT public.rec_public_upload_bump('session:global:hour', v_hour, 200) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  END IF;

  INSERT INTO public.rec_public_upload_sessions (vacancy_slug)
  VALUES (p_slug)
  RETURNING id, expires_at INTO v_id, v_expires;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_id,
    'prefix', 'public-applications/' || p_slug || '/' || v_id::text || '/',
    'expires_at', v_expires
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rec_public_upload_session_allow(p_slug text, p_session text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_row public.rec_public_upload_sessions;
BEGIN
  IF p_slug IS NULL OR p_session IS NULL THEN
    RETURN false;
  END IF;
  IF length(p_slug) = 0 OR length(p_slug) > 200 THEN
    RETURN false;
  END IF;

  BEGIN
    v_id := p_session::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  SELECT * INTO v_row
    FROM public.rec_public_upload_sessions
   WHERE id = v_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN RETURN false; END IF;
  IF v_row.vacancy_slug <> p_slug THEN RETURN false; END IF;
  IF v_row.expires_at <= now() THEN RETURN false; END IF;
  -- Independent of expires_at, a session identifier can never be replayed
  -- beyond its issuance window even if that column were ever widened.
  IF v_row.created_at <= now() - interval '2 hours' THEN RETURN false; END IF;
  IF v_row.claimed_application_id IS NOT NULL THEN RETURN false; END IF;
  IF v_row.file_count >= 10 THEN RETURN false; END IF;

  -- Per-session burst cap: a real application uploads a handful of documents,
  -- never dozens inside one minute.
  IF NOT public.rec_public_upload_bump(
        'sess:' || v_id::text || ':minute', date_trunc('minute', now()), 4) THEN
    RETURN false;
  END IF;

  -- Session allowance is consumed only after every ceiling has cleared.
  IF NOT public.rec_public_upload_reserve(p_slug) THEN
    RETURN false;
  END IF;

  UPDATE public.rec_public_upload_sessions
     SET file_count = file_count + 1, updated_at = now()
   WHERE id = v_id;

  RETURN true;
END;
$function$;