CREATE OR REPLACE FUNCTION public.driver_rides_self()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _driver public.drivers;
  _bps integer;
  _out jsonb;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _driver
    FROM public.drivers
   WHERE user_id = _caller
   ORDER BY created_at
   LIMIT 1;

  IF _driver.id IS NULL THEN
    RETURN jsonb_build_object(
      'is_driver', false,
      'currency', 'KES',
      'commission_bps', 1500,
      'available', '[]'::jsonb,
      'trips', '[]'::jsonb,
      'summary', jsonb_build_object(
        'available', 0, 'assigned', 0, 'in_progress', 0, 'completed', 0,
        'gross_cents', 0, 'commission_cents', 0, 'net_cents', 0, 'upcoming_net_cents', 0
      )
    );
  END IF;

  SELECT coalesce(commission_bps, 1500) INTO _bps FROM public.provider_settlement_settings LIMIT 1;
  _bps := coalesce(_bps, 1500);

  WITH mine AS (
    SELECT b.id,
           b.booking_number,
           b.pickup_address,
           b.dropoff_address,
           b.passenger_count,
           b.intent,
           b.status,
           b.payment_status,
           b.payment_method,
           coalesce(b.currency, 'KES') AS currency,
           b.scheduled_for,
           b.pickup_eta,
           b.started_at,
           b.completed_at,
           b.cancelled_at,
           round(coalesce(b.total_fare, 0) * 100)::bigint AS gross_cents,
           coalesce(
             b.commission_cents,
             round(coalesce(b.total_fare, 0) * 100 * _bps / 10000.0)::bigint
           ) AS commission_cents
      FROM public.trip_bookings b
     WHERE b.driver_id = _driver.id
  ),
  waiting AS (
    SELECT b.id,
           b.booking_number,
           b.pickup_address,
           b.dropoff_address,
           b.passenger_count,
           b.intent,
           b.status,
           coalesce(b.currency, 'KES') AS currency,
           b.scheduled_for,
           round(coalesce(b.total_fare, 0) * 100)::bigint AS gross_cents,
           round(coalesce(b.total_fare, 0) * 100 * (10000 - _bps) / 10000.0)::bigint AS net_cents
      FROM public.trip_bookings b
     WHERE b.driver_id IS NULL
       AND b.status IN ('pending', 'scheduled')
       AND b.cancelled_at IS NULL
     ORDER BY coalesce(b.scheduled_for, b.created_at)
     LIMIT 25
  )
  SELECT jsonb_build_object(
    'is_driver', true,
    'driver', jsonb_build_object(
      'id', _driver.id,
      'driver_code', _driver.driver_code,
      'status', _driver.status,
      'driver_type', _driver.driver_type,
      'rating', _driver.driver_rating
    ),
    'currency', coalesce((SELECT currency FROM mine LIMIT 1), 'KES'),
    'commission_bps', _bps,
    'available', coalesce((SELECT jsonb_agg(to_jsonb(w)) FROM waiting w), '[]'::jsonb),
    'trips', coalesce((
      SELECT jsonb_agg(to_jsonb(m) || jsonb_build_object('net_cents', m.gross_cents - m.commission_cents)
             ORDER BY coalesce(m.completed_at, m.started_at, m.scheduled_for) DESC NULLS LAST)
        FROM mine m
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'available', (SELECT count(*) FROM waiting),
      'assigned', (SELECT count(*) FROM mine WHERE status IN ('assigned', 'scheduled', 'pending')),
      'in_progress', (SELECT count(*) FROM mine WHERE status IN ('in_progress', 'started', 'arrived')),
      'completed', (SELECT count(*) FROM mine WHERE status = 'completed'),
      'gross_cents', (SELECT coalesce(sum(gross_cents), 0) FROM mine WHERE status = 'completed'),
      'commission_cents', (SELECT coalesce(sum(commission_cents), 0) FROM mine WHERE status = 'completed'),
      'net_cents', (SELECT coalesce(sum(gross_cents - commission_cents), 0) FROM mine WHERE status = 'completed'),
      'upcoming_net_cents', (SELECT coalesce(sum(gross_cents - commission_cents), 0) FROM mine
                              WHERE status IN ('assigned', 'scheduled', 'pending', 'in_progress', 'started', 'arrived'))
    )
  ) INTO _out;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_rides_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_rides_self() TO authenticated;