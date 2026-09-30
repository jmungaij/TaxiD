-- The OUT parameter `outcome` shadowed trip_share_access_log.outcome, so the
-- failed-attempt counts raised 42702 (ambiguous column) on EVERY failed
-- redemption. The lockout logic therefore never ran. Qualify all column
-- references against table aliases.
CREATE OR REPLACE FUNCTION public.redeem_trip_share_token(_token_hash text, _pin_hash text, _ip inet, _user_agent text)
 RETURNS TABLE(trip_booking_id uuid, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.trip_share_tokens%ROWTYPE;
  result_outcome text;
  ip_key text := coalesce(host(_ip), 'unknown');
  ip_locked timestamptz;
  tok_locked timestamptz;
  fail_window_start timestamptz := now() - interval '10 minutes';
  ip_recent_fails int;
  tok_recent_fails int;
  failure_outcomes text[] := ARRAY['invalid','pin_wrong','pin_required','revoked','expired','exhausted'];
BEGIN
  SELECT l.locked_until INTO ip_locked FROM public.trip_share_lockouts l
    WHERE l.scope = 'ip' AND l.key = ip_key AND l.locked_until > now();
  SELECT l.locked_until INTO tok_locked FROM public.trip_share_lockouts l
    WHERE l.scope = 'token' AND l.key = _token_hash AND l.locked_until > now();
  IF ip_locked IS NOT NULL OR tok_locked IS NOT NULL THEN
    INSERT INTO public.trip_share_access_log(token_hash, ip, user_agent, outcome)
      VALUES (_token_hash, _ip, _user_agent, 'invalid');
    RETURN QUERY SELECT NULL::uuid, 'locked'::text;
    RETURN;
  END IF;

  SELECT * INTO t FROM public.trip_share_tokens tok
    WHERE tok.token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    result_outcome := 'invalid';
  ELSIF t.revoked_at IS NOT NULL THEN result_outcome := 'revoked';
  ELSIF t.expires_at < now() THEN result_outcome := 'expired';
  ELSIF t.used_count >= t.max_uses THEN result_outcome := 'exhausted';
  ELSIF t.pin_hash IS NOT NULL AND _pin_hash IS NULL THEN result_outcome := 'pin_required';
  ELSIF t.pin_hash IS NOT NULL AND t.pin_hash <> _pin_hash THEN result_outcome := 'pin_wrong';
  ELSE
    UPDATE public.trip_share_tokens tok SET used_count = tok.used_count + 1 WHERE tok.id = t.id;
    result_outcome := 'ok';
  END IF;

  INSERT INTO public.trip_share_access_log(token_hash, trip_booking_id, ip, user_agent, outcome)
    VALUES (_token_hash, t.trip_booking_id, _ip, _user_agent, result_outcome);

  IF result_outcome = ANY (failure_outcomes) THEN
    SELECT count(*) INTO ip_recent_fails FROM public.trip_share_access_log al
      WHERE al.ip = _ip AND al.accessed_at > fail_window_start
        AND al.outcome = ANY (failure_outcomes);
    SELECT count(*) INTO tok_recent_fails FROM public.trip_share_access_log al
      WHERE al.token_hash = _token_hash AND al.accessed_at > fail_window_start
        AND al.outcome = ANY (failure_outcomes);

    INSERT INTO public.trip_share_lockouts(scope, key, failed_count, last_failed_at, locked_until)
      VALUES ('ip', ip_key, ip_recent_fails, now(),
              CASE WHEN ip_recent_fails >= 5 THEN now() + interval '15 minutes' END)
      ON CONFLICT (scope, key) DO UPDATE
        SET failed_count = EXCLUDED.failed_count,
            last_failed_at = now(),
            locked_until = CASE WHEN EXCLUDED.failed_count >= 5
                                THEN now() + interval '15 minutes'
                                ELSE trip_share_lockouts.locked_until END,
            updated_at = now();

    INSERT INTO public.trip_share_lockouts(scope, key, failed_count, last_failed_at, locked_until)
      VALUES ('token', _token_hash, tok_recent_fails, now(),
              CASE WHEN tok_recent_fails >= 5 THEN now() + interval '15 minutes' END)
      ON CONFLICT (scope, key) DO UPDATE
        SET failed_count = EXCLUDED.failed_count,
            last_failed_at = now(),
            locked_until = CASE WHEN EXCLUDED.failed_count >= 5
                                THEN now() + interval '15 minutes'
                                ELSE trip_share_lockouts.locked_until END,
            updated_at = now();
  END IF;

  RETURN QUERY SELECT CASE WHEN result_outcome = 'ok' THEN t.trip_booking_id END, result_outcome;
END;
$function$;