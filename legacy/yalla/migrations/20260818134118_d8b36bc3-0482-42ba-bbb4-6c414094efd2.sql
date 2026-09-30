-- pgcrypto's digest() lives in the extensions schema; the hardened
-- search_path hid it, aborting every audit insert (and thus sign-up).
ALTER FUNCTION public.tg_hash_chain_hash_col() SET search_path = public, extensions, pg_temp;
REVOKE EXECUTE ON FUNCTION public.tg_hash_chain_hash_col() FROM PUBLIC, anon, authenticated;