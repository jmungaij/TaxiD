-- ============================================================================
-- Yalla Communications Engine — deliverability, idempotency and forensic ledger
-- ============================================================================

-- 1. Event dispatch claims: one business event → at most one outbound email.
CREATE TABLE IF NOT EXISTS public.email_event_dispatch (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_key TEXT,
  recipient_email TEXT NOT NULL,
  message_id TEXT NOT NULL,
  correlation_id TEXT,
  replay_count INTEGER NOT NULL DEFAULT 0,
  last_replay_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_event_dispatch TO authenticated;
GRANT ALL ON public.email_event_dispatch TO service_role;
ALTER TABLE public.email_event_dispatch ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email dispatch claims"
  ON public.email_event_dispatch FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::public.app_role[]));

-- Atomic claim: returns claimed=false and the original message_id on replay.
CREATE OR REPLACE FUNCTION public.comms_claim_dispatch(
  p_idempotency_key TEXT,
  p_event_key TEXT,
  p_recipient TEXT,
  p_message_id TEXT,
  p_correlation_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.email_event_dispatch;
BEGIN
  INSERT INTO public.email_event_dispatch (idempotency_key, event_key, recipient_email, message_id, correlation_id)
  VALUES (p_idempotency_key, p_event_key, lower(p_recipient), p_message_id, p_correlation_id)
  ON CONFLICT (idempotency_key) DO NOTHING;

  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true, 'message_id', p_message_id);
  END IF;

  UPDATE public.email_event_dispatch
     SET replay_count = replay_count + 1, last_replay_at = now()
   WHERE idempotency_key = p_idempotency_key
  RETURNING * INTO v_existing;

  RETURN jsonb_build_object(
    'claimed', false,
    'message_id', v_existing.message_id,
    'replay_count', v_existing.replay_count,
    'first_seen', v_existing.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.comms_claim_dispatch(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comms_claim_dispatch(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 2. Forensic provider event ledger (bounces, complaints, deliveries, opens).
CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'smtp2go',
  event_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  message_id TEXT,
  provider_message_id TEXT,
  bounce_type TEXT,
  reason TEXT,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  source_ip TEXT,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (provider, event_type, recipient_email, payload_sha256)
);

GRANT SELECT ON public.email_delivery_events TO authenticated;
GRANT ALL ON public.email_delivery_events TO service_role;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read email delivery events"
  ON public.email_delivery_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::public.app_role[]));

CREATE INDEX IF NOT EXISTS email_delivery_events_recipient_idx ON public.email_delivery_events (recipient_email, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_delivery_events_type_idx ON public.email_delivery_events (event_type, occurred_at DESC);

-- Append-only: provider evidence is never edited or deleted.
CREATE OR REPLACE FUNCTION public.email_delivery_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'email_delivery_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS email_delivery_events_immutable ON public.email_delivery_events;
CREATE TRIGGER email_delivery_events_immutable
  BEFORE UPDATE OR DELETE ON public.email_delivery_events
  FOR EACH ROW EXECUTE FUNCTION public.email_delivery_events_append_only();

-- 3. Domain authentication readiness snapshots (SPF / DKIM / DMARC).
CREATE TABLE IF NOT EXISTS public.email_domain_auth_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  spf_present BOOLEAN NOT NULL DEFAULT false,
  spf_record TEXT,
  dkim_present BOOLEAN NOT NULL DEFAULT false,
  dkim_selector TEXT,
  dmarc_present BOOLEAN NOT NULL DEFAULT false,
  dmarc_policy TEXT,
  mx_present BOOLEAN NOT NULL DEFAULT false,
  readiness_score INTEGER NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_domain_auth_checks TO authenticated;
GRANT ALL ON public.email_domain_auth_checks TO service_role;
ALTER TABLE public.email_domain_auth_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read domain auth checks"
  ON public.email_domain_auth_checks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::public.app_role[]));

CREATE INDEX IF NOT EXISTS email_domain_auth_checks_domain_idx ON public.email_domain_auth_checks (domain, checked_at DESC);

-- 4. Deliverability statistics — deduplicated by message_id, admin only.
CREATE OR REPLACE FUNCTION public.email_deliverability_daily(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  day DATE,
  total BIGINT,
  sent BIGINT,
  failed BIGINT,
  dlq BIGINT,
  bounced BIGINT,
  complained BIGINT,
  suppressed BIGINT,
  bounce_rate NUMERIC,
  complaint_rate NUMERIC,
  delivery_rate NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (coalesce(l.message_id, l.id::text))
           coalesce(l.message_id, l.id::text) AS mid, l.status, l.created_at
      FROM public.email_send_log l
     WHERE l.created_at >= now() - make_interval(days => greatest(p_days, 1))
     ORDER BY coalesce(l.message_id, l.id::text), l.created_at DESC
  )
  SELECT (latest.created_at)::date AS day,
         count(*)::bigint,
         count(*) FILTER (WHERE latest.status IN ('sent','delivered'))::bigint,
         count(*) FILTER (WHERE latest.status = 'failed')::bigint,
         count(*) FILTER (WHERE latest.status = 'dlq')::bigint,
         count(*) FILTER (WHERE latest.status = 'bounced')::bigint,
         count(*) FILTER (WHERE latest.status = 'complained')::bigint,
         count(*) FILTER (WHERE latest.status = 'suppressed')::bigint,
         round(100.0 * count(*) FILTER (WHERE latest.status = 'bounced') / greatest(count(*), 1), 2),
         round(100.0 * count(*) FILTER (WHERE latest.status = 'complained') / greatest(count(*), 1), 2),
         round(100.0 * count(*) FILTER (WHERE latest.status IN ('sent','delivered')) / greatest(count(*), 1), 2)
    FROM latest
   GROUP BY 1
   ORDER BY 1 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.email_deliverability_daily(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_deliverability_daily(INTEGER) TO authenticated, service_role;

-- 5. Self-service recipient preferences (own email only, optional categories).
CREATE OR REPLACE FUNCTION public.comms_set_category_preference(
  p_category TEXT,
  p_enabled BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(coalesce(auth.jwt() ->> 'email', ''));
BEGIN
  IF v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_category NOT IN ('operational','marketing','reports','internal') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'category_is_mandatory_or_unknown');
  END IF;

  INSERT INTO public.email_category_prefs (email, category, enabled, updated_by)
  VALUES (v_email, p_category, p_enabled, auth.uid())
  ON CONFLICT (email, category)
  DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'email', v_email, 'category', p_category, 'enabled', p_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.comms_set_category_preference(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comms_set_category_preference(TEXT, BOOLEAN) TO authenticated, service_role;