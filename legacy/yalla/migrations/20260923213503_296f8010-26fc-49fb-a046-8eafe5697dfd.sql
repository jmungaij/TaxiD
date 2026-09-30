DO $$
DECLARE
  hdr text := $h$jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ','x-internal-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_job_secret'))$h$;
  base text := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/';
BEGIN
  PERFORM cron.alter_job(11, command := format('SELECT net.http_post(url := %L, headers := %s, body := jsonb_build_object(''source'',''cron'',''ts'', now()));', base||'observability-evaluator', hdr));
  PERFORM cron.alter_job(18, command := format('SELECT net.http_post(url := %L, headers := %s, body := jsonb_build_object(''triggered_at'', now()));', base||'corporate-kyb-ack-retry', hdr));
  PERFORM cron.alter_job(37, command := format('SELECT net.http_post(url := %L, headers := %s || jsonb_build_object(''x-scheduled'',''nightly''), body := jsonb_build_object(''scale'',''micro'',''verify_idempotent'',true,''scheduled'',true,''regression_baseline_score'',80));', base||'digital-twin-seed', hdr));
  PERFORM cron.alter_job(41, command := format('SELECT net.http_post(url := %L, headers := %s, body := jsonb_build_object(''scheduled_at'', now()));', base||'callback-certification-run', hdr));
  PERFORM cron.alter_job(57, command := format('SELECT net.http_post(url := %L, headers := %s, body := ''{}''::jsonb);', base||'payment-replay-certifier', hdr));
  PERFORM cron.alter_job(58, command := format('SELECT net.http_post(url := %L, headers := %s, body := ''{}''::jsonb);', base||'payment-confidence-report-builder', hdr));
  PERFORM cron.alter_job(82, command := format('SELECT net.http_post(url := %L, headers := %s, body := jsonb_build_object(''time'', now()));', base||'lineage-refresh', hdr));
END $$;