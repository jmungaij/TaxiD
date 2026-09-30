REVOKE EXECUTE ON FUNCTION public.credit_wallet(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_wallet(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet(uuid, bigint) TO service_role;