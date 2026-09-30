REVOKE EXECUTE ON FUNCTION public.partner_wl_incident_create(uuid, text, text, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_wl_incident_update(uuid, text, text, uuid, boolean, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_wl_evidence_attach(uuid, text, text, text, text, text, bigint, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_wl_log_provisioning_step(uuid, text, text, text, uuid, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_wl_abort_provisioning(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_wl_evidence_statement(uuid) FROM anon;

REVOKE ALL ON FUNCTION public._partner_wl_artifacts_immutable() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public._partner_wl_signatures_append_only() FROM anon, authenticated;