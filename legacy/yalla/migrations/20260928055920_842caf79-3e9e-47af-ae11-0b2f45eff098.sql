CREATE OR REPLACE FUNCTION public.issue_trip_share_token(
  _trip_booking_id uuid,
  _token_hash text,
  _pin_hash text,
  _ttl_seconds int,
  _max_uses int
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid;
  is_owner boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.trip_bookings b
    WHERE b.id = _trip_booking_id AND b.rider_user_id = auth.uid()
  ) INTO is_owner;
  IF NOT is_owner AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _ttl_seconds IS NULL OR _ttl_seconds <= 0 OR _ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_ttl';
  END IF;
  INSERT INTO public.trip_share_tokens(
    trip_booking_id, owner_id, token_hash, pin_hash, expires_at, max_uses
  ) VALUES (
    _trip_booking_id, auth.uid(), _token_hash, _pin_hash,
    now() + make_interval(secs => _ttl_seconds),
    COALESCE(_max_uses, 1)
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_trip_share_token(uuid, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_trip_share_token(uuid, text, text, int, int) TO authenticated;