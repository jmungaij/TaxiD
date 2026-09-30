CREATE TABLE public.partner_application_public_notices (
  application_id uuid PRIMARY KEY,
  notified_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.partner_application_public_notices TO service_role;
ALTER TABLE public.partner_application_public_notices ENABLE ROW LEVEL SECURITY;