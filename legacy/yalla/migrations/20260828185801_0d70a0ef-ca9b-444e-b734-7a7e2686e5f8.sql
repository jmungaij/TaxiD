INSERT INTO public.logistics_event_catalogue (event_type, aggregate_type, event_version, schema_version, description, payload_keys, ordinal, publishable)
SELECT 'logistics.control_tower.command_executed', t.agg, 1, 1,
       'An authorised operator command was executed from the logistics Control Tower.',
       ARRAY['operation','result']::text[],
       (SELECT coalesce(max(ordinal),0) FROM public.logistics_event_catalogue) + row_number() OVER (ORDER BY t.agg),
       false
FROM (VALUES ('route'),('package'),('route_stop'),('logistics_exception'),('control_tower')) AS t(agg)
ON CONFLICT DO NOTHING;