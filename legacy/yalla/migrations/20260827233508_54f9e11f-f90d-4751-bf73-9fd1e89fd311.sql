-- =========================================================
-- LEGAL & REGULATORY CONTROL PLANE — FOUNDATION
-- =========================================================

-- 1. Enums -------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.legal_status AS ENUM (
    'not_applicable','unknown','review_required','evidence_required','submitted',
    'under_review','verified','active','expiring','expired','suspended','revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_gate_stage AS ENUM (
    'serviceability','quote','booking','dispatch','custody','delivery','claims','settlement','processing','activation','invoicing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_goods_class AS ENUM ('standard','restricted','conditional','prohibited','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_failure_action AS ENUM (
    'block_booking','block_dispatch','block_settlement','block_processing','block_activation','manual_review','warn_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_review_outcome AS ENUM (
    'pending','legal_review_required','evidence_required','approved','approved_with_conditions','rejected','not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Permissions -------------------------------------------
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
  ('staff.legal.read','legal','read','Read legal, regulatory and compliance records'),
  ('staff.legal.manage','legal','manage','Create and maintain legal, regulatory and compliance records')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key) VALUES
  ('admin','staff.legal.read'),('admin','staff.legal.manage'),
  ('compliance_admin','staff.legal.read'),('compliance_admin','staff.legal.manage'),
  ('director','staff.legal.read'),
  ('general_manager','staff.legal.read'),
  ('operations_admin','staff.legal.read'),
  ('finance_admin','staff.legal.read')
ON CONFLICT DO NOTHING;

-- 3. Reference data ----------------------------------------
CREATE TABLE public.legal_jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  country_code text NOT NULL,
  parent_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  notes text,
  status public.legal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_regulators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  jurisdiction_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  domain text,
  website text,
  contact_email text,
  contact_phone text,
  notes text,
  status public.legal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  jurisdiction_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  regulator_id uuid REFERENCES public.legal_regulators(id) ON DELETE SET NULL,
  legal_source text,
  source_url text,
  summary text,
  effective_from date,
  effective_until date,
  status public.legal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  jurisdiction_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  regulator_id uuid REFERENCES public.legal_regulators(id) ON DELETE SET NULL,
  framework_id uuid REFERENCES public.legal_frameworks(id) ON DELETE SET NULL,
  legal_source text,
  requirement_type text NOT NULL,
  applies_to text NOT NULL DEFAULT 'platform',
  service_families text[] NOT NULL DEFAULT '{}',
  partner_types text[] NOT NULL DEFAULT '{}',
  asset_types text[] NOT NULL DEFAULT '{}',
  goods_classes public.legal_goods_class[] NOT NULL DEFAULT '{}',
  geographies text[] NOT NULL DEFAULT '{}',
  mandatory boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_until date,
  verification_method text,
  evidence_type text,
  approval_authority text,
  renewal_period_days integer,
  failure_action public.legal_failure_action NOT NULL DEFAULT 'manual_review',
  blocking_stages public.legal_gate_stage[] NOT NULL DEFAULT '{}',
  owner_role text,
  owner_user_id uuid,
  status public.legal_status NOT NULL DEFAULT 'review_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_requirements_status ON public.legal_requirements(status);
CREATE INDEX idx_legal_requirements_type ON public.legal_requirements(requirement_type);

-- 4. Instruments -------------------------------------------
CREATE TABLE public.legal_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  jurisdiction_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  regulator_id uuid REFERENCES public.legal_regulators(id) ON DELETE SET NULL,
  holder_type text NOT NULL DEFAULT 'platform',
  holder_id uuid,
  holder_name text,
  licence_type text NOT NULL,
  licence_number text,
  issuer text,
  issue_date date,
  effective_from date,
  effective_until date,
  scope text,
  document_path text,
  verification_status public.legal_review_outcome NOT NULL DEFAULT 'pending',
  verified_by uuid,
  verified_at timestamptz,
  owner_user_id uuid,
  notes text,
  status public.legal_status NOT NULL DEFAULT 'evidence_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_licences_holder ON public.legal_licences(holder_type, holder_id);
CREATE INDEX idx_legal_licences_expiry ON public.legal_licences(effective_until);

CREATE TABLE public.legal_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  jurisdiction_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  regulator_id uuid REFERENCES public.legal_regulators(id) ON DELETE SET NULL,
  holder_type text NOT NULL DEFAULT 'platform',
  holder_id uuid,
  holder_name text,
  permit_type text NOT NULL,
  permit_number text,
  issuer text,
  issue_date date,
  effective_from date,
  effective_until date,
  scope text,
  document_path text,
  verification_status public.legal_review_outcome NOT NULL DEFAULT 'pending',
  owner_user_id uuid,
  notes text,
  status public.legal_status NOT NULL DEFAULT 'evidence_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_permits_expiry ON public.legal_permits(effective_until);

CREATE TABLE public.legal_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  holder_type text NOT NULL DEFAULT 'platform',
  holder_id uuid,
  holder_name text,
  certification_type text NOT NULL,
  certificate_number text,
  issuer text,
  issue_date date,
  effective_from date,
  effective_until date,
  document_path text,
  verification_status public.legal_review_outcome NOT NULL DEFAULT 'pending',
  owner_user_id uuid,
  notes text,
  status public.legal_status NOT NULL DEFAULT 'evidence_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version text NOT NULL DEFAULT '1.0',
  title text NOT NULL,
  policy_type text NOT NULL,
  audience text NOT NULL DEFAULT 'customer',
  summary text,
  body text,
  document_path text,
  public_url text,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  effective_from date,
  effective_until date,
  approved_by uuid,
  approved_at timestamptz,
  owner_user_id uuid,
  status public.legal_status NOT NULL DEFAULT 'review_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE public.legal_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code text NOT NULL,
  version text NOT NULL DEFAULT '1.0',
  title text NOT NULL,
  contract_type text NOT NULL,
  counterparty_type text NOT NULL DEFAULT 'customer',
  counterparty_id uuid,
  counterparty_name text,
  scope text,
  territory text,
  services text[] NOT NULL DEFAULT '{}',
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  obligations_summary text,
  document_path text,
  signed_at timestamptz,
  effective_from date,
  effective_until date,
  auto_renew boolean NOT NULL DEFAULT false,
  owner_user_id uuid,
  status public.legal_status NOT NULL DEFAULT 'review_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_code, version)
);
CREATE INDEX idx_legal_contracts_counterparty ON public.legal_contracts(counterparty_type, counterparty_id);

CREATE TABLE public.legal_slas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid REFERENCES public.legal_contracts(id) ON DELETE CASCADE,
  code text NOT NULL,
  service_family text,
  metric text NOT NULL,
  target_value numeric,
  target_unit text,
  measurement_method text,
  remedy text,
  is_guarantee boolean NOT NULL DEFAULT false,
  effective_from date,
  effective_until date,
  owner_user_id uuid,
  status public.legal_status NOT NULL DEFAULT 'review_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_protection_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_reference text NOT NULL,
  provider text NOT NULL,
  policy_number text,
  insured_entity text NOT NULL,
  insured_entity_id uuid,
  coverage_type text NOT NULL,
  territory text,
  limit_amount numeric,
  limit_currency text NOT NULL DEFAULT 'KES',
  per_consignment_limit numeric,
  deductible numeric,
  effective_from date,
  effective_until date,
  covered_goods text[] NOT NULL DEFAULT '{}',
  exclusions text[] NOT NULL DEFAULT '{}',
  document_path text,
  verification_status public.legal_review_outcome NOT NULL DEFAULT 'pending',
  verified_by uuid,
  verified_at timestamptz,
  owner_user_id uuid,
  status public.legal_status NOT NULL DEFAULT 'evidence_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_protection_expiry ON public.legal_protection_policies(effective_until);

CREATE TABLE public.legal_goods_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  goods_category text NOT NULL,
  goods_class public.legal_goods_class NOT NULL DEFAULT 'unknown',
  jurisdiction_id uuid REFERENCES public.legal_jurisdictions(id) ON DELETE SET NULL,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  service_families text[] NOT NULL DEFAULT '{}',
  conditions text[] NOT NULL DEFAULT '{}',
  required_evidence text[] NOT NULL DEFAULT '{}',
  max_declared_value numeric,
  keywords text[] NOT NULL DEFAULT '{}',
  legal_basis text,
  failure_action public.legal_failure_action NOT NULL DEFAULT 'manual_review',
  owner_user_id uuid,
  notes text,
  status public.legal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_data_processing_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  activity text NOT NULL,
  data_controller text NOT NULL,
  data_processor text,
  processing_purpose text NOT NULL,
  lawful_basis text NOT NULL,
  data_categories text[] NOT NULL DEFAULT '{}',
  data_subjects text[] NOT NULL DEFAULT '{}',
  special_category boolean NOT NULL DEFAULT false,
  retention_period_days integer,
  deletion_rule text,
  access_roles text[] NOT NULL DEFAULT '{}',
  sharing_parties text[] NOT NULL DEFAULT '{}',
  cross_border_transfer boolean NOT NULL DEFAULT false,
  transfer_destinations text[] NOT NULL DEFAULT '{}',
  transfer_safeguard text,
  security_measures text[] NOT NULL DEFAULT '{}',
  dpia_required boolean NOT NULL DEFAULT false,
  dpia_completed_at timestamptz,
  owner_user_id uuid,
  status public.legal_status NOT NULL DEFAULT 'review_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Governance --------------------------------------------
CREATE TABLE public.legal_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  evidence_type text NOT NULL,
  title text NOT NULL,
  description text,
  storage_bucket text,
  storage_path text,
  content_hash text,
  issued_at timestamptz,
  valid_until date,
  collected_by uuid,
  verification_status public.legal_review_outcome NOT NULL DEFAULT 'pending',
  verified_by uuid,
  verified_at timestamptz,
  status public.legal_status NOT NULL DEFAULT 'submitted',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_evidence_subject ON public.legal_evidence(subject_type, subject_id);

CREATE TABLE public.legal_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  approval_type text NOT NULL,
  authority text NOT NULL,
  decision public.legal_review_outcome NOT NULL DEFAULT 'pending',
  conditions text[] NOT NULL DEFAULT '{}',
  rationale text,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  evidence_id uuid REFERENCES public.legal_evidence(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_approvals_subject ON public.legal_approvals(subject_type, subject_id);

CREATE TABLE public.legal_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  question text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_by uuid,
  assigned_to uuid,
  assigned_role text,
  due_at timestamptz,
  outcome public.legal_review_outcome NOT NULL DEFAULT 'legal_review_required',
  determination text,
  determined_by uuid,
  determined_at timestamptz,
  evidence_id uuid REFERENCES public.legal_evidence(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_reviews_outcome ON public.legal_reviews(outcome);

CREATE TABLE public.legal_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES public.legal_contracts(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  obligation_type text NOT NULL DEFAULT 'regulatory',
  frequency text,
  next_due_at timestamptz,
  last_completed_at timestamptz,
  owner_role text,
  owner_user_id uuid,
  escalation_role text,
  failure_action public.legal_failure_action NOT NULL DEFAULT 'manual_review',
  status public.legal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_obligation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.legal_obligations(id) ON DELETE CASCADE,
  assignee_user_id uuid,
  assignee_role text,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  completed_at timestamptz,
  completion_note text,
  evidence_id uuid REFERENCES public.legal_evidence(id) ON DELETE SET NULL,
  status public.legal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.legal_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_code text NOT NULL UNIQUE,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text,
  regulator_id uuid REFERENCES public.legal_regulators(id) ON DELETE SET NULL,
  requirement_id uuid REFERENCES public.legal_requirements(id) ON DELETE SET NULL,
  legal_basis text,
  affected_customer_id uuid,
  affected_partner_id uuid,
  affected_shipment_ref text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  reported_by uuid,
  owner_user_id uuid,
  owner_role text,
  deadline_at timestamptz,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  evidence_id uuid REFERENCES public.legal_evidence(id) ON DELETE SET NULL,
  status public.legal_status NOT NULL DEFAULT 'under_review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_incidents_status ON public.legal_incidents(status, severity);

CREATE TABLE public.legal_compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid,
  subject_ref text,
  requirement_code text,
  gate_stage public.legal_gate_stage,
  decision text NOT NULL,
  reason_code text,
  shadow_mode boolean NOT NULL DEFAULT true,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_legal_compliance_events_subject ON public.legal_compliance_events(subject_type, subject_id);
CREATE INDEX idx_legal_compliance_events_created ON public.legal_compliance_events(created_at DESC);

-- 6. Grants ------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_jurisdictions','legal_regulators','legal_frameworks','legal_requirements',
    'legal_licences','legal_permits','legal_certifications','legal_policies','legal_contracts',
    'legal_slas','legal_protection_policies','legal_goods_rules','legal_data_processing_records',
    'legal_evidence','legal_approvals','legal_reviews','legal_obligations',
    'legal_obligation_assignments','legal_incidents','legal_compliance_events'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY "legal_read_%1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.has_staff_permission('staff.legal.read'))$f$, t);
  END LOOP;
END $$;

-- 7. Write policies (mutable instrument/reference tables) ---
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_jurisdictions','legal_regulators','legal_frameworks','legal_requirements',
    'legal_licences','legal_permits','legal_certifications','legal_policies','legal_contracts',
    'legal_slas','legal_protection_policies','legal_goods_rules','legal_data_processing_records',
    'legal_evidence','legal_obligations','legal_obligation_assignments','legal_incidents'
  ] LOOP
    EXECUTE format($f$CREATE POLICY "legal_insert_%1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission('staff.legal.manage'))$f$, t);
    EXECUTE format($f$CREATE POLICY "legal_update_%1$s" ON public.%1$I FOR UPDATE TO authenticated USING (public.has_staff_permission('staff.legal.manage')) WITH CHECK (public.has_staff_permission('staff.legal.manage'))$f$, t);
  END LOOP;
END $$;

-- Append-only tables: insert allowed for managers, never update/delete.
CREATE POLICY "legal_insert_legal_approvals" ON public.legal_approvals
  FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission('staff.legal.manage'));
CREATE POLICY "legal_insert_legal_reviews" ON public.legal_reviews
  FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission('staff.legal.manage'));
CREATE POLICY "legal_insert_legal_compliance_events" ON public.legal_compliance_events
  FOR INSERT TO authenticated WITH CHECK (public.has_staff_permission('staff.legal.manage'));

-- Approvals/reviews record decisions once; the decision fields are set through
-- a controlled update path restricted to legal managers.
CREATE POLICY "legal_update_legal_approvals" ON public.legal_approvals
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.legal.manage') AND decided_at IS NULL)
  WITH CHECK (public.has_staff_permission('staff.legal.manage'));
CREATE POLICY "legal_update_legal_reviews" ON public.legal_reviews
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.legal.manage') AND determined_at IS NULL)
  WITH CHECK (public.has_staff_permission('staff.legal.manage'));

-- 8. updated_at triggers -----------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_jurisdictions','legal_regulators','legal_frameworks','legal_requirements',
    'legal_licences','legal_permits','legal_certifications','legal_policies','legal_contracts',
    'legal_slas','legal_protection_policies','legal_goods_rules','legal_data_processing_records',
    'legal_evidence','legal_obligations','legal_obligation_assignments','legal_incidents'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- 9. Append-only guard for the compliance event log ---------
CREATE OR REPLACE FUNCTION public._legal_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'legal_compliance_events is append-only';
END;
$$;

CREATE TRIGGER trg_legal_events_append_only
  BEFORE UPDATE OR DELETE ON public.legal_compliance_events
  FOR EACH ROW EXECUTE FUNCTION public._legal_events_append_only();