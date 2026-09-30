REVOKE ALL ON FUNCTION public.audit_finance_fields() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.deny_finance_audit_mutation() FROM public, anon, authenticated;