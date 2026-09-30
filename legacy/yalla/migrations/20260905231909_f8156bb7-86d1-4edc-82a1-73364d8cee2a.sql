DO $mig$
DECLARE
  d text;
  target text := 'IF NOT v_has_cv THEN
    INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
    VALUES (v_email, v_slug, ''rejected'', ''cv_missing'');
    RAISE EXCEPTION ''a CV document is required'';
  END IF;';
BEGIN
  d := pg_get_functiondef('public.rec_public_apply_core(jsonb)'::regprocedure);
  IF position(target in d) = 0 THEN
    RAISE EXCEPTION 'cv requirement block not found — migration aborted, no change made';
  END IF;
  d := replace(d, target, '-- CV is no longer collected at application stage (documents retired).');
  EXECUTE d;
END $mig$;