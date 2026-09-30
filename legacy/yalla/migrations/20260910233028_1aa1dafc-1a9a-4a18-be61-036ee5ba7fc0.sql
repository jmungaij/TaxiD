-- `wallets_no_client_write` was a permissive ALL policy with USING (true) granted to
-- anon + authenticated. Because permissive policies are OR'd, its USING clause made
-- every wallet row readable by any client role, defeating "view own wallets".
-- Writes are already denied by the absence of any INSERT/UPDATE/DELETE policy, so the
-- policy is dropped and client-side write privileges are explicitly revoked.
DROP POLICY IF EXISTS "wallets_no_client_write" ON public.wallets;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.wallets FROM anon, authenticated;
REVOKE SELECT ON public.wallets FROM anon;
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;