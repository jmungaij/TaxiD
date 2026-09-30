-- Scope the commercial document engine's functions: strip the default
-- PUBLIC/anon EXECUTE grant. Internal role checks already gate every call;
-- this removes the anonymous surface entirely.
REVOKE EXECUTE ON FUNCTION public.commercial_document_generate(uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commercial_document_transition(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commercial_document_trace(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commercial_document_attach_hash(uuid, text, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commercial_document_dispatch_record(uuid, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._commercial_document_number(public.commercial_document_type) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._commercial_document_guard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._commercial_document_events_append_only() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._commercial_document_dispatch_guard() FROM PUBLIC, anon;