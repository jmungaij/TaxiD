-- 1. Webhook endpoints: no client-side access at all; staff tooling uses the masked view.
REVOKE ALL ON public.logistics_webhook_endpoints FROM anon, authenticated;
GRANT ALL ON public.logistics_webhook_endpoints TO service_role;
GRANT SELECT ON public.v_logistics_webhook_endpoints TO authenticated;

-- 2. Partner API credentials: hide secret_hash from client roles via column privileges.
REVOKE ALL ON public.partner_api_credentials FROM anon, authenticated;
GRANT ALL ON public.partner_api_credentials TO service_role;
GRANT SELECT (
  id, partner_id, environment, label, client_id, secret_fingerprint, scopes, tier, status,
  rate_limit_per_min, monthly_quota, last_used_at, rotated_at, rotated_from, grace_expires_at,
  revoked_at, revoked_by, revoke_reason, created_by, created_at, updated_at
) ON public.partner_api_credentials TO authenticated;

-- Masked view for partner-facing reads (inherits the table's RLS policies).
CREATE OR REPLACE VIEW public.v_partner_api_credentials
WITH (security_invoker = true) AS
SELECT id, partner_id, environment, label, client_id, secret_fingerprint, scopes, tier, status,
       rate_limit_per_min, monthly_quota, last_used_at, rotated_at, rotated_from, grace_expires_at,
       revoked_at, revoked_by, revoke_reason, created_by, created_at, updated_at
FROM public.partner_api_credentials;

GRANT SELECT ON public.v_partner_api_credentials TO authenticated;
GRANT ALL ON public.v_partner_api_credentials TO service_role;