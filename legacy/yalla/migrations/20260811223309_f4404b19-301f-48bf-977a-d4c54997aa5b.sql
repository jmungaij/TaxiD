-- 1. Immutable operating-context switch audit -------------------------------
CREATE TABLE public.operating_context_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acting_user_id uuid NOT NULL,
  acting_identity text,
  organisation_id uuid,
  role text,
  previous_context text,
  new_context text NOT NULL,
  authorization_basis text NOT NULL,
  event_type text NOT NULL DEFAULT 'operating_context_switch',
  outcome text NOT NULL DEFAULT 'allowed',
  correlation_id text,
  session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.operating_context_switches TO authenticated;
GRANT ALL ON public.operating_context_switches TO service_role;

ALTER TABLE public.operating_context_switches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read operating context switches"
  ON public.operating_context_switches FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Users read their own context switches"
  ON public.operating_context_switches FOR SELECT TO authenticated
  USING (acting_user_id = auth.uid());

CREATE INDEX idx_octx_switch_user_time
  ON public.operating_context_switches (acting_user_id, created_at DESC);

-- Append-only: block UPDATE/DELETE even for privileged roles.
CREATE OR REPLACE FUNCTION public.block_operating_context_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'operating_context_switches is append-only';
END;
$$;

CREATE TRIGGER operating_context_switches_append_only
  BEFORE UPDATE OR DELETE ON public.operating_context_switches
  FOR EACH ROW EXECUTE FUNCTION public.block_operating_context_mutation();

-- 2. Server-side context resolution ----------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_operating_contexts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _roles text[];
  _contexts text[] := ARRAY[]::text[];
  _email text;
  _org_id uuid;
  _org_name text;
  _position text;
  _unit text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'contexts', '[]'::jsonb);
  END IF;

  SELECT array_agg(role::text) INTO _roles FROM public.user_roles WHERE user_id = _uid;
  _roles := COALESCE(_roles, ARRAY[]::text[]);

  SELECT email INTO _email FROM auth.users WHERE id = _uid;

  IF _roles && ARRAY['admin','super_admin','finance_admin','compliance_admin',
                     'operations_admin','operations_manager','pricing_manager','fleet_manager'] THEN
    _contexts := _contexts || 'staff_operations';
  END IF;
  IF _roles && ARRAY['admin','super_admin'] THEN
    _contexts := _contexts || 'super_admin';
  END IF;

  BEGIN
    SELECT s.entity_id, p.title, u.name
      INTO _org_id, _position, _unit
      FROM public.staff_members s
      LEFT JOIN public.org_positions p ON p.id = s.position_id
      LEFT JOIN public.org_units u ON u.id = s.unit_id
     WHERE s.user_id = _uid
     LIMIT 1;
  EXCEPTION WHEN others THEN
    _org_id := NULL;
  END;

  IF _org_id IS NOT NULL THEN
    BEGIN
      SELECT name INTO _org_name FROM public.org_entities WHERE id = _org_id;
    EXCEPTION WHEN others THEN _org_name := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', _uid,
    'identity', _email,
    'roles', to_jsonb(_roles),
    'contexts', to_jsonb(_contexts),
    'organisation_id', _org_id,
    'organisation', COALESCE(_org_name, 'Yalla Mobility'),
    'unit', _unit,
    'position', _position,
    'resolved_role', COALESCE(_position,
      CASE WHEN _roles && ARRAY['super_admin'] THEN 'Super Administrator'
           WHEN _roles && ARRAY['admin'] THEN 'Administrator'
           ELSE COALESCE(_roles[1], 'Staff') END)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_operating_contexts() FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_operating_contexts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_operating_contexts() TO service_role;

-- 3. Server-authorised context switch --------------------------------------
CREATE OR REPLACE FUNCTION public.switch_operating_context(
  _new_context text,
  _previous_context text DEFAULT NULL,
  _correlation_id text DEFAULT NULL,
  _session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _resolved jsonb := public.resolve_operating_contexts();
  _uid uuid := auth.uid();
  _allowed boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF _new_context NOT IN ('staff_operations','super_admin') THEN
    RAISE EXCEPTION 'unknown_operating_context:%', _new_context;
  END IF;

  _allowed := (_resolved -> 'contexts') ? _new_context;

  INSERT INTO public.operating_context_switches (
    acting_user_id, acting_identity, organisation_id, role,
    previous_context, new_context, authorization_basis, event_type,
    outcome, correlation_id, session_id
  ) VALUES (
    _uid,
    _resolved ->> 'identity',
    NULLIF(_resolved ->> 'organisation_id','')::uuid,
    _resolved ->> 'resolved_role',
    _previous_context,
    _new_context,
    'user_roles:' || COALESCE(_resolved ->> 'roles','[]'),
    CASE WHEN _allowed THEN 'operating_context_switch' ELSE 'operating_context_switch_denied' END,
    CASE WHEN _allowed THEN 'allowed' ELSE 'denied' END,
    _correlation_id,
    _session_id
  );

  IF NOT _allowed THEN
    RAISE EXCEPTION 'operating_context_not_authorized:%', _new_context;
  END IF;

  RETURN jsonb_build_object('ok', true, 'context', _new_context, 'identity', _resolved);
END;
$$;

REVOKE ALL ON FUNCTION public.switch_operating_context(text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.switch_operating_context(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.switch_operating_context(text, text, text, text) TO service_role;