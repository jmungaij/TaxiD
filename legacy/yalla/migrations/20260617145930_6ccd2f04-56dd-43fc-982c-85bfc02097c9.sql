
-- Executive alert rules (configurable thresholds & anomaly triggers)
CREATE TABLE public.executive_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  stream text NOT NULL CHECK (stream IN ('trip','driver','finance')),
  metric_key text NOT NULL,
  operator text NOT NULL CHECK (operator IN ('gt','gte','lt','lte','eq','anomaly')),
  threshold numeric,
  window_seconds integer NOT NULL DEFAULT 300,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  enabled boolean NOT NULL DEFAULT true,
  notify_toast boolean NOT NULL DEFAULT true,
  cooldown_seconds integer NOT NULL DEFAULT 60,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.executive_alert_rules TO authenticated;
GRANT ALL ON public.executive_alert_rules TO service_role;
ALTER TABLE public.executive_alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage alert rules" ON public.executive_alert_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Alerts events (immutable firing history)
CREATE TABLE public.alerts_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.executive_alert_rules(id) ON DELETE SET NULL,
  rule_name text NOT NULL,
  stream text NOT NULL,
  metric_key text NOT NULL,
  observed_value numeric,
  threshold numeric,
  operator text,
  severity text NOT NULL,
  message text NOT NULL,
  triggered_by uuid REFERENCES auth.users(id),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.alerts_events TO authenticated;
GRANT ALL ON public.alerts_events TO service_role;
ALTER TABLE public.alerts_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins view alert events" ON public.alerts_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "authenticated insert alert events" ON public.alerts_events
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admins ack alert events" ON public.alerts_events
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_alerts_events_created ON public.alerts_events (created_at DESC);
CREATE INDEX idx_alerts_events_rule ON public.alerts_events (rule_id, created_at DESC);

-- Document review SLA tracking
CREATE TABLE public.document_review_sla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.document_review_actions(id) ON DELETE CASCADE,
  queue_id uuid,
  assigned_to uuid REFERENCES auth.users(id),
  sla_minutes integer NOT NULL DEFAULT 60,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','overdue','escalated')),
  escalation_level integer NOT NULL DEFAULT 0,
  last_escalated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(action_id)
);
GRANT SELECT, INSERT, UPDATE ON public.document_review_sla TO authenticated;
GRANT ALL ON public.document_review_sla TO service_role;
ALTER TABLE public.document_review_sla ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage doc sla" ON public.document_review_sla
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_doc_sla_due ON public.document_review_sla (status, due_at);

-- Append-only escalation audit log (hash-chained via existing trigger pattern)
CREATE TABLE public.document_review_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_id uuid NOT NULL REFERENCES public.document_review_sla(id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  escalation_level integer NOT NULL,
  reason text NOT NULL,
  escalated_to uuid REFERENCES auth.users(id),
  triggered_by text NOT NULL DEFAULT 'system',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash text,
  record_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.document_review_escalations TO authenticated;
REVOKE UPDATE, DELETE ON public.document_review_escalations FROM authenticated;
GRANT ALL ON public.document_review_escalations TO service_role;
ALTER TABLE public.document_review_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins view escalations" ON public.document_review_escalations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "service inserts escalations" ON public.document_review_escalations
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_doc_escalations_sla ON public.document_review_escalations (sla_id, created_at DESC);

-- Hash-chain trigger reuse (if tg_hash_chain exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='tg_hash_chain') THEN
    EXECUTE 'CREATE TRIGGER trg_doc_escalations_hash BEFORE INSERT ON public.document_review_escalations FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain()';
  END IF;
END$$;

-- Function: escalate overdue SLAs
CREATE OR REPLACE FUNCTION public.escalate_overdue_document_slas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.document_review_sla
    WHERE status IN ('pending','overdue')
      AND due_at < now()
      AND (last_escalated_at IS NULL OR last_escalated_at < now() - interval '15 minutes')
  LOOP
    UPDATE public.document_review_sla
      SET status='escalated',
          escalation_level = r.escalation_level + 1,
          last_escalated_at = now(),
          updated_at = now()
      WHERE id = r.id;

    INSERT INTO public.document_review_escalations
      (sla_id, action_id, escalation_level, reason, triggered_by, payload)
    VALUES
      (r.id, r.action_id, r.escalation_level + 1,
       'SLA breached: due ' || r.due_at::text, 'timer',
       jsonb_build_object('sla_minutes', r.sla_minutes, 'assigned_to', r.assigned_to));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Auto-create SLA row when a document_review_actions row is inserted
CREATE OR REPLACE FUNCTION public.tg_create_doc_review_sla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.document_review_sla (action_id, sla_minutes, due_at)
  VALUES (NEW.id, 60, now() + interval '60 minutes')
  ON CONFLICT (action_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doc_review_actions_sla ON public.document_review_actions;
CREATE TRIGGER trg_doc_review_actions_sla
  AFTER INSERT ON public.document_review_actions
  FOR EACH ROW EXECUTE FUNCTION public.tg_create_doc_review_sla();

-- Event subscription health
CREATE TABLE public.event_subscription_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream text NOT NULL,
  channel_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('connected','disconnected','error','timeout','reconnecting')),
  last_event_at timestamptz,
  last_error text,
  latency_ms integer,
  user_id uuid REFERENCES auth.users(id),
  session_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.event_subscription_health TO authenticated;
GRANT ALL ON public.event_subscription_health TO service_role;
ALTER TABLE public.event_subscription_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins view sub health" ON public.event_subscription_health
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "authenticated insert sub health" ON public.event_subscription_health
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE INDEX idx_sub_health_stream ON public.event_subscription_health (stream, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_alert_rules_updated BEFORE UPDATE ON public.executive_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_doc_sla_updated BEFORE UPDATE ON public.document_review_sla
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.document_review_sla;
