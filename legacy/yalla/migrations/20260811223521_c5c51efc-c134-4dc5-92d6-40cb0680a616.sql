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
                     'operations_admin','operations_manager','pricing_manager','fleet_manager']::text[] THEN
    _contexts := array_append(_contexts, 'staff_operations');
  END IF;
  IF _roles && ARRAY['admin','super_admin']::text[] THEN
    _contexts := array_append(_contexts, 'super_admin');
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
      CASE WHEN _roles && ARRAY['super_admin']::text[] THEN 'Super Administrator'
           WHEN _roles && ARRAY['admin']::text[] THEN 'Administrator'
           ELSE COALESCE(_roles[1], 'Staff') END)
  );
END;
$$;