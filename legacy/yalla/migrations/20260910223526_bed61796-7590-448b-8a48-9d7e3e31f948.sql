-- Selected finding: contact_submissions_pii_public_insert
DROP POLICY IF EXISTS "public can submit contact form" ON public.contact_submissions;
DROP POLICY IF EXISTS "Anyone can submit contact form" ON public.contact_submissions;
REVOKE INSERT ON public.contact_submissions FROM anon, authenticated;
GRANT INSERT ON public.contact_submissions TO service_role;

-- Selected finding: cta_events_public_insert_abuse
DROP POLICY IF EXISTS "public can insert CTA events" ON public.cta_events;
DROP POLICY IF EXISTS "Anyone can insert CTA events" ON public.cta_events;
REVOKE INSERT ON public.cta_events FROM anon, authenticated;
GRANT INSERT ON public.cta_events TO service_role;

-- Selected finding: realtime_tracking_tables_broad_publish
DO $$
DECLARE
  t text;
  sensitive_tracking text[] := ARRAY[
    'driver_locations',
    'trip_tracking',
    'package_tracking',
    'delivery_route_segments',
    'delivery_eta_predictions'
  ];
BEGIN
  FOREACH t IN ARRAY sensitive_tracking LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_publication p ON p.oid = pr.prpubid
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.pubname = 'supabase_realtime'
        AND n.nspname = 'public'
        AND c.relname = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;