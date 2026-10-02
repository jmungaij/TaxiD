CREATE OR REPLACE FUNCTION public.payout_disbursement_mark_unknown(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := (p->>'disbursement_id')::uuid;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  UPDATE public.payout_disbursements
     SET state = 'UNKNOWN', failure_reason = coalesce(p->>'reason','provider state unknown after submission')
   WHERE id = v_id AND state IN ('DRAFT','INITIATED','PROCESSING');
  RETURN jsonb_build_object('ok', true, 'state','UNKNOWN');
END $$;
REVOKE ALL ON FUNCTION public.payout_disbursement_mark_unknown(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_mark_unknown(jsonb) TO service_role;