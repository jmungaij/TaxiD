-- Trigger: after inserting a trust_incidents row, POST the incident to the
-- trust-case-router edge function via pg_net (async, fire-and-forget).
-- Only fires when the row is not already routed (case_id IS NULL AND routed_at IS NULL)
-- so that back-fills by the function itself (which stamps case_id/routed_at)
-- do not cause loops.

CREATE OR REPLACE FUNCTION public.trg_route_trust_incident()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  _payload jsonb;
BEGIN
  IF NEW.case_id IS NOT NULL OR NEW.routed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  _payload := jsonb_build_object(
    'source',        NEW.source,
    'source_ref',    NEW.source_ref,
    'category',      NEW.category::text,
    'severity',      NEW.severity::text,
    'subject_type',  NEW.subject_type::text,
    'subject_id',    NEW.subject_id,
    'description',   NEW.description,
    'evidence_refs', COALESCE(NEW.evidence_refs, '[]'::jsonb),
    'occurred_at',   to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'metadata',      COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
                       'incident_id', NEW.id,
                       'trigger', 'pg_trigger:trust_incidents_after_insert'
                     )
  );

  PERFORM net.http_post(
    url     := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/trust-case-router',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       'sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ'
    ),
    body    := _payload,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trust_incidents_after_insert_route ON public.trust_incidents;
CREATE TRIGGER trust_incidents_after_insert_route
AFTER INSERT ON public.trust_incidents
FOR EACH ROW EXECUTE FUNCTION public.trg_route_trust_incident();