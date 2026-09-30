REVOKE ALL ON FUNCTION public.sales_lead_triage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_lead_triage(uuid, text) TO service_role;