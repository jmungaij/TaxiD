CREATE OR REPLACE FUNCTION public.rec_vacancy_prepare_publication(p_vacancy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_body jsonb;
BEGIN
  -- Single-key advisory lock: the two-argument form takes (int,int), not (bigint,bigint).
  PERFORM pg_advisory_xact_lock(hashtextextended('rec_prepare_publication:' || p_vacancy::text, 0));
  v_body := public.rec_vacancy_prepare_publication_body(p_vacancy);
  RETURN v_body;
END;
$fn$;