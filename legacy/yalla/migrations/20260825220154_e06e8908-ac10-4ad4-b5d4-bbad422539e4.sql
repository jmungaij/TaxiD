-- 1. Re-arm the rec-comm-worker cron jobs with the internal-caller secret so
--    the new requireInternalCaller guard admits the scheduler (and nobody else).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'internal_job_secret') THEN
    RAISE EXCEPTION 'vault secret internal_job_secret is missing — cron would be locked out';
  END IF;
END $$;

SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('rec-comm-generate-2m','rec-comm-dispatch-2m','rec-comm-reconcile-15m');

SELECT cron.schedule(
  'rec-comm-generate-2m', '*/2 * * * *',
  $$select public.invoke_scheduled_function(
      'rec-comm-generate-2m', 'rec-comm-worker',
      'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/rec-comm-worker',
      jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ',
        'x-internal-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_job_secret')
      ),
      jsonb_build_object('action','generate','limit',15)
    );$$
);

SELECT cron.schedule(
  'rec-comm-dispatch-2m', '1-59/2 * * * *',
  $$select public.invoke_scheduled_function(
      'rec-comm-dispatch-2m', 'rec-comm-worker',
      'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/rec-comm-worker',
      jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ',
        'x-internal-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_job_secret')
      ),
      jsonb_build_object('action','dispatch','limit',15)
    );$$
);

SELECT cron.schedule(
  'rec-comm-reconcile-15m', '*/15 * * * *',
  $$select public.invoke_scheduled_function(
      'rec-comm-reconcile-15m', 'rec-comm-worker',
      'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/rec-comm-worker',
      jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ',
        'x-internal-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_job_secret')
      ),
      jsonb_build_object('action','reconcile','limit',50)
    );$$
);

-- 2. Pin search_path on the five internal functions flagged by the linter
--    (append-only audit triggers + the M-Pesa status mapper). Logic unchanged.
ALTER FUNCTION public._canonical_to_mpesa_status(public.payment_state) SET search_path = public, pg_catalog;
ALTER FUNCTION public.charter_wallet_finance_actions_append_only() SET search_path = public, pg_catalog;
ALTER FUNCTION public.enforce_append_only() SET search_path = public, pg_catalog;
ALTER FUNCTION public.pq_evidence_pack_immutable() SET search_path = public, pg_catalog;
ALTER FUNCTION public.tg_dlq_actions_append_only() SET search_path = public, pg_catalog;