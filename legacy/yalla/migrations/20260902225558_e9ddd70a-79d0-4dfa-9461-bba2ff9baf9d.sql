CREATE OR REPLACE FUNCTION public._logistics_dispatch_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'logistics_dispatch_events is append-only';
END $$;

CREATE OR REPLACE FUNCTION public._logistics_dispatch_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

REVOKE ALL ON FUNCTION public._logistics_dispatch_events_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._logistics_dispatch_touch() FROM PUBLIC, anon, authenticated;