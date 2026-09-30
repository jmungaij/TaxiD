
ALTER FUNCTION public._block_payment_audit_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.deny_ledger_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.driver_classify_regime(bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_corp_touch_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_corporate_paybill_proofs() SET search_path = public, pg_temp;

DO $$
DECLARE r record; sig text;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true
  LOOP
    sig := format('public.%I(%s)', r.proname, r.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

DO $$
DECLARE allowed_name text; sig text;
DECLARE allow text[] := ARRAY[
  'has_role','has_any_role','has_capability','has_corporate_role',
  'is_corp_or_finance','is_corporate_member','is_corporate_manager_or_admin',
  'is_alert_muted','current_user_corporates',
  'approval_decide','approval_request_create',
  'trip_quote_fare','trip_confirm_booking','trip_cancel_booking',
  'safety_raise_sos',
  'training_enroll','training_complete_lesson','training_record_video_watch',
  'training_submit_assessment','training_issue_certificate','training_verify_certificate',
  'training_current_driver_id','training_driver_summary',
  'issue_trip_share_token','revoke_trip_share_token','regenerate_trip_share_token',
  'validate_expense_code_for_ride','evaluate_corporate_ride_policy',
  'budget_reserve','budget_release','budget_consume',
  'corporate_tentative_bill_summary','driver_leaderboard_public',
  'assert_activation_training_complete'
];
BEGIN
  FOREACH allowed_name IN ARRAY allow LOOP
    FOR sig IN
      SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname = allowed_name
    LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE sig text;
BEGIN
  FOR sig IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('redeem_trip_share_token','track_package_public','driver_leaderboard_public','verify_kyb_rescan_cron_secret')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "service writes wallet txns" ON public.wallet_transactions;
CREATE POLICY "service_role writes wallet txns" ON public.wallet_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service writes mpesa txns" ON public.mpesa_transactions;
CREATE POLICY "service_role writes mpesa txns" ON public.mpesa_transactions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages mpesa rate buckets" ON public.mpesa_rate_limit_buckets;
CREATE POLICY "service_role manages mpesa rate buckets" ON public.mpesa_rate_limit_buckets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authz insert auth" ON public.authorization_decisions;
CREATE POLICY "authz insert service" ON public.authorization_decisions
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service writes realtime audit" ON public.realtime_subscription_audit;
CREATE POLICY "realtime audit insert service" ON public.realtime_subscription_audit
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Fraud signals system insert" ON public.delivery_fraud_signals;
CREATE POLICY "delivery fraud signals insert service" ON public.delivery_fraud_signals
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can log analytics" ON public.driver_analytics_events;
CREATE POLICY "driver analytics insert authenticated"
  ON public.driver_analytics_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "corp_viol_insert" ON public.corporate_policy_violations;
CREATE POLICY "corp_viol_insert_service" ON public.corporate_policy_violations
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "corp_audit_insert" ON public.corporate_policy_audit_log;
CREATE POLICY "corp_audit_insert_service" ON public.corporate_policy_audit_log
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "event_store_part_insert_auth" ON public.event_store_202606;
CREATE POLICY "event_store_part_insert_service" ON public.event_store_202606
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "event_store_part_insert_auth" ON public.event_store_202607;
CREATE POLICY "event_store_part_insert_service" ON public.event_store_202607
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "event_store_part_insert_auth" ON public.event_store_default;
CREATE POLICY "event_store_part_insert_service" ON public.event_store_default
  FOR INSERT TO service_role WITH CHECK (true);

-- Public form submissions: least-privilege predicates
DROP POLICY IF EXISTS "Anyone can submit contact form" ON public.contact_submissions;
CREATE POLICY "public can submit contact form" ON public.contact_submissions
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    email IS NOT NULL AND length(email) BETWEEN 3 AND 320
    AND name IS NOT NULL AND length(name) BETWEEN 1 AND 200
    AND length(message) BETWEEN 1 AND 5000
  );

DROP POLICY IF EXISTS "Anyone can insert CTA events" ON public.cta_events;
CREATE POLICY "public can insert CTA events" ON public.cta_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    button_name IS NOT NULL AND length(button_name) BETWEEN 1 AND 200
    AND action_type IS NOT NULL AND length(action_type) BETWEEN 1 AND 100
  );

DROP POLICY IF EXISTS "pr_anon_insert" ON public.phishing_reports;
CREATE POLICY "phishing anon report" ON public.phishing_reports
  FOR INSERT TO anon
  WITH CHECK (
    channel IS NOT NULL AND artifact_type IS NOT NULL
    AND artifact_value IS NOT NULL AND length(artifact_value) BETWEEN 1 AND 4096
  );

DROP POLICY IF EXISTS "pr_user_insert" ON public.phishing_reports;
CREATE POLICY "phishing user report" ON public.phishing_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    channel IS NOT NULL AND artifact_type IS NOT NULL
    AND artifact_value IS NOT NULL AND length(artifact_value) BETWEEN 1 AND 4096
  );

DROP POLICY IF EXISTS "pq_anon_insert" ON public.privacy_requests;
CREATE POLICY "privacy anon request" ON public.privacy_requests
  FOR INSERT TO anon
  WITH CHECK (requester_email IS NOT NULL AND length(requester_email) BETWEEN 3 AND 320);

DROP POLICY IF EXISTS "pq_user_insert" ON public.privacy_requests;
CREATE POLICY "privacy user request" ON public.privacy_requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_email IS NOT NULL);

-- Strip sensitive tables from supabase_realtime
DO $$
DECLARE t text;
DECLARE sensitive text[] := ARRAY[
  'driver_locations','trip_tracking','trip_bookings','trip_status_history',
  'dispatch_requests','dispatch_assignments','dispatch_candidates','dispatch_surge_zones',
  'delivery_route_segments_202606','delivery_route_segments_202607',
  'delivery_route_segments_202608','delivery_route_segments_202609','delivery_route_segments_default',
  'delivery_eta_predictions_202606','delivery_eta_predictions_202607',
  'delivery_eta_predictions_202608','delivery_eta_predictions_202609','delivery_eta_predictions_default',
  'package_tracking_202606','package_tracking_202607','package_tracking_202608',
  'package_tracking_202609','package_tracking_default',
  'event_store_202606','event_store_202607','event_store_default',
  'alerts_events','operations_events','document_review_sla',
  'service_alerts','system_health_events','corporate_document_notifications'
];
BEGIN
  FOREACH t IN ARRAY sensitive LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;
