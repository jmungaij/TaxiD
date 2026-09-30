-- P0: admin_audit_log stores its fingerprint in "hash", not "event_hash".
-- The shared writer set NEW.event_hash, so EVERY audit insert raised
-- 42703 and aborted the surrounding transaction — including the auth
-- sign-up transaction (handle_new_user -> user_roles -> audit trigger).
CREATE OR REPLACE FUNCTION public.tg_hash_chain_hash_col()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stream text := TG_ARGV[0];
  v_prev text;
  v_payload text;
BEGIN
  SELECT head_hash INTO v_prev FROM public.audit_hash_chain WHERE stream = v_stream FOR UPDATE;
  IF v_prev IS NULL THEN v_prev := ''; END IF;
  NEW.prev_hash := v_prev;
  v_payload := v_prev || '|' || coalesce(NEW.id::text,'') || '|' || coalesce(to_jsonb(NEW)::text,'') || '|' || coalesce(NEW.created_at::text, now()::text);
  NEW.hash := encode(digest(v_payload,'sha256'),'hex');

  INSERT INTO public.audit_hash_chain(stream, head_hash, head_id, head_at, count)
    VALUES (v_stream, NEW.hash, NEW.id, coalesce(NEW.created_at, now()), 1)
  ON CONFLICT (stream) DO UPDATE
    SET head_hash = EXCLUDED.head_hash, head_id = EXCLUDED.head_id,
        head_at = EXCLUDED.head_at,
        count = public.audit_hash_chain.count + 1,
        updated_at = now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chain_audit_log ON public.admin_audit_log;
CREATE TRIGGER trg_chain_audit_log
BEFORE INSERT ON public.admin_audit_log
FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain_hash_col('admin_audit_log');

-- document_review_escalations: chain column missing and no stream argument.
ALTER TABLE public.document_review_escalations
  ADD COLUMN IF NOT EXISTS event_hash text;

DROP TRIGGER IF EXISTS trg_doc_escalations_hash ON public.document_review_escalations;
CREATE TRIGGER trg_doc_escalations_hash
BEFORE INSERT ON public.document_review_escalations
FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('document_review_escalations');