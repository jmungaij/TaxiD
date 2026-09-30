CREATE OR REPLACE FUNCTION public._rec_requirement_set_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published requirement version % cannot be deleted; supersede it with a new version', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    -- Only lifecycle / provenance fields may move on a published version.
    IF (NEW.scope, NEW.vacancy_id, NEW.version, NEW.effective_from)
       IS DISTINCT FROM (OLD.scope, OLD.vacancy_id, OLD.version, OLD.effective_from) THEN
      RAISE EXCEPTION 'requirement version % is published and immutable; create a new version instead', OLD.id;
    END IF;
    -- A version that was never published (review / approved) may be withdrawn
    -- back to draft. Anything that has been enforced never returns to draft.
    IF NEW.status = 'draft' AND OLD.status NOT IN ('review','approved') THEN
      RAISE EXCEPTION 'requirement version % cannot return to draft', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END; $function$;