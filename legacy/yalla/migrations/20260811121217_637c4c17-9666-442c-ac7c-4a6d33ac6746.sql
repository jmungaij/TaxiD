-- ============================================================
-- YALLA STAFF 360 — ORGANISATION & WORKFORCE FOUNDATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---------- audit log ----------
CREATE TABLE public.org_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  entity_table text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.org_audit_log TO authenticated;
GRANT ALL ON public.org_audit_log TO service_role;
ALTER TABLE public.org_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read org audit" ON public.org_audit_log FOR SELECT TO authenticated USING (public.is_staff_member());

CREATE OR REPLACE FUNCTION public.org_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.org_audit_log (actor_user_id, actor_email, entity_table, entity_id, action, before_data, after_data)
  VALUES (
    auth.uid(), v_email, TG_TABLE_NAME,
    COALESCE((CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)),
    lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

CREATE OR REPLACE FUNCTION public.block_org_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'org_audit_log is append-only'; END; $$;
CREATE TRIGGER org_audit_log_immutable BEFORE UPDATE OR DELETE ON public.org_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.block_org_audit_mutation();

-- ---------- organisation profile ----------
CREATE TABLE public.org_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trading_name text,
  registration_number text,
  tax_pin text,
  country text NOT NULL DEFAULT 'KE',
  registered_address text,
  operating_address text,
  contact_email text,
  contact_phone text,
  website text,
  logo_url text,
  operating_markets text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  provenance text NOT NULL DEFAULT 'LIVE' CHECK (provenance IN ('LIVE','SEEDED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- units (division / department / team) ----------
CREATE TABLE public.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_entities(id) ON DELETE CASCADE,
  parent_unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  unit_type text NOT NULL DEFAULT 'department' CHECK (unit_type IN ('division','department','team')),
  name text NOT NULL,
  code text NOT NULL,
  mandate text,
  purpose text,
  cost_centre text,
  head_staff_id uuid,
  budget_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  approval_authority_cents bigint,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  provenance text NOT NULL DEFAULT 'LIVE' CHECK (provenance IN ('LIVE','SEEDED')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX idx_org_units_parent ON public.org_units(parent_unit_id);

-- ---------- positions ----------
CREATE TABLE public.org_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.org_units(id) ON DELETE CASCADE,
  reports_to_position_id uuid REFERENCES public.org_positions(id) ON DELETE SET NULL,
  title text NOT NULL,
  code text NOT NULL UNIQUE,
  job_purpose text,
  responsibilities text[] NOT NULL DEFAULT '{}',
  authority text[] NOT NULL DEFAULT '{}',
  kpis jsonb NOT NULL DEFAULT '[]'::jsonb,
  grade text,
  approval_limit_cents bigint,
  approved_headcount int NOT NULL DEFAULT 1,
  platform_roles text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  provenance text NOT NULL DEFAULT 'LIVE' CHECK (provenance IN ('LIVE','SEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_positions_unit ON public.org_positions(unit_id);

-- ---------- competency catalogue ----------
CREATE TABLE public.org_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'functional',
  description text,
  max_level int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.org_position_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES public.org_positions(id) ON DELETE CASCADE,
  requirement_kind text NOT NULL CHECK (requirement_kind IN ('qualification','competency','training','certification')),
  competency_id uuid REFERENCES public.org_competencies(id) ON DELETE SET NULL,
  label text NOT NULL,
  required_level int,
  mandatory boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_pos_req_position ON public.org_position_requirements(position_id);

-- ---------- staff ----------
CREATE TABLE public.staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_entities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_no text NOT NULL UNIQUE,
  full_name text NOT NULL,
  preferred_name text,
  work_email text,
  personal_email text,
  phone text,
  photo_url text,
  national_id text,
  emergency_contact_name text,
  emergency_contact_phone text,
  employment_status text NOT NULL DEFAULT 'onboarding'
    CHECK (employment_status IN ('onboarding','active','on_leave','suspended','transferred','offboarding','exited')),
  employment_type text NOT NULL DEFAULT 'permanent'
    CHECK (employment_type IN ('permanent','contract','intern','consultant','part_time')),
  start_date date,
  end_date date,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE SET NULL,
  manager_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  location text,
  cost_centre text,
  approval_limit_cents bigint,
  languages text[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  years_experience numeric,
  provenance text NOT NULL DEFAULT 'LIVE' CHECK (provenance IN ('LIVE','SEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staff_members_unit ON public.staff_members(unit_id);
CREATE INDEX idx_staff_members_manager ON public.staff_members(manager_staff_id);
CREATE INDEX idx_staff_members_user ON public.staff_members(user_id);

ALTER TABLE public.org_units
  ADD CONSTRAINT org_units_head_fkey FOREIGN KEY (head_staff_id) REFERENCES public.staff_members(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_my_staff_record(_staff_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_members s WHERE s.id = _staff_id AND s.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.manages_staff_record(_staff_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_members s
    JOIN public.staff_members m ON m.id = s.manager_staff_id
    WHERE s.id = _staff_id AND m.user_id = auth.uid()
  );
$$;

-- ---------- staff documents ----------
CREATE TABLE public.staff_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  title text NOT NULL,
  description text,
  storage_path text,
  file_name text,
  mime_type text,
  issue_date date,
  expiry_date date,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','expired')),
  classification text NOT NULL DEFAULT 'confidential' CHECK (classification IN ('internal','confidential','restricted')),
  version int NOT NULL DEFAULT 1,
  supersedes_document_id uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  uploaded_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staff_documents_staff ON public.staff_documents(staff_id);
CREATE INDEX idx_staff_documents_expiry ON public.staff_documents(expiry_date);

-- ---------- qualifications & competencies ----------
CREATE TABLE public.staff_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  qualification_kind text NOT NULL DEFAULT 'academic'
    CHECK (qualification_kind IN ('academic','professional','certification','licence','membership')),
  title text NOT NULL,
  institution text,
  awarded_on date,
  expires_on date,
  reference text,
  document_id uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staff_quals_staff ON public.staff_qualifications(staff_id);

CREATE TABLE public.staff_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES public.org_competencies(id) ON DELETE CASCADE,
  assessed_level int NOT NULL,
  evidence text,
  assessed_by uuid,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, competency_id)
);

-- ---------- gaps ----------
CREATE TABLE public.staff_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE SET NULL,
  requirement_id uuid REFERENCES public.org_position_requirements(id) ON DELETE CASCADE,
  gap_kind text NOT NULL CHECK (gap_kind IN ('qualification','competency','training','certification')),
  label text NOT NULL,
  required_level int,
  current_level int,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed','waived')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, requirement_id)
);
CREATE INDEX idx_staff_gaps_staff ON public.staff_gaps(staff_id);

-- ---------- training needs ----------
CREATE TABLE public.staff_training_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  gap_id uuid REFERENCES public.staff_gaps(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('position_requirement','qualification_gap','competency_gap','performance_gap','policy_requirement','compliance_requirement','new_product','new_technology','manager_recommendation','development_objective')),
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified','assigned','enrolled','attended','assessed','completed','certified','applied','closed','cancelled')),
  course_id uuid,
  assigned_by uuid,
  assigned_at timestamptz,
  due_date date,
  completed_at timestamptz,
  assessment_score numeric,
  assessment_passed boolean,
  certificate_document_id uuid REFERENCES public.staff_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_training_needs_staff ON public.staff_training_needs(staff_id);

-- ---------- objectives ----------
CREATE TABLE public.org_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_entities(id) ON DELETE CASCADE,
  parent_objective_id uuid REFERENCES public.org_objectives(id) ON DELETE SET NULL,
  level text NOT NULL CHECK (level IN ('company','division','department','team','employee')),
  unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  kpi_label text NOT NULL,
  kpi_unit text NOT NULL DEFAULT 'count',
  baseline numeric,
  target numeric NOT NULL,
  actual numeric,
  period_start date,
  deadline date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','at_risk','achieved','missed','cancelled')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance text NOT NULL DEFAULT 'LIVE' CHECK (provenance IN ('LIVE','SEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_objectives_unit ON public.org_objectives(unit_id);
CREATE INDEX idx_org_objectives_staff ON public.org_objectives(staff_id);
CREATE INDEX idx_org_objectives_parent ON public.org_objectives(parent_objective_id);

-- ---------- work items (references authoritative records) ----------
CREATE TABLE public.staff_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  objective_id uuid REFERENCES public.org_objectives(id) ON DELETE SET NULL,
  work_kind text NOT NULL CHECK (work_kind IN ('sales_opportunity','customer_case','approval','reconciliation','operations_task','document_review','training','admin_task')),
  title text NOT NULL,
  description text,
  source_table text,
  source_id uuid,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','done','cancelled')),
  next_action text,
  next_action_due date,
  sla_due_at timestamptz,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  outcome text,
  quality_flag text CHECK (quality_flag IN ('good','rework','escalated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_kind, source_table, source_id, staff_id)
);
CREATE INDEX idx_staff_work_items_staff ON public.staff_work_items(staff_id, status);

-- ---------- policies ----------
CREATE TABLE public.org_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_entities(id) ON DELETE CASCADE,
  title text NOT NULL,
  code text NOT NULL,
  category text NOT NULL DEFAULT 'human_capital',
  purpose text,
  scope text,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  approver_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','published','archived')),
  current_version int NOT NULL DEFAULT 1,
  effective_date date,
  review_date date,
  requires_acknowledgement boolean NOT NULL DEFAULT true,
  provenance text NOT NULL DEFAULT 'LIVE' CHECK (provenance IN ('LIVE','SEEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE public.org_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.org_policies(id) ON DELETE CASCADE,
  version int NOT NULL,
  body text,
  storage_path text,
  change_summary text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','published','superseded')),
  authored_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);

CREATE TABLE public.org_policy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.org_policies(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  platform_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_policy_assign_policy ON public.org_policy_assignments(policy_id);

CREATE TABLE public.org_policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.org_policies(id) ON DELETE CASCADE,
  policy_version int NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by_user uuid,
  ip_address text,
  UNIQUE (policy_id, policy_version, staff_id)
);

-- ---------- lifecycle ----------
CREATE TABLE public.staff_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  event_kind text NOT NULL CHECK (event_kind IN ('recruited','onboarded','assigned','equipped','trained','objectives_set','reviewed','transferred','promoted','leave_started','leave_ended','suspended','offboarding_started','access_revoked','work_reassigned','exited')),
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  from_value text,
  to_value text,
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_staff_lifecycle_staff ON public.staff_lifecycle_events(staff_id);

-- ============================================================
-- GRANTS
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.org_entities, public.org_units, public.org_positions, public.org_competencies,
  public.org_position_requirements, public.staff_members, public.staff_documents,
  public.staff_qualifications, public.staff_competencies, public.staff_gaps,
  public.staff_training_needs, public.org_objectives, public.staff_work_items,
  public.org_policies, public.org_policy_versions, public.org_policy_assignments,
  public.org_policy_acknowledgements, public.staff_lifecycle_events
TO authenticated;
GRANT ALL ON
  public.org_entities, public.org_units, public.org_positions, public.org_competencies,
  public.org_position_requirements, public.staff_members, public.staff_documents,
  public.staff_qualifications, public.staff_competencies, public.staff_gaps,
  public.staff_training_needs, public.org_objectives, public.staff_work_items,
  public.org_policies, public.org_policy_versions, public.org_policy_assignments,
  public.org_policy_acknowledgements, public.staff_lifecycle_events
TO service_role;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.org_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_position_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_training_needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_policy_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_lifecycle_events ENABLE ROW LEVEL SECURITY;

-- structure: staff read, admin write
CREATE POLICY "staff read orgs" ON public.org_entities FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write orgs" ON public.org_entities FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff read units" ON public.org_units FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write units" ON public.org_units FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff read positions" ON public.org_positions FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write positions" ON public.org_positions FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff read competencies" ON public.org_competencies FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write competencies" ON public.org_competencies FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff read position reqs" ON public.org_position_requirements FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write position reqs" ON public.org_position_requirements FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- staff records
CREATE POLICY "staff read staff records" ON public.staff_members FOR SELECT TO authenticated
  USING (public.is_staff_member() OR user_id = auth.uid() OR public.manages_staff_record(id));
CREATE POLICY "admin write staff records" ON public.staff_members FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- documents: admins + owner + manager
CREATE POLICY "read staff documents" ON public.staff_documents FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.is_my_staff_record(staff_id)
         OR (classification <> 'restricted' AND public.manages_staff_record(staff_id)));
CREATE POLICY "admin write staff documents" ON public.staff_documents FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "owner upload staff documents" ON public.staff_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_my_staff_record(staff_id));

-- qualifications / competencies / gaps / training
CREATE POLICY "read staff quals" ON public.staff_qualifications FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write staff quals" ON public.staff_qualifications FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "owner add staff quals" ON public.staff_qualifications FOR INSERT TO authenticated
  WITH CHECK (public.is_my_staff_record(staff_id));

CREATE POLICY "read staff competencies" ON public.staff_competencies FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write staff competencies" ON public.staff_competencies FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "read staff gaps" ON public.staff_gaps FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write staff gaps" ON public.staff_gaps FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "read training needs" ON public.staff_training_needs FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write training needs" ON public.staff_training_needs FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "owner progress training needs" ON public.staff_training_needs FOR UPDATE TO authenticated
  USING (public.is_my_staff_record(staff_id)) WITH CHECK (public.is_my_staff_record(staff_id));

-- objectives
CREATE POLICY "staff read objectives" ON public.org_objectives FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write objectives" ON public.org_objectives FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- work items
CREATE POLICY "read work items" ON public.staff_work_items FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write work items" ON public.staff_work_items FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "owner update work items" ON public.staff_work_items FOR UPDATE TO authenticated
  USING (public.is_my_staff_record(staff_id)) WITH CHECK (public.is_my_staff_record(staff_id));

-- policies
CREATE POLICY "staff read policies" ON public.org_policies FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write policies" ON public.org_policies FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff read policy versions" ON public.org_policy_versions FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write policy versions" ON public.org_policy_versions FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "staff read policy assignments" ON public.org_policy_assignments FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "admin write policy assignments" ON public.org_policy_assignments FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE POLICY "read policy acks" ON public.org_policy_acknowledgements FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id));
CREATE POLICY "own policy ack" ON public.org_policy_acknowledgements FOR INSERT TO authenticated
  WITH CHECK (public.is_my_staff_record(staff_id));
CREATE POLICY "admin manage policy acks" ON public.org_policy_acknowledgements FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- lifecycle
CREATE POLICY "read lifecycle" ON public.staff_lifecycle_events FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id));
CREATE POLICY "admin write lifecycle" ON public.staff_lifecycle_events FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ============================================================
-- TRIGGERS: updated_at + audit
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_entities','org_units','org_positions','org_competencies','org_position_requirements',
    'staff_members','staff_documents','staff_qualifications','staff_competencies','staff_gaps',
    'staff_training_needs','org_objectives','staff_work_items','org_policies','org_policy_versions']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['org_entities','org_units','org_positions','org_position_requirements','staff_members',
    'staff_documents','staff_qualifications','staff_competencies','staff_gaps','staff_training_needs',
    'org_objectives','staff_work_items','org_policies','org_policy_versions','org_policy_acknowledgements','staff_lifecycle_events']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.org_audit_trigger()', t, t);
  END LOOP;
END $$;
