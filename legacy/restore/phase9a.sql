DO $$ BEGIN CREATE TYPE public.crm_doc_verb AS ENUM ('view','download','use_template','create_version','edit','submit','approve','share','archive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS public.crm_account_access_grants ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, grantee_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE, access_level text NOT NULL CHECK (access_level IN ('view','edit')), reason text NOT NULL, granted_by uuid NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, revoked_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_contacts ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, full_name text NOT NULL, contact_role text NOT NULL DEFAULT 'primary' CHECK (contact_role IN ('primary','decision_maker','procurement','finance','operations','exec_sponsor','other')), job_title text, email text, phone text, influence_level text NOT NULL DEFAULT 'medium' CHECK (influence_level IN ('low','medium','high')), is_active boolean NOT NULL DEFAULT true, notes text, seed_batch text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_document_permissions ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid REFERENCES public.crm_documents(id) ON DELETE CASCADE, doc_class public.crm_doc_class, doc_type text, role app_role, verb public.crm_doc_verb NOT NULL, allowed boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT crm_document_permissions_scope CHECK (document_id IS NOT NULL OR doc_class IS NOT NULL OR doc_type IS NOT NULL) );
CREATE TABLE IF NOT EXISTS public.crm_document_versions ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES public.crm_documents(id) ON DELETE CASCADE, version_label text NOT NULL, version_seq integer NOT NULL, storage_path text, file_name text, mime_type text, byte_size bigint, checksum text, change_note text, authored_by uuid REFERENCES auth.users(id), authored_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL, approval_state text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (document_id, version_seq), UNIQUE (document_id, version_label) );
CREATE TABLE IF NOT EXISTS public.device_fingerprints ( id UUID PRIMARY KEY DEFAULT gen_random_uuid(), fingerprint_hash TEXT NOT NULL UNIQUE, user_id UUID, platform TEXT, os TEXT, os_version TEXT, app_version TEXT, user_agent TEXT, screen TEXT, timezone TEXT, language TEXT, ip_address INET, country TEXT, city TEXT, is_emulator BOOLEAN DEFAULT false, is_rooted BOOLEAN DEFAULT false, is_jailbroken BOOLEAN DEFAULT false, has_mock_location BOOLEAN DEFAULT false, risk_score NUMERIC(5,2) DEFAULT 0, first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now(), metadata JSONB NOT NULL DEFAULT '{}'::JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.identity_auth_policies ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope text NOT NULL CHECK (scope IN ('PLATFORM','ORGANISATION')), corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE CASCADE, label text NOT NULL, version integer NOT NULL DEFAULT 1, email_domains text[] NOT NULL DEFAULT '{}', password_enabled boolean NOT NULL DEFAULT true, passwordless_enabled boolean NOT NULL DEFAULT true, google_enabled boolean NOT NULL DEFAULT true, sso_enabled boolean NOT NULL DEFAULT false, sso_provider text, mfa_required boolean NOT NULL DEFAULT false, session_idle_minutes integer NOT NULL DEFAULT 60, session_absolute_hours integer NOT NULL DEFAULT 12, state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')), approved_by uuid, approved_at timestamptz, note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT identity_policy_scope_shape CHECK ( (scope = 'ORGANISATION' AND corporate_id IS NOT NULL) OR (scope = 'PLATFORM' AND corporate_id IS NULL) ), CONSTRAINT identity_policy_approved_shape CHECK ( state <> 'ACTIVE' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL) ) );
CREATE TABLE IF NOT EXISTS public.identity_discovery_rate ( bucket text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), hits integer NOT NULL DEFAULT 0 );
CREATE TABLE IF NOT EXISTS public.identity_risk_policies ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL, label text NOT NULL, w_new_device integer NOT NULL DEFAULT 30, w_new_country integer NOT NULL DEFAULT 35, w_dormant integer NOT NULL DEFAULT 20, w_recent_failures integer NOT NULL DEFAULT 25, w_impossible_travel integer NOT NULL DEFAULT 45, w_privileged_access integer NOT NULL DEFAULT 15, dormant_days integer NOT NULL DEFAULT 30, failure_window_minutes integer NOT NULL DEFAULT 60, failure_threshold integer NOT NULL DEFAULT 3, travel_window_hours integer NOT NULL DEFAULT 2, step_up_threshold integer NOT NULL DEFAULT 40, state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')), business_approval text NOT NULL DEFAULT 'PENDING_BUSINESS_APPROVAL', approved_by uuid, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (version) );
CREATE TABLE IF NOT EXISTS public.navigation_logs ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, session_id text, route text NOT NULL, from_route text, success boolean NOT NULL DEFAULT true, error_message text, duration_ms int, user_agent text, created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.platform_settings ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brand_name text NOT NULL DEFAULT 'Yalla Ride', support_email text, support_phone text, default_currency text NOT NULL DEFAULT 'KES', default_timezone text NOT NULL DEFAULT 'Africa/Nairobi', default_locale text NOT NULL DEFAULT 'en', maintenance_mode boolean NOT NULL DEFAULT false, maintenance_message text, feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb, email_from_name text, email_from_address text, email_reply_to text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.portal_transition_audit ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, actor_email text, kind text NOT NULL CHECK (kind IN ('login_redirect','portal_switch','deep_link')), previous_route text, new_route text NOT NULL, previous_context text, new_context text, roles text[] NOT NULL DEFAULT '{}', remembered boolean NOT NULL DEFAULT false, user_agent text, created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.rename_feature_flag ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), singleton boolean NOT NULL DEFAULT true UNIQUE, enabled boolean NOT NULL DEFAULT false, kill_switch boolean NOT NULL DEFAULT false, ramp_percent integer NOT NULL DEFAULT 0 CHECK (ramp_percent BETWEEN 0 AND 100), allowed_country_codes text[] NOT NULL DEFAULT '{}', allowed_tenant_ids uuid[] NOT NULL DEFAULT '{}', notes text, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES auth.users(id) );
CREATE TABLE IF NOT EXISTS public.social_accounts ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform_slug text NOT NULL REFERENCES public.social_platforms(slug) ON DELETE RESTRICT, market text NOT NULL DEFAULT 'GLOBAL', display_name text NOT NULL, handle text, profile_url text, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_VERIFICATION','VERIFIED','APPROVED','ACTIVE','SUSPENDED','ARCHIVED')), verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED','VERIFIED')), ownership_evidence text, is_public boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT false, aria_label text, tracking_enabled boolean NOT NULL DEFAULT true, campaign_source text, sort_order integer NOT NULL DEFAULT 100, verified_by uuid, verified_at timestamptz, approved_by uuid, approved_at timestamptz, activated_by uuid, activated_at timestamptz, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (platform_slug, market) );
CREATE TABLE IF NOT EXISTS public.ui_events ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, session_id text, page_route text, element_id text NOT NULL, element_label text, action text NOT NULL DEFAULT 'click', success boolean NOT NULL DEFAULT true, error_message text, payload jsonb DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.work_capacity_profiles ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_key text NOT NULL UNIQUE, label text NOT NULL, working_minutes integer NOT NULL DEFAULT 480, meeting_reserve_minutes integer NOT NULL DEFAULT 60, break_reserve_minutes integer NOT NULL DEFAULT 45, admin_reserve_minutes integer NOT NULL DEFAULT 45, focus_block_minutes integer NOT NULL DEFAULT 50, productive_minutes integer GENERATED ALWAYS AS (GREATEST(working_minutes - meeting_reserve_minutes - break_reserve_minutes - admin_reserve_minutes, 0)) STORED, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_account_access_requests ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, requester_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE, access_level text NOT NULL CHECK (access_level IN ('view','edit')), reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000), status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','refused','withdrawn')), decided_by uuid, decided_at timestamptz, decision_note text, grant_id uuid REFERENCES public.crm_account_access_grants(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_document_approvals ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.crm_document_versions(id) ON DELETE CASCADE, decision text NOT NULL CHECK (decision IN ('approved','rejected')), rationale text NOT NULL CHECK (length(btrim(rationale)) >= 5), decided_by uuid REFERENCES auth.users(id), decided_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_document_links ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES public.crm_documents(id) ON DELETE CASCADE, version_id uuid REFERENCES public.crm_document_versions(id) ON DELETE SET NULL, target_type text NOT NULL CHECK (target_type IN ('opportunity','interaction','work_item','account','transaction')), target_id uuid NOT NULL, created_by uuid REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (document_id, target_type, target_id) );
CREATE TABLE IF NOT EXISTS public.crm_document_shares ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES public.crm_document_versions(id) ON DELETE RESTRICT, contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL, channel text NOT NULL DEFAULT 'email', recipient_email text, note text, shared_by uuid REFERENCES auth.users(id), shared_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_interactions ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL, opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL, work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL, staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL, interaction_type text NOT NULL CHECK (interaction_type IN ('email','call','meeting','document_shared','proposal','customer_response','note','visit')), direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound','internal')), subject text NOT NULL, summary text, outcome text, sentiment text CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative')), occurred_at timestamptz NOT NULL DEFAULT now(), provenance text NOT NULL DEFAULT 'declared', seed_batch text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_opportunity_links ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), opportunity_id uuid NOT NULL UNIQUE REFERENCES public.commercial_opportunities(id) ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, primary_contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL, owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.identity_discovery_events ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_hash text NOT NULL, email_domain text, outcome text NOT NULL, corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL, policy_id uuid REFERENCES public.identity_auth_policies(id) ON DELETE SET NULL, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), metadata jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.identity_risk_assessments ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, policy_id uuid REFERENCES public.identity_risk_policies(id), policy_version integer, score integer NOT NULL, decision text NOT NULL CHECK (decision IN ('ALLOW','STEP_UP_REQUIRED')), reasons jsonb NOT NULL DEFAULT '[]'::jsonb, signals jsonb NOT NULL DEFAULT '{}'::jsonb, fingerprint_hash text, country text, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), occurred_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_customer_commitments ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL, contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL, interaction_id uuid REFERENCES public.crm_interactions(id) ON DELETE SET NULL, work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL, owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL, direction text NOT NULL DEFAULT 'yalla_to_customer' CHECK (direction IN ('yalla_to_customer','customer_to_yalla')), commitment text NOT NULL, expected_outcome text, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','fulfilled','waived','cancelled')), due_at timestamptz, fulfilled_at timestamptz, evidence_kind text, evidence_ref text, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_meeting_outcomes ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), interaction_id uuid NOT NULL UNIQUE REFERENCES public.crm_interactions(id) ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL, needs text, commercial_position text, operational_requirements text, decision_process text, decision_timeline text, competition text, risks text, agreed_next_steps text, capture_completeness_pct integer NOT NULL DEFAULT 0 CHECK (capture_completeness_pct BETWEEN 0 AND 100), created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
CREATE TABLE IF NOT EXISTS public.crm_next_actions ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE, opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL, interaction_id uuid REFERENCES public.crm_interactions(id) ON DELETE SET NULL, work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE, staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL, title text NOT NULL, due_at timestamptz, priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')), status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')), created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS onboarding_welcome_message text;
ALTER TABLE public.crm_interactions ADD COLUMN IF NOT EXISTS email_message_id uuid;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['crm_account_access_grants','crm_contacts','crm_document_permissions','crm_document_versions','device_fingerprints','identity_auth_policies','identity_discovery_rate','identity_risk_policies','navigation_logs','platform_settings','portal_transition_audit','rename_feature_flag','social_accounts','ui_events','work_capacity_profiles','crm_account_access_requests','crm_document_approvals','crm_document_links','crm_document_shares','crm_interactions','crm_opportunity_links','identity_discovery_events','identity_risk_assessments','crm_customer_commitments','crm_meeting_outcomes','crm_next_actions'] LOOP EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t); EXECUTE format('GRANT ALL ON public.%I TO service_role', t); EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t); EXECUTE format('CREATE POLICY "Admins manage restored records" ON public.%I FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[]))', t); END LOOP; END $$;

DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS crm_access_grants_read ON public.crm_account_access_grants$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY crm_access_grants_read ON public.crm_account_access_grants FOR SELECT TO authenticated
  USING (grantee_staff_id = public._crm_my_staff_id(auth.uid()) OR public.crm_can_decide_account_access(auth.uid(), account_id))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_account_access_grants: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read contacts" ON public.crm_contacts$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read contacts" ON public.crm_contacts
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_contacts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial write contacts" ON public.crm_contacts$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial write contacts" ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_contacts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial update contacts" ON public.crm_contacts$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial update contacts" ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_contacts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "admin delete contacts" ON public.crm_contacts$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "admin delete contacts" ON public.crm_contacts
  FOR DELETE TO authenticated USING (public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_contacts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Staff can read document permissions" ON public.crm_document_permissions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Staff can read document permissions" ON public.crm_document_permissions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_permissions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Staff can read document versions" ON public.crm_document_versions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Staff can read document versions" ON public.crm_document_versions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_versions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Authorised staff can add versions" ON public.crm_document_versions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Authorised staff can add versions" ON public.crm_document_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.crm_document_authority(auth.uid(), document_id, 'create_version'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_versions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Staff read versions they may open" ON public.crm_document_versions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Staff read versions they may open" ON public.crm_document_versions FOR SELECT TO authenticated
  USING (coalesce(has_staff_permission('staff.crm.read'),false)
         AND crm_document_authority(auth.uid(), document_id, 'view'::crm_doc_verb))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_versions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_user_read_own" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_user_read_own" ON public.device_fingerprints FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_admin_all" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_admin_all" ON public.device_fingerprints FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_user_read_own_nonscoring" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_user_read_own_nonscoring" ON public.device_fingerprints
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_read_own_or_security_staff" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_read_own_or_security_staff"
  ON public.device_fingerprints FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_permission('staff.security.read'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_security_staff_insert" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_security_staff_insert"
  ON public.device_fingerprints FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_permission('staff.security.manage'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_security_staff_update" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_security_staff_update"
  ON public.device_fingerprints FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.security.manage'))
  WITH CHECK (public.has_staff_permission('staff.security.manage'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "df_security_staff_delete" ON public.device_fingerprints$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "df_security_staff_delete"
  ON public.device_fingerprints FOR DELETE TO authenticated
  USING (public.has_staff_permission('staff.security.manage'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip device_fingerprints: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS identity_policy_read ON public.identity_auth_policies$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY identity_policy_read ON public.identity_auth_policies
FOR SELECT TO authenticated
USING (
  scope = 'PLATFORM'
  OR public.is_corporate_member(auth.uid(), corporate_id)
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
)$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_auth_policies: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS identity_policy_admin_write ON public.identity_auth_policies$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY identity_policy_admin_write ON public.identity_auth_policies
FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_auth_policies: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS identity_discovery_rate_staff_read ON public.identity_discovery_rate$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY identity_discovery_rate_staff_read ON public.identity_discovery_rate
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_discovery_rate: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS identity_risk_policies_staff_read ON public.identity_risk_policies$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY identity_risk_policies_staff_read ON public.identity_risk_policies
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_risk_policies: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "nav_logs insert self or anon" ON public.navigation_logs$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "nav_logs insert self or anon"
  ON public.navigation_logs FOR INSERT
  TO authenticated, anon
  WITH CHECK (user_id IS NULL OR user_id = auth.uid())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip navigation_logs: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "nav_logs read own" ON public.navigation_logs$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "nav_logs read own"
  ON public.navigation_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip navigation_logs: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "nav_logs read admin" ON public.navigation_logs$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "nav_logs read admin"
  ON public.navigation_logs FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip navigation_logs: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "platform_settings_read_all" ON public.platform_settings$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "platform_settings_read_all"
  ON public.platform_settings FOR SELECT
  USING (true)$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip platform_settings: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "platform_settings_admin_write" ON public.platform_settings$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "platform_settings_admin_write"
  ON public.platform_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip platform_settings: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS platform_settings_read_authenticated ON public.platform_settings$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY platform_settings_read_authenticated ON public.platform_settings FOR SELECT TO authenticated USING (true)$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip platform_settings: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS pta_admin_read ON public.portal_transition_audit$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY pta_admin_read ON public.portal_transition_audit
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'compliance_admin'::app_role]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip portal_transition_audit: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "rename_flag_read_any_authenticated" ON public.rename_feature_flag$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "rename_flag_read_any_authenticated"
  ON public.rename_feature_flag FOR SELECT
  TO authenticated
  USING (true)$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip rename_feature_flag: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "rename_flag_write_super_admin" ON public.rename_feature_flag$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "rename_flag_write_super_admin"
  ON public.rename_feature_flag FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip rename_feature_flag: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "rename_flag_read_any_authenticated" ON public.rename_feature_flag$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "rename_flag_read_any_authenticated" ON public.rename_feature_flag FOR SELECT TO authenticated
  USING (public.is_staff_member() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip rename_feature_flag: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS social_accounts_published_read ON public.social_accounts$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY social_accounts_published_read ON public.social_accounts
  FOR SELECT TO anon, authenticated
  USING (status = 'ACTIVE' AND verification_status = 'VERIFIED' AND is_public = true AND is_active = true AND profile_url IS NOT NULL)$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip social_accounts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS social_accounts_admin_read ON public.social_accounts$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY social_accounts_admin_read ON public.social_accounts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip social_accounts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "ui_events insert self or anon" ON public.ui_events$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "ui_events insert self or anon"
  ON public.ui_events FOR INSERT
  TO authenticated, anon
  WITH CHECK (user_id IS NULL OR user_id = auth.uid())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip ui_events: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "ui_events read own" ON public.ui_events$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "ui_events read own"
  ON public.ui_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip ui_events: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "ui_events read admin" ON public.ui_events$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "ui_events read admin"
  ON public.ui_events FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip ui_events: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "work_capacity_profiles_read" ON public.work_capacity_profiles$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "work_capacity_profiles_read" ON public.work_capacity_profiles
  FOR SELECT TO authenticated USING (true)$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip work_capacity_profiles: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "work_capacity_profiles_admin" ON public.work_capacity_profiles$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "work_capacity_profiles_admin" ON public.work_capacity_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip work_capacity_profiles: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS work_capacity_profiles_read ON public.work_capacity_profiles$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY work_capacity_profiles_read ON public.work_capacity_profiles
  FOR SELECT TO authenticated USING (public.is_staff_member())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip work_capacity_profiles: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS crm_access_requests_read ON public.crm_account_access_requests$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY crm_access_requests_read ON public.crm_account_access_requests FOR SELECT TO authenticated
  USING (requester_staff_id = public._crm_my_staff_id(auth.uid()) OR public.crm_can_decide_account_access(auth.uid(), account_id))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_account_access_requests: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Staff can read document approvals" ON public.crm_document_approvals$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Staff can read document approvals" ON public.crm_document_approvals
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_approvals: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Approvers can record decisions" ON public.crm_document_approvals$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Approvers can record decisions" ON public.crm_document_approvals
  FOR INSERT TO authenticated WITH CHECK (
    public.crm_document_authority(
      auth.uid(),
      (SELECT document_id FROM public.crm_document_versions v WHERE v.id = version_id),
      'approve')
  )$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_approvals: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Staff can read document links" ON public.crm_document_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Staff can read document links" ON public.crm_document_links
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Commercial staff can manage document links" ON public.crm_document_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Commercial staff can manage document links" ON public.crm_document_links
  FOR INSERT TO authenticated WITH CHECK (public.crm_can_write_commercial(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Commercial staff can remove document links" ON public.crm_document_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Commercial staff can remove document links" ON public.crm_document_links
  FOR DELETE TO authenticated USING (public.crm_can_write_commercial(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Staff can read document shares" ON public.crm_document_shares$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Staff can read document shares" ON public.crm_document_shares
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_shares: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "Authorised staff can record shares" ON public.crm_document_shares$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "Authorised staff can record shares" ON public.crm_document_shares
  FOR INSERT TO authenticated WITH CHECK (
    public.crm_document_authority(
      auth.uid(),
      (SELECT document_id FROM public.crm_document_versions v WHERE v.id = version_id),
      'share')
  )$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_document_shares: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read interactions" ON public.crm_interactions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read interactions" ON public.crm_interactions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_interactions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial insert interactions" ON public.crm_interactions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial insert interactions" ON public.crm_interactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_interactions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial update interactions" ON public.crm_interactions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial update interactions" ON public.crm_interactions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin()
         OR (staff_id IS NOT NULL AND (public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id))))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_interactions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "admin delete interactions" ON public.crm_interactions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "admin delete interactions" ON public.crm_interactions
  FOR DELETE TO authenticated USING (public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_interactions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read opp links" ON public.crm_opportunity_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read opp links" ON public.crm_opportunity_links
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_opportunity_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial insert opp links" ON public.crm_opportunity_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial insert opp links" ON public.crm_opportunity_links
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_opportunity_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial update opp links" ON public.crm_opportunity_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial update opp links" ON public.crm_opportunity_links
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_opportunity_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "admin delete opp links" ON public.crm_opportunity_links$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "admin delete opp links" ON public.crm_opportunity_links
  FOR DELETE TO authenticated USING (public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_opportunity_links: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS identity_discovery_staff_read ON public.identity_discovery_events$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY identity_discovery_staff_read ON public.identity_discovery_events
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_discovery_events: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS identity_risk_assessments_own_read ON public.identity_risk_assessments$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY identity_risk_assessments_own_read ON public.identity_risk_assessments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
     OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_risk_assessments: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read commitments" ON public.crm_customer_commitments$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read commitments" ON public.crm_customer_commitments
  FOR SELECT TO authenticated USING (is_staff_member() OR is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_customer_commitments: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial staff write commitments" ON public.crm_customer_commitments$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial staff write commitments" ON public.crm_customer_commitments
  TO authenticated USING (is_commercial_staff() OR is_platform_admin())
  WITH CHECK (is_commercial_staff() OR is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_customer_commitments: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read commitments" ON public.crm_customer_commitments$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read commitments" ON public.crm_customer_commitments
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.crm.read') OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_customer_commitments: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read meeting outcomes" ON public.crm_meeting_outcomes$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read meeting outcomes" ON public.crm_meeting_outcomes
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_meeting_outcomes: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial insert meeting outcomes" ON public.crm_meeting_outcomes$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial insert meeting outcomes" ON public.crm_meeting_outcomes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_meeting_outcomes: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial update meeting outcomes" ON public.crm_meeting_outcomes$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial update meeting outcomes" ON public.crm_meeting_outcomes
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_meeting_outcomes: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "admin delete meeting outcomes" ON public.crm_meeting_outcomes$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "admin delete meeting outcomes" ON public.crm_meeting_outcomes
  FOR DELETE TO authenticated USING (public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_meeting_outcomes: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "staff read next actions" ON public.crm_next_actions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "staff read next actions" ON public.crm_next_actions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_next_actions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial insert next actions" ON public.crm_next_actions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial insert next actions" ON public.crm_next_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_next_actions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "commercial update next actions" ON public.crm_next_actions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "commercial update next actions" ON public.crm_next_actions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin()
         OR public.is_commercial_staff()
         OR (staff_id IS NOT NULL AND (public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id))))$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_next_actions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$DROP POLICY IF EXISTS "admin delete next actions" ON public.crm_next_actions$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip dp: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE POLICY "admin delete next actions" ON public.crm_next_actions
  FOR DELETE TO authenticated USING (public.is_platform_admin())$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip crm_next_actions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$CREATE VIEW public.v_security_claims AS
SELECT c.claim_code, c.surface, c.wording, c.implementation, c.owner, c.audience,
       c.requested_display, c.withheld_reason, c.review_interval_days,
       (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) AS controls,
       e.verdict AS latest_verdict,
       e.observation AS latest_observation,
       e.executed_at AS verified_at,
       e.environment,
       (e.executed_at + (c.review_interval_days || ' days')::interval) AS review_due,
       CASE
         WHEN c.wording IS NULL OR NOT c.requested_display THEN false
         WHEN (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) = 0 THEN false
         WHEN e.verdict IS DISTINCT FROM 'PASS' THEN false
         WHEN e.executed_at + (c.review_interval_days || ' days')::interval < now() THEN false
         ELSE true
       END AS safe_to_display,
       CASE
         WHEN c.wording IS NULL THEN 'NO_APPROVED_WORDING'
         WHEN NOT c.requested_display THEN 'WITHHELD_BY_OWNER'
         WHEN (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) = 0 THEN 'NO_CONTROL'
         WHEN e.verdict IS NULL THEN 'NO_EVIDENCE'
         WHEN e.verdict <> 'PASS' THEN 'EVIDENCE_' || e.verdict
         WHEN e.executed_at + (c.review_interval_days || ' days')::interval < now() THEN 'EVIDENCE_EXPIRED'
         ELSE 'DISPLAYABLE'
       END AS display_state
FROM public.security_claims c
LEFT JOIN LATERAL (
  SELECT * FROM public.security_claim_evidence x
  WHERE x.claim_code = c.claim_code ORDER BY x.executed_at DESC LIMIT 1
) e ON true$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip view: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.is_stabilization_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((feature_flags->>'stabilization_mode')::boolean, false)
  FROM public.platform_settings
  ORDER BY created_at ASC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.is_stabilization_mode() TO authenticated, anon, service_role;

-- Block orchestrator promotion while stabilization mode is on
CREATE OR REPLACE FUNCTION public.tg_orchestrator_freeze_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_stabilization_mode()
     AND NEW.rollout_percent IS DISTINCT FROM OLD.rollout_percent
     AND NEW.rollout_percent > OLD.rollout_percent THEN
    RAISE EXCEPTION 'STABILIZATION_$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip is_stabilization_mode: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.is_stabilization_mode() TO authenticated, anon, service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.record_portal_transition(
  _kind text,
  _new_route text,
  _previous_route text DEFAULT NULL,
  _new_context text DEFAULT NULL,
  _previous_context text DEFAULT NULL,
  _remembered boolean DEFAULT false,
  _user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF _kind NOT IN ('login_redirect','portal_switch','deep_link') THEN
    RAISE EXCEPTION 'unsupported transition kind %', _kind;
  END IF;

  INSERT INTO public.portal_transition_audit
    (user_id, actor_email, kind, previous_route, new_route,
     previous_context, new_context, roles, remembered, user_agent)
  SELECT
    _uid,
    (SELECT email FROM auth.users WHERE id = _uid),
    _kind,
    left(coalesce(_previous_route, ''), 300),
    left(_new_route, 300),
    _previous_context,
    _new_context,
    coalesce(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = _uid), '{}'),
    coalesce(_remembered, false),
    left(coalesce(_user_agent, ''), 400)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO service_role;

-- ============================================================
-- 2. Deployment gate: EXECUTE grants for SECURITY DEFINER
--    functions referenced by RLS policies
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_rls_definer_grants()
RETURNS TABLE (
  function_name text,
  function_args text,
  referenced_by_policies int,
  authenticated_can_execute boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH policy_text AS (
    SELECT lower(coalesce(qual,'') || ' ' || coalesce(with_check,'')) AS expr
    FROM pg_policies
    WHERE schemaname = 'public'
  ),
  definers AS (
    SELECT p.oid, p.pro$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip record_portal_transition: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$REVOKE EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) FROM anon$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.security_claims_public()
RETURNS TABLE (claim_code text, surface text, wording text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.claim_code, c.surface, c.wording
  FROM public.v_security_claims c
  WHERE c.safe_to_display
  ORDER BY c.claim_code
$$;
REVOKE ALL ON FUNCTION public.security_claims_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.security_claims_public() TO anon, authenticated, service_role;

-- ============ recovery request ledger (append-only, non-enumerating) ============
CREATE TABLE IF NOT EXISTS public.identity_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  email_domain text,
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED','RATE_LIMITED','INVALID_EMAIL')),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_recovery_occurred ON public.identity_recovery_requests (occurred_at DESC);
GRANT SELECT ON public.identity_recovery_requests TO authenticated;
GRANT ALL ON public.identity_recovery_requests TO service_role;
ALTER TABLE public.identity_recovery_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identity_recovery_staff_read ON public.identity_recovery_requests;
CREATE POLICY identity_recovery_staff_read ON public.identity_recovery_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
         OR public.has_role(auth.uid(), 'compliance_admin'));

CREATE OR REPLACE FUNCTION public.identity_recovery_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'identity_recovery_requests is append-only'$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip security_claims_public: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.security_claims_public() TO anon, authenticated, service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.security_claims_public() TO anon, authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.identity_discover(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(_email, '')));
  v_domain text;
  v_hash text;
  v_bucket text;
  v_hits integer;
  v_policy public.identity_auth_policies;
  v_org public.corporate_accounts;
  v_outcome text := 'PLATFORM_POLICY';
  v_corr uuid := gen_random_uuid();
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_EMAIL');
  END IF;

  v_domain := split_part(v_email, '@', 2);
  v_hash := md5(v_email || 'yalla-identity-discovery');
  v_bucket := 'discover:' || v_hash;

  INSERT INTO public.identity_discovery_rate (bucket, window_start, hits)
  VALUES (v_bucket, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket) DO UPDATE
    SET hits = CASE WHEN public.identity_discovery_rate.window_start < date_trunc('hour', now())
                    THEN 1 ELSE public.identity_discovery_rate.hits + 1 END,
        window_start = CASE WHEN public.identity_discovery_rate.window_start < date_trunc('hour', now())
                    THEN date_trunc('hour', now()) ELSE public.identity_discovery_rate.window_start END
  RETURNING hits INTO v_hits;

  IF v_hits > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;

  SELECT p.* INTO v_policy
  FROM public.identity_auth_policies p
  WHERE p.state = 'ACTIVE' AND p.scope = 'ORGANISATION' AND v_domain = ANY (p.email_domains)
  LIMIT 1;

  IF v_policy.id IS NOT NULL THEN
    SELECT * INTO v_org FROM public.corporate_accounts WHERE id = v_policy.corporate_id;
    v_outcome := 'ORGANISATION_POLICY';
  ELSE
    SELECT p.* INTO v_policy
    FROM public.identity_auth_policies p
    WHERE p.state = 'ACTIVE' AND p.scope = 'PLATFORM'
    LIMIT 1;
  END IF;

  INSERT INTO public.identity_discovery_events (email_hash, email_domain, outcome, corporate_id, policy_id, correlation_id)
  VALUES (v_hash, v_domain, v_outcome, v_policy.corporate_id, v_policy.id, v_corr);

  IF v_policy.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_POLICY', 'correlation_id', v_corr);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'correlation_id', v_corr,
    'outcome', v_outcome,
    'domain', v_domain,
    'organisation', CASE WHEN v_org.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', coalesce(v_org.trading_name, v_org.legal_name)) END,
    'policy', jsonb_build_object('id', v_policy.id, 'label', v_policy.label, 'version', v_policy.version),
    'methods', jsonb_build_object(
      'password', v_policy.password_enabled,
      'passwordless', v_policy.passwordless_enabled,
      'google', v_policy.google_enabled,
      'sso', v_policy.sso_enabled,
      'sso_provider', v_policy.sso_provider
    ),
    'mfa_required', v_policy.mfa_required,
    'session', jsonb_build_object('idle_minutes', v_policy.session_idle_minutes,
                                  'absolute_hours', v_policy.session_absolute_hours)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.identity_discover(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_discover(text) TO anon, authenticated, service_role;

-- ============================================================
-- IDENTITY CONTEXT (server authoritative)
-- ============================================================
CREATE OR REPLACE FUNCTION public.identity_tenant_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid()$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_discover: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.identity_discover(text) TO anon, authenticated, service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.identity_discover(text) TO anon, authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.identity_risk_evaluate(_fingerprint_hash text DEFAULT NULL, _country text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.identity_risk_policies;
  v_score integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_signals jsonb := '{}'::jsonb;
  v_new_device boolean := false;
  v_new_country boolean := false;
  v_dormant boolean := false;
  v_failures integer := 0;
  v_travel boolean := false;
  v_privileged boolean := false;
  v_last_success timestamptz;
  v_decision text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_p FROM public.identity_risk_policies WHERE state = 'ACTIVE' LIMIT 1;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_RISK_POLICY');
  END IF;

  IF _fingerprint_hash IS NOT NULL THEN
    v_new_device := NOT EXISTS (
      SELECT 1 FROM public.device_fingerprints d
      WHERE d.user_id = v_uid AND d.fingerprint_hash = _fingerprint_hash)
      AND NOT EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.fingerprint_hash = _fingerprint_hash AND e.success);
  END IF;

  IF _country IS NOT NULL THEN
    v_new_country := NOT EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.success AND e.country = _country);
  END IF;

  SELECT max(e.occurred_at) INTO v_last_success
  FROM public.authentication_events e
  WHERE e.user_id = v_uid AND e.success;
  v_dormant := v_last_success IS NOT NULL
    AND v_last_success < now() - make_interval(days => v_p.dormant_days);

  SELECT count(*) INTO v_failures
  FROM public.authentication_events e
  WHERE e.user_id = v_uid AND NOT e.success
    AND e.occurred_at > now() - make_interval(mins => v_p.failure_window_minutes);

  IF _country IS NOT NULL THEN
    v_travel := EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.success
        AND e.country IS NOT NULL AND e.country <> _country
        AND e.occurred_at > now() - make_interval(hours => v_p.travel_window_hours));
  END IF;

  v_privileged := public.has_any_role(v_uid,
    ARRAY['admin','super_admin','finance_admin']::app_role[]);

  IF v_new_device THEN
    v_score := v_score + v_p.w_new_device;
    v_reasons := v_reasons || jsonb_build_array('A device we have not seen on this account before');
  END IF;
  IF v_new_country THEN
    v_score := v_score + v_p.w_new_country;
    v_reasons := v_reasons || jsonb_build_array('A country this account has not signed in from before');
  END IF;
  IF v_dormant THEN
    v_score := v_score + v_p.w_dormant;
    v_reasons := v_reasons || jsonb_build_array('A long gap since the last sign-in');
  END IF;
  IF v_failures >= v_p.failure_threshold THEN
    v_score := v_score + v_p.w_recent_failures;
    v_reasons := v_reasons || jsonb_build_array('Several failed sign-in attempts recently');
  END IF;
  IF v_travel THEN
    v_score := v_score + v_p.w_impossible_travel;
    v_reasons := v_reasons || jsonb_build_array('A sign-in from a different country within a short window');
  END IF;
  IF v_privileged THEN
    v_score := v_score + v_p.w_privileged_access;
    v_reasons := v_reasons || jsonb_build_array('This account holds privileged access');
  END IF;

  v_signals := jsonb_build_object(
    'new_device', v_new_device, 'new_country', v_new_country, 'dormant', v_dormant,
    'recent_failures', v_failures, 'impossible_travel', v_travel, 'privileged', v_privileged,
    'last_success_at', v_last_success);

  v_decision := CASE WHEN v_score >= v_p.step_up_threshold THEN 'STEP_UP_REQUIRED' ELSE 'ALLOW' END;

  INSERT INTO public.identity_risk_assessments
    (user_id, policy_id, policy_version, score, decision, reasons, signals, fingerprint_hash, country)
  VALUES (v_uid, v_p.id, v_p.version, v_score, v_decision, v_reasons, v_signals, _fingerprint_hash, _country)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'assessment_id', v_id, 'decision', v_decision, 'score', v_score,
    'threshold', v_p.step_up_threshold, 'reasons', v_reasons,
    'policy', jsonb_build_object('id', v_p.id, 'version', v_p.version, 'label', v_p.label,
                                 'business_approval', v_p.business_approval));
END;
$$;
REVOKE ALL ON FUNCTION public.identity_risk_evaluate(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_risk_evaluate(text, text) TO authenticated, service_role;

-- own risk history for the Security Centre
CREATE OR REPLACE FUNCTION public.identity_my_risk_assessments(_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, score integer, decision text, reasons jsonb, occurred_at timestamptz, policy_version integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id, a.score, a.decision, a.reasons, a.occurred_at, a.policy_version
  FROM public.identity_risk_assessments a
  WHERE a.user_id = auth.uid()
  ORDER BY a.occurred_at DESC
  LIMIT least(coa$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip identity_risk_evaluate: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.identity_risk_evaluate(text, text) TO authenticated, service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.staff_link_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified boolean := false;
  v_linked_id uuid;
  v_linked_status text;
  v_match_count int := 0;
  v_match_status text;
  v_match_org uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('reason', 'not_authenticated');
  END IF;

  SELECT lower(u.email), u.email_confirmed_at IS NOT NULL
    INTO v_email, v_verified
  FROM auth.users u WHERE u.id = v_uid;

  SELECT s.id, s.employment_status INTO v_linked_id, v_linked_status
  FROM public.staff_members s WHERE s.user_id = v_uid LIMIT 1;

  SELECT count(*) INTO v_match_count
  FROM public.staff_members s
  WHERE s.user_id IS NULL
    AND (lower(s.work_email) = v_email OR lower(s.personal_email) = v_email);

  IF v_match_count > 0 THEN
    SELECT s.employment_status, s.org_id INTO v_match_status, v_match_org
    FROM public.staff_members s
    WHERE s.user_id IS NULL
      AND (lower(s.work_email) = v_email OR lower(s.personal_email) = v_email)
    LIMIT 1;
  END IF;

  v_reason := CASE
    WHEN v_linked_id IS NOT NULL AND coalesce(v_linked_status, 'active') <> 'active' THEN 'record_inactive'
    WHEN v_linked_id IS NOT NULL THEN 'linked'
    WHEN NOT v_verified THEN 'email_unverified'
    WHEN v_match_count > 1 THEN 'ambiguous_email_match'
    WHEN v_match_count = 1 AND coalesce(v_match_status, 'active') <> 'active' THEN 'match_inactive'
    WHEN v_match_count = 1 THEN 'claimable'
    ELSE 'no_staff_record'
  END;

  RETURN jsonb_build_object(
    'reason', v_reason,
    'email', v_email,
    'email_verified', v_verified,
    'linked_staff_id', v_linked_id,
    'linked_status', v_linked_status,
    'unlinked_email_matches', v_match_count,
    'match_status', v_match_status,
    'match_org_id', v_match_org
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_link_diagnostics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_link_diagnostics() TO authenticated;

-- Admin-only backfill: link unlinked staff records to accounts by verified email.
CREATE OR REPLACE FUNCTION public.staff_backfill_links(p_dry_run boolean DEFAULT true)
RETURNS TABLE (
  staff_id uuid,
  staff_no text,
  full_name text,
  email text,
  matched_user_id uuid,
  action text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip staff_link_diagnostics: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.staff_link_diagnostics() TO authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.staff_claim_self()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified timestamptz;
  v_staff uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = v_uid LIMIT 1;
  IF v_staff IS NOT NULL THEN
    RETURN v_staff;
  END IF;

  SELECT lower(email), email_confirmed_at
    INTO v_email, v_verified
    FROM auth.users WHERE id = v_uid;

  IF v_email IS NULL OR v_verified IS NULL THEN
    RAISE EXCEPTION 'email_not_verified';
  END IF;

  SELECT id, employment_status INTO v_staff, v_status
    FROM public.staff_members
   WHERE user_id IS NULL
     AND employment_status IN ('active', 'onboarding')
     AND (lower(work_email) = v_email OR lower(personal_email) = v_email)
   ORDER BY created_at
   LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no_matching_staff_record';
  END IF;

  UPDATE public.staff_members
     SET user_id = v_uid, updated_at = now()
   WHERE id = v_staff AND user_id IS NULL;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, resource_type, resource_id, metadata)
  VALUES (v_uid, v_email, 'staff_profile_self_claim', 'staff_members', v_staff::text,
          jsonb_build_object('matched_email', v_email, 'employment_status', v_status));

  RETURN v_staff;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_claim_self() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_claim_self() TO authenticated;
-- 1. Canonical Charles Gateru record: align work email with the linked login.
UPDATE public.staff_members
   SET work_email = 'charles.gateru@yalla.africa', updated_at = now()
 WHERE id = '7a98630c-882a-4fd4-a07e-585efb9ce452';

-- Consolidate his reporting line onto the record his login is attached to.
UPDATE public.staff_members
   SET manager_staff_id = '7a98630c-882a-4fd4-a07e-585efb9ce452', updated_at = now()
 WHERE manager_staff_id = '62a834c9-be98-475b-b26b-74826079df5a';

-- 2. General Manager / Director are staff roles for portal purposes.
CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin','super_admin','director','general_manager','finance_admin',
                         'compliance_admin','operations_admin','operations_manager',
                         'pricing_manager','fleet_manager')
  );
$function$;

-- 3. Management authority follows the whole reporting line, not only direct reports.
CREATE OR REPLACE FUNCTION public.manages_staff_record(_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE me AS (
    SELECT id FROM public.staff_members WHERE user_id = auth.uid()
  ), line AS (
    SELECT s.id, s.manager_staff_id, 1 AS depth
      FROM public.staff_members s
     WHERE s.manager_staff_id IN (SELECT id FROM me)
    UNION ALL
    SELECT c.id, c.manager_staff_id, l.depth + 1
      FROM public.staff_members c
      JOIN line l ON c.manager_staff_id = l.id
     WHERE l.depth < 8
  )
  SELECT EXISTS (SELECT 1 FROM line WHERE id = _staff_id);
$function$;

-- 4. Manager team overview (whole reporting line) with work counts.
CREATE OR REPLACE FUNCTION public.staff_my_team_overview()
RETURNS TABLE (
  staff_id uuid,
  full_name text,
  work_email text,
  position_title text,
  unit_name text,
  employment_status text,
  has_login boolean,
  reports_to uuid,
  depth integer,
  open_work integer,
  overdue_work integer,
  completed_work integer,
  last_activity timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE me AS (
    SELECT id FROM public.staff_members WHERE user_id = auth.uid()
  ), line AS (
    SELECT s.id, s.manager_staff_id, 1 AS depth
      FROM public.staff_members s
     WHERE s.manager_staff_id IN (SELECT id FROM me)
    UNION ALL
    SELECT c.id, c.manager_staff_id, l.depth + 1
      FROM public.staff_members c
      JOIN line l ON c.manager_staff_id = l.id
     WHERE l.depth < 8
  )
  SELECT s.id,
         COALESCE(s.preferred_name, s.full_name),
         s.work_email,
         p.title,
         u.name,
         s.employment_status::text,
         s.user_id IS NOT NULL,
         l.manager_staff_id,
         l.depth,
         COALESCE(w.open_work, 0)::int,
         COALESCE(w.overdue_work, 0)::int,
         COALESCE(w.completed_work, 0)::int,
         w.last_activity
    FROM line l
    JOIN public.staff_members s ON s.id = l.id
    LEFT JOIN public.org_positions p ON p.id = s.position_id
    LEFT JOIN public.org_units u ON u.id = s.unit_id
    LEFT JOIN (
      SELECT staff_id,
             count(*) FILTER (WHERE status IS DISTINCT FROM 'done' AND completed_at IS NULL) AS open_work,
             count(*) FILTER (WHERE completed_at IS NULL AND next_action_due IS NOT NULL
                                AND next_action_due < current_date) AS overdue_work,
             count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_work,
             max(GREATEST(COALESCE(updated_at, created_at), created_at)) AS last_activity
        FROM public.staff_work_items
       GROUP BY staff_id
    ) w ON w.staff_id = s.id
   ORDER BY l.depth, 2;
$function$;

REVOKE ALL ON FUNCTION public.staff_my_team_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_my_team_overview() TO authenticated;
CREATE OR REPLACE FUNCTION public.staff_dashboard_snapshot(_lens text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid()$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip staff_claim_self: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.staff_claim_self() TO authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.staff_claim_self() TO authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.staff_available_actions(p_limit integer DEFAULT 8)
RETURNS TABLE (
  kind            text,
  title           text,
  reason          text,
  account_id      uuid,
  account_name    text,
  opportunity_id  uuid,
  reference_id    uuid,
  priority        text,
  value_score     numeric,
  suggested_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid := public.staff_self_id();
  v_lim   integer := least(greatest(coalesce(p_limit, 8), 1), 25);
BEGIN
  IF v_staff IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH overdue AS (
    SELECT 'overdue_follow_up'::text AS kind,
           na.title,
           'Committed action is past its due date'::text AS reason,
           na.account_id,
           a.name AS account_name,
           na.opportunity_id,
           na.work_item_id AS reference_id,
           na.priority,
           90::numeric + least(extract(epoch FROM (now() - na.due_at)) / 86400, 10) AS value_score,
           10 AS suggested_minutes
      FROM public.crm_next_actions na
      JOIN public.crm_accounts a ON a.id = na.account_id
     WHERE na.staff_id = v_staff
       AND na.status IN ('open', 'in_progress')
       AND na.due_at IS NOT NULL
       AND na.due_at < now()
  ),
  dormant AS (
    SELECT 'reengage_account'::text,
           ('Re-engage ' || a.name)::text,
           'No recorded interaction in the last 30 days'::text,
           a.id,
           a.name,
           NULL::uuid,
           a.id,
           CASE a.importance_tier WHEN 'strategic' THEN 'high' WHEN 'key' THEN 'high' ELSE 'medium' END,
           60::numeric + CASE a.importance_tier WHEN 'strategic' THEN 20 WHEN 'key' THEN 10 ELSE 0 END,
           15
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_interactions i
          WHERE i.account_id = a.id AND i.occurred_at > now() - interval '30 days'
       )
  ),
  stalled AS (
    SELECT 'opportunity_without_next_action'::text,
           ('Set the next action on ' || a.name)::text,
           'Active opportunity has no open next action'::text,
           a.id,
           a.name,
           ol.opportunity_id,
           ol.opportunity_id,
           'high'::text,
           75::numeric,
           10
      FROM public.crm_opportunity_links ol
      JOIN public.crm_accounts a ON a.id = ol.account_id
     WHERE ol.owner_staff_id = v_staff
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_next_actions na
          WHERE na.opportunity_id = ol.opportunity_id
            AND na.status IN ('open', 'in_progress')
       )
  ),
  quiet AS (
    SELECT 'prospect_new_account'::text,
           ('Open a conversation with ' || a.name)::text,
           'Account owned by you has no interaction on record'::text,
           a.id,
           a.name,
           NULL::uuid,
           a.id,
           'medium'::text,
           50::numeric,
           15
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
       AND a.lifecycle_stage IN ('prospect', 'lead', 'qualified')
       AND NOT EXISTS (SELECT 1 FROM public.crm_interactions i WHERE i.account_id = a.id)
  )
  SELECT * FROM (
    SELECT * FROM overdue
    UNION ALL SELECT * FROM stalled
    UNION ALL SELECT * FROM dormant
    UNION ALL SELECT * FROM quiet
  ) s
  ORDER BY s.value_score DESC, s.title
  LIMIT v_lim;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_available_actions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_available_actions(integer) TO authenticated, service_role;

-- ============================================================
-- RECRUITMENT 360 — data foundation
-- ============================================================

CREATE OR REPLACE FUNCTION public.rec_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now()$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip staff_available_actions: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.staff_available_actions(integer) TO authenticated, service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $qq$CREATE OR REPLACE FUNCTION public.resolve_operating_contexts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _roles text[];
  _contexts text[] := ARRAY[]::text[];
  _email text;
  _org_id uuid;
  _org_name text;
  _position text;
  _unit text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'contexts', '[]'::jsonb);
  END IF;

  SELECT array_agg(role::text) INTO _roles FROM public.user_roles WHERE user_id = _uid;
  _roles := COALESCE(_roles, ARRAY[]::text[]);

  SELECT email INTO _email FROM auth.users WHERE id = _uid;

  IF _roles && ARRAY['admin','super_admin','finance_admin','compliance_admin',
                     'operations_admin','operations_manager','pricing_manager','fleet_manager']::text[] THEN
    _contexts := array_append(_contexts, 'staff_operations');
  END IF;
  IF _roles && ARRAY['admin','super_admin']::text[] THEN
    _contexts := array_append(_contexts, 'super_admin');
  END IF;

  BEGIN
    SELECT s.entity_id, p.title, u.name
      INTO _org_id, _position, _unit
      FROM public.staff_members s
      LEFT JOIN public.org_positions p ON p.id = s.position_id
      LEFT JOIN public.org_units u ON u.id = s.unit_id
     WHERE s.user_id = _uid
     LIMIT 1;
  EXCEPTION WHEN others THEN
    _org_id := NULL;
  END;

  IF _org_id IS NOT NULL THEN
    BEGIN
      SELECT name INTO _org_name FROM public.org_entities WHERE id = _org_id;
    EXCEPTION WHEN others THEN _org_name := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', _uid,
    'identity', _email,
    'roles', to_jsonb(_roles),
    'contexts', to_jsonb(_contexts),
    'organisation_id', _org_id,
    'organisation', COALESCE(_org_name, 'Yalla Mobility'),
    'unit', _unit,
    'position', _position,
    'resolved_role', COALESCE(_position,
      CASE WHEN _roles && ARRAY['super_admin']::text[] THEN 'Super Administrator'
           WHEN _roles && ARRAY['admin']::text[] THEN 'Administrator'
           ELSE COALESCE(_roles[1], 'Staff') END)
  );
END;
$$;
-- ============ Phase 2: CRM foundation ============

CREATE TABLE public.crm_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_ref text NOT NULL UNIQUE DEFAULT ('ACC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  name text NOT NULL,
  legal_name text,
  industry text,
  country text NOT NULL DEFAULT 'KE',
  city text,
  size_band text NOT NULL DEFAULT 'unknown'
    CHECK (size_band IN ('unknown','micro','small','mid','large','enterprise')),
  lifecycle_stage text NOT NULL DEFAULT 'prospect'
    CHECK (lifecycle_stage IN ('prospect','engaged','qualified','opportunity','negotiation','won','onboarding','active','expansion','renewal','lost')),
  importance_tier text NOT NULL DEFAULT 'standard'
    CHECK (importance_tier IN ('standard','key','strategic')),
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'outbound',
  website text,
  notes text,
  provenance text NOT NULL DEFAULT 'declared',
  seed_batch text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_accounts TO authenticated;
GRANT ALL ON public.crm_accounts TO service_role;
ALTER TABLE public.crm_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_crm_accounts_owner ON public.crm_accounts(owner_staff_id);
CREATE INDEX idx_crm_accounts_stage ON public.crm_accounts(lifecycle_stage);

CREATE POLICY "staff read accounts" ON public.crm_accounts
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert accounts" ON public.crm_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update accounts" ON public.crm_accounts
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR public.is_commercial_staff()
    OR (owner_staff_id IS NOT NULL AND (public.is_my_staff_record(owner_staff_id) OR public.manages_staff_record(owner_staff_id)))
  );
CREATE POLICY "admin delete accounts" ON public.crm_accounts
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  contact_role text NOT NULL DEFAULT 'primary'
    CHECK (contact_role IN ('primary','decision_maker','procurement','finance','operations','exec_sponsor','other')),
  job_title text,
  email text,
  phone text,
  influence_level text NOT NULL DEFAULT 'medium'
    CHECK (influence_level IN ('low','medium','high')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  seed_batch text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts TO authenticated;
GRANT ALL ON public.crm_contacts TO service_role;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_contacts_account ON public.crm_contacts(account_id);

CREATE POLICY "staff read contacts" ON public.crm_contacts
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial write contacts" ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update contacts" ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "admin delete contacts" ON public.crm_contacts
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_opportunity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL UNIQUE REFERENCES public.commercial_opportunities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  primary_contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_opportunity_links TO authenticated;
GRANT ALL ON public.crm_opportunity_links TO service_role;
ALTER TABLE public.crm_opportunity_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_opp_links_account ON public.crm_opportunity_links(account_id);

CREATE POLICY "staff read opp links" ON public.crm_opportunity_links
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert opp links" ON public.crm_opportunity_links
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update opp links" ON public.crm_opportunity_links
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "admin delete opp links" ON public.crm_opportunity_links
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  interaction_type text NOT NULL
    CHECK (interaction_type IN ('email','call','meeting','document_shared','proposal','customer_response','note','visit')),
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound','internal')),
  subject text NOT NULL,
  summary text,
  outcome text,
  sentiment text CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  provenance text NOT NULL DEFAULT 'declared',
  seed_batch text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_interactions TO authenticated;
GRANT ALL ON public.crm_interactions TO service_role;
ALTER TABLE public.crm_interactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_interactions_account_time ON public.crm_interactions(account_id, occurred_at DESC);
CREATE INDEX idx_crm_interactions_opportunity ON public.crm_interactions(opportunity_id);

CREATE POLICY "staff read interactions" ON public.crm_interactions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert interactions" ON public.crm_interactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update interactions" ON public.crm_interactions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin()
         OR (staff_id IS NOT NULL AND (public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id))));
CREATE POLICY "admin delete interactions" ON public.crm_interactions
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_meeting_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL UNIQUE REFERENCES public.crm_interactions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  needs text,
  commercial_position text,
  operational_requirements text,
  decision_process text,
  decision_timeline text,
  competition text,
  risks text,
  agreed_next_steps text,
  capture_completeness_pct integer NOT NULL DEFAULT 0
    CHECK (capture_completeness_pct BETWEEN 0 AND 100),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_meeting_outcomes TO authenticated;
GRANT ALL ON public.crm_meeting_outcomes TO service_role;
ALTER TABLE public.crm_meeting_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read meeting outcomes" ON public.crm_meeting_outcomes
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert meeting outcomes" ON public.crm_meeting_outcomes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update meeting outcomes" ON public.crm_meeting_outcomes
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "admin delete meeting outcomes" ON public.crm_meeting_outcomes
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  interaction_id uuid REFERENCES public.crm_interactions(id) ON DELETE SET NULL,
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  title text NOT NULL,
  due_at timestamptz,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_next_actions TO authenticated;
GRANT ALL ON public.crm_next_actions TO service_role;
ALTER TABLE public.crm_next_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_next_actions_account ON public.crm_next_actions(account_id);
CREATE INDEX idx_crm_next_actions_work ON public.crm_next_actions(work_item_id);

CREATE POLICY "staff read next actions" ON public.crm_next_actions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert next actions" ON public.crm_next_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update next actions" ON public.crm_next_actions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin()
         OR public.is_commercial_staff()
         OR (staff_id IS NOT NULL AND (public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id))));
CREATE POLICY "admin delete next actions" ON public.crm_next_actions
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.crm_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now()$qq$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip resolve_operating_contexts: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.resolve_operating_contexts() TO authenticated$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ BEGIN EXECUTE $q$GRANT EXECUTE ON FUNCTION public.resolve_operating_contexts() TO service_role$q$; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip g: %', SQLERRM; END $w$;
DO $w$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['crm_account_access_grants','crm_contacts','crm_document_permissions','crm_document_versions','device_fingerprints','identity_auth_policies','identity_discovery_rate','identity_risk_policies','navigation_logs','platform_settings','portal_transition_audit','rename_feature_flag','social_accounts','ui_events','work_capacity_profiles','crm_account_access_requests','crm_document_approvals','crm_document_links','crm_document_shares','crm_interactions','crm_opportunity_links','identity_discovery_events','identity_risk_assessments','crm_customer_commitments','crm_meeting_outcomes','crm_next_actions'] LOOP
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname<>'Admins manage restored records')=0 THEN NULL; ELSE EXECUTE format('DROP POLICY IF EXISTS "Admins manage restored records" ON public.%I', t); EXECUTE format('CREATE POLICY "Admins manage restored records" ON public.%I FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'']::public.app_role[]))', t); END IF; END LOOP; END $w$;
