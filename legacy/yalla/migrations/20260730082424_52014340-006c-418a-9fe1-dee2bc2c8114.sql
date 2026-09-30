CREATE TABLE public.charter_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, action, idempotency_key)
);

GRANT SELECT, INSERT ON public.charter_idempotency_keys TO authenticated;
GRANT ALL ON public.charter_idempotency_keys TO service_role;
ALTER TABLE public.charter_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own idempotency keys select" ON public.charter_idempotency_keys
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own idempotency keys insert" ON public.charter_idempotency_keys
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE TABLE public.charter_pdf_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  brand jsonb NOT NULL DEFAULT '{}'::jsonb,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.charter_pdf_templates TO authenticated;
GRANT ALL ON public.charter_pdf_templates TO service_role;
ALTER TABLE public.charter_pdf_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates readable by authenticated" ON public.charter_pdf_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "templates managed by admins" ON public.charter_pdf_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE UNIQUE INDEX charter_pdf_templates_single_active
  ON public.charter_pdf_templates (active) WHERE active;

CREATE TRIGGER update_charter_pdf_templates_updated_at
  BEFORE UPDATE ON public.charter_pdf_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.charter_pdf_templates (version, label, active, brand, layout, notes)
VALUES (
  'v1',
  'Yalla Air secure itinerary v1',
  true,
  jsonb_build_object(
    'name', 'Yalla Mobility',
    'division', 'Yalla Air · Charter, Leasing & Rentals',
    'address', 'Nairobi, Kenya',
    'phone', '+254 710 100 090',
    'email', 'hello@yallabeena.info',
    'web', 'yallabeena.info',
    'logo_url', null
  ),
  jsonb_build_object('security_marks', true, 'guilloche', true, 'gallery_thumbnails', true),
  'Initial security-printed itinerary template.'
);