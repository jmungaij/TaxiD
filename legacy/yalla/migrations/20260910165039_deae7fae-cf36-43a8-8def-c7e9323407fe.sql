REVOKE ALL ON FUNCTION public._provider_withdrawal_invoice_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._provider_invoice_cover(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._provider_invoice_cover(uuid) TO service_role;