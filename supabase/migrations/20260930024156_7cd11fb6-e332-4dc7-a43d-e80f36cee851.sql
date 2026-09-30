REVOKE EXECUTE ON FUNCTION public.identity_risk_evaluate(text, text), public.record_portal_transition(text,text,text,text,text,boolean,text),
  public.resolve_operating_contexts(), public.staff_available_actions(integer), public.staff_claim_self(),
  public.staff_link_diagnostics(), public.staff_self_id() FROM anon;
-- Signed-out access kept only for the three sign-in page checks, which by design return no private data.
REVOKE EXECUTE ON FUNCTION public.staff_self_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.staff_self_id() TO service_role;