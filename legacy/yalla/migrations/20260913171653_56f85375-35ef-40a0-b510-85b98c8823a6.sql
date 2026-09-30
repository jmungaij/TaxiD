CREATE OR REPLACE FUNCTION public.comms_is_my_verified_email(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.email_confirmed_at IS NOT NULL
      AND lower(u.email) = lower(coalesce(_email, ''))
  )
$$;

REVOKE ALL ON FUNCTION public.comms_is_my_verified_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comms_is_my_verified_email(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users manage their own email category preferences" ON public.email_category_prefs;
CREATE POLICY "Users manage their own email category preferences"
ON public.email_category_prefs
FOR ALL
TO authenticated
USING (public.comms_is_my_verified_email(email))
WITH CHECK (public.comms_is_my_verified_email(email));

CREATE OR REPLACE FUNCTION public.comms_set_category_preference(p_category text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT lower(u.email) INTO v_email
  FROM auth.users u
  WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_not_verified');
  END IF;

  IF p_category NOT IN ('operational','marketing','reports','internal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'category_is_mandatory_or_unknown');
  END IF;

  INSERT INTO public.email_category_prefs (email, category, enabled, updated_by)
  VALUES (v_email, p_category, p_enabled, auth.uid())
  ON CONFLICT (email, category)
  DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'email', v_email, 'category', p_category, 'enabled', p_enabled);
END;
$function$;