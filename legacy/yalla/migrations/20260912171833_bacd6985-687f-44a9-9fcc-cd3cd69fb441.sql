-- Explicit, least-privilege EXECUTE contract for contract mutation operations.
-- These were already restricted to authenticated + service_role, but the grants
-- were implicit; make the revocation of PUBLIC/anon explicit so it cannot silently
-- regress through a future CREATE OR REPLACE or default-privilege change.
REVOKE ALL ON FUNCTION public.contract_status_set(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_acceptance_record(uuid, date, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_document_attach(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_status_set(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_acceptance_record(uuid, date, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_document_attach(uuid, text, text, text, text, text) TO authenticated, service_role;

-- Authorization helpers have no anonymous use: an anonymous caller can never
-- satisfy them, so remove the privilege rather than rely on the predicate.
REVOKE ALL ON FUNCTION public._contract_may_activate(public.commercial_contract_instances) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._contract_may_read(public.commercial_contract_instances) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._contract_may_activate(public.commercial_contract_instances) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._contract_may_read(public.commercial_contract_instances) TO authenticated, service_role;