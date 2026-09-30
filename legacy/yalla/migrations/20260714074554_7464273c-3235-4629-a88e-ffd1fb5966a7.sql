
DO $$
DECLARE
  t text;
  sensitive text[] := ARRAY[
    'account_takeover_alerts','blocked_ips','command_denials','authorization_decisions',
    'admin_login_events','delivery_fraud_signals','executive_alerts','executive_metrics',
    'financial_risk_events','fraud_alerts','package_tamper_alerts','payment_fraud_cases',
    'phishing_reports','privacy_requests','reconciliation_cases','reconciliation_case_activities',
    'reconciliation_evidence','safety_alerts','suspicious_transactions','trust_cases',
    'trust_incidents','wallet_freezes','service_incidents',
    'location_integrity_events','corporate_financial_reconciliation'
  ];
BEGIN
  FOREACH t IN ARRAY sensitive LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END$$;

DO $$
DECLARE fn text; args text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['enqueue_email','read_email_batch','delete_email','move_to_dlq'] LOOP
    SELECT pg_get_function_identity_arguments(p.oid) INTO args
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=fn AND p.prosecdef LIMIT 1;
    IF args IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public', fn, args);
    END IF;
  END LOOP;
END$$;

DROP POLICY IF EXISTS "Own create share" ON public.trip_share_links;
CREATE POLICY "Authenticated users create own share"
  ON public.trip_share_links
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.notify_forbidden_update_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count int;
BEGIN
  SELECT count(*) INTO recent_count
    FROM public.forbidden_update_attempts
    WHERE actor_user_id = NEW.actor_user_id
      AND occurred_at > now() - interval '10 minutes';

  IF recent_count >= 5 THEN
    INSERT INTO public.alerts_events(
      rule_name, stream, metric_key, observed_value, severity, message, context, channels_dispatched
    ) VALUES (
      'forbidden_update_anomaly', 'security', 'forbidden_updates_10m',
      recent_count, 'critical',
      format('User %s attempted %s forbidden updates on %s in 10m', NEW.actor_user_id, recent_count, NEW.target_table),
      jsonb_build_object('actor', NEW.actor_user_id, 'table', NEW.target_table, 'reason', NEW.reason),
      ARRAY['toast','email']::text[]
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_forbidden_update_email ON public.forbidden_update_attempts;
CREATE TRIGGER trg_notify_forbidden_update_email
  AFTER INSERT ON public.forbidden_update_attempts
  FOR EACH ROW EXECUTE FUNCTION public.notify_forbidden_update_email();

CREATE OR REPLACE VIEW public.v_privileged_update_metrics AS
SELECT
  date_trunc('hour', a.ts) AS bucket,
  a.target_table,
  ur.role,
  count(*) FILTER (WHERE a.source = 'success') AS successes,
  count(*) FILTER (WHERE a.source = 'forbidden') AS forbidden
FROM (
  SELECT actor_user_id, target_table, occurred_at AS ts, 'success'::text AS source FROM public.privileged_update_audit
  UNION ALL
  SELECT actor_user_id, target_table, occurred_at AS ts, 'forbidden'::text FROM public.forbidden_update_attempts
) a
LEFT JOIN LATERAL (
  SELECT string_agg(role::text, ',') AS role FROM public.user_roles WHERE user_id = a.actor_user_id
) ur ON true
GROUP BY 1,2,3;

GRANT SELECT ON public.v_privileged_update_metrics TO authenticated, service_role;
