CREATE OR REPLACE FUNCTION public.classify_lineage_pending(_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE tx record; scanned int := 0; pend int := 0;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_trusted_backend_job()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  FOR tx IN SELECT id FROM commercial_transactions
             WHERE fulfilled_at IS NULL AND cancelled_at IS NULL
             ORDER BY created_at LIMIT _limit LOOP
    scanned := scanned + 1;
    WITH upd AS (
      UPDATE commercial_lineage_stages
         SET status = 'pending',
             source = 'lineage_applicability',
             evidence = COALESCE(evidence,'{}'::jsonb) || jsonb_build_object('reason',
               'Booking is still in flight: this step has not been reached yet, so no record exists to point at.'),
             updated_at = now()
       WHERE transaction_id = tx.id AND status = 'missing' AND stage_no >= 6
      RETURNING 1)
    SELECT pend + count(*) INTO pend FROM upd;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', scanned, 'stages_pending', pend);
END; $$;

REVOKE ALL ON FUNCTION public.classify_lineage_pending(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.classify_lineage_pending(integer) TO authenticated, service_role;