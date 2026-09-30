
ALTER TABLE public.social_webhook_events
  ADD COLUMN IF NOT EXISTS event_kind text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS variant_id uuid,
  ADD COLUMN IF NOT EXISTS result text NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS social_webhook_events_key_uidx
  ON public.social_webhook_events(provider, event_id);
CREATE INDEX IF NOT EXISTS social_webhook_events_recent_idx
  ON public.social_webhook_events(received_at DESC);

GRANT SELECT ON public.social_webhook_events TO authenticated;
GRANT ALL ON public.social_webhook_events TO service_role;

DROP POLICY IF EXISTS social_webhook_events_staff_read ON public.social_webhook_events;
CREATE POLICY social_webhook_events_staff_read ON public.social_webhook_events
  FOR SELECT TO authenticated USING (public.social_can_edit());

CREATE OR REPLACE FUNCTION public.social_webhook_events_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RAISE EXCEPTION 'social_webhook_events is append-only';
END $fn$;

DROP TRIGGER IF EXISTS social_webhook_events_no_delete ON public.social_webhook_events;
CREATE TRIGGER social_webhook_events_no_delete
  BEFORE DELETE ON public.social_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.social_webhook_events_append_only();

CREATE OR REPLACE FUNCTION public.social_ingest_webhook(
  _platform text,
  _event_key text,
  _payload jsonb,
  _signature_valid boolean,
  _external_id text DEFAULT NULL,
  _status text DEFAULT NULL,
  _metrics jsonb DEFAULT '{}'::jsonb,
  _event_kind text DEFAULT 'UNKNOWN'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v public.social_post_variants;
  inserted uuid;
  m record;
  applied text := 'RECORDED';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'worker_only'; END IF;
  IF coalesce(_event_key,'') = '' THEN RAISE EXCEPTION 'event_key_required'; END IF;

  IF _external_id IS NOT NULL THEN
    SELECT pv.* INTO v FROM public.social_post_variants pv
     WHERE pv.external_post_id = _external_id AND pv.platform_slug = _platform
     ORDER BY pv.updated_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.social_webhook_events(
    provider, event_id, event_kind, signature_valid, external_post_id, variant_id, payload, result, processed_at)
  VALUES (_platform, _event_key, coalesce(_event_kind,'UNKNOWN'), coalesce(_signature_valid,false),
          _external_id, v.id, coalesce(_payload,'{}'::jsonb),
          CASE WHEN coalesce(_signature_valid,false) THEN 'RECEIVED' ELSE 'REJECTED_SIGNATURE' END, now())
  ON CONFLICT (provider, event_id) DO NOTHING
  RETURNING id INTO inserted;

  IF inserted IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'result', 'DUPLICATE');
  END IF;

  IF NOT coalesce(_signature_valid,false) THEN
    RETURN jsonb_build_object('ok', false, 'result', 'REJECTED_SIGNATURE');
  END IF;

  IF v.id IS NOT NULL AND _status IS NOT NULL THEN
    IF _status = 'PUBLISHED' THEN
      UPDATE public.social_post_variants
         SET status = 'PUBLISHED', published_at = coalesce(published_at, now()),
             failure_code = NULL, failure_message = NULL, updated_at = now()
       WHERE id = v.id AND status <> 'PUBLISHED';
      UPDATE public.social_publication_jobs
         SET state = 'PUBLISHED', updated_at = now()
       WHERE variant_id = v.id AND state IN ('PUBLISHING','PLATFORM_ACCEPTED','QUEUED','RETRY_PENDING');
      applied := 'STATUS_PUBLISHED';
    ELSIF _status IN ('FAILED','REJECTED') THEN
      UPDATE public.social_post_variants
         SET status = 'FAILED', failure_code = 'PROVIDER_' || _status,
             failure_message = left(coalesce(_payload::text,''), 1000), updated_at = now()
       WHERE id = v.id;
      UPDATE public.social_publication_jobs
         SET state = 'FAILED_PERMANENTLY', error_code = 'PROVIDER_' || _status, updated_at = now()
       WHERE variant_id = v.id AND state NOT IN ('PUBLISHED','CANCELLED');
      applied := 'STATUS_FAILED';
    END IF;
  END IF;

  IF v.id IS NOT NULL AND _metrics IS NOT NULL AND jsonb_typeof(_metrics) = 'object' THEN
    FOR m IN SELECT key, value FROM jsonb_each(_metrics) LOOP
      IF jsonb_typeof(m.value) = 'number' THEN
        INSERT INTO public.social_post_metrics(variant_id, platform_slug, metric, value, source, captured_at)
        VALUES (v.id, _platform, m.key, (m.value #>> '{}')::numeric, 'WEBHOOK', now());
      END IF;
    END LOOP;
  END IF;

  IF v.id IS NOT NULL THEN
    INSERT INTO public.social_content_events(post_id, variant_id, account_id, action, result, detail)
    VALUES (v.post_id, v.id, v.account_id, 'webhook_' || lower(coalesce(_event_kind,'unknown')), applied,
            jsonb_build_object('external_post_id', _external_id, 'status', _status, 'metrics', _metrics));
  END IF;

  RETURN jsonb_build_object('ok', true, 'result', applied, 'variant_id', v.id);
END $fn$;

REVOKE ALL ON FUNCTION public.social_ingest_webhook(text,text,jsonb,boolean,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.social_ingest_webhook(text,text,jsonb,boolean,text,text,jsonb,text) FROM anon;
REVOKE ALL ON FUNCTION public.social_ingest_webhook(text,text,jsonb,boolean,text,text,jsonb,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.social_ingest_webhook(text,text,jsonb,boolean,text,text,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.social_webhook_health()
RETURNS TABLE(platform_slug text, deliveries bigint, rejected bigint, last_received timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT w.provider, count(*)::bigint,
         count(*) FILTER (WHERE w.result = 'REJECTED_SIGNATURE')::bigint,
         max(w.received_at)
    FROM public.social_webhook_events w
   WHERE public.social_can_edit()
   GROUP BY w.provider
$fn$;

GRANT EXECUTE ON FUNCTION public.social_webhook_health() TO authenticated, service_role;
