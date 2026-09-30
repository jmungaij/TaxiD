REVOKE EXECUTE ON FUNCTION public.charter_wallet_reconcile_range(timestamptz, timestamptz, text, uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.charter_wallet_queue_reconciliation(timestamptz, timestamptz, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.charter_wallet_reconcile_range(timestamptz, timestamptz, text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.charter_wallet_queue_reconciliation(timestamptz, timestamptz, uuid, text) TO authenticated, service_role;