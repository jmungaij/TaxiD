-- email_delivery_events / email_domain_auth_checks: ingestion runs as service_role
-- (supabase/functions/email-provider-webhook, email-domain-auth-check) which bypasses
-- RLS, so no client-facing write path is required. Remove the broad table grants that
-- were left on anon/authenticated and state the writer explicitly.

REVOKE ALL ON public.email_delivery_events FROM anon, authenticated;
REVOKE ALL ON public.email_domain_auth_checks FROM anon, authenticated;

-- Admin/operations/compliance read through the existing SELECT policies.
GRANT SELECT ON public.email_delivery_events TO authenticated;
GRANT SELECT ON public.email_domain_auth_checks TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_delivery_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_domain_auth_checks TO service_role;

-- Explicit, self-documenting write authority: only the ingesting backend identity.
DROP POLICY IF EXISTS "Only the ingesting service writes email delivery events" ON public.email_delivery_events;
CREATE POLICY "Only the ingesting service writes email delivery events"
  ON public.email_delivery_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Only the ingesting service writes domain auth checks" ON public.email_domain_auth_checks;
CREATE POLICY "Only the ingesting service writes domain auth checks"
  ON public.email_domain_auth_checks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.email_delivery_events IS
  'Append-only provider delivery evidence. Written only by the email-provider-webhook edge function (service_role); readable by admin/super_admin/operations_admin/compliance_admin.';
COMMENT ON TABLE public.email_domain_auth_checks IS
  'SPF/DKIM/DMARC readiness snapshots. Written only by the email-domain-auth-check edge function (service_role); readable by admin/super_admin/operations_admin/compliance_admin.';