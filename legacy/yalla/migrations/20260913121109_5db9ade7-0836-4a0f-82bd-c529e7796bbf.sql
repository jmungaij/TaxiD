REVOKE ALL ON FUNCTION public.rental_quote_settle_payment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_quote_settle_payment(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.purge_expired_public_upload_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_public_upload_sessions() TO service_role;