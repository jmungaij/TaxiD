-- ============ Rate cards (versioned, never overwritten) ============
CREATE TABLE public.commercial_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  product_domain text NOT NULL CHECK (product_domain IN (
    'ride_hailing','corporate_charter','delivery','logistics','rentals','leasing','other')),
  version text NOT NULL,
  status text NOT NULL DEFAULT 'source' CHECK (status IN ('source','pending_approval','approved','retired')),
  currency text NOT NULL DEFAULT 'KES',
  effective_from date,
  review_at date,
  source_note text,
  source_reference text,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  retired_at timestamptz,
  change_reason text,
  provenance text NOT NULL DEFAULT 'LIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_rate_cards TO authenticated;
GRANT ALL ON public.commercial_rate_cards TO service_role;
ALTER TABLE public.commercial_rate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read rate cards" ON public.commercial_rate_cards
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin insert rate cards" ON public.commercial_rate_cards
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update rate cards" ON public.commercial_rate_cards
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ============ Vehicle categories ============
CREATE TABLE public.commercial_vehicle_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  product_domain text NOT NULL DEFAULT 'corporate_charter',
  example_models text[] NOT NULL DEFAULT '{}',
  accessibility boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_vehicle_categories TO authenticated;
GRANT ALL ON public.commercial_vehicle_categories TO service_role;
ALTER TABLE public.commercial_vehicle_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read vehicle categories" ON public.commercial_vehicle_categories
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write vehicle categories" ON public.commercial_vehicle_categories
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update vehicle categories" ON public.commercial_vehicle_categories
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ============ Rate lines ============
CREATE TABLE public.commercial_rate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id uuid NOT NULL REFERENCES public.commercial_rate_cards(id) ON DELETE CASCADE,
  service_code text NOT NULL CHECK (service_code IN (
    'day_trip','executive','pwd','offroad','airport_transfer','monthly_long_term')),
  scope_label text NOT NULL DEFAULT '',
  category_code text NOT NULL REFERENCES public.commercial_vehicle_categories(code) ON DELETE RESTRICT,
  pricing_basis text NOT NULL CHECK (pricing_basis IN ('per_day','per_trip','per_month')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES',
  included_distance_km integer,
  included_distance_period text CHECK (included_distance_period IN ('day','trip','month')),
  drive_mode text CHECK (drive_mode IN ('chauffeured','self_drive','dry_with_driver')),
  min_days integer,
  inclusion_note text,
  conditions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_card_id, service_code, scope_label, category_code, pricing_basis)
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_rate_lines TO authenticated;
GRANT ALL ON public.commercial_rate_lines TO service_role;
ALTER TABLE public.commercial_rate_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read rate lines" ON public.commercial_rate_lines
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write rate lines" ON public.commercial_rate_lines
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update rate lines" ON public.commercial_rate_lines
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ============ Contract templates ============
CREATE TABLE public.commercial_contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','approved','retired')),
  service_provider_legal_name text NOT NULL,
  classification text NOT NULL DEFAULT 'private_confidential',
  jurisdiction text NOT NULL DEFAULT 'Republic of Kenya',
  scope_services text[] NOT NULL DEFAULT '{}',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_document_id uuid REFERENCES public.crm_documents(id) ON DELETE SET NULL,
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_contract_templates TO authenticated;
GRANT ALL ON public.commercial_contract_templates TO service_role;
ALTER TABLE public.commercial_contract_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read contract templates" ON public.commercial_contract_templates
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write contract templates" ON public.commercial_contract_templates
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update contract templates" ON public.commercial_contract_templates
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ============ Customer contract instances ============
CREATE TABLE public.commercial_contract_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.commercial_contract_templates(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.crm_documents(id) ON DELETE SET NULL,
  rate_card_id uuid REFERENCES public.commercial_rate_cards(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  customer_legal_name text NOT NULL,
  customer_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_services text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'generated' CHECK (status IN (
    'generated','internal_review','approved','shared','under_negotiation','executed','declined','superseded')),
  effective_date date,
  contract_term text,
  payment_terms text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, template_id, status) DEFERRABLE INITIALLY DEFERRED
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_contract_instances TO authenticated;
GRANT ALL ON public.commercial_contract_instances TO service_role;
ALTER TABLE public.commercial_contract_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read contract instances" ON public.commercial_contract_instances
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert contract instances" ON public.commercial_contract_instances
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());
CREATE POLICY "commercial update contract instances" ON public.commercial_contract_instances
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_commercial_staff()
         OR (owner_staff_id IS NOT NULL AND public.is_my_staff_record(owner_staff_id)))
  WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff()
         OR (owner_staff_id IS NOT NULL AND public.is_my_staff_record(owner_staff_id)));

-- ============ Commercial schedules ============
CREATE TABLE public.commercial_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_instance_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  rate_card_id uuid NOT NULL REFERENCES public.commercial_rate_cards(id) ON DELETE RESTRICT,
  title text NOT NULL,
  services text[] NOT NULL DEFAULT '{}',
  locations text[] NOT NULL DEFAULT '{}',
  vehicle_categories text[] NOT NULL DEFAULT '{}',
  commercial_terms text,
  validity text,
  special_conditions text,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_schedules TO authenticated;
GRANT ALL ON public.commercial_schedules TO service_role;
ALTER TABLE public.commercial_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read schedules" ON public.commercial_schedules
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert schedules" ON public.commercial_schedules
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());
CREATE POLICY "commercial update schedules" ON public.commercial_schedules
  FOR UPDATE TO authenticated USING (public.is_platform_admin() OR public.is_commercial_staff())
  WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());

-- ============ Quotations pinned to a rate card version ============
CREATE TABLE public.commercial_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  contract_instance_id uuid REFERENCES public.commercial_contract_instances(id) ON DELETE SET NULL,
  rate_card_id uuid NOT NULL REFERENCES public.commercial_rate_cards(id) ON DELETE RESTRICT,
  rate_card_version text NOT NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  currency text NOT NULL DEFAULT 'KES',
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','submitted','approved','shared','accepted','declined','expired','superseded')),
  approval_status text NOT NULL DEFAULT 'not_required' CHECK (approval_status IN (
    'not_required','pending','approved','rejected')),
  valid_until date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_quotations TO authenticated;
GRANT ALL ON public.commercial_quotations TO service_role;
ALTER TABLE public.commercial_quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read quotations" ON public.commercial_quotations
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert quotations" ON public.commercial_quotations
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());
CREATE POLICY "commercial update quotations" ON public.commercial_quotations
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin() OR public.is_commercial_staff()
         OR (owner_staff_id IS NOT NULL AND public.is_my_staff_record(owner_staff_id)))
  WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff()
         OR (owner_staff_id IS NOT NULL AND public.is_my_staff_record(owner_staff_id)));

CREATE TABLE public.commercial_quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.commercial_quotations(id) ON DELETE CASCADE,
  rate_line_id uuid REFERENCES public.commercial_rate_lines(id) ON DELETE SET NULL,
  service_code text NOT NULL,
  scope_label text NOT NULL DEFAULT '',
  category_code text NOT NULL,
  pricing_basis text NOT NULL,
  unit_amount numeric(14,2) NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total numeric(14,2) NOT NULL,
  included_distance_km integer,
  conditions text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.commercial_quotation_lines TO authenticated;
GRANT ALL ON public.commercial_quotation_lines TO service_role;
ALTER TABLE public.commercial_quotation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read quotation lines" ON public.commercial_quotation_lines
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert quotation lines" ON public.commercial_quotation_lines
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());

-- ============ Custom pricing requests (no invented rates) ============
CREATE TABLE public.commercial_pricing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  rate_card_id uuid REFERENCES public.commercial_rate_cards(id) ON DELETE SET NULL,
  requested_by_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  service_code text NOT NULL,
  scope_label text,
  category_code text,
  requirement text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.commercial_pricing_requests TO authenticated;
GRANT ALL ON public.commercial_pricing_requests TO service_role;
ALTER TABLE public.commercial_pricing_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read pricing requests" ON public.commercial_pricing_requests
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert pricing requests" ON public.commercial_pricing_requests
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin decide pricing requests" ON public.commercial_pricing_requests
  FOR UPDATE TO authenticated USING (public.is_platform_admin() OR public.is_commercial_staff())
  WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());

-- Timestamps
CREATE TRIGGER trg_rate_cards_touch BEFORE UPDATE ON public.commercial_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_contract_templates_touch BEFORE UPDATE ON public.commercial_contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_contract_instances_touch BEFORE UPDATE ON public.commercial_contract_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_schedules_touch BEFORE UPDATE ON public.commercial_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_quotations_touch BEFORE UPDATE ON public.commercial_quotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pricing_requests_touch BEFORE UPDATE ON public.commercial_pricing_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_rate_lines_lookup ON public.commercial_rate_lines (rate_card_id, service_code, category_code, scope_label);
CREATE INDEX idx_contract_instances_account ON public.commercial_contract_instances (account_id);
CREATE INDEX idx_quotations_account ON public.commercial_quotations (account_id, created_at DESC);