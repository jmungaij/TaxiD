DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN (
         'logistics_integration_authorised','logistics_webhook_url_valid',
         'logistics_webhook_endpoint_upsert','logistics_webhook_endpoint_set_status',
         'logistics_webhook_endpoint_rotate_secret','logistics_partner_tenant_grant',
         'logistics_partner_tenant_revoke','logistics_webhook_replay',
         'logistics_integration_endpoints','logistics_integration_overview',
         '_logistics_events_append_only')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    IF f.proname <> '_logistics_events_append_only' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
  END LOOP;
END $$;