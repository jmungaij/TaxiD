CREATE TABLE IF NOT EXISTS public.payment_gateway_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway text NOT NULL DEFAULT 'mpesa',
  environment text NOT NULL DEFAULT 'production',
  short_code text,
  consumer_key text,
  consumer_secret text,
  passkey text,
  b2c_initiator_name text,
  b2c_security_credential text,
  etims_device_serial text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, environment)
);
GRANT SELECT, INSERT, UPDATE ON public.payment_gateway_settings TO authenticated;
GRANT ALL ON public.payment_gateway_settings TO service_role;
ALTER TABLE public.payment_gateway_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Super admins manage payment settings" ON public.payment_gateway_settings;
CREATE POLICY "Super admins manage payment settings" ON public.payment_gateway_settings
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin']::public.app_role[]));
INSERT INTO public.payment_gateway_settings (gateway, environment, short_code)
  VALUES ('mpesa', 'production', '4573823')
  ON CONFLICT (gateway, environment) DO NOTHING;