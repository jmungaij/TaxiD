ALTER TABLE public.app_download_clicks ADD COLUMN IF NOT EXISTS device_type text, ADD COLUMN IF NOT EXISTS os text, ADD COLUMN IF NOT EXISTS browser text;

CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  driver_code text NOT NULL UNIQUE DEFAULT ('DRV-' || upper(substr(md5(gen_random_uuid()::text),1,6))),
  phone text,
  status text NOT NULL DEFAULT 'offline',
  verification_status text NOT NULL DEFAULT 'pending',
  driver_rating numeric,
  risk_score numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drivers own read" ON public.drivers FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));
CREATE POLICY "drivers own insert" ON public.drivers FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND verification_status = 'pending');
CREATE POLICY "drivers own update" ON public.drivers FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE OR REPLACE FUNCTION public.drivers_protect_fields() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN
    NEW.verification_status := OLD.verification_status; NEW.driver_rating := OLD.driver_rating; NEW.risk_score := OLD.risk_score; NEW.user_id := OLD.user_id; NEW.driver_code := OLD.driver_code;
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
CREATE TRIGGER drivers_guard BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.drivers_protect_fields();

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  plate_number text NOT NULL,
  make text, model text, color text,
  ride_type_id uuid REFERENCES public.ride_types(id),
  status text NOT NULL DEFAULT 'offline',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicles read" ON public.vehicles FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));
CREATE POLICY "vehicles own write" ON public.vehicles FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid()) AND status IN ('available','offline','on_trip','maintenance'));
CREATE TRIGGER vehicles_updated BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.driver_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  trip_booking_id uuid REFERENCES public.trip_bookings(id),
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_booking_id)
);
GRANT SELECT ON public.driver_earnings TO authenticated;
GRANT ALL ON public.driver_earnings TO service_role;
ALTER TABLE public.driver_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "earnings read" ON public.driver_earnings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::public.app_role[]));

ALTER TABLE public.trip_bookings ADD COLUMN IF NOT EXISTS business_request_id uuid REFERENCES public.business_requests(id);

CREATE POLICY "drivers see open and own trips" ON public.trip_bookings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = auth.uid() AND (trip_bookings.driver_id = d.id OR (trip_bookings.driver_id IS NULL AND trip_bookings.status IN ('pending','scheduled'))))
);

CREATE OR REPLACE FUNCTION public.driver_accept_trip(_booking_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_driver uuid; v_vehicle uuid; v_status text;
BEGIN
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF v_driver IS NULL THEN RAISE EXCEPTION 'Not a driver'; END IF;
  SELECT id INTO v_vehicle FROM public.vehicles WHERE driver_id = v_driver ORDER BY (status='available') DESC, created_at LIMIT 1;
  SELECT status INTO v_status FROM public.trip_bookings WHERE id = _booking_id AND driver_id IS NULL FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('pending','scheduled') THEN RAISE EXCEPTION 'Trip is no longer available'; END IF;
  UPDATE public.trip_bookings SET driver_id = v_driver, vehicle_id = v_vehicle, status = 'accepted' WHERE id = _booking_id;
  IF v_vehicle IS NOT NULL THEN UPDATE public.vehicles SET status = 'on_trip' WHERE id = v_vehicle; END IF;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason) VALUES (_booking_id, v_status, 'accepted', auth.uid(), 'Driver accepted');
END $$;

CREATE OR REPLACE FUNCTION public.driver_update_trip_status(_booking_id uuid, _status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_driver uuid; v_old text; v_fare numeric; v_vehicle uuid;
BEGIN
  IF _status NOT IN ('arrived','in_progress','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT id INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  SELECT status, total_fare, vehicle_id INTO v_old, v_fare, v_vehicle FROM public.trip_bookings WHERE id = _booking_id AND driver_id = v_driver FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_old IN ('completed','cancelled') THEN RAISE EXCEPTION 'Trip already %', v_old; END IF;
  UPDATE public.trip_bookings SET status = _status,
    started_at = CASE WHEN _status='in_progress' THEN now() ELSE started_at END,
    completed_at = CASE WHEN _status='completed' THEN now() ELSE completed_at END
  WHERE id = _booking_id;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by) VALUES (_booking_id, v_old, _status, auth.uid());
  IF _status = 'completed' THEN
    INSERT INTO public.driver_earnings(driver_id, trip_booking_id, amount) VALUES (v_driver, _booking_id, round(coalesce(v_fare,0) * 0.8, 2)) ON CONFLICT (trip_booking_id) DO NOTHING;
    IF v_vehicle IS NOT NULL THEN UPDATE public.vehicles SET status = 'available' WHERE id = v_vehicle; END IF;
    UPDATE public.business_requests SET status = 'completed', updated_at = now() WHERE id = (SELECT business_request_id FROM public.trip_bookings WHERE id = _booking_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.driver_set_vehicle_status(_vehicle_id uuid, _status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('available','offline','maintenance') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.vehicles v SET status = _status FROM public.drivers d WHERE v.id = _vehicle_id AND d.id = v.driver_id AND d.user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_assign_business_request(_request_id uuid, _driver_id uuid, _fare numeric DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.business_requests%ROWTYPE; v_id uuid; v_vehicle uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO r FROM public.business_requests WHERE id = _request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'Request already %', r.status; END IF;
  IF EXISTS (SELECT 1 FROM public.trip_bookings WHERE business_request_id = _request_id) THEN RAISE EXCEPTION 'Already booked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id) THEN RAISE EXCEPTION 'Driver not found'; END IF;
  SELECT id INTO v_vehicle FROM public.vehicles WHERE driver_id = _driver_id ORDER BY (status='available') DESC LIMIT 1;
  INSERT INTO public.trip_bookings(rider_user_id, driver_id, vehicle_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, passenger_count, intent, payment_method, total_fare, status, scheduled_for, business_request_id)
  VALUES (r.requested_by, _driver_id, v_vehicle, coalesce(r.origin,'To be confirmed'), 0, 0, coalesce(r.destination,'To be confirmed'), 0, 0, 1, 'business', 'invoice', _fare, 'accepted', r.requested_date::timestamptz, r.id)
  RETURNING id INTO v_id;
  UPDATE public.business_requests SET status = 'in_review', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() WHERE id = r.id;
  INSERT INTO public.trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason) VALUES (v_id, NULL, 'accepted', auth.uid(), 'Assigned from fleet request');
  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.driver_accept_trip(uuid), public.driver_update_trip_status(uuid,text), public.driver_set_vehicle_status(uuid,text), public.admin_assign_business_request(uuid,uuid,numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.driver_accept_trip(uuid), public.driver_update_trip_status(uuid,text), public.driver_set_vehicle_status(uuid,text), public.admin_assign_business_request(uuid,uuid,numeric) TO authenticated;