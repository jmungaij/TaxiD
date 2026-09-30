REVOKE ALL ON FUNCTION public.rec_document_requirements_versioned(uuid, uuid[], text, text, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rec_document_evaluate_versioned(uuid, uuid[], text, text, integer, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rec_bind_requirement_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._rec_document_verification_authority() FROM PUBLIC, anon, authenticated;