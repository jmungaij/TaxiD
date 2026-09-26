CREATE TYPE public.wallet_type AS ENUM ('personal','driver','corporate');
CREATE TYPE public.txn_direction AS ENUM ('credit','debit');
CREATE TYPE public.txn_kind AS ENUM ('topup','payout','trip_charge','refund','adjustment');
CREATE TYPE public.txn_status AS ENUM ('pending','completed','failed');
CREATE TYPE public.mpesa_status AS ENUM ('pending','success','failed');

CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_type wallet_type NOT NULL DEFAULT 'personal',
  balance_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KES',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, wallet_type)
);
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own wallets" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction txn_direction NOT NULL,
  amount_cents BIGINT NOT NULL,
  kind txn_kind NOT NULL,
  status txn_status NOT NULL DEFAULT 'pending',
  mpesa_receipt TEXT,
  reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own wallet txns" ON public.wallet_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wtxn_updated BEFORE UPDATE ON public.wallet_transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_wtxn_wallet ON public.wallet_transactions(wallet_id, created_at DESC);

CREATE TABLE public.mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  account_reference TEXT,
  merchant_request_id TEXT,
  checkout_request_id TEXT UNIQUE,
  result_code INT,
  result_desc TEXT,
  mpesa_receipt TEXT,
  status mpesa_status NOT NULL DEFAULT 'pending',
  raw_callback JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mpesa_transactions TO authenticated;
GRANT ALL ON public.mpesa_transactions TO service_role;
ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own mpesa" ON public.mpesa_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_mpesa_updated BEFORE UPDATE ON public.mpesa_transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.credit_wallet(_wallet_id UUID, _amount_cents BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.wallets SET balance_cents = balance_cents + _amount_cents, updated_at = now() WHERE id = _wallet_id;
END; $$;
REVOKE ALL ON FUNCTION public.credit_wallet(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(UUID, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.debit_wallet(_wallet_id UUID, _amount_cents BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal BIGINT;
BEGIN
  SELECT balance_cents INTO _bal FROM public.wallets WHERE id = _wallet_id FOR UPDATE;
  IF _bal IS NULL OR _bal < _amount_cents THEN RETURN false; END IF;
  UPDATE public.wallets SET balance_cents = balance_cents - _amount_cents, updated_at = now() WHERE id = _wallet_id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.debit_wallet(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet(UUID, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE public.rider_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text, middle_name text, last_name text, display_name text,
  gender text, date_of_birth date, phone_number text,
  country_code text DEFAULT 'KE', email text, photo_url text,
  preferred_language text DEFAULT 'en', accessibility_needs text[],
  status text NOT NULL DEFAULT 'active',
  rider_tier text NOT NULL DEFAULT 'standard',
  lifetime_trips int NOT NULL DEFAULT 0,
  lifetime_spend numeric(14,2) NOT NULL DEFAULT 0,
  rating_avg numeric(3,2) NOT NULL DEFAULT 5.0,
  rating_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.rider_profiles TO authenticated;
GRANT ALL ON public.rider_profiles TO service_role;
ALTER TABLE public.rider_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rider sees own profile" ON public.rider_profiles FOR SELECT USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));
CREATE POLICY "Rider updates own profile" ON public.rider_profiles FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Rider inserts own profile" ON public.rider_profiles FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE TRIGGER tg_rider_profiles_updated BEFORE UPDATE ON public.rider_profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.rider_kyc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id_type text NOT NULL, id_number text NOT NULL,
  country text NOT NULL DEFAULT 'KE', document_url text,
  verification_status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz, rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.rider_kyc TO authenticated;
GRANT ALL ON public.rider_kyc TO service_role;
ALTER TABLE public.rider_kyc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rider sees own kyc" ON public.rider_kyc FOR SELECT USING (rider_user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Rider inserts own kyc" ON public.rider_kyc FOR INSERT WITH CHECK (rider_user_id = auth.uid());
CREATE POLICY "Rider updates own kyc" ON public.rider_kyc FOR UPDATE USING (rider_user_id = auth.uid());
CREATE TRIGGER tg_rider_kyc_updated BEFORE UPDATE ON public.rider_kyc FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.favorite_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL, icon text DEFAULT 'pin', address text NOT NULL,
  lat numeric(10,7) NOT NULL, lng numeric(10,7) NOT NULL,
  place_id text, sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorite_locations TO authenticated;
GRANT ALL ON public.favorite_locations TO service_role;
ALTER TABLE public.favorite_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own favorites" ON public.favorite_locations FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_fav_user ON public.favorite_locations(user_id);

CREATE TABLE public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL, relationship text, phone_number text NOT NULL, email text,
  is_primary boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO authenticated;
GRANT ALL ON public.emergency_contacts TO service_role;
ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own contacts" ON public.emergency_contacts FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.ride_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE, name text NOT NULL, description text,
  capacity int NOT NULL DEFAULT 4,
  base_fare numeric(10,2) NOT NULL DEFAULT 200,
  per_km_rate numeric(10,2) NOT NULL DEFAULT 60,
  per_minute_rate numeric(10,2) NOT NULL DEFAULT 4,
  minimum_fare numeric(10,2) NOT NULL DEFAULT 250,
  cancellation_fee numeric(10,2) NOT NULL DEFAULT 100,
  icon text DEFAULT 'car', is_active boolean NOT NULL DEFAULT true, sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ride_types TO authenticated, anon;
GRANT ALL ON public.ride_types TO service_role;
ALTER TABLE public.ride_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public ride types" ON public.ride_types FOR SELECT USING (is_active);
CREATE POLICY "Admin manages ride types" ON public.ride_types FOR ALL USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
INSERT INTO public.ride_types(code,name,description,capacity,base_fare,per_km_rate,per_minute_rate,minimum_fare,icon,sort_order) VALUES
('basic','SAFARID Basic','Affordable everyday rides',4,150,55,3,200,'car',1),
('standard','SAFARID Standard','Comfortable sedans',4,200,65,4,300,'car',2),
('xl','SAFARID XL','Group rides up to 6',6,300,85,5,450,'van',3),
('executive','SAFARID Executive','Premium executive transport',4,500,140,8,800,'crown',4),
('airport','SAFARID Airport','Fixed-price airport transfers',4,400,100,6,600,'plane',5),
('coach','SAFARID Tour Coach','10-33 seat coaches',33,2000,250,15,3000,'bus',6);

CREATE TABLE public.trip_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pickup_address text NOT NULL, pickup_lat numeric(10,7) NOT NULL, pickup_lng numeric(10,7) NOT NULL,
  dropoff_address text NOT NULL, dropoff_lat numeric(10,7) NOT NULL, dropoff_lng numeric(10,7) NOT NULL,
  ride_type_id uuid REFERENCES public.ride_types(id),
  passenger_count int NOT NULL DEFAULT 1,
  estimated_distance_km numeric(8,2), estimated_duration_min int, estimated_fare numeric(10,2),
  surge_multiplier numeric(4,2) DEFAULT 1.0, intent text DEFAULT 'personal',
  status text NOT NULL DEFAULT 'created',
  requested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.trip_requests TO authenticated;
GRANT ALL ON public.trip_requests TO service_role;
ALTER TABLE public.trip_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own trip requests" ON public.trip_requests FOR ALL USING (rider_user_id = auth.uid()) WITH CHECK (rider_user_id = auth.uid());
CREATE POLICY "Admin reads requests" ON public.trip_requests FOR SELECT USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE INDEX idx_trip_req_status ON public.trip_requests(status);
CREATE INDEX idx_trip_req_rider ON public.trip_requests(rider_user_id);
CREATE INDEX idx_trip_req_requested ON public.trip_requests(requested_at DESC);

CREATE TABLE public.trip_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_request_id uuid NOT NULL REFERENCES public.trip_requests(id) ON DELETE CASCADE,
  ride_type_id uuid REFERENCES public.ride_types(id),
  distance_km numeric(8,2), duration_min int,
  base_fare numeric(10,2), distance_fare numeric(10,2), time_fare numeric(10,2),
  surge_multiplier numeric(4,2) DEFAULT 1.0, discount numeric(10,2) DEFAULT 0, taxes numeric(10,2) DEFAULT 0,
  total_fare numeric(10,2) NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trip_quotes TO authenticated;
GRANT ALL ON public.trip_quotes TO service_role;
ALTER TABLE public.trip_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own quotes" ON public.trip_quotes FOR SELECT USING (EXISTS(SELECT 1 FROM public.trip_requests r WHERE r.id = trip_request_id AND r.rider_user_id = auth.uid()));
CREATE POLICY "Insert quotes" ON public.trip_quotes FOR INSERT WITH CHECK (EXISTS(SELECT 1 FROM public.trip_requests r WHERE r.id = trip_request_id AND r.rider_user_id = auth.uid()));

CREATE TABLE public.trip_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number text NOT NULL UNIQUE DEFAULT ('YR-TR-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  rider_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_request_id uuid REFERENCES public.trip_requests(id),
  trip_quote_id uuid REFERENCES public.trip_quotes(id),
  ride_type_id uuid REFERENCES public.ride_types(id),
  driver_id uuid, vehicle_id uuid,
  pickup_address text NOT NULL, pickup_lat numeric(10,7) NOT NULL, pickup_lng numeric(10,7) NOT NULL,
  dropoff_address text NOT NULL, dropoff_lat numeric(10,7) NOT NULL, dropoff_lng numeric(10,7) NOT NULL,
  passenger_count int NOT NULL DEFAULT 1, intent text DEFAULT 'personal', payment_method text DEFAULT 'wallet',
  total_fare numeric(10,2), surge_multiplier numeric(4,2) DEFAULT 1.0,
  status text NOT NULL DEFAULT 'pending',
  scheduled_for timestamptz, pickup_eta timestamptz, started_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, cancellation_reason text, cancelled_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.trip_bookings TO authenticated;
GRANT ALL ON public.trip_bookings TO service_role;
ALTER TABLE public.trip_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own bookings" ON public.trip_bookings FOR SELECT USING (rider_user_id = auth.uid() OR driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));
CREATE POLICY "Rider creates booking" ON public.trip_bookings FOR INSERT WITH CHECK (rider_user_id = auth.uid());
CREATE POLICY "Rider/driver update booking" ON public.trip_bookings FOR UPDATE USING (rider_user_id = auth.uid() OR driver_id = auth.uid());
CREATE INDEX idx_book_status ON public.trip_bookings(status);
CREATE INDEX idx_book_rider ON public.trip_bookings(rider_user_id);
CREATE INDEX idx_book_driver ON public.trip_bookings(driver_id);
CREATE INDEX idx_book_scheduled ON public.trip_bookings(scheduled_for);
CREATE TRIGGER tg_book_updated BEFORE UPDATE ON public.trip_bookings FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.trip_waypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  seq int NOT NULL, address text NOT NULL, lat numeric(10,7) NOT NULL, lng numeric(10,7) NOT NULL,
  arrived_at timestamptz, departed_at timestamptz
);
GRANT SELECT, INSERT ON public.trip_waypoints TO authenticated;
GRANT ALL ON public.trip_waypoints TO service_role;
ALTER TABLE public.trip_waypoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Booking waypoints" ON public.trip_waypoints FOR SELECT USING (EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND (b.rider_user_id = auth.uid() OR b.driver_id = auth.uid())));
CREATE POLICY "Insert waypoints" ON public.trip_waypoints FOR INSERT WITH CHECK (EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND b.rider_user_id = auth.uid()));

CREATE TABLE public.trip_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL, changed_by uuid, reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trip_status_history TO authenticated;
GRANT ALL ON public.trip_status_history TO service_role;
ALTER TABLE public.trip_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Booking history" ON public.trip_status_history FOR SELECT USING (EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND (b.rider_user_id = auth.uid() OR b.driver_id = auth.uid())));
CREATE INDEX idx_trip_status_book ON public.trip_status_history(trip_booking_id, created_at);

CREATE TABLE public.trip_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  lat numeric(10,7) NOT NULL, lng numeric(10,7) NOT NULL,
  speed_kmh numeric(6,2), heading numeric(5,2), eta_seconds int,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trip_tracking TO authenticated;
GRANT ALL ON public.trip_tracking TO service_role;
ALTER TABLE public.trip_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Booking tracking" ON public.trip_tracking FOR SELECT USING (EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND (b.rider_user_id = auth.uid() OR b.driver_id = auth.uid())));
CREATE POLICY "Driver inserts tracking" ON public.trip_tracking FOR INSERT WITH CHECK (EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND b.driver_id = auth.uid()));
CREATE INDEX idx_trip_track_book ON public.trip_tracking(trip_booking_id, recorded_at DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_tracking;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_status_history;

CREATE TABLE public.trip_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  rater_user_id uuid NOT NULL REFERENCES auth.users(id),
  ratee_kind text NOT NULL,
  driving int CHECK (driving BETWEEN 1 AND 5),
  professionalism int CHECK (professionalism BETWEEN 1 AND 5),
  cleanliness int CHECK (cleanliness BETWEEN 1 AND 5),
  safety int CHECK (safety BETWEEN 1 AND 5),
  overall int NOT NULL CHECK (overall BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trip_booking_id, rater_user_id)
);
GRANT SELECT, INSERT ON public.trip_ratings TO authenticated;
GRANT ALL ON public.trip_ratings TO service_role;
ALTER TABLE public.trip_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Booking ratings" ON public.trip_ratings FOR SELECT USING (rater_user_id = auth.uid() OR EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND (b.rider_user_id = auth.uid() OR b.driver_id = auth.uid())));
CREATE POLICY "Own rating insert" ON public.trip_ratings FOR INSERT WITH CHECK (rater_user_id = auth.uid());

CREATE TABLE public.trip_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid REFERENCES public.trip_bookings(id) ON DELETE SET NULL,
  reporter_user_id uuid NOT NULL REFERENCES auth.users(id),
  incident_type text NOT NULL, severity text NOT NULL DEFAULT 'low', description text,
  lat numeric(10,7), lng numeric(10,7), evidence_urls text[],
  status text NOT NULL DEFAULT 'open', resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.trip_incidents TO authenticated;
GRANT ALL ON public.trip_incidents TO service_role;
ALTER TABLE public.trip_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own/admin incidents" ON public.trip_incidents FOR SELECT USING (reporter_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Report incident" ON public.trip_incidents FOR INSERT WITH CHECK (reporter_user_id = auth.uid());

CREATE TABLE public.rider_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance numeric(14,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.rider_wallets TO authenticated;
GRANT ALL ON public.rider_wallets TO service_role;
ALTER TABLE public.rider_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own wallet" ON public.rider_wallets FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Insert own wallet" ON public.rider_wallets FOR INSERT WITH CHECK (user_id = auth.uid() AND balance = 0);

CREATE TABLE public.rider_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.rider_wallets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  txn_type text NOT NULL, amount numeric(14,2) NOT NULL, currency text NOT NULL DEFAULT 'KES',
  reference text, trip_booking_id uuid REFERENCES public.trip_bookings(id),
  status text NOT NULL DEFAULT 'completed', metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rider_wallet_transactions TO authenticated;
GRANT ALL ON public.rider_wallet_transactions TO service_role;
ALTER TABLE public.rider_wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own wallet txns" ON public.rider_wallet_transactions FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_rwt_wallet ON public.rider_wallet_transactions(wallet_id, created_at DESC);

CREATE TABLE public.rider_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method_type text NOT NULL, display_label text NOT NULL, masked_identifier text, provider text,
  is_default boolean DEFAULT false, is_active boolean DEFAULT true, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_payment_methods TO authenticated;
GRANT ALL ON public.rider_payment_methods TO service_role;
ALTER TABLE public.rider_payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own pay methods" ON public.rider_payment_methods FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.rider_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  points_balance int NOT NULL DEFAULT 0, tier text NOT NULL DEFAULT 'bronze',
  lifetime_points int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rider_rewards TO authenticated;
GRANT ALL ON public.rider_rewards TO service_role;
ALTER TABLE public.rider_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rewards" ON public.rider_rewards FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Insert own rewards" ON public.rider_rewards FOR INSERT WITH CHECK (user_id = auth.uid() AND points_balance = 0 AND lifetime_points = 0);

CREATE TABLE public.rider_reward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL, points int NOT NULL, reason text,
  trip_booking_id uuid REFERENCES public.trip_bookings(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rider_reward_events TO authenticated;
GRANT ALL ON public.rider_reward_events TO service_role;
ALTER TABLE public.rider_reward_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own reward events" ON public.rider_reward_events FOR SELECT USING (user_id = auth.uid());

CREATE TABLE public.rider_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE, description text,
  discount_type text NOT NULL DEFAULT 'percent', discount_value numeric(10,2) NOT NULL,
  max_discount numeric(10,2), min_fare numeric(10,2) DEFAULT 0,
  valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  usage_limit int, used_count int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rider_promotions TO authenticated, anon;
GRANT ALL ON public.rider_promotions TO service_role;
ALTER TABLE public.rider_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public promos" ON public.rider_promotions FOR SELECT USING (is_active AND (valid_to IS NULL OR valid_to > now()));
CREATE POLICY "Admin manages promos" ON public.rider_promotions FOR ALL USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.rider_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL, body text, category text DEFAULT 'general',
  trip_booking_id uuid REFERENCES public.trip_bookings(id), read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.rider_notifications TO authenticated;
GRANT ALL ON public.rider_notifications TO service_role;
ALTER TABLE public.rider_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notifications" ON public.rider_notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Update own notif" ON public.rider_notifications FOR UPDATE USING (user_id = auth.uid());
CREATE INDEX idx_notif_user ON public.rider_notifications(user_id, created_at DESC);

CREATE TABLE public.rider_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token text NOT NULL, platform text NOT NULL, device_name text,
  last_seen_at timestamptz NOT NULL DEFAULT now(), is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_devices TO authenticated;
GRANT ALL ON public.rider_devices TO service_role;
ALTER TABLE public.rider_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own devices" ON public.rider_devices FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.scheduled_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pickup_address text NOT NULL, pickup_lat numeric(10,7) NOT NULL, pickup_lng numeric(10,7) NOT NULL,
  dropoff_address text NOT NULL, dropoff_lat numeric(10,7) NOT NULL, dropoff_lng numeric(10,7) NOT NULL,
  ride_type_id uuid REFERENCES public.ride_types(id),
  scheduled_for timestamptz NOT NULL, recurrence text DEFAULT 'none', recurrence_until timestamptz,
  status text NOT NULL DEFAULT 'active', next_booking_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_trips TO authenticated;
GRANT ALL ON public.scheduled_trips TO service_role;
ALTER TABLE public.scheduled_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own scheduled" ON public.scheduled_trips FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.airport_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction text NOT NULL, airport_code text NOT NULL, terminal text, flight_number text, flight_time timestamptz,
  passenger_count int NOT NULL DEFAULT 1, luggage_count int NOT NULL DEFAULT 0,
  meet_and_greet boolean DEFAULT false, vip boolean DEFAULT false, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.airport_bookings TO authenticated;
GRANT ALL ON public.airport_bookings TO service_role;
ALTER TABLE public.airport_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own airport" ON public.airport_bookings FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.safety_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_booking_id uuid REFERENCES public.trip_bookings(id),
  alert_type text NOT NULL, lat numeric(10,7), lng numeric(10,7), message text,
  status text NOT NULL DEFAULT 'active', acknowledged_by uuid, acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.safety_alerts TO authenticated;
GRANT ALL ON public.safety_alerts TO service_role;
ALTER TABLE public.safety_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own alerts" ON public.safety_alerts FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Raise own alert" ON public.safety_alerts FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Ack alert" ON public.safety_alerts FOR UPDATE USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
ALTER PUBLICATION supabase_realtime ADD TABLE public.safety_alerts;

CREATE TABLE public.trip_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(18),'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.trip_share_links TO authenticated;
GRANT ALL ON public.trip_share_links TO service_role;
ALTER TABLE public.trip_share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own share links" ON public.trip_share_links FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Own create share" ON public.trip_share_links FOR INSERT WITH CHECK (user_id = auth.uid() AND EXISTS(SELECT 1 FROM public.trip_bookings b WHERE b.id = trip_booking_id AND b.rider_user_id = auth.uid()));

CREATE TABLE public.family_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL, shared_wallet_balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_accounts TO authenticated;
GRANT ALL ON public.family_accounts TO service_role;
ALTER TABLE public.family_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own family" ON public.family_accounts FOR ALL USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

CREATE TABLE public.family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_account_id uuid NOT NULL REFERENCES public.family_accounts(id) ON DELETE CASCADE,
  member_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL, relationship text, is_minor boolean DEFAULT false, per_trip_limit numeric(10,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.family_members TO authenticated;
GRANT ALL ON public.family_members TO service_role;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Family members access" ON public.family_members FOR ALL
  USING (EXISTS(SELECT 1 FROM public.family_accounts f WHERE f.id = family_account_id AND f.owner_user_id = auth.uid()))
  WITH CHECK (EXISTS(SELECT 1 FROM public.family_accounts f WHERE f.id = family_account_id AND f.owner_user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.trip_quote_fare(_request_id uuid, _distance_km numeric, _duration_min int)
RETURNS TABLE(quote_id uuid, total numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rt public.ride_types%ROWTYPE; v_req public.trip_requests%ROWTYPE;
  v_base numeric; v_dist numeric; v_time numeric; v_surge numeric := 1.0; v_total numeric; v_quote_id uuid;
BEGIN
  SELECT * INTO v_req FROM public.trip_requests WHERE id = _request_id AND rider_user_id = auth.uid();
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Trip request not found'; END IF;
  SELECT * INTO v_rt FROM public.ride_types WHERE id = v_req.ride_type_id;
  IF v_rt.id IS NULL THEN RAISE EXCEPTION 'Invalid ride type'; END IF;
  v_base := v_rt.base_fare; v_dist := _distance_km * v_rt.per_km_rate; v_time := _duration_min * v_rt.per_minute_rate;
  v_total := GREATEST(v_rt.minimum_fare, (v_base + v_dist + v_time) * v_surge);
  INSERT INTO public.trip_quotes(trip_request_id, ride_type_id, distance_km, duration_min, base_fare, distance_fare, time_fare, surge_multiplier, total_fare)
  VALUES(_request_id, v_rt.id, _distance_km, _duration_min, v_base, v_dist, v_time, v_surge, v_total) RETURNING id INTO v_quote_id;
  UPDATE public.trip_requests SET estimated_fare = v_total, estimated_distance_km = _distance_km, estimated_duration_min = _duration_min WHERE id = _request_id;
  RETURN QUERY SELECT v_quote_id, v_total;
END $$;
REVOKE ALL ON FUNCTION public.trip_quote_fare(uuid,numeric,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_quote_fare(uuid,numeric,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_confirm_booking(_quote_id uuid, _payment_method text DEFAULT 'wallet', _scheduled_for timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q public.trip_quotes%ROWTYPE; v_r public.trip_requests%ROWTYPE; v_book_id uuid;
BEGIN
  SELECT * INTO v_q FROM public.trip_quotes WHERE id = _quote_id;
  IF v_q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  SELECT * INTO v_r FROM public.trip_requests WHERE id = v_q.trip_request_id AND rider_user_id = auth.uid();
  IF v_r.id IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_q.expires_at < now() THEN RAISE EXCEPTION 'Quote expired'; END IF;
  INSERT INTO public.trip_bookings(rider_user_id, trip_request_id, trip_quote_id, ride_type_id,
    pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
    passenger_count, intent, payment_method, total_fare, surge_multiplier, status, scheduled_for)
  VALUES(auth.uid(), v_r.id, v_q.id, v_q.ride_type_id,
    v_r.pickup_address, v_r.pickup_lat, v_r.pickup_lng, v_r.dropoff_address, v_r.dropoff_lat, v_r.dropoff_lng,
    v_r.passenger_count, v_r.intent, _payment_method, v_q.total_fare, v_q.surge_multiplier,
    CASE WHEN _scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END, _scheduled_for)
  RETURNING id INTO v_book_id;
  UPDATE public.trip_requests SET status = 'booked' WHERE id = v_r.id;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES(v_book_id, NULL, CASE WHEN _scheduled_for IS NULL THEN 'pending' ELSE 'scheduled' END, auth.uid(), 'Booking confirmed');
  RETURN v_book_id;
END $$;
REVOKE ALL ON FUNCTION public.trip_confirm_booking(uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_confirm_booking(uuid,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_cancel_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_owner uuid;
BEGIN
  SELECT status, rider_user_id INTO v_status, v_owner FROM public.trip_bookings WHERE id = _booking_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_status IN ('completed','cancelled') THEN RAISE EXCEPTION 'Cannot cancel %', v_status; END IF;
  UPDATE public.trip_bookings SET status='cancelled', cancelled_at = now(), cancellation_reason=_reason, cancelled_by='rider' WHERE id=_booking_id;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
  VALUES(_booking_id, v_status, 'cancelled', auth.uid(), _reason);
END $$;
REVOKE ALL ON FUNCTION public.trip_cancel_booking(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_cancel_booking(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.safety_raise_sos(_booking_id uuid, _lat numeric, _lng numeric, _message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO public.safety_alerts(user_id, trip_booking_id, alert_type, lat, lng, message, status)
  VALUES(auth.uid(), _booking_id, 'sos', _lat, _lng, _message, 'active') RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.safety_raise_sos(uuid,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_raise_sos(uuid,numeric,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_rider_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text := auth.jwt()->>'email';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO public.rider_profiles (user_id, email, display_name)
  VALUES (v_uid, v_email, split_part(coalesce(v_email,''),'@',1)) ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.wallets (user_id, wallet_type) VALUES (v_uid, 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'rider') ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.ensure_rider_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_rider_account() TO authenticated;

ALTER TABLE public.support_threads
  ADD COLUMN assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz;
CREATE INDEX idx_support_threads_agent ON public.support_threads(assigned_agent_id, status);

CREATE TABLE public.support_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('assigned','reassigned','unassigned','status_changed','agent_reply')),
  from_agent_id uuid, to_agent_id uuid, actor_id uuid,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','mcp','system')),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.support_assignment_events TO authenticated;
GRANT ALL ON public.support_assignment_events TO service_role;
ALTER TABLE public.support_assignment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read assignment events" ON public.support_assignment_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','support','super_admin']::public.app_role[]));
CREATE POLICY "Staff log assignment events" ON public.support_assignment_events FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND public.has_any_role(auth.uid(), ARRAY['admin','support','super_admin']::public.app_role[]));
CREATE INDEX idx_assign_events_thread ON public.support_assignment_events(thread_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.auto_assign_support_thread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    SELECT ur.user_id INTO NEW.assigned_agent_id
    FROM public.user_roles ur
    LEFT JOIN public.support_threads t ON t.assigned_agent_id = ur.user_id AND t.status = 'open'
    WHERE ur.role = 'support'
    GROUP BY ur.user_id ORDER BY count(t.id), min(ur.user_id::text) LIMIT 1;
    IF NEW.assigned_agent_id IS NULL THEN NEW.assigned_agent_id := NEW.created_by; END IF;
  END IF;
  IF NEW.assigned_agent_id IS NOT NULL THEN NEW.assigned_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_support_threads_autoassign BEFORE INSERT ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_support_thread();

CREATE OR REPLACE FUNCTION public.log_support_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NOT NULL THEN
      INSERT INTO public.support_assignment_events(thread_id, event_type, to_agent_id, actor_id, source)
      VALUES (NEW.id, 'assigned', NEW.assigned_agent_id, auth.uid(), 'system');
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      INSERT INTO public.support_assignment_events(thread_id, event_type, from_agent_id, to_agent_id, actor_id)
      VALUES (NEW.id, CASE WHEN NEW.assigned_agent_id IS NULL THEN 'unassigned' WHEN OLD.assigned_agent_id IS NULL THEN 'assigned' ELSE 'reassigned' END,
              OLD.assigned_agent_id, NEW.assigned_agent_id, auth.uid());
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.support_assignment_events(thread_id, event_type, actor_id, note)
      VALUES (NEW.id, 'status_changed', auth.uid(), OLD.status || ' -> ' || NEW.status);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_support_threads_log AFTER INSERT OR UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.log_support_assignment();
REVOKE ALL ON FUNCTION public.auto_assign_support_thread() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_support_assignment() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_rider_thread_update()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['admin','support','super_admin']::public.app_role[]) THEN
    IF (NEW.subject, NEW.category, NEW.status, NEW.rider_email, NEW.rider_user_id, NEW.created_by, NEW.staff_last_read_at, NEW.assigned_agent_id, NEW.assigned_at)
       IS DISTINCT FROM (OLD.subject, OLD.category, OLD.status, OLD.rider_email, OLD.rider_user_id, OLD.created_by, OLD.staff_last_read_at, OLD.assigned_agent_id, OLD.assigned_at) THEN
      RAISE EXCEPTION 'Riders can only update their read status';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.list_support_agents()
RETURNS TABLE(user_id uuid, email text, open_cases bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.user_id, u.email::text,
    (SELECT count(*) FROM public.support_threads t WHERE t.assigned_agent_id = ur.user_id AND t.status = 'open')
  FROM (SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('support','admin','super_admin')) ur
  JOIN auth.users u ON u.id = ur.user_id
  WHERE public.has_any_role(auth.uid(), ARRAY['admin','support','super_admin']::public.app_role[])
  ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.list_support_agents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_support_agents() TO authenticated;