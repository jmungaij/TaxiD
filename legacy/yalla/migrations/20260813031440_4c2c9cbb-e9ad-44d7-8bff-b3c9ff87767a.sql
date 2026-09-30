DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rec_public_apply'
  LIMIT 1;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.rec_public_apply not found';
  END IF;

  v_new := regexp_replace(
    v_def,
    'IF nullif\(trim\(p_payload->>''(linkedin|portfolio)_url''\),''''\) IS NOT NULL.*?END IF;',
    '',
    'gs'
  );

  IF v_new = v_def THEN
    RAISE NOTICE 'no link validation found in rec_public_apply';
  ELSE
    EXECUTE v_new;
  END IF;
END
$mig$;