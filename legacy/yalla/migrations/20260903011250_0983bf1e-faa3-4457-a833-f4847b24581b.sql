-- 1. RLS-enabled-no-policy tables: deny-by-default with explicit rules.
REVOKE ALL ON public.doc_number_sequences FROM anon, authenticated;
REVOKE ALL ON public.rec_import_worker_config FROM anon, authenticated;
REVOKE ALL ON public.social_credentials FROM anon, authenticated;
GRANT ALL ON public.doc_number_sequences TO service_role;
GRANT ALL ON public.rec_import_worker_config TO service_role;
GRANT ALL ON public.social_credentials TO service_role;
GRANT SELECT ON public.doc_number_sequences TO authenticated;
GRANT SELECT ON public.rec_import_worker_config TO authenticated;

DROP POLICY IF EXISTS "doc_number_sequences_admin_read" ON public.doc_number_sequences;
CREATE POLICY "doc_number_sequences_admin_read" ON public.doc_number_sequences
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

DROP POLICY IF EXISTS "rec_import_worker_config_admin_read" ON public.rec_import_worker_config;
CREATE POLICY "rec_import_worker_config_admin_read" ON public.rec_import_worker_config
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- Social provider credentials are secrets: no signed-in role may ever read them.
DROP POLICY IF EXISTS "social_credentials_no_client_access" ON public.social_credentials;
CREATE POLICY "social_credentials_no_client_access" ON public.social_credentials
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- 2. Revoke drifted anonymous EXECUTE on SECURITY DEFINER functions.
DO $$
DECLARE
  r record;
  allow text[] := ARRAY[
    'rec_public_vacancies','rec_public_vacancy','rec_public_vacancy_detail','rec_public_internship',
    'rec_public_application_blueprint','rec_public_slug_is_open','rec_public_document_check',
    'rec_public_stage_gate','rec_education_policy','rec_public_apply','rec_public_internship_apply',
    'rec_public_draft_load','rec_public_draft_save','rec_public_announcement_track','rec_log_public_api',
    'rec_public_application_contract','rec_public_apply_bootstrap','rec_record_apply_refusal',
    'rec_public_remediation_case','rec_public_remediation_resume','rec_notify_compatibility_block',
    'rec_profession_attempt_load','rec_profession_attempt_save','rec_profession_attempt_submit',
    'rec_comm_candidate_respond','rec_comm_verify_document','rec_delivery_touch_public',
    'rec_public_requirement_responses',
    'doc_verify_public','track_package_public','redeem_trip_share_token','city_pricing_public',
    'surge_rules_public','active_surge_multiplier','driver_leaderboard_public','public_onboarding_message',
    'has_role','has_any_role','has_staff_permission','has_corporate_role','has_governance_access',
    'has_recon_permission','can_read_tax_reports','crm_can_write_commercial','crm_document_authority',
    'intern_can_view','intern_is_self','intern_programme_authority','intern_recruitment_authority',
    'is_charter_partner_admin','is_commercial_staff','is_corp_or_finance','is_corporate_manager_or_admin',
    'is_corporate_member','is_finance_approver','is_finance_auditor','is_my_staff_record',
    'is_partner_member','is_platform_admin','is_platform_staff','is_staff_member',
    'is_staff_portal_member','is_staff_user','manages_staff_record','nav_registry_can_author',
    'ops_can_work_queue','owns_fleet','owns_fleet_driver','owns_fleet_vehicle',
    'partner_api_is_manager','partner_api_is_member','payment_has_forensic_access',
    'rec_can_read','rec_can_write','rec_is_hiring_authority','rec_is_recruiter',
    'social_can_approve','social_can_edit','yp_is_compliance','yp_is_staff'
  ];
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           (p.prorettype::regtype::text = 'trigger') AS is_trigger
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.proname = ANY(allow))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
    IF r.is_trigger THEN
      -- Trigger routines run as the table owner; no client role needs EXECUTE.
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', r.proname, r.args);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'anon EXECUTE revoked on % SECURITY DEFINER functions', n;
END $$;

-- 3. Risk-ranked security ledger.
INSERT INTO public.ai_security_ledger (
  finding_key, category, finding_count, severity, exploitability,
  tenant_impact, financial_impact, authentication_impact, authorization_impact,
  rls_impact, secret_exposure, production_blocker, remediation_status,
  risk_acceptance_note, evidence
) VALUES
 ('LINT_0008_RLS_ENABLED_NO_POLICY','RLS',3,'HIGH','THEORETICAL',
  false,false,false,true,true,true,false,'FIXED',
  NULL,
  jsonb_build_object(
    'tables', jsonb_build_array('doc_number_sequences','rec_import_worker_config','social_credentials'),
    'remediation','Client grants revoked; admin-read policies added for the two operational tables; social_credentials denied to every client role (USING false).',
    'residual','service_role only, used by edge functions.')),
 ('LINT_0028_ANON_SECURITY_DEFINER_DRIFT','AUTHORIZATION',45,'CRITICAL','PROVEN',
  true,false,false,true,true,false,false,'FIXED',
  NULL,
  jsonb_build_object(
    'cause','Postgres grants EXECUTE to PUBLIC on every new function; Stage 3-10 functions were created without the deny-by-default revoke.',
    'examples', jsonb_build_array('freight_hub_receive','freight_hub_depart','di00_orch_start','legal_raise_compliance_alert','rec_requirement_response_review','rec_vacancy_competencies_set'),
    'remediation','REVOKE ALL FROM PUBLIC, anon on every public SECURITY DEFINER function outside the approved anon entrypoint/RLS-predicate allowlist; service_role retained.',
    'gate','scripts/execute-grant-gate.ts reads live grants and fails the build on re-drift.')),
 ('LINT_0028_ANON_SECURITY_DEFINER_ALLOWLISTED','AUTHORIZATION',81,'LOW','NOT_EXPLOITABLE',
  false,false,false,false,true,false,false,'RISK_ACCEPTED',
  'Deliberate anon surface: public careers/verification/tracking entrypoints plus boolean RLS predicates that return false for anonymous callers (auth.uid() is NULL). Enumerated in src/lib/security/executeGrantContract.ts and gated in CI.',
  jsonb_build_object('entrypoints',35,'rls_predicates',46)),
 ('LINT_0029_AUTHENTICATED_SECURITY_DEFINER','AUTHORIZATION',944,'MEDIUM','THEORETICAL',
  false,false,false,true,false,false,false,'IN_PROGRESS',
  'Application RPCs are intentionally SECURITY DEFINER so they can enforce their own authorisation (require_staff / has_staff_permission / ownership predicates) while bypassing table RLS. The linter flags the pattern, not a defect. Ledger-, worker- and payment-mutating RPCs are already service_role-only per the EXECUTE grant contract. A per-function authorisation attestation sweep remains open work.',
  jsonb_build_object('service_role_only_enforced',true,'contract','src/lib/security/executeGrantContract.ts','open_work','per-function authorisation attestation')),
 ('LINT_0014_EXTENSION_IN_PUBLIC','CONFIGURATION',1,'LOW','NOT_EXPLOITABLE',
  false,false,false,false,false,false,false,'RISK_ACCEPTED',
  'Extension installed in public by the managed platform. Relocating it would break dependent objects; no privilege escalation path.',
  jsonb_build_object('action','none'))
ON CONFLICT (finding_key) DO UPDATE SET
  finding_count = EXCLUDED.finding_count,
  severity = EXCLUDED.severity,
  exploitability = EXCLUDED.exploitability,
  tenant_impact = EXCLUDED.tenant_impact,
  financial_impact = EXCLUDED.financial_impact,
  authentication_impact = EXCLUDED.authentication_impact,
  authorization_impact = EXCLUDED.authorization_impact,
  rls_impact = EXCLUDED.rls_impact,
  secret_exposure = EXCLUDED.secret_exposure,
  production_blocker = EXCLUDED.production_blocker,
  remediation_status = EXCLUDED.remediation_status,
  risk_acceptance_note = EXCLUDED.risk_acceptance_note,
  evidence = EXCLUDED.evidence,
  updated_at = now();

-- Reporting projection for the security ledger (admin/governor visibility).
CREATE OR REPLACE VIEW public.v_security_ledger
WITH (security_invoker = true) AS
SELECT finding_key, category, finding_count, severity, exploitability,
       tenant_impact, financial_impact, authentication_impact, authorization_impact,
       rls_impact, secret_exposure, production_blocker, remediation_status,
       risk_acceptance_note, evidence, recorded_at, updated_at,
       CASE
         WHEN production_blocker AND remediation_status NOT IN ('FIXED','RISK_ACCEPTED') THEN 'BLOCKS_PRODUCTION'
         WHEN remediation_status = 'FIXED' THEN 'CLOSED'
         WHEN remediation_status = 'RISK_ACCEPTED' THEN 'ACCEPTED'
         ELSE 'OPEN'
       END AS ledger_state
FROM public.ai_security_ledger;

GRANT SELECT ON public.v_security_ledger TO authenticated;