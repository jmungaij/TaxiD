
-- 1) SECURITY DEFINER view -> security_invoker
ALTER VIEW public.payment_qualification_streak SET (security_invoker = on);

-- 2) corporate_registration_drafts: remove anon session-key based policies.
--    All client access now flows through the corporate-registration-draft
--    edge function using the service role.
DROP POLICY IF EXISTS "insert own draft" ON public.corporate_registration_drafts;
DROP POLICY IF EXISTS "read own draft"   ON public.corporate_registration_drafts;
DROP POLICY IF EXISTS "update own draft" ON public.corporate_registration_drafts;

-- Preserve the ability for signed-in owners to read their own submitted draft.
CREATE POLICY "Owners can read their own registration drafts"
  ON public.corporate_registration_drafts
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

REVOKE ALL ON public.corporate_registration_drafts FROM anon;

-- 3) Partition child tables: add explicit deny policies for anon/authenticated
--    so direct queries fail closed even if grants are ever added.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'delivery_eta_predictions_202606','delivery_eta_predictions_202607',
    'delivery_eta_predictions_202608','delivery_eta_predictions_202609',
    'delivery_eta_predictions_default',
    'delivery_route_segments_202606','delivery_route_segments_202607',
    'delivery_route_segments_202608','delivery_route_segments_202609',
    'delivery_route_segments_default',
    'event_store_202606','event_store_202607','event_store_default',
    'package_events_202606','package_events_202607','package_events_202608',
    'package_events_202609','package_events_default',
    'package_tracking_202606','package_tracking_202607','package_tracking_202608',
    'package_tracking_202609','package_tracking_default'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "deny direct partition access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "deny direct partition access" ON public.%I
         AS RESTRICTIVE FOR ALL TO anon, authenticated
         USING (false) WITH CHECK (false)', t);
    -- 4) Drop child partitions from the realtime publication (idempotent).
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    EXCEPTION WHEN undefined_object THEN
      NULL; -- not in publication
    END;
  END LOOP;
END $$;
