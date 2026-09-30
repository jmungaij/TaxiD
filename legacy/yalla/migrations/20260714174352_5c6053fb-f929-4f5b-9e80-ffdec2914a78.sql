
DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT format('public.%I', c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='v' AND n.nspname='public'
  LOOP
    EXECUTE format('ALTER VIEW %s SET (security_invoker = on)', v);
  END LOOP;
END $$;

DO $$
DECLARE t text;
DECLARE parts text[] := ARRAY[
  'delivery_eta_predictions_202606','delivery_eta_predictions_202607',
  'delivery_eta_predictions_202608','delivery_eta_predictions_202609','delivery_eta_predictions_default',
  'delivery_route_segments_202606','delivery_route_segments_202607',
  'delivery_route_segments_202608','delivery_route_segments_202609','delivery_route_segments_default',
  'location_history_202606','location_history_202607','location_history_202608',
  'package_events_202606','package_events_202607','package_events_202608',
  'package_events_202609','package_events_default',
  'package_tracking_202606','package_tracking_202607','package_tracking_202608',
  'package_tracking_202609','package_tracking_default'
];
BEGIN
  FOREACH t IN ARRAY parts LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_service_all" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_service_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;
