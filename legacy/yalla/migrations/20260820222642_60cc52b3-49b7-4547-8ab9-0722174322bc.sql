DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.intern_certify_suite()')) INTO d;
  d := replace(d, 'IF NOT public.intern_programme_authority(auth.uid()) THEN',
                  'IF NOT public.intern_certify_authorised() THEN');
  EXECUTE d;
END $mig$;