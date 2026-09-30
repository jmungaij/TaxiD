-- ============================================================
-- 1. Portal transition audit (login redirects + portal switches)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.portal_transition_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_email text,
  kind text NOT NULL CHECK (kind IN ('login_redirect','portal_switch','deep_link')),
  previous_route text,
  new_route text NOT NULL,
  previous_context text,
  new_context text,
  roles text[] NOT NULL DEFAULT '{}',
  remembered boolean NOT NULL DEFAULT false,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.portal_transition_audit TO authenticated;
GRANT ALL ON public.portal_transition_audit TO service_role;
ALTER TABLE public.portal_transition_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pta_admin_read ON public.portal_transition_audit;
CREATE POLICY pta_admin_read ON public.portal_transition_audit
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'compliance_admin'::app_role]));

CREATE INDEX IF NOT EXISTS portal_transition_audit_created_idx
  ON public.portal_transition_audit (created_at DESC);

-- Append-only, server-stamped writer. Clients may never insert directly.
CREATE OR REPLACE FUNCTION public.record_portal_transition(
  _kind text,
  _new_route text,
  _previous_route text DEFAULT NULL,
  _new_context text DEFAULT NULL,
  _previous_context text DEFAULT NULL,
  _remembered boolean DEFAULT false,
  _user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF _kind NOT IN ('login_redirect','portal_switch','deep_link') THEN
    RAISE EXCEPTION 'unsupported transition kind %', _kind;
  END IF;

  INSERT INTO public.portal_transition_audit
    (user_id, actor_email, kind, previous_route, new_route,
     previous_context, new_context, roles, remembered, user_agent)
  SELECT
    _uid,
    (SELECT email FROM auth.users WHERE id = _uid),
    _kind,
    left(coalesce(_previous_route, ''), 300),
    left(_new_route, 300),
    _previous_context,
    _new_context,
    coalesce(ARRAY(SELECT role::text FROM public.user_roles WHERE user_id = _uid), '{}'),
    coalesce(_remembered, false),
    left(coalesce(_user_agent, ''), 400)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_portal_transition(text,text,text,text,text,boolean,text) TO service_role;

-- ============================================================
-- 2. Deployment gate: EXECUTE grants for SECURITY DEFINER
--    functions referenced by RLS policies
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_rls_definer_grants()
RETURNS TABLE (
  function_name text,
  function_args text,
  referenced_by_policies int,
  authenticated_can_execute boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH policy_text AS (
    SELECT lower(coalesce(qual,'') || ' ' || coalesce(with_check,'')) AS expr
    FROM pg_policies
    WHERE schemaname = 'public'
  ),
  definers AS (
    SELECT p.oid, p.proname::text AS name,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  ),
  refs AS (
    SELECT d.oid, d.name, d.args,
           (SELECT count(*) FROM policy_text t WHERE t.expr LIKE '%' || lower(d.name) || '(%')::int AS hits
    FROM definers d
  )
  SELECT r.name, r.args, r.hits,
         has_function_privilege('authenticated', r.oid, 'EXECUTE')
  FROM refs r
  WHERE r.hits > 0
    AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE');
$$;

REVOKE ALL ON FUNCTION public.validate_rls_definer_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_rls_definer_grants() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_rls_definer_grants() TO service_role;

-- Migration-time enforcement: fail the deployment when a policy helper is
-- unreachable by signed-in callers.
DO $$
DECLARE
  _missing text;
BEGIN
  SELECT string_agg(format('%s(%s)', function_name, function_args), ', ')
    INTO _missing
  FROM public.validate_rls_definer_grants();

  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS definer grant gate failed — missing EXECUTE for authenticated on: %', _missing;
  END IF;
END;
$$;

-- ============================================================
-- 3. Schema preconditions for edge functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.assert_table_columns(_spec jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tbl text;
  _col text;
  _missing jsonb := '[]'::jsonb;
BEGIN
  FOR _tbl IN SELECT jsonb_object_keys(_spec) LOOP
    FOR _col IN SELECT jsonb_array_elements_text(_spec -> _tbl) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = _tbl AND column_name = _col
      ) THEN
        _missing := _missing || jsonb_build_object('table', _tbl, 'column', _col);
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(_missing) = 0,
    'missing', _missing,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assert_table_columns(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_table_columns(jsonb) TO service_role;

-- ============================================================
-- 4. RLS public-read regression detector
-- ============================================================
CREATE OR REPLACE FUNCTION public.rls_public_read_violations(_tables text[])
RETURNS TABLE (table_name text, policy_name text, roles text[], expression text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tablename::text, p.policyname::text, p.roles::text[], coalesce(p.qual,'')
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = ANY (_tables)
    AND p.cmd IN ('SELECT','ALL')
    AND ('public' = ANY (p.roles::text[]) OR 'anon' = ANY (p.roles::text[]));
$$;

REVOKE ALL ON FUNCTION public.rls_public_read_violations(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_public_read_violations(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_public_read_violations(text[]) TO service_role;