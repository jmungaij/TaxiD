CREATE OR REPLACE FUNCTION public._ai_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit_events is append-only';
END $$;

CREATE OR REPLACE FUNCTION public._ai_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;