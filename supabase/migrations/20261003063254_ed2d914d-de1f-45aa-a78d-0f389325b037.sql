ALTER TABLE public.ride_types ADD COLUMN IF NOT EXISTS commission_pct numeric NOT NULL DEFAULT 15;
CREATE TABLE public.taxid_rate_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL, vehicle_group text NOT NULL, location text NOT NULL DEFAULT 'Nairobi',
  basis text NOT NULL CHECK (basis IN ('per_day','per_trip','per_month','per_day_min3')),
  amount_kes numeric NOT NULL, km_cap int, all_inclusive boolean NOT NULL DEFAULT true,
  vehicle_examples text, effective_from date NOT NULL DEFAULT current_date, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section, vehicle_group, location, basis, effective_from));
GRANT SELECT ON public.taxid_rate_card TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.taxid_rate_card TO authenticated;
GRANT ALL ON public.taxid_rate_card TO service_role;
ALTER TABLE public.taxid_rate_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read rate card" ON public.taxid_rate_card FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage rate card" ON public.taxid_rate_card FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_taxid_rate_card_updated BEFORE UPDATE ON public.taxid_rate_card FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();