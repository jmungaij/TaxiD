CREATE TABLE public.trip_delay_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  minutes_late int NOT NULL,
  predicted_arrival timestamptz NOT NULL,
  promised_arrival timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.trip_delay_alerts(trip_booking_id, created_at DESC);
GRANT SELECT ON public.trip_delay_alerts TO authenticated;
GRANT ALL ON public.trip_delay_alerts TO service_role;
ALTER TABLE public.trip_delay_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Trip parties see delay alerts" ON public.trip_delay_alerts FOR SELECT TO authenticated
  USING (private.trip_party_role(trip_booking_id) IS NOT NULL OR public.safety_is_operator());
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_delay_alerts;

CREATE OR REPLACE FUNCTION private.driver_post_location(_booking_id uuid, _lat numeric, _lng numeric, _speed_kmh numeric DEFAULT NULL::numeric, _heading numeric DEFAULT NULL::numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE b trip_bookings%ROWTYPE; tlat numeric; tlng numeric; dist_m numeric; spd numeric; eta int;
  prev record; jump_m numeric; secs numeric; v_pred timestamptz; v_late int;
BEGIN
  IF private.trip_party_role(_booking_id) IS DISTINCT FROM 'driver' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid position'; END IF;
  SELECT * INTO b FROM trip_bookings WHERE id=_booking_id;
  IF b.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok',false); END IF;
  SELECT lat, lng, recorded_at INTO prev FROM trip_tracking WHERE trip_booking_id=_booking_id ORDER BY recorded_at DESC LIMIT 1;
  IF FOUND THEN
    IF prev.recorded_at > now() - interval '4 seconds' THEN RETURN jsonb_build_object('ok',false,'throttled',true); END IF;
    secs := greatest(extract(epoch FROM now() - prev.recorded_at), 1);
    jump_m := 6371000 * 2 * asin(sqrt(power(sin(radians(_lat-prev.lat)/2),2) + cos(radians(prev.lat))*cos(radians(_lat))*power(sin(radians(_lng-prev.lng)/2),2)));
    IF secs < 600 AND jump_m / secs > 55 THEN RETURN jsonb_build_object('ok',false,'rejected','implausible_jump'); END IF;
  END IF;
  IF b.status = 'in_progress' THEN tlat := b.dropoff_lat; tlng := b.dropoff_lng; ELSE tlat := b.pickup_lat; tlng := b.pickup_lng; END IF;
  dist_m := 6371000 * 2 * asin(sqrt(power(sin(radians(tlat-_lat)/2),2) + cos(radians(_lat))*cos(radians(tlat))*power(sin(radians(tlng-_lng)/2),2)));
  spd := greatest(coalesce(nullif(_speed_kmh,0), 22), 12);
  eta := round((dist_m * 1.3) / (spd * 1000 / 3600.0));
  INSERT INTO trip_tracking(trip_booking_id, lat, lng, speed_kmh, heading, eta_seconds, recorded_at)
    VALUES (_booking_id, _lat, _lng, _speed_kmh, _heading, eta, now());
  IF b.status <> 'in_progress' AND b.pickup_eta IS NOT NULL THEN
    v_pred := now() + make_interval(secs => eta);
    v_late := floor(extract(epoch FROM v_pred - b.pickup_eta) / 60);
    IF v_late >= 3 AND NOT EXISTS (SELECT 1 FROM trip_delay_alerts WHERE trip_booking_id=_booking_id AND created_at > now() - interval '10 minutes') THEN
      INSERT INTO trip_delay_alerts(trip_booking_id, minutes_late, predicted_arrival, promised_arrival) VALUES (_booking_id, v_late, v_pred, b.pickup_eta);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'eta_seconds',eta,'distance_m',round(dist_m));
END $function$;