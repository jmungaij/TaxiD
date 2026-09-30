
CREATE OR REPLACE FUNCTION public.trip_share_lockout_alert_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_threshold   INT := 5;
  v_window_min  INT := 10;
  v_count       INT;
  v_bucket      BIGINT;
  v_idem        TEXT;
BEGIN
  IF NEW.outcome <> 'locked' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.trip_share_access_log
  WHERE outcome = 'locked'
    AND accessed_at >= NOW() - (v_window_min || ' minutes')::interval
    AND COALESCE(ip::text, 'unknown') = COALESCE(NEW.ip::text, 'unknown')
    AND COALESCE(trip_booking_id::text, 'unknown') = COALESCE(NEW.trip_booking_id::text, 'unknown');

  IF v_count < v_threshold THEN
    RETURN NEW;
  END IF;

  -- 5-minute idempotency bucket per (ip, trip) prevents duplicate alerts.
  v_bucket := EXTRACT(EPOCH FROM NOW())::BIGINT / 300;
  v_idem := 'tsl:' || v_bucket::text
         || ':' || COALESCE(NEW.ip::text, 'unknown')
         || '|' || COALESCE(NEW.trip_booking_id::text, 'unknown');

  INSERT INTO public.alerts_events (alert_type, severity, idempotency_key, payload, source)
  VALUES (
    'trip_share_lockout_spike',
    'high',
    v_idem,
    jsonb_build_object(
      'ip', NEW.ip,
      'trip_booking_id', NEW.trip_booking_id,
      'count', v_count,
      'window_min', v_window_min,
      'threshold', v_threshold
    ),
    'trip_share_lockout_trigger'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trip_share_lockout_alert_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trip_share_lockout_alert ON public.trip_share_access_log;
CREATE TRIGGER trg_trip_share_lockout_alert
  AFTER INSERT ON public.trip_share_access_log
  FOR EACH ROW
  WHEN (NEW.outcome = 'locked')
  EXECUTE FUNCTION public.trip_share_lockout_alert_trigger();
