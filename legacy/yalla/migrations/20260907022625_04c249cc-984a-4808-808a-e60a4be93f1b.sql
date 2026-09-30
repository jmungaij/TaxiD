REVOKE EXECUTE ON FUNCTION public.commercial_can_approve(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commercial_request_approval(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commercial_decide_approval(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commercial_service_handoff(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commercial_approvals_touch() FROM anon, authenticated;