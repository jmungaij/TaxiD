
-- 1) Lockout tracking table
CREATE TABLE IF NOT EXISTS public.trip_share_lockouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('ip','token')),
  key text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);
GRANT SELECT ON public.trip_share_lockouts TO authenticated;
GRANT ALL ON public.trip_share_lockouts TO service_role;
ALTER TABLE public.trip_share_lockouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read lockouts" ON public.trip_share_lockouts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'super_admin'::app_role));

-- 2) Rate-limited redeem: max 5 failures per ip OR token in 10 min => 15 min lockout
CREATE OR REPLACE FUNCTION public.redeem_trip_share_token(
  _token_hash text, _pin_hash text, _ip inet, _user_agent text
) RETURNS TABLE(trip_booking_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.trip_share_tokens%ROWTYPE;
  result_outcome text;
  ip_key text := coalesce(host(_ip), 'unknown');
  ip_locked timestamptz;
  tok_locked timestamptz;
  fail_window_start timestamptz := now() - interval '10 minutes';
  ip_recent_fails int;
  tok_recent_fails int;
BEGIN
  -- Check existing lockouts
  SELECT locked_until INTO ip_locked FROM public.trip_share_lockouts
    WHERE scope='ip' AND key=ip_key AND locked_until > now();
  SELECT locked_until INTO tok_locked FROM public.trip_share_lockouts
    WHERE scope='token' AND key=_token_hash AND locked_until > now();
  IF ip_locked IS NOT NULL OR tok_locked IS NOT NULL THEN
    INSERT INTO public.trip_share_access_log(token_hash, ip, user_agent, outcome)
      VALUES (_token_hash, _ip, _user_agent, 'invalid');
    RETURN QUERY SELECT NULL::uuid, 'locked'::text;
    RETURN;
  END IF;

  SELECT * INTO t FROM public.trip_share_tokens WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    result_outcome := 'invalid';
  ELSIF t.revoked_at IS NOT NULL THEN result_outcome := 'revoked';
  ELSIF t.expires_at < now() THEN  result_outcome := 'expired';
  ELSIF t.used_count >= t.max_uses THEN result_outcome := 'exhausted';
  ELSIF t.pin_hash IS NOT NULL AND _pin_hash IS NULL THEN result_outcome := 'pin_required';
  ELSIF t.pin_hash IS NOT NULL AND t.pin_hash <> _pin_hash THEN result_outcome := 'pin_wrong';
  ELSE
    UPDATE public.trip_share_tokens SET used_count = used_count + 1 WHERE id = t.id;
    result_outcome := 'ok';
  END IF;

  INSERT INTO public.trip_share_access_log(token_hash, trip_booking_id, ip, user_agent, outcome)
    VALUES (_token_hash, t.trip_booking_id, _ip, _user_agent, result_outcome);

  IF result_outcome IN ('invalid','pin_wrong','revoked','expired','exhausted') THEN
    SELECT count(*) INTO ip_recent_fails FROM public.trip_share_access_log
      WHERE ip = _ip AND accessed_at > fail_window_start
        AND outcome IN ('invalid','pin_wrong','revoked','expired','exhausted');
    SELECT count(*) INTO tok_recent_fails FROM public.trip_share_access_log
      WHERE token_hash = _token_hash AND accessed_at > fail_window_start
        AND outcome IN ('invalid','pin_wrong','revoked','expired','exhausted');

    INSERT INTO public.trip_share_lockouts(scope,key,failed_count,last_failed_at,locked_until)
      VALUES ('ip', ip_key, ip_recent_fails, now(),
              CASE WHEN ip_recent_fails >= 5 THEN now()+interval '15 minutes' ELSE NULL END)
      ON CONFLICT (scope,key) DO UPDATE
        SET failed_count = EXCLUDED.failed_count,
            last_failed_at = now(),
            locked_until = CASE WHEN EXCLUDED.failed_count >= 5 THEN now()+interval '15 minutes' ELSE trip_share_lockouts.locked_until END,
            updated_at = now();

    INSERT INTO public.trip_share_lockouts(scope,key,failed_count,last_failed_at,locked_until)
      VALUES ('token', _token_hash, tok_recent_fails, now(),
              CASE WHEN tok_recent_fails >= 5 THEN now()+interval '15 minutes' ELSE NULL END)
      ON CONFLICT (scope,key) DO UPDATE
        SET failed_count = EXCLUDED.failed_count,
            last_failed_at = now(),
            locked_until = CASE WHEN EXCLUDED.failed_count >= 5 THEN now()+interval '15 minutes' ELSE trip_share_lockouts.locked_until END,
            updated_at = now();
  END IF;

  RETURN QUERY SELECT CASE WHEN result_outcome='ok' THEN t.trip_booking_id ELSE NULL END, result_outcome;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.redeem_trip_share_token(text,text,inet,text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_trip_share_token(text,text,inet,text) TO service_role;

-- Allow outcome 'locked' in access log
ALTER TABLE public.trip_share_access_log DROP CONSTRAINT IF EXISTS trip_share_access_log_outcome_check;
ALTER TABLE public.trip_share_access_log ADD CONSTRAINT trip_share_access_log_outcome_check
  CHECK (outcome IN ('ok','invalid','expired','revoked','exhausted','pin_required','pin_wrong','locked'));

-- 3) Admin revoke RPC (owner or admin)
CREATE OR REPLACE FUNCTION public.revoke_trip_share_token(_token_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.trip_share_tokens
    SET revoked_at = now(), revoked_by = auth.uid()
    WHERE id = _token_id
      AND (owner_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'super_admin'::app_role))
      AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_authorized_or_already_revoked'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.revoke_trip_share_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_trip_share_token(uuid) TO authenticated;

-- 4) Regenerate: revokes any active tokens for a trip and issues a new one.
-- Returns the raw token so caller can build the URL. Owner or admin only.
CREATE OR REPLACE FUNCTION public.regenerate_trip_share_token(
  _trip_booking_id uuid,
  _token_hash text,
  _pin_hash text,
  _ttl_minutes int,
  _max_uses int
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  new_id uuid;
  owner uuid;
BEGIN
  SELECT rider_id INTO owner FROM public.trip_bookings WHERE id = _trip_booking_id;
  IF owner IS NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF NOT (owner = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.trip_share_tokens
    SET revoked_at = now(), revoked_by = auth.uid()
    WHERE trip_booking_id = _trip_booking_id AND revoked_at IS NULL;
  INSERT INTO public.trip_share_tokens(trip_booking_id, owner_id, token_hash, pin_hash, expires_at, max_uses)
    VALUES (_trip_booking_id, auth.uid(), _token_hash, _pin_hash,
            now() + make_interval(mins => coalesce(_ttl_minutes, 60)),
            coalesce(_max_uses, 1))
    RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.regenerate_trip_share_token(uuid,text,text,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_trip_share_token(uuid,text,text,int,int) TO authenticated;
