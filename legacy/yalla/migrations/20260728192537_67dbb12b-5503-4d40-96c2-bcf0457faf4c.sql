
CREATE TABLE public.charter_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_slug text NOT NULL,
  name text NOT NULL,
  spec text NOT NULL DEFAULT '',
  capacity text NOT NULL DEFAULT '',
  base_rate numeric NOT NULL CHECK (base_rate >= 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','limited','on-request','maintenance','retired')),
  offer_label text,
  offer_discount_pct numeric NOT NULL DEFAULT 0 CHECK (offer_discount_pct >= 0 AND offer_discount_pct <= 90),
  operator_name text,
  operator_id uuid,
  home_base text,
  available_from date,
  available_to date,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_inventory TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charter_inventory TO authenticated;
GRANT ALL ON public.charter_inventory TO service_role;
ALTER TABLE public.charter_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charter_inventory_public_read" ON public.charter_inventory
  FOR SELECT USING (active = true);
CREATE POLICY "charter_inventory_admin_manage" ON public.charter_inventory
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.charter_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  user_id uuid,
  category_slug text NOT NULL,
  inventory_id uuid REFERENCES public.charter_inventory(id) ON DELETE SET NULL,
  asset_name text NOT NULL,
  duration numeric NOT NULL CHECK (duration > 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  controls jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  trip jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text NOT NULL DEFAULT 'USD',
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','priced','accepted','declined','expired','converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.charter_quotes TO authenticated;
GRANT ALL ON public.charter_quotes TO service_role;
ALTER TABLE public.charter_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charter_quotes_owner_read" ON public.charter_quotes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "charter_quotes_owner_insert" ON public.charter_quotes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "charter_quotes_admin_update" ON public.charter_quotes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.charter_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  quote_id uuid REFERENCES public.charter_quotes(id) ON DELETE SET NULL,
  user_id uuid,
  category_slug text NOT NULL,
  asset_name text NOT NULL,
  passengers jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  trip jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  payment_method text NOT NULL DEFAULT 'invoice' CHECK (payment_method IN ('invoice','mpesa','card','corporate_wallet')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','authorized','paid','failed','refunded')),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled')),
  flight_status text NOT NULL DEFAULT 'scheduled' CHECK (flight_status IN ('scheduled','crew_assigned','boarding','departed','en_route','landed','completed','cancelled')),
  flight_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.charter_bookings TO authenticated;
GRANT ALL ON public.charter_bookings TO service_role;
ALTER TABLE public.charter_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charter_bookings_owner_read" ON public.charter_bookings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "charter_bookings_owner_insert" ON public.charter_bookings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "charter_bookings_manage_update" ON public.charter_bookings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_charter_inventory_cat ON public.charter_inventory (category_slug, active);
CREATE INDEX idx_charter_quotes_user ON public.charter_quotes (user_id, created_at DESC);
CREATE INDEX idx_charter_bookings_user ON public.charter_bookings (user_id, created_at DESC);

CREATE TRIGGER trg_charter_inventory_updated BEFORE UPDATE ON public.charter_inventory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_charter_quotes_updated BEFORE UPDATE ON public.charter_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_charter_bookings_updated BEFORE UPDATE ON public.charter_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.charter_inventory (category_slug, name, spec, capacity, base_rate, status, offer_label, offer_discount_pct, operator_name, home_base) VALUES
 ('aircraft-charter','Gulfstream G650','7,500 nm · Mach 0.925 · Ultra long range','14 passengers',12500,'available',NULL,0,'Yalla Air Partners','Nairobi (WIL)'),
 ('aircraft-charter','Bombardier Challenger 650','4,000 nm · Heavy jet','12 passengers',8200,'available','Nairobi → Dubai empty leg',40,'Yalla Air Partners','Nairobi (NBO)'),
 ('aircraft-charter','Cessna Citation Latitude','2,700 nm · Midsize jet','9 passengers',5400,'limited',NULL,0,'Rift Executive Aviation','Nairobi (WIL)'),
 ('aircraft-charter','HondaJet Elite II','1,547 nm · Very light jet','5 passengers',3100,'available',NULL,0,'Rift Executive Aviation','Mombasa (MBA)'),
 ('aircraft-charter','Beechcraft King Air 350','1,800 nm · Turboprop','9 passengers',2450,'available',NULL,0,'Savannah Wings','Nairobi (WIL)'),
 ('aircraft-charter','Airbus H145 Helicopter','351 nm · Twin-engine rotor','8 passengers',4300,'on-request',NULL,0,'Savannah Wings','Nairobi (WIL)'),
 ('bus-charter','Executive Coach 49','Reclining seats · WiFi · Onboard washroom','49 seats',780,'available',NULL,0,'Yalla Coaches','Nairobi'),
 ('bus-charter','Tour Coach 33','Luggage hold · PA system','33 seats',560,'available',NULL,0,'Yalla Coaches','Nairobi'),
 ('bus-charter','School Bus 51','Safety-certified · Seat belts','51 seats',430,'available',NULL,0,'Yalla Coaches','Nakuru'),
 ('bus-charter','Executive Shuttle 14','VIP interior · Chauffeur','14 seats',320,'limited',NULL,0,'Yalla Coaches','Nairobi');
