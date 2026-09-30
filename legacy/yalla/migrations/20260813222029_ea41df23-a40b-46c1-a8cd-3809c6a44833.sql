ALTER FUNCTION public.charter_wallet_apply_funding_callback(text, text, numeric, text, integer, text) SET search_path = public, extensions;
ALTER FUNCTION public.charter_wallet_debit(uuid, numeric, text, uuid, text, text, text, uuid) SET search_path = public, extensions;
ALTER FUNCTION public.charter_wallet_reverse_funding(uuid, text, text, jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.payment_projection_replay_certify(uuid) SET search_path = public, extensions;
ALTER FUNCTION public.payment_verify_evidence_bundle(uuid, text) SET search_path = public, extensions;
ALTER FUNCTION public.rec_public_draft_load(text, text, text) SET search_path = public, extensions;
ALTER FUNCTION public.rec_public_draft_save(text, text, text, jsonb, integer) SET search_path = public, extensions;