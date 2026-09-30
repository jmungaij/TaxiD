CREATE TABLE public.provider_verification (
  provider_user_id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (state IN ('UNVERIFIED','IN_REVIEW','VERIFIED','SUSPENDED','BLOCKED')),
  reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_verification TO authenticated;
GRANT ALL ON public.provider_verification TO service_role;
ALTER TABLE public.provider_verification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read their own verification"
ON public.provider_verification FOR SELECT TO authenticated
USING (provider_user_id = auth.uid() OR public.capacity_can_approve(auth.uid()));

CREATE TRIGGER provider_verification_touch
BEFORE UPDATE ON public.provider_verification
FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_touch();

CREATE TABLE public.provider_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id uuid NOT NULL,
  from_state text,
  to_state text NOT NULL,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_verification_events TO authenticated;
GRANT ALL ON public.provider_verification_events TO service_role;
ALTER TABLE public.provider_verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators read their own verification history"
ON public.provider_verification_events FOR SELECT TO authenticated
USING (provider_user_id = auth.uid() OR public.capacity_can_approve(auth.uid()));

CREATE INDEX idx_provider_verification_events_provider
  ON public.provider_verification_events (provider_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._provider_verification_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'VERIFICATION_HISTORY_IS_APPEND_ONLY';
END; $$;

CREATE TRIGGER trg_provider_verification_events_append_only
BEFORE UPDATE OR DELETE ON public.provider_verification_events
FOR EACH ROW EXECUTE FUNCTION public._provider_verification_events_append_only();

-- Listings only go live for a verified operator.
CREATE OR REPLACE FUNCTION public._provider_capacity_requires_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_state text;
BEGIN
  IF NEW.status <> 'PUBLISHED' OR coalesce(OLD.status,'') = 'PUBLISHED' THEN
    RETURN NEW;
  END IF;
  SELECT state INTO v_state FROM public.provider_verification
   WHERE provider_user_id = NEW.provider_user_id;
  IF coalesce(v_state,'UNVERIFIED') <> 'VERIFIED' THEN
    RAISE EXCEPTION 'PROVIDER_NOT_VERIFIED: %', coalesce(v_state,'UNVERIFIED');
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_provider_capacity_requires_verification
BEFORE INSERT OR UPDATE ON public.provider_capacity
FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_requires_verification();

-- Staff decision on an operator's standing.
CREATE OR REPLACE FUNCTION public.provider_verification_set(
  _provider_user_id uuid,
  _state text,
  _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_from text;
  v_missing text[];
  v_unpublished int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')
          OR public.has_role(v_actor,'operations_admin')) THEN
    RAISE EXCEPTION 'VERIFICATION_NOT_PERMITTED';
  END IF;
  IF _state NOT IN ('UNVERIFIED','IN_REVIEW','VERIFIED','SUSPENDED','BLOCKED') THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;
  IF _provider_user_id IS NULL THEN RAISE EXCEPTION 'OPERATOR_REQUIRED'; END IF;
  IF _provider_user_id = v_actor THEN RAISE EXCEPTION 'SELF_VERIFICATION_NOT_PERMITTED'; END IF;
  IF _state IN ('IN_REVIEW','SUSPENDED','BLOCKED','UNVERIFIED')
     AND coalesce(btrim(_reason),'') = '' THEN
    RAISE EXCEPTION 'VERIFICATION_REASON_REQUIRED';
  END IF;

  IF _state = 'VERIFIED' THEN
    SELECT array_agg(k) INTO v_missing
    FROM unnest(ARRAY['OPERATING_LICENCE','INSURANCE','VEHICLE_INSPECTION']) AS k
    WHERE NOT EXISTS (
      SELECT 1 FROM public.provider_documents d
       WHERE d.provider_user_id = _provider_user_id
         AND d.doc_kind = k
         AND d.status = 'VERIFIED'
         AND (d.expires_on IS NULL OR d.expires_on >= current_date)
    );
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'PROVIDER_DOCUMENTS_REQUIRED: %', array_to_string(v_missing, ', ');
    END IF;
  END IF;

  SELECT state INTO v_from FROM public.provider_verification
   WHERE provider_user_id = _provider_user_id FOR UPDATE;

  INSERT INTO public.provider_verification (provider_user_id, state, reason, decided_by, decided_at)
  VALUES (_provider_user_id, _state, nullif(btrim(_reason),''), v_actor, now())
  ON CONFLICT (provider_user_id) DO UPDATE
    SET state = excluded.state,
        reason = excluded.reason,
        decided_by = excluded.decided_by,
        decided_at = excluded.decided_at;

  INSERT INTO public.provider_verification_events
    (provider_user_id, from_state, to_state, reason, actor_id)
  VALUES (_provider_user_id, v_from, _state, nullif(btrim(_reason),''), v_actor);

  IF _state IN ('SUSPENDED','BLOCKED') THEN
    WITH pulled AS (
      UPDATE public.provider_capacity
         SET status = 'PENDING_APPROVAL',
             published_at = NULL,
             decision_reason = 'OPERATOR_' || _state,
             decided_at = now(),
             decided_by = v_actor
       WHERE provider_user_id = _provider_user_id
         AND status = 'PUBLISHED'
      RETURNING 1
    ) SELECT count(*)::int INTO v_unpublished FROM pulled;
  END IF;

  RETURN jsonb_build_object(
    'provider_user_id', _provider_user_id,
    'state', _state,
    'from_state', v_from,
    'listings_withdrawn', v_unpublished
  );
END; $$;

REVOKE ALL ON FUNCTION public.provider_verification_set(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_verification_set(uuid, text, text) TO authenticated;

-- Admin console: every operator with their evidence and standing.
CREATE OR REPLACE FUNCTION public.provider_verification_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')
          OR public.has_role(v_actor,'operations_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  WITH operators AS (
    SELECT provider_user_id FROM public.provider_documents WHERE provider_user_id IS NOT NULL
    UNION
    SELECT provider_user_id FROM public.provider_capacity WHERE provider_user_id IS NOT NULL
    UNION
    SELECT provider_user_id FROM public.provider_verification
  ), enriched AS (
    SELECT
      o.provider_user_id,
      coalesce(v.state,'UNVERIFIED') AS state,
      v.reason,
      v.decided_at,
      (SELECT max(provider_name) FROM public.provider_capacity c
        WHERE c.provider_user_id = o.provider_user_id) AS operator_name,
      (SELECT count(*) FROM public.provider_documents d
        WHERE d.provider_user_id = o.provider_user_id AND d.status = 'SUBMITTED') AS docs_awaiting,
      (SELECT count(*) FROM public.provider_documents d
        WHERE d.provider_user_id = o.provider_user_id AND d.status = 'VERIFIED'
          AND (d.expires_on IS NULL OR d.expires_on >= current_date)) AS docs_verified,
      (SELECT count(*) FROM public.provider_documents d
        WHERE d.provider_user_id = o.provider_user_id AND d.status = 'REJECTED') AS docs_rejected,
      (SELECT array_agg(k) FROM unnest(ARRAY['OPERATING_LICENCE','INSURANCE','VEHICLE_INSPECTION']) AS k
        WHERE NOT EXISTS (
          SELECT 1 FROM public.provider_documents d
           WHERE d.provider_user_id = o.provider_user_id AND d.doc_kind = k
             AND d.status = 'VERIFIED'
             AND (d.expires_on IS NULL OR d.expires_on >= current_date))) AS missing_docs,
      (SELECT count(*) FROM public.provider_capacity c
        WHERE c.provider_user_id = o.provider_user_id AND c.status = 'PUBLISHED') AS listings_live,
      (SELECT count(*) FROM public.provider_capacity c
        WHERE c.provider_user_id = o.provider_user_id AND c.status = 'PENDING_APPROVAL') AS listings_awaiting,
      (SELECT count(*) FROM public.provider_bookings b
        WHERE b.provider_user_id = o.provider_user_id AND coalesce(b.is_test,false) = false
          AND b.status NOT IN ('CANCELLED')) AS bookings_active
    FROM operators o
    LEFT JOIN public.provider_verification v ON v.provider_user_id = o.provider_user_id
  )
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.docs_awaiting DESC, e.state), '[]'::jsonb)
    INTO v_rows FROM enriched e;

  RETURN jsonb_build_object('operators', v_rows, 'generated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.provider_verification_console() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_verification_console() TO authenticated;

-- History for one operator, readable by staff and by the operator themselves.
CREATE OR REPLACE FUNCTION public.provider_verification_history(_provider_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_actor uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_actor <> _provider_user_id AND NOT (
      public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')
      OR public.has_role(v_actor,'operations_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'from_state', e.from_state, 'to_state', e.to_state,
           'reason', e.reason, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.provider_verification_events e
   WHERE e.provider_user_id = _provider_user_id;
  RETURN v_rows;
END; $$;

REVOKE ALL ON FUNCTION public.provider_verification_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_verification_history(uuid) TO authenticated;