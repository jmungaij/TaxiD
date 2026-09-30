REVOKE EXECUTE ON FUNCTION public.customer_request_submit(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_my_requests() FROM anon;
REVOKE EXECUTE ON FUNCTION public.customer_request_respond(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sales_lead_request_information(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commercial_my_kpis(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public._sales_route_owner(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sales_lead_customer_state(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._sales_lead_close_stamp() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_lead_customer_state(text, text) TO authenticated;