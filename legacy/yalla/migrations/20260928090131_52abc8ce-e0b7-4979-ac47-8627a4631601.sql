
CREATE OR REPLACE FUNCTION public.air_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role(auth.uid(),'operations_admin') OR public.has_role(auth.uid(),'pricing_manager'), false) IS TRUE
$$;
REVOKE ALL ON FUNCTION public.air_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.air_is_admin() TO authenticated, service_role;

CREATE TABLE public.air_airfields (
  code text PRIMARY KEY, name text NOT NULL, city text NOT NULL, country text NOT NULL DEFAULT 'Kenya',
  kind text NOT NULL DEFAULT 'airport', lat double precision NOT NULL, lng double precision NOT NULL,
  landing_fee_kes numeric NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 100
);
GRANT SELECT ON public.air_airfields TO anon, authenticated; GRANT ALL ON public.air_airfields TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.air_airfields TO authenticated;
ALTER TABLE public.air_airfields ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_airfields_read ON public.air_airfields FOR SELECT USING (true);
CREATE POLICY air_airfields_admin ON public.air_airfields FOR ALL TO authenticated USING (public.air_is_admin()) WITH CHECK (public.air_is_admin());

CREATE TABLE public.air_aircraft_classes (
  code text PRIMARY KEY, label text NOT NULL, example_models text NOT NULL, seats int NOT NULL,
  cruise_kts int NOT NULL, benchmark_hourly_usd numeric NOT NULL, min_block_hours numeric NOT NULL DEFAULT 1,
  bush_strip_ok boolean NOT NULL DEFAULT false, sort int NOT NULL DEFAULT 100
);
GRANT SELECT ON public.air_aircraft_classes TO anon, authenticated; GRANT ALL ON public.air_aircraft_classes TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.air_aircraft_classes TO authenticated;
ALTER TABLE public.air_aircraft_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_classes_read ON public.air_aircraft_classes FOR SELECT USING (true);
CREATE POLICY air_classes_admin ON public.air_aircraft_classes FOR ALL TO authenticated USING (public.air_is_admin()) WITH CHECK (public.air_is_admin());

CREATE TABLE public.air_pricing_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fx_kes_per_usd numeric NOT NULL DEFAULT 129,
  season_multipliers jsonb NOT NULL DEFAULT '{"1":1.1,"2":1,"3":1,"4":0.88,"5":0.88,"6":1,"7":1.15,"8":1.15,"9":1.12,"10":1.05,"11":0.95,"12":1.2}',
  weekend_multiplier numeric NOT NULL DEFAULT 1.05,
  urgent_hours int NOT NULL DEFAULT 48, urgent_multiplier numeric NOT NULL DEFAULT 1.12,
  early_days int NOT NULL DEFAULT 30, early_multiplier numeric NOT NULL DEFAULT 0.95,
  one_way_return_pct numeric NOT NULL DEFAULT 0.5,
  taxi_hours numeric NOT NULL DEFAULT 0.25,
  yalla_fee_pct numeric NOT NULL DEFAULT 0.08,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
GRANT SELECT ON public.air_pricing_settings TO anon, authenticated; GRANT UPDATE ON public.air_pricing_settings TO authenticated;
GRANT ALL ON public.air_pricing_settings TO service_role;
ALTER TABLE public.air_pricing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_settings_read ON public.air_pricing_settings FOR SELECT USING (true);
CREATE POLICY air_settings_admin ON public.air_pricing_settings FOR UPDATE TO authenticated USING (public.air_is_admin()) WITH CHECK (public.air_is_admin());
INSERT INTO public.air_pricing_settings (id) VALUES (1);

CREATE TABLE public.air_fleet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.charter_partner_applications(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  operator_name text NOT NULL,
  registration text NOT NULL, model text NOT NULL,
  class_code text NOT NULL REFERENCES public.air_aircraft_classes(code),
  seats int NOT NULL CHECK (seats BETWEEN 1 AND 30),
  home_base text NOT NULL REFERENCES public.air_airfields(code),
  hourly_rate_kes numeric NOT NULL CHECK (hourly_rate_kes > 0),
  year_built int, amenities text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
  review_note text, reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration)
);
GRANT SELECT ON public.air_fleet TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON public.air_fleet TO authenticated;
GRANT ALL ON public.air_fleet TO service_role;
ALTER TABLE public.air_fleet ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_fleet_public ON public.air_fleet FOR SELECT USING (status = 'active');
CREATE POLICY air_fleet_owner_read ON public.air_fleet FOR SELECT TO authenticated USING (owner_id = auth.uid() OR public.air_is_admin());
CREATE POLICY air_fleet_owner_insert ON public.air_fleet FOR INSERT TO authenticated WITH CHECK (
  owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.charter_partner_applications a WHERE a.id = application_id AND a.submitted_by = auth.uid()));
CREATE POLICY air_fleet_owner_update ON public.air_fleet FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR public.air_is_admin()) WITH CHECK (owner_id = auth.uid() OR public.air_is_admin());
CREATE POLICY air_fleet_owner_delete ON public.air_fleet FOR DELETE TO authenticated USING ((owner_id = auth.uid() AND status <> 'active') OR public.air_is_admin());

CREATE OR REPLACE FUNCTION public._air_fleet_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.registration := upper(trim(NEW.registration));
  IF public.air_is_admin() IS NOT TRUE AND coalesce(auth.role(),'') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN NEW.status := 'pending'; NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.review_note := NULL;
    ELSE
      NEW.status := CASE WHEN OLD.status = 'active' AND (NEW.hourly_rate_kes IS DISTINCT FROM OLD.hourly_rate_kes OR NEW.class_code IS DISTINCT FROM OLD.class_code OR NEW.registration IS DISTINCT FROM OLD.registration) THEN 'pending' ELSE OLD.status END;
      NEW.reviewed_by := OLD.reviewed_by; NEW.reviewed_at := OLD.reviewed_at; NEW.review_note := OLD.review_note;
      NEW.owner_id := OLD.owner_id; NEW.application_id := OLD.application_id;
    END IF;
  ELSIF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    IF NOT EXISTS (SELECT 1 FROM public.charter_partner_applications a WHERE a.id = NEW.application_id AND a.status = 'approved') THEN
      RAISE EXCEPTION 'Operator application must be approved before an aircraft can go live';
    END IF;
    NEW.reviewed_by := auth.uid(); NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER air_fleet_guard BEFORE INSERT OR UPDATE ON public.air_fleet FOR EACH ROW EXECUTE FUNCTION public._air_fleet_guard();

CREATE TABLE public.air_empty_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id uuid NOT NULL REFERENCES public.air_fleet(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  origin text NOT NULL REFERENCES public.air_airfields(code),
  destination text NOT NULL REFERENCES public.air_airfields(code),
  depart_date date NOT NULL, flexible_days int NOT NULL DEFAULT 0 CHECK (flexible_days BETWEEN 0 AND 7),
  price_kes numeric NOT NULL CHECK (price_kes > 0), seats int NOT NULL CHECK (seats > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','held','sold','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origin <> destination)
);
GRANT SELECT ON public.air_empty_legs TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON public.air_empty_legs TO authenticated;
GRANT ALL ON public.air_empty_legs TO service_role;
ALTER TABLE public.air_empty_legs ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_legs_public ON public.air_empty_legs FOR SELECT USING (status = 'open' AND depart_date >= current_date
  AND EXISTS (SELECT 1 FROM public.air_fleet f WHERE f.id = fleet_id AND f.status = 'active'));
CREATE POLICY air_legs_owner_read ON public.air_empty_legs FOR SELECT TO authenticated USING (owner_id = auth.uid() OR public.air_is_admin());
CREATE POLICY air_legs_owner_insert ON public.air_empty_legs FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.air_fleet f WHERE f.id = fleet_id AND f.owner_id = auth.uid() AND f.status = 'active'));
CREATE POLICY air_legs_owner_update ON public.air_empty_legs FOR UPDATE TO authenticated USING (owner_id = auth.uid() OR public.air_is_admin()) WITH CHECK (owner_id = auth.uid() OR public.air_is_admin());
CREATE POLICY air_legs_owner_delete ON public.air_empty_legs FOR DELETE TO authenticated USING (owner_id = auth.uid() OR public.air_is_admin());

CREATE TABLE public.air_quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL DEFAULT ('AQ-' || upper(substr(md5(gen_random_uuid()::text),1,8))) UNIQUE,
  user_id uuid DEFAULT auth.uid(),
  contact_name text NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 120),
  contact_email text NOT NULL CHECK (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone text NOT NULL CHECK (length(contact_phone) BETWEEN 7 AND 20),
  origin text NOT NULL REFERENCES public.air_airfields(code),
  destination text NOT NULL REFERENCES public.air_airfields(code),
  depart_date date NOT NULL, return_date date, passengers int NOT NULL CHECK (passengers BETWEEN 1 AND 30),
  class_code text REFERENCES public.air_aircraft_classes(code),
  fleet_id uuid REFERENCES public.air_fleet(id), empty_leg_id uuid REFERENCES public.air_empty_legs(id),
  indicative_total_kes numeric, price_breakdown jsonb NOT NULL DEFAULT '{}',
  notes text CHECK (notes IS NULL OR length(notes) <= 1000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','booked','lost','cancelled')),
  staff_note text, handled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.air_quote_requests TO anon; GRANT SELECT, INSERT, UPDATE ON public.air_quote_requests TO authenticated;
GRANT ALL ON public.air_quote_requests TO service_role;
ALTER TABLE public.air_quote_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY air_qr_anon_insert ON public.air_quote_requests FOR INSERT TO anon WITH CHECK (user_id IS NULL AND status = 'new' AND staff_note IS NULL AND handled_by IS NULL);
CREATE POLICY air_qr_auth_insert ON public.air_quote_requests FOR INSERT TO authenticated WITH CHECK ((user_id IS NULL OR user_id = auth.uid()) AND status = 'new' AND staff_note IS NULL AND handled_by IS NULL);
CREATE POLICY air_qr_read ON public.air_quote_requests FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.air_is_admin());
CREATE POLICY air_qr_admin_update ON public.air_quote_requests FOR UPDATE TO authenticated USING (public.air_is_admin()) WITH CHECK (public.air_is_admin());

INSERT INTO public.air_airfields (code,name,city,country,kind,lat,lng,landing_fee_kes,sort) VALUES
('WIL','Wilson Airport','Nairobi','Kenya','airport',-1.3217,36.8148,6500,1),
('NBO','Jomo Kenyatta International','Nairobi','Kenya','airport',-1.3192,36.9278,18000,2),
('MBA','Moi International','Mombasa','Kenya','airport',-4.0348,39.5942,14000,3),
('MYD','Malindi Airport','Malindi','Kenya','airport',-3.2293,40.1017,6000,4),
('UKA','Ukunda (Diani) Airstrip','Diani','Kenya','airstrip',-4.2933,39.5711,4500,5),
('LAU','Manda Airport','Lamu','Kenya','airport',-2.2524,40.9131,5000,6),
('KIS','Kisumu International','Kisumu','Kenya','airport',-0.0861,34.7289,8000,7),
('EDL','Eldoret International','Eldoret','Kenya','airport',0.4045,35.2389,8000,8),
('NYK','Nanyuki Airstrip','Nanyuki','Kenya','airstrip',-0.0624,37.0410,4000,9),
('KEU','Keekorok Airstrip (Maasai Mara)','Maasai Mara','Kenya','airstrip',-1.5830,35.2500,3500,10),
('OLX','Ol Kiombo Airstrip (Maasai Mara)','Maasai Mara','Kenya','airstrip',-1.4086,35.1105,3500,11),
('ASV','Amboseli Airstrip','Amboseli','Kenya','airstrip',-2.6450,37.2531,3500,12),
('UAS','Samburu (Buffalo Springs) Airstrip','Samburu','Kenya','airstrip',0.5306,37.5342,3500,13),
('LWA','Lewa Downs Airstrip','Lewa','Kenya','airstrip',0.1942,37.4981,3500,14),
('LOK','Lodwar Airport','Lodwar','Kenya','airport',3.1219,35.6087,5000,15),
('EBB','Entebbe International','Entebbe','Uganda','airport',0.0424,32.4435,25000,30),
('JRO','Kilimanjaro International','Arusha / Moshi','Tanzania','airport',-3.4294,37.0745,22000,31),
('ZNZ','Abeid Amani Karume International','Zanzibar','Tanzania','airport',-6.2220,39.2249,22000,32),
('DAR','Julius Nyerere International','Dar es Salaam','Tanzania','airport',-6.8781,39.2026,25000,33),
('KGL','Kigali International','Kigali','Rwanda','airport',-1.9686,30.1395,25000,34);

INSERT INTO public.air_aircraft_classes (code,label,example_models,seats,cruise_kts,benchmark_hourly_usd,min_block_hours,bush_strip_ok,sort) VALUES
('piston','Single-engine piston','Cessna 206 · Cessna 210',5,140,650,1,true,1),
('caravan','Single turboprop (safari)','Cessna Grand Caravan · Pilatus PC-12',12,175,1300,1,true,2),
('twin_turboprop','Twin turboprop','Beechcraft King Air 200/350',8,280,2400,1,true,3),
('light_jet','Light jet','Citation CJ3 · Phenom 300',6,410,3400,1.5,false,4),
('midsize_jet','Midsize jet','Citation Latitude · Learjet 60',8,440,5200,2,false,5),
('heavy_jet','Heavy / long-range jet','Challenger 650 · Gulfstream G450',12,470,8500,2,false,6),
('helicopter','Helicopter','Bell 407 · Airbus H125',5,120,1900,1,true,7);
