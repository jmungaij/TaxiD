REVOKE ALL ON FUNCTION public._contract_signed_work() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._contract_amendment_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._contract_signed_work() TO service_role;
GRANT EXECUTE ON FUNCTION public._contract_amendment_immutable() TO service_role;