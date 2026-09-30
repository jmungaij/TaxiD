CREATE TABLE public.platform_billing_identity (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name text NOT NULL,
  kra_pin text NOT NULL CHECK (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  tcc_number text,
  tcc_valid_until date,
  postal_address text,
  physical_address text,
  mpesa_paybill text NOT NULL CHECK (mpesa_paybill ~ '^[0-9]{5,7}$'),
  mpesa_environment text NOT NULL DEFAULT 'sandbox' CHECK (mpesa_environment IN ('sandbox','production')),
  etims_environment text NOT NULL DEFAULT 'sandbox' CHECK (etims_environment IN ('sandbox','production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_billing_identity TO authenticated;
GRANT ALL ON public.platform_billing_identity TO service_role;
ALTER TABLE public.platform_billing_identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance staff read billing identity" ON public.platform_billing_identity FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));
CREATE POLICY "Super admins manage billing identity" ON public.platform_billing_identity FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]));
CREATE TRIGGER platform_billing_identity_updated BEFORE UPDATE ON public.platform_billing_identity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();