
-- D6.5: Certification governance recovery job
CREATE OR REPLACE FUNCTION public.driver_withdrawal_certification_recover(_max_batch int DEFAULT 25)
RETURNS TABLE(payout_id uuid, verdict boolean, score int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  cert jsonb;
BEGIN
  FOR r IN
    SELECT p.id
    FROM public.driver_payouts p
    LEFT JOIN LATERAL (
      SELECT passed FROM public.driver_withdrawal_certifications c
      WHERE c.payout_id = p.id ORDER BY created_at DESC LIMIT 1
    ) last ON true
    WHERE p.created_at > now() - interval '7 days'
      AND (last.passed IS NULL OR last.passed = false)
      AND (
        SELECT count(*) FROM public.driver_withdrawal_certifications c2
        WHERE c2.payout_id = p.id
      ) < 5
    ORDER BY p.created_at DESC
    LIMIT _max_batch
  LOOP
    BEGIN
      cert := public.certify_driver_withdrawal(r.id);
      payout_id := r.id;
      verdict := COALESCE((cert->>'passed')::boolean, false);
      score := COALESCE((cert->>'score')::int, 0);
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- swallow so batch continues; recovery is idempotent and retried on cron
      CONTINUE;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_withdrawal_certification_recover(int) FROM public;
GRANT EXECUTE ON FUNCTION public.driver_withdrawal_certification_recover(int) TO service_role;
