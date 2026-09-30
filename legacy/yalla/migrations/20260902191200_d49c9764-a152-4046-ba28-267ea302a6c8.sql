-- Delivery attempts stay append-only for every evidentiary field, but the POD
-- capture routine must bind the proof record to its attempt exactly once.
-- Blocking that binding made proof-of-delivery capture impossible (P0).
create or replace function public._logistics_attempts_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'logistics_delivery_attempts is append-only';
  END IF;

  -- Sole permitted mutation: first-time binding of the POD record.
  IF OLD.pod_id IS NULL
     AND NEW.pod_id IS NOT NULL
     AND to_jsonb(NEW) - 'pod_id' = to_jsonb(OLD) - 'pod_id' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'logistics_delivery_attempts is append-only';
END;
$$;