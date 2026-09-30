REVOKE EXECUTE ON FUNCTION public.rec_import_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rec_import_idempotency_report(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rec_adjudication_decide(uuid, text, text, text) FROM PUBLIC, anon;