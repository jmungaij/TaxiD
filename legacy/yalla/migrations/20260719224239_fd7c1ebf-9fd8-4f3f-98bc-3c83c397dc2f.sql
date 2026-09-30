
DO $$
DECLARE
  v_url TEXT := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1';
  v_anon TEXT := current_setting('app.settings.anon_key', true);
BEGIN
  PERFORM cron.unschedule('payment-qualification-rerun-worker') WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='payment-qualification-rerun-worker');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'payment-qualification-rerun-worker',
  '*/2 * * * *',
  $$SELECT net.http_post(
      url:='https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/payment-qualification-rerun-worker',
      headers:=jsonb_build_object('Content-Type','application/json'),
      body:='{}'::jsonb
    );$$
);

SELECT cron.schedule(
  'payment-forecast-accuracy',
  '15 * * * *',
  $$SELECT net.http_post(
      url:='https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/payment-forecast-accuracy',
      headers:=jsonb_build_object('Content-Type','application/json'),
      body:='{}'::jsonb
    );$$
);
