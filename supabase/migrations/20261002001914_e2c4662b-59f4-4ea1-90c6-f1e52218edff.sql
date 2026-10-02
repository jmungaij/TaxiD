ALTER TABLE public.payment_gateway_settings
  ADD COLUMN IF NOT EXISTS b2c_short_code text,
  ADD COLUMN IF NOT EXISTS etims_api_key text,
  ADD COLUMN IF NOT EXISTS etims_base_url text,
  ADD COLUMN IF NOT EXISTS etims_webhook_secret text,
  ADD COLUMN IF NOT EXISTS etims_device_mode text;