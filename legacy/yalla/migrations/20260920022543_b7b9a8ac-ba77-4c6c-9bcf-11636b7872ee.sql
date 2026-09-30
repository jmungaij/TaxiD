DO $mig$
DECLARE
  allowed text[] := ARRAY[
    '_contract_may_activate','_contract_may_read','_driver_application_staff','_sales_stage_probability',
    'active_surge_multiplier','can_read_tax_reports','capacity_photo_is_published',
    'carrier_application_status','carrier_application_submit','city_pricing_public','client_portal_open',
    'comms_can_read_account','comms_can_read_thread','comms_is_administrator','comms_is_manager','comms_my_staff_id',
    'contract_portal_open','contract_portal_submit','contract_portal_upload_allowed',
    'crm_can_write_commercial','crm_document_authority','doc_verify_public',
    'driver_application_status','driver_application_submit','driver_leaderboard_public',
    'has_any_role','has_corporate_role','has_governance_access','has_recon_permission','has_role','has_staff_permission',
    'intern_can_view','intern_is_self','intern_programme_authority','intern_recruitment_authority',
    'is_charter_partner_admin','is_commercial_staff','is_corp_or_finance','is_corporate_manager_or_admin',
    'is_corporate_member','is_finance_approver','is_finance_auditor','is_my_staff_record','is_partner_member',
    'is_platform_admin','is_platform_staff','is_staff_member','is_staff_portal_member','is_staff_user',
    'manages_staff_record','marketplace_capacity_search','nav_registry_can_author','ops_can_work_queue',
    'owns_fleet','owns_fleet_driver','owns_fleet_vehicle','partner_api_is_manager','partner_api_is_member',
    'partner_application_intake_within_limit','partner_application_submit','partner_portal_open',
    'payment_has_forensic_access','pricing_models_public','public_onboarding_message',
    'rec_can_read','rec_can_write','rec_comm_candidate_respond','rec_comm_verify_document',
    'rec_delivery_touch_public','rec_education_policy','rec_is_hiring_authority','rec_is_recruiter',
    'rec_log_public_api','rec_notify_compatibility_block','rec_profession_attempt_load',
    'rec_profession_attempt_save','rec_profession_attempt_submit','rec_public_announcement_track',
    'rec_public_application_blueprint','rec_public_application_contract','rec_public_apply',
    'rec_public_apply_bootstrap','rec_public_document_check','rec_public_draft_load','rec_public_draft_save',
    'rec_public_internship','rec_public_internship_apply','rec_public_remediation_case',
    'rec_public_remediation_resume','rec_public_requirement_responses','rec_public_slug_is_open',
    'rec_public_stage_gate','rec_public_upload_global_within_limit','rec_public_upload_reserve',
    'rec_public_upload_session_allow','rec_public_upload_session_open','rec_public_upload_within_limit',
    'rec_public_vacancies','rec_public_vacancy','rec_public_vacancy_detail','rec_record_apply_refusal',
    'redeem_trip_share_token','rental_booking_request_change','rental_fleet_availability','rental_quote_open',
    'sales_lead_contact_reply','sales_lead_contact_view','sales_lead_customer_state','sales_lead_request_submit',
    'social_can_approve','social_can_edit','surge_rules_public','track_package_public',
    'yp_is_compliance','yp_is_staff'
  ];
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_type t ON t.oid = p.prorettype
    WHERE ns.nspname = 'public'
      AND p.prosecdef
      AND t.typname NOT IN ('trigger','event_trigger')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT (p.proname = ANY (allowed))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'anon EXECUTE revoked on % routines', n;
END
$mig$;