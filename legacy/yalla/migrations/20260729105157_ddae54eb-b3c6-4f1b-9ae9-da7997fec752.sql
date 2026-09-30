-- 1. Restrict charter_pricing_config reads (internal cost strategy + admin emails)
DROP POLICY IF EXISTS charter_pricing_config_public_read ON public.charter_pricing_config;
REVOKE SELECT ON public.charter_pricing_config FROM anon;
CREATE POLICY charter_pricing_config_staff_read ON public.charter_pricing_config
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 2. Detailed audit trail for every user_roles mutation
CREATE OR REPLACE FUNCTION public.audit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_email text;
BEGIN
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_actor;

  INSERT INTO public.admin_audit_log (
    actor_id, actor_email, action, resource_type, resource_id,
    old_value, new_value, reason, metadata
  ) VALUES (
    v_actor,
    v_email,
    'user_roles.' || lower(TG_OP),
    'user_roles',
    v_target::text,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    'rls_allowed',
    jsonb_build_object(
      'actor_user_id', v_actor,
      'target_user_id', v_target,
      'role', COALESCE(NEW.role, OLD.role),
      'operation', TG_OP,
      'result', 'allowed',
      'constraint_result', 'ok',
      'actor_is_super_admin', public.has_role(v_actor, 'super_admin'::app_role)
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_role_change ON public.user_roles;
CREATE TRIGGER trg_audit_user_role_change
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_role_change();

-- 3. Denial monitoring helper
CREATE OR REPLACE FUNCTION public.record_role_management_denial(
  _target_user_id uuid,
  _role text,
  _operation text,
  _reason text,
  _context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_roles text[];
BEGIN
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_actor;
  SELECT COALESCE(array_agg(ur.role::text), '{}') INTO v_roles
    FROM public.user_roles ur WHERE ur.user_id = v_actor;

  INSERT INTO public.access_denials (
    user_id, user_email, user_roles, surface, reason,
    resource_type, attempted_resource, requested_role, required_roles, metadata
  ) VALUES (
    v_actor, v_email, v_roles,
    'role_management:user_roles',
    _reason,
    'table', 'user_roles', _role, ARRAY['super_admin'],
    jsonb_build_object(
      'actor_user_id', v_actor,
      'target_user_id', _target_user_id,
      'role', _role,
      'operation', _operation,
      'result', 'denied'
    ) || COALESCE(_context, '{}'::jsonb)
  );
END;
$$;

-- 4. Governed grant / revoke operations (super admin only)
CREATE OR REPLACE FUNCTION public.admin_assign_role(_target_user_id uuid, _role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_actor, 'super_admin'::app_role) THEN
    PERFORM public.record_role_management_denial(
      _target_user_id, _role::text, 'assign',
      'rls_denied: only super_admin may grant roles', '{}'::jsonb);
    RAISE EXCEPTION 'forbidden: only super_admin may grant roles' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true, 'actor_user_id', v_actor,
    'target_user_id', _target_user_id, 'role', _role::text, 'operation', 'assign');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_target_user_id uuid, _role app_role)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_actor, 'super_admin'::app_role) THEN
    PERFORM public.record_role_management_denial(
      _target_user_id, _role::text, 'revoke',
      'rls_denied: only super_admin may revoke roles', '{}'::jsonb);
    RAISE EXCEPTION 'forbidden: only super_admin may revoke roles' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _role;

  RETURN jsonb_build_object(
    'ok', true, 'actor_user_id', v_actor,
    'target_user_id', _target_user_id, 'role', _role::text, 'operation', 'revoke');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_role_management_denial(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_role_management_denial(uuid, text, text, text, jsonb) TO authenticated;