DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rec_public_apply'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.rec_public_apply not found';
  END IF;

  -- Postgres caps regex repetition counts at 255; {4,300} raised
  -- "invalid regular expression: invalid repetition count(s)".
  IF position('{4,300}' in v_def) = 0 THEN
    RAISE NOTICE 'rec_public_apply already patched';
  ELSE
    EXECUTE replace(v_def, '{4,300}', '{4,255}');
  END IF;
END
$mig$;