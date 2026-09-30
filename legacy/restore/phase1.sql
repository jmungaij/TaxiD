CREATE TABLE IF NOT EXISTS public.authentication_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  event_type TEXT NOT NULL,
  method TEXT,
  ip_address INET, country TEXT, city TEXT, user_agent TEXT,
  fingerprint_hash TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.authorization_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  decision text NOT NULL,
  required_capabilities text[] NOT NULL DEFAULT '{}',
  user_capabilities text[] NOT NULL DEFAULT '{}',
  risk_score int NOT NULL DEFAULT 0,
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text, device_id text, country text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  risk_level text NOT NULL DEFAULT 'low',
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.org_audit_log (
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
CREATE TABLE IF NOT EXISTS public.org_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'functional',
  description text,
  max_level int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.org_entities (
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
CREATE TABLE IF NOT EXISTS public.org_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  purpose TEXT,
  meeting_kind TEXT NOT NULL DEFAULT 'internal',
  platform TEXT NOT NULL DEFAULT 'google_meet',
  account_id UUID,
  interview_id UUID,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  organiser_user_id UUID,
  organiser_email TEXT NOT NULL,
  attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
  join_url TEXT,
  conference_provider TEXT,
  external_event_id TEXT,
  external_calendar_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  invite_sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  failure_reason TEXT,
  calendar_uid TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_meetings_kind_ck CHECK (meeting_kind IN ('interview','internal','client','partner','other')),
  CONSTRAINT org_meetings_platform_ck CHECK (platform IN ('google_meet','microsoft_teams','other_link','phone','in_person')),
  CONSTRAINT org_meetings_status_ck CHECK (status IN ('draft','scheduled','sent','failed','cancelled')),
  CONSTRAINT org_meetings_duration_ck CHECK (duration_minutes BETWEEN 10 AND 600)
);
CREATE TABLE IF NOT EXISTS public.permission_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  capability_key text NOT NULL,
  action text NOT NULL,
  old_state jsonb, new_state jsonb,
  approval_ref text, reason text,
  risk_score int NOT NULL DEFAULT 0,
  prev_hash text, event_hash text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.role_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_role app_role, new_role app_role,
  action text NOT NULL,
  approval_ref text, reason text,
  risk_score int NOT NULL DEFAULT 0,
  prev_hash text, event_hash text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.role_grant_drift_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'manual',   
  gap_count integer NOT NULL DEFAULT 0,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  repaired boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  notification_channel text,
  notification_error text
);
CREATE TABLE IF NOT EXISTS public.role_grant_guard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,               
  command_tag text,
  function_signature text,
  function_owner text,
  security_definer boolean,
  applied_grantees text[] NOT NULL DEFAULT '{}',
  missing_grantees text[] NOT NULL DEFAULT '{}',
  actor text NOT NULL DEFAULT current_user,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS public.staff_attention_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_label text NOT NULL DEFAULT 'staff360-intelligence-v1',
  domain text NOT NULL,
  severity text NOT NULL DEFAULT 'watch',
  title text NOT NULL,
  why text NOT NULL,
  evidence text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL,
  expected_impact text NOT NULL,
  recommended_action text NOT NULL,
  owner text NOT NULL,
  source text NOT NULL,
  state text NOT NULL DEFAULT 'modelled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_attention_signals_severity_chk CHECK (severity IN ('info','watch','critical')),
  CONSTRAINT staff_attention_signals_state_chk CHECK (state IN ('live','modelled')),
  CONSTRAINT staff_attention_signals_conf_chk CHECK (confidence >= 0 AND confidence <= 1)
);
CREATE TABLE IF NOT EXISTS public.staff_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordination_key text NOT NULL,
  policy_key text NOT NULL,
  event_key text NOT NULL,
  title text NOT NULL,
  requested_class text NOT NULL,
  effective_class text NOT NULL,
  approver text NOT NULL,
  sla_class text NOT NULL DEFAULT 'today',
  deadline_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  priority_score numeric NOT NULL DEFAULT 0,
  confidence numeric,
  recommendation text,
  selected_option text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_decisions_status_chk CHECK (status IN ('pending','approved','rejected','withdrawn','expired','executed','measured'))
);
CREATE TABLE IF NOT EXISTS public.staff_experiments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  domain text NOT NULL,
  hypothesis text NOT NULL,
  baseline text,
  control text,
  treatment text,
  measurement text,
  status text NOT NULL DEFAULT 'draft',
  decision text,
  measured_result text,
  expected_value text,
  owner_role text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text,
  entity_label text,
  title text NOT NULL,
  notes text,
  workflow_stage text,
  assignee_id uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'open',
  decision_reason text,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_insight_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_key text NOT NULL,
  insight_title text,
  reporter_id uuid NOT NULL DEFAULT auth.uid(),
  issue_type text NOT NULL,
  source_label text,
  comment text,
  status text NOT NULL DEFAULT 'open',
  confidence_before numeric,
  confidence_after numeric,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_intelligence_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_label text NOT NULL DEFAULT 'staff360-intelligence-v1',
  surface text NOT NULL,
  entity_key text NOT NULL DEFAULT 'global',
  metric_key text NOT NULL,
  metric_label text NOT NULL,
  value_text text NOT NULL,
  unit text,
  source text NOT NULL,
  state text NOT NULL DEFAULT 'modelled',
  hint text,
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_intelligence_metrics_state_chk CHECK (state IN ('live','modelled')),
  CONSTRAINT staff_intelligence_metrics_unique UNIQUE (batch_label, surface, entity_key, metric_key)
);
CREATE TABLE IF NOT EXISTS public.staff_live_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key text NOT NULL,
  domain text NOT NULL DEFAULT 'unknown',
  source text NOT NULL,
  entity_type text,
  entity_id text,
  severity text NOT NULL DEFAULT 'info',
  magnitude numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_key text NOT NULL CHECK (permission_key IN ('staff.crm.read','staff.crm.manage')),
  reason text,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE TABLE IF NOT EXISTS public.staff_permissions (
  key text PRIMARY KEY,
  domain text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'search',
  name text NOT NULL,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'private',
  shared_roles text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_alert_prefs (
  user_id uuid PRIMARY KEY,
  sla_toast boolean NOT NULL DEFAULT true,
  sla_email boolean NOT NULL DEFAULT true,
  integration_toast boolean NOT NULL DEFAULT true,
  integration_email boolean NOT NULL DEFAULT true,
  circuit_toast boolean NOT NULL DEFAULT true,
  circuit_email boolean NOT NULL DEFAULT false,
  min_severity text NOT NULL DEFAULT 'warning',
  muted_integrations jsonb NOT NULL DEFAULT '[]'::jsonb,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_start_minute integer NOT NULL DEFAULT 1260,
  quiet_end_minute integer NOT NULL DEFAULT 420,
  quiet_allow_critical boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_alert_prefs_min_severity_check CHECK (min_severity IN ('warning','critical')),
  CONSTRAINT user_alert_prefs_quiet_start_check CHECK (quiet_start_minute BETWEEN 0 AND 1439),
  CONSTRAINT user_alert_prefs_quiet_end_check CHECK (quiet_end_minute BETWEEN 0 AND 1439)
);
CREATE TABLE IF NOT EXISTS public.org_units (
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
CREATE TABLE IF NOT EXISTS public.role_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  capability_id uuid NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, capability_id)
);
CREATE TABLE IF NOT EXISTS public.staff_action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES public.staff_decisions(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  measure_key text NOT NULL,
  unit text NOT NULL DEFAULT 'count',
  expected_value numeric,
  actual_value numeric,
  succeeded boolean,
  lesson text,
  adaptation text,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_baseline_permissions (
  permission_key text PRIMARY KEY REFERENCES public.staff_permissions(key),
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.staff_decisions(id) ON DELETE CASCADE,
  step text NOT NULL,
  actor uuid,
  actor_roles text[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_role_permissions (
  role app_role NOT NULL,
  permission_key text NOT NULL REFERENCES public.staff_permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_key)
);
CREATE TABLE IF NOT EXISTS public.user_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.org_positions (
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
CREATE TABLE IF NOT EXISTS public.org_position_requirements (
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
CREATE TABLE IF NOT EXISTS public.staff_members (
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
CREATE TABLE IF NOT EXISTS public.org_objectives (
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
CREATE TABLE IF NOT EXISTS public.org_policies (
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
CREATE TABLE IF NOT EXISTS public.staff_calendar_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'block' CHECK (kind IN ('block','leave','prep','follow_up','internal','travel')),
  title text NOT NULL DEFAULT 'Busy' CHECK (length(title) <= 160),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS public.staff_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('shared_freebusy','google','microsoft')),
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','pending','verified','error')),
  account_email text,
  last_checked_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, provider)
);
CREATE TABLE IF NOT EXISTS public.staff_competencies (
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
CREATE TABLE IF NOT EXISTS public.staff_documents (
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
CREATE TABLE IF NOT EXISTS public.staff_gaps (
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
CREATE TABLE IF NOT EXISTS public.staff_lifecycle_events (
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
CREATE TABLE IF NOT EXISTS public.org_policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.org_policies(id) ON DELETE CASCADE,
  policy_version int NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by_user uuid,
  ip_address text,
  UNIQUE (policy_id, policy_version, staff_id)
);
CREATE TABLE IF NOT EXISTS public.org_policy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.org_policies(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE CASCADE,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  platform_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.org_policy_versions (
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
CREATE TABLE IF NOT EXISTS public.staff_kpi_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES public.org_objectives(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  note text,
  recorded_by uuid,
  seed_batch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_kpi_actuals_source_type_check
    CHECK (source_type = ANY (ARRAY['authoritative_system','verified_manual','imported','calculated'])),
  CONSTRAINT staff_kpi_actuals_period_check CHECK (period_end >= period_start)
);
CREATE TABLE IF NOT EXISTS public.staff_qualifications (
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
CREATE TABLE IF NOT EXISTS public.staff_training_needs (
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
CREATE TABLE IF NOT EXISTS public.staff_work_items (
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
CREATE TABLE IF NOT EXISTS public.staff_corrective_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  objective_id uuid REFERENCES public.org_objectives(id) ON DELETE SET NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind = ANY (ARRAY['rework','blocked','escalated','sla_breach'])),
  cause_category text NOT NULL CHECK (cause_category = ANY (ARRAY[
    'missing_information','system_defect','process_gap','dependency_delay','capability_gap',
    'customer_delay','pricing_approval','data_quality','third_party','other'])),
  cause_description text NOT NULL,
  evidence_source_table text,
  evidence_source_id uuid,
  evidence_note text,
  impact_days numeric,
  impact_value_cents bigint,
  corrective_action text,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open','in_progress','resolved','ineffective','closed'])),
  resolution text,
  resolved_at timestamptz,
  reported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  actor_user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  planned_minutes integer,
  actual_minutes integer,
  interrupted boolean NOT NULL DEFAULT false,
  outcome_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_work_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  reviewer_user_id uuid,
  decision text NOT NULL CHECK (decision = ANY (ARRAY['submitted','approved','returned','changes_requested'])),
  rationale text NOT NULL,
  quality_rating text CHECK (quality_rating = ANY (ARRAY['good','rework','escalated'])),
  required_action text,
  source_of_record text,
  source_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_staff_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  actor_user_id uuid,
  actor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('review_requested','review_approved','review_returned','corrective_reported','corrective_resolved')),
  title text NOT NULL,
  body text,
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  review_id uuid REFERENCES public.staff_work_reviews(id) ON DELETE SET NULL,
  source_of_record text NOT NULL DEFAULT 'staff_work_items',
  source_record_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_audit_log ADD COLUMN IF NOT EXISTS source_of_record text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL;
ALTER TABLE public.org_entities ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.user_alert_prefs ADD COLUMN IF NOT EXISTS decision_request_portal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS decision_request_email boolean NOT NULL DEFAULT false;
ALTER TABLE public.org_units ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.org_positions ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.org_objectives ADD COLUMN IF NOT EXISTS weight_pct numeric,
  ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS critical_min_pct numeric,
  ADD COLUMN IF NOT EXISTS measurement_frequency text,
  ADD COLUMN IF NOT EXISTS review_frequency text,
  ADD COLUMN IF NOT EXISTS data_source text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'not_available',
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS formula text,
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cross_functional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.org_objectives ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE public.staff_work_items ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.staff_work_items ADD COLUMN IF NOT EXISTS source_event_id  uuid,
  ADD COLUMN IF NOT EXISTS ops_queue        text,
  ADD COLUMN IF NOT EXISTS entity_type      text,
  ADD COLUMN IF NOT EXISTS entity_id        uuid,
  ADD COLUMN IF NOT EXISTS entity_ref       text,
  ADD COLUMN IF NOT EXISTS service_line     text,
  ADD COLUMN IF NOT EXISTS lifecycle_state  text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS required_action  text,
  ADD COLUMN IF NOT EXISTS needs_approval   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_request_id uuid,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sla_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sla_minutes      integer,
  ADD COLUMN IF NOT EXISTS sla_breached_at  timestamptz,
  ADD COLUMN IF NOT EXISTS resolution       text,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS closed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS seed_batch       text;
ALTER TABLE public.staff_work_items ADD COLUMN IF NOT EXISTS approval_state         text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_requested_by  uuid,
  ADD COLUMN IF NOT EXISTS approval_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approval_reason        text,
  ADD COLUMN IF NOT EXISTS approval_decided_by    uuid,
  ADD COLUMN IF NOT EXISTS approval_decided_at    timestamptz,
  ADD COLUMN IF NOT EXISTS approval_decision_note text,
  ADD COLUMN IF NOT EXISTS writeback_outcome      text,
  ADD COLUMN IF NOT EXISTS writeback_applied_at   timestamptz,
  ADD COLUMN IF NOT EXISTS writeback_result       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.staff_work_items ADD COLUMN IF NOT EXISTS priority_band text NOT NULL DEFAULT 'P3',
  ADD COLUMN IF NOT EXISTS effort_minutes integer,
  ADD COLUMN IF NOT EXISTS effort_basis text,
  ADD COLUMN IF NOT EXISTS triage_score numeric,
  ADD COLUMN IF NOT EXISTS value_score numeric;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['authentication_events','authorization_decisions','capabilities','org_audit_log','org_competencies','org_entities','org_meetings','permission_change_log','role_change_log','role_grant_drift_checks','role_grant_guard_events','staff_attention_signals','staff_decisions','staff_experiments','staff_follow_up_tasks','staff_insight_feedback','staff_intelligence_metrics','staff_live_events','staff_permission_grants','staff_permissions','staff_saved_views','user_alert_prefs','org_units','role_capabilities','staff_action_outcomes','staff_baseline_permissions','staff_decision_audit','staff_role_permissions','user_capabilities','org_positions','org_position_requirements','staff_members','org_objectives','org_policies','staff_calendar_blocks','staff_calendar_connections','staff_competencies','staff_documents','staff_gaps','staff_lifecycle_events','org_policy_acknowledgements','org_policy_assignments','org_policy_versions','staff_kpi_actuals','staff_qualifications','staff_training_needs','staff_work_items','staff_corrective_actions','staff_focus_sessions','staff_work_reviews','staff_notifications'] LOOP
 EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
 EXECUTE format('CREATE POLICY "Admins manage restored records" ON public.%I FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[]))', t);
END LOOP; END $$;