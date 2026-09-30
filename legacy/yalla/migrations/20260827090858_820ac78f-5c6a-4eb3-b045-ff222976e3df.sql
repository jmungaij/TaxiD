CREATE TABLE IF NOT EXISTS public.logistics_service_config (
  offering_code text PRIMARY KEY,
  lifecycle text NOT NULL DEFAULT 'DRAFT',
  self_service_booking boolean NOT NULL DEFAULT false,
  enquiry_enabled boolean NOT NULL DEFAULT true,
  service_areas text[] NOT NULL DEFAULT '{}',
  operating_hours jsonb,
  daily_capacity_orders integer,
  rate_plan_id text,
  pricing_verified boolean NOT NULL DEFAULT false,
  pod_required text[] NOT NULL DEFAULT '{}',
  returns_policy text,
  claims_policy text,
  restricted_goods_policy text,
  partner_eligibility_required boolean NOT NULL DEFAULT false,
  compliance_status text NOT NULL DEFAULT 'NOT_ASSESSED',
  legal_approval_reference text,
  effective_from timestamptz,
  expires_at timestamptz,
  activation_authority text,
  last_verified_at timestamptz,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.logistics_service_config TO authenticated;
GRANT ALL ON public.logistics_service_config TO service_role;
ALTER TABLE public.logistics_service_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.logistics_service_config_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_code text NOT NULL,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.logistics_service_config_audit TO authenticated;
GRANT ALL ON public.logistics_service_config_audit TO service_role;
ALTER TABLE public.logistics_service_config_audit ENABLE ROW LEVEL SECURITY;

INSERT INTO public.staff_permissions(key, domain, action, description) VALUES
  ('staff.logistics.read','logistics','read','View logistics service catalogue configuration and serviceability diagnostics'),
  ('staff.logistics.manage','logistics','manage','Configure, activate and suspend logistics service offerings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions(role, permission_key) VALUES
  ('admin','staff.logistics.read'),('admin','staff.logistics.manage'),
  ('director','staff.logistics.read'),
  ('general_manager','staff.logistics.read'),
  ('operations_admin','staff.logistics.read'),('operations_admin','staff.logistics.manage'),
  ('dispatch_manager','staff.logistics.read'),
  ('compliance_admin','staff.logistics.read')
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "staff read logistics service config" ON public.logistics_service_config;
CREATE POLICY "staff read logistics service config" ON public.logistics_service_config
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

DROP POLICY IF EXISTS "staff insert logistics service config" ON public.logistics_service_config;
CREATE POLICY "staff insert logistics service config" ON public.logistics_service_config
  FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

DROP POLICY IF EXISTS "staff update logistics service config" ON public.logistics_service_config;
CREATE POLICY "staff update logistics service config" ON public.logistics_service_config
  FOR UPDATE TO authenticated USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

DROP POLICY IF EXISTS "staff read logistics service config audit" ON public.logistics_service_config_audit;
CREATE POLICY "staff read logistics service config audit" ON public.logistics_service_config_audit
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._logistics_service_config_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  INSERT INTO public.logistics_service_config_audit(offering_code, action, before_state, after_state, actor_id)
  VALUES (
    NEW.offering_code,
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS logistics_service_config_audit ON public.logistics_service_config;
CREATE TRIGGER logistics_service_config_audit
  BEFORE INSERT OR UPDATE ON public.logistics_service_config
  FOR EACH ROW EXECUTE FUNCTION public._logistics_service_config_audit();

-- Seed truthful activation records mirroring the frozen catalogue.
INSERT INTO public.logistics_service_config
  (offering_code, lifecycle, self_service_booking, enquiry_enabled, service_areas, operating_hours,
   daily_capacity_orders, rate_plan_id, pricing_verified, pod_required, returns_policy, claims_policy,
   restricted_goods_policy, partner_eligibility_required, compliance_status, activation_authority, last_verified_at)
VALUES
  ('PARCEL_STANDARD','BOOKABLE',true,true,ARRAY['Nairobi CBD','Westlands','Industrial Area','Ngara','Kilimani','Embakasi'],
   '{"start":"08:00","end":"18:00","days":[1,2,3,4,5,6]}'::jsonb, 250,'RP-NBO-STD-1',true,ARRAY['PHOTO'],
   'Undelivered parcels are returned to the sender within 3 working days at the return tariff.',
   'Claims are accepted within 7 days of the delivery attempt, capped at the declared value.',
   'No prohibited goods. Restricted categories require compliance review before dispatch.',
   false,'APPROVED','Head of Logistics Operations', now()),
  ('EXPRESS_CITY','PILOT',true,true,ARRAY[]::text[], NULL, NULL,'RP-NBO-EXP-1',false,ARRAY['PHOTO'],
   NULL, NULL, NULL, true,'NOT_ASSESSED', NULL, NULL),
  ('COURIER_DOCUMENT','PILOT',true,true,ARRAY[]::text[], NULL, NULL,'RP-NBO-DOC-1',false,ARRAY['SIGNATURE','RECIPIENT_ID'],
   NULL, NULL, NULL, true,'NOT_ASSESSED', NULL, NULL),
  ('FREIGHT_CARGO','ENQUIRY_ONLY',false,true,ARRAY['Kenya']::text[], NULL, NULL,'RP-KE-FRT-1',false,ARRAY['SIGNATURE','PHOTO'],
   NULL, NULL, NULL, true,'NOT_ASSESSED', NULL, NULL),
  ('ECOMMERCE_FULFILMENT','ENQUIRY_ONLY',false,true,ARRAY['Nairobi']::text[], NULL, NULL,'RP-NBO-FUL-1',false,ARRAY['PHOTO'],
   NULL, NULL, NULL, true,'NOT_ASSESSED', NULL, NULL)
ON CONFLICT (offering_code) DO NOTHING;