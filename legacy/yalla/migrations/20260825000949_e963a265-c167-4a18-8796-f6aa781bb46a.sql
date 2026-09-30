REVOKE ALL ON FUNCTION public.partner_wl_owns_evidence_object(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_wl_manages_evidence_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_wl_owns_evidence_object(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_wl_manages_evidence_object(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.partner_wl_incident_create(uuid, text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_wl_incident_update(uuid, text, text, uuid, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_wl_evidence_attach(uuid, text, text, text, text, text, bigint, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_wl_log_provisioning_step(uuid, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_wl_abort_provisioning(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_wl_evidence_statement(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.partner_wl_incident_create(uuid, text, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_wl_incident_update(uuid, text, text, uuid, boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_wl_evidence_attach(uuid, text, text, text, text, text, bigint, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_wl_log_provisioning_step(uuid, text, text, text, uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_wl_abort_provisioning(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_wl_evidence_statement(uuid) TO service_role;