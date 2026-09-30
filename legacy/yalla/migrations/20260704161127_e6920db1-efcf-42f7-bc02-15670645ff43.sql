CREATE OR REPLACE FUNCTION public.trg_scan_location_stream()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  _prior       RECORD;
  _prior_json  jsonb := NULL;
  _payload     jsonb;
BEGIN
  IF NEW.lat IS NULL OR NEW.lng IS NULL THEN
    RETURN NEW;
  END IF;

  -- Most recent prior sample in the same tracking session
  IF NEW.session_id IS NOT NULL THEN
    SELECT lat, lng, recorded_at
      INTO _prior
      FROM public.location_streams
      WHERE session_id = NEW.session_id
        AND id <> NEW.id
        AND recorded_at < NEW.recorded_at
      ORDER BY recorded_at DESC
      LIMIT 1;

    IF FOUND THEN
      _prior_json := jsonb_build_object(
        'lat', _prior.lat,
        'lng', _prior.lng,
        'timestamp', to_char(_prior.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    END IF;
  END IF;

  _payload := jsonb_build_object(
    'driver_id', NEW.subject_id,
    'reported', jsonb_build_object(
      'lat', NEW.lat,
      'lng', NEW.lng,
      'speed_kph', NEW.speed_kph,
      'timestamp', to_char(NEW.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'device', '{}'::jsonb
  );

  IF _prior_json IS NOT NULL THEN
    _payload := _payload || jsonb_build_object('prior', _prior_json);
  END IF;

  PERFORM net.http_post(
    url     := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/gps-integrity-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ'
    ),
    body    := _payload,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS location_streams_after_insert_scan ON public.location_streams;
CREATE TRIGGER location_streams_after_insert_scan
AFTER INSERT ON public.location_streams
FOR EACH ROW EXECUTE FUNCTION public.trg_scan_location_stream();