CREATE TABLE public.mobility_services (
  code text PRIMARY KEY, label text NOT NULL, description text, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.mobility_vehicle_classes (
  code text PRIMARY KEY, service_code text NOT NULL REFERENCES public.mobility_services(code),
  service_class text NOT NULL, label text NOT NULL, seats int NOT NULL DEFAULT 4,
  accessible boolean NOT NULL DEFAULT false, example_models text[] NOT NULL DEFAULT '{}',
  ride_type_id uuid REFERENCES public.ride_types(id), sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.mobility_services, public.mobility_vehicle_classes TO authenticated;
GRANT ALL ON public.mobility_services, public.mobility_vehicle_classes TO service_role;
ALTER TABLE public.mobility_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobility_vehicle_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read services" ON public.mobility_services FOR SELECT TO authenticated USING (true);
CREATE POLICY "Signed-in read vehicle classes" ON public.mobility_vehicle_classes FOR SELECT TO authenticated USING (true);
GRANT INSERT, UPDATE, DELETE ON public.mobility_services, public.mobility_vehicle_classes TO authenticated;
CREATE POLICY "Admins manage services" ON public.mobility_services FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage vehicle classes" ON public.mobility_vehicle_classes FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_mobility_services_updated BEFORE UPDATE ON public.mobility_services FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_mobility_vehicle_classes_updated BEFORE UPDATE ON public.mobility_vehicle_classes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.mobility_services(code,label,description,sort_order) VALUES
 ('ride','TaxiD Ride','Everyday on-demand and scheduled business rides',1),
 ('airport','TaxiD Airport','Airport pickups and drop-offs',2),
 ('charter','TaxiD Charter','Group movement, events and staff transport',3);
INSERT INTO public.mobility_vehicle_classes(code,service_code,service_class,label,seats,accessible,example_models,ride_type_id,sort_order) VALUES
 ('ride_basic','ride','Economy','Basic',4,false,'{Toyota Vitz,Honda Fit}',(SELECT id FROM ride_types WHERE code='basic'),1),
 ('ride_comfort','ride','Comfort','Comfort',4,false,'{Toyota Axio,Mazda Axela}',(SELECT id FROM ride_types WHERE code='standard'),2),
 ('ride_comfort_plus','ride','Comfort','Comfort+',4,false,'{Toyota Camry,Mazda Atenza}',NULL,3),
 ('ride_executive','ride','Executive','Executive',4,false,'{Mercedes C-Class,BMW 3 Series}',(SELECT id FROM ride_types WHERE code='executive'),4),
 ('ride_executive_suv','ride','Executive','Executive SUV',4,false,'{Toyota Prado,Range Rover Sport}',NULL,5),
 ('ride_mpv','ride','Group','MPV',6,false,'{Toyota Noah,Toyota Voxy}',(SELECT id FROM ride_types WHERE code='xl'),6),
 ('ride_van','ride','Group','Van',10,false,'{Toyota HiAce}',NULL,7),
 ('ride_pwd','ride','Accessible','PWD-accessible',4,true,'{Wheelchair-accessible van}',NULL,8),
 ('airport_transfer','airport','Airport','Airport Transfer',4,false,'{Toyota Axio,Toyota Fielder}',(SELECT id FROM ride_types WHERE code='airport'),9),
 ('charter_van','charter','Charter','Charter Van',14,false,'{Toyota HiAce}',NULL,10),
 ('charter_bus','charter','Charter','Charter Bus',29,false,'{Isuzu NQR,Toyota Coaster}',NULL,11),
 ('charter_coach','charter','Charter','Charter Coach',33,false,'{Scania Touring}',(SELECT id FROM ride_types WHERE code='coach'),12);