-- Scheduled worker triggers for the recruitment letter engine.
-- Three separately-scheduled stages so a slow render never blocks reconciliation.
select cron.unschedule(jobname) from cron.job
 where jobname in ('rec-comm-generate-2m','rec-comm-dispatch-2m','rec-comm-reconcile-15m');

select cron.schedule(
  'rec-comm-generate-2m', '*/2 * * * *',
  $$select public.invoke_scheduled_function(
      'rec-comm-generate-2m', 'rec-comm-worker',
      'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/rec-comm-worker',
      jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ'
      ),
      jsonb_build_object('action','generate','limit',15)
    );$$
);

select cron.schedule(
  'rec-comm-dispatch-2m', '1-59/2 * * * *',
  $$select public.invoke_scheduled_function(
      'rec-comm-dispatch-2m', 'rec-comm-worker',
      'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/rec-comm-worker',
      jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ'
      ),
      jsonb_build_object('action','dispatch','limit',15)
    );$$
);

select cron.schedule(
  'rec-comm-reconcile-15m', '*/15 * * * *',
  $$select public.invoke_scheduled_function(
      'rec-comm-reconcile-15m', 'rec-comm-worker',
      'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/rec-comm-worker',
      jsonb_build_object(
        'Content-Type','application/json',
        'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ'
      ),
      jsonb_build_object('action','reconcile','limit',50)
    );$$
);