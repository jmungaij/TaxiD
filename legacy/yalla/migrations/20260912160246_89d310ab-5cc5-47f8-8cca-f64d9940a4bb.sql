-- Defence in depth: these SECURITY DEFINER contract RPCs already guard on staff
-- roles internally, but EXECUTE was still granted to PUBLIC (so anon could call
-- them). Restrict to authenticated + service_role.
DO $$
DECLARE fn text; sig text;
BEGIN
  FOR fn, sig IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'contract_create','contract_status_set','contract_acceptance_record',
      'contract_manager_dashboard','contract_portal_invite_create',
      'contract_onboarding_complete','contract_revenue_by_employee',
      'contract_amendment_billing_board','contract_amendment_bill')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', fn, sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', fn, sig);
  END LOOP;
END $$;