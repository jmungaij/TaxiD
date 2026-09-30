CREATE OR REPLACE FUNCTION public.certify_phase_8_5_job(_actor uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cert jsonb;
BEGIN
  IF NOT (pg_has_role(session_user, 'service_role', 'member')
          OR session_user IN ('postgres', 'supabase_admin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised',
      'reason', 'Only the backend scheduler may run the job certification.');
  END IF;

  cert := public.certify_phase_8_5();
  IF cert->>'ok' = 'true' AND _actor IS NOT NULL THEN
    UPDATE public.commercial_certification_runs SET run_by = _actor
     WHERE id = (cert->>'run_id')::uuid;
  END IF;
  RETURN cert;
END; $$;

REVOKE ALL ON FUNCTION public.certify_phase_8_5_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.certify_phase_8_5_job(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.certify_phase_8_5_job(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.certify_phase_8_5_job(uuid) TO service_role;