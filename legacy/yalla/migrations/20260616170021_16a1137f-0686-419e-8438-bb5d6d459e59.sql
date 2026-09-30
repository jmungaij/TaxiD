
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.oid::regclass::text AS qname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname IN ('package_events','package_tracking','delivery_route_segments','delivery_eta_predictions')
      AND p.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rec.qname);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rec.qname);
  END LOOP;
END $$;
