-- Meet-me messages
CREATE TABLE public.trip_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL DEFAULT auth.uid(),
  sender_role text NOT NULL CHECK (sender_role IN ('rider','driver')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.trip_messages(trip_booking_id, created_at);
GRANT SELECT, INSERT ON public.trip_messages TO authenticated;
GRANT ALL ON public.trip_messages TO service_role;
ALTER TABLE public.trip_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.trip_party_role(_booking_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN b.rider_user_id = auth.uid() THEN 'rider'
    WHEN EXISTS (SELECT 1 FROM drivers d WHERE d.id = b.driver_id AND d.user_id = auth.uid()) THEN 'driver'
  END FROM trip_bookings b WHERE b.id = _booking_id
$$;
REVOKE ALL ON FUNCTION private.trip_party_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trip_party_role(uuid) TO authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE POLICY "Trip parties read messages" ON public.trip_messages FOR SELECT TO authenticated
  USING (private.trip_party_role(trip_booking_id) IS NOT NULL);
CREATE POLICY "Trip parties send messages" ON public.trip_messages FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid() AND sender_role = private.trip_party_role(trip_booking_id)
    AND EXISTS (SELECT 1 FROM trip_bookings b WHERE b.id = trip_booking_id AND b.status NOT IN ('completed','cancelled')));
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_messages;

-- Pickup meeting points
CREATE TABLE public.pickup_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_name text NOT NULL,
  point_name text NOT NULL,
  landmark text,
  lat numeric NOT NULL,
  lng numeric NOT NULL,
  radius_m int NOT NULL DEFAULT 400 CHECK (radius_m BETWEEN 50 AND 3000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pickup_points TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pickup_points TO authenticated;
GRANT ALL ON public.pickup_points TO service_role;
ALTER TABLE public.pickup_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active pickup points are public" ON public.pickup_points FOR SELECT USING (is_active OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Admins manage pickup points" ON public.pickup_points FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

ALTER TABLE public.trip_bookings ADD COLUMN IF NOT EXISTS meeting_point_id uuid REFERENCES public.pickup_points(id);

CREATE OR REPLACE FUNCTION private.trip_set_meeting_point(_booking_id uuid, _point_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF private.trip_party_role(_booking_id) IS DISTINCT FROM 'rider' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _point_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pickup_points WHERE id=_point_id AND is_active) THEN RAISE EXCEPTION 'Unknown meeting point'; END IF;
  UPDATE trip_bookings SET meeting_point_id = _point_id WHERE id=_booking_id AND status NOT IN ('in_progress','completed','cancelled');
END $$;
REVOKE ALL ON FUNCTION private.trip_set_meeting_point(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trip_set_meeting_point(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.trip_set_meeting_point(_booking_id uuid, _point_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.trip_set_meeting_point(_booking_id,_point_id) $$;
GRANT EXECUTE ON FUNCTION public.trip_set_meeting_point(uuid,uuid) TO authenticated;

-- Driver live location with server-computed ETA
DROP POLICY IF EXISTS "Driver inserts tracking" ON public.trip_tracking;
CREATE OR REPLACE FUNCTION private.driver_post_location(_booking_id uuid, _lat numeric, _lng numeric, _speed_kmh numeric DEFAULT NULL, _heading numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b trip_bookings%ROWTYPE; tlat numeric; tlng numeric; dist_m numeric; spd numeric; eta int; last_at timestamptz;
BEGIN
  IF private.trip_party_role(_booking_id) IS DISTINCT FROM 'driver' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'Invalid position'; END IF;
  SELECT * INTO b FROM trip_bookings WHERE id=_booking_id;
  IF b.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok',false); END IF;
  SELECT max(recorded_at) INTO last_at FROM trip_tracking WHERE trip_booking_id=_booking_id;
  IF last_at > now() - interval '4 seconds' THEN RETURN jsonb_build_object('ok',false,'throttled',true); END IF;
  IF b.status = 'in_progress' THEN tlat := b.dropoff_lat; tlng := b.dropoff_lng; ELSE tlat := b.pickup_lat; tlng := b.pickup_lng; END IF;
  dist_m := 6371000 * 2 * asin(sqrt(power(sin(radians(tlat-_lat)/2),2) + cos(radians(_lat))*cos(radians(tlat))*power(sin(radians(tlng-_lng)/2),2)));
  spd := greatest(coalesce(nullif(_speed_kmh,0), 22), 12); -- urban average fallback
  eta := round((dist_m * 1.3) / (spd * 1000 / 3600.0));
  INSERT INTO trip_tracking(trip_booking_id, lat, lng, speed_kmh, heading, eta_seconds, recorded_at)
    VALUES (_booking_id, _lat, _lng, _speed_kmh, _heading, eta, now());
  RETURN jsonb_build_object('ok',true,'eta_seconds',eta,'distance_m',round(dist_m));
END $$;
REVOKE ALL ON FUNCTION private.driver_post_location(uuid,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.driver_post_location(uuid,numeric,numeric,numeric,numeric) TO authenticated;
CREATE OR REPLACE FUNCTION public.driver_post_location(_booking_id uuid, _lat numeric, _lng numeric, _speed_kmh numeric DEFAULT NULL, _heading numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.driver_post_location(_booking_id,_lat,_lng,_speed_kmh,_heading) $$;
GRANT EXECUTE ON FUNCTION public.driver_post_location(uuid,numeric,numeric,numeric,numeric) TO authenticated;

-- Tips (paid from the M-Pesa-funded rider wallet)
CREATE TABLE public.trip_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL UNIQUE REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  rider_user_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0 AND amount <= 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trip_tips TO authenticated;
GRANT ALL ON public.trip_tips TO service_role;
ALTER TABLE public.trip_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rider and driver see tip" ON public.trip_tips FOR SELECT TO authenticated
  USING (rider_user_id = auth.uid() OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_id AND d.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION private.trip_tip_driver(_booking_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b trip_bookings%ROWTYPE; w wallets%ROWTYPE; c bigint;
BEGIN
  SELECT * INTO b FROM trip_bookings WHERE id=_booking_id AND rider_user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF b.status <> 'completed' OR b.driver_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','TRIP_NOT_COMPLETED'); END IF;
  IF EXISTS (SELECT 1 FROM trip_tips WHERE trip_booking_id=_booking_id) THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_TIPPED'); END IF;
  IF _amount IS NULL OR _amount < 10 OR _amount > 5000 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_AMOUNT'); END IF;
  c := round(_amount*100)::bigint;
  SELECT * INTO w FROM wallets WHERE user_id=auth.uid() AND wallet_type='personal' AND lifecycle_status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NO_WALLET'); END IF;
  IF w.balance_cents < c THEN RETURN jsonb_build_object('ok',false,'error','INSUFFICIENT_FUNDS','balance',w.balance_cents/100.0); END IF;
  UPDATE wallets SET balance_cents = balance_cents - c WHERE id=w.id;
  INSERT INTO wallet_transactions(wallet_id,user_id,direction,amount_cents,kind,status,reference,metadata)
    VALUES (w.id, auth.uid(), 'debit', c, 'trip_charge', 'completed', 'TIP-'||b.booking_number, jsonb_build_object('source','driver_tip','trip_booking_id',b.id));
  INSERT INTO trip_tips(trip_booking_id, rider_user_id, driver_id, amount) VALUES (b.id, auth.uid(), b.driver_id, round(_amount,2));
  RETURN jsonb_build_object('ok',true,'wallet_balance',(w.balance_cents-c)/100.0);
END $$;
REVOKE ALL ON FUNCTION private.trip_tip_driver(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trip_tip_driver(uuid,numeric) TO authenticated;
CREATE OR REPLACE FUNCTION public.trip_tip_driver(_booking_id uuid, _amount numeric) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.trip_tip_driver(_booking_id,_amount) $$;
GRANT EXECUTE ON FUNCTION public.trip_tip_driver(uuid,numeric) TO authenticated;