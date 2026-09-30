-- Documents are no longer collected during an application: the per-job document
-- list is now a recruitment-facing reference mirror, not a submission gate.
-- It is therefore no longer part of the candidate-facing content that is frozen
-- once an application is bound to a blueprint version.
CREATE OR REPLACE FUNCTION public._rec_blueprint_bound_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_bound integer;
BEGIN
  IF (NEW.sections, NEW.assessment, NEW.cover_letter_mode,
      NEW.requirement_set_id, NEW.version)
     IS NOT DISTINCT FROM
     (OLD.sections, OLD.assessment, OLD.cover_letter_mode,
      OLD.requirement_set_id, OLD.version) THEN
    RETURN NEW; -- status / provenance / reference-mirror movement only
  END IF;

  SELECT count(*) INTO v_bound FROM public.rec_applications WHERE blueprint_id = OLD.id;
  IF v_bound > 0 THEN
    RAISE EXCEPTION 'blueprint % is bound to % application(s) and cannot be edited; provision a new version instead', OLD.id, v_bound;
  END IF;
  RETURN NEW;
END; $function$;

UPDATE public.rec_blueprints
SET document_requirements = (
      SELECT coalesce(jsonb_agg(jsonb_set(d, '{required}', 'false'::jsonb, true)), '[]'::jsonb)
      FROM jsonb_array_elements(document_requirements) d
    ),
    updated_at = now()
WHERE document_requirements IS NOT NULL
  AND document_requirements <> '[]'::jsonb
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(document_requirements) d
    WHERE coalesce((d->>'required')::boolean, false)
  );