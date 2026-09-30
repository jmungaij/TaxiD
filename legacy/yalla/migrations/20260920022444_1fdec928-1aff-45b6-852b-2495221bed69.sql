REVOKE ALL ON FUNCTION public.rental_fleet_availability(text,date,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rental_fleet_availability(text,date,integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.rental_booking_request_change(text,text,text,date,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rental_booking_request_change(text,text,text,date,date,text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.contract_portal_upload_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contract_portal_upload_allowed(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.partner_application_intake_within_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_application_intake_within_limit(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.corp_admin_signin_policy_decide(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_admin_signin_policy_decide(uuid,text,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.corp_admin_org_settings_update(uuid,bigint,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_admin_org_settings_update(uuid,bigint,integer,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sales_kpi_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_kpi_cascade(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sales_management_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_management_dashboard() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._sales_desk_leader() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sales_desk_leader() TO service_role;

REVOKE ALL ON FUNCTION public._sales_kpi_target(uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sales_kpi_target(uuid,date,date) TO service_role;