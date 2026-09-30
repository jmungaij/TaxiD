-- Self-test the grant guard with a throwaway overload, then remove it.
CREATE FUNCTION public.has_any_role(_user_id uuid, _probe text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT false $$;

DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.has_any_role(uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.has_any_role(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'grant guard did not apply EXECUTE to new has_any_role overload';
  END IF;
END $$;

DROP FUNCTION public.has_any_role(uuid, text);