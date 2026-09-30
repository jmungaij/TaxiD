
-- Threat advisories from continuous intel feeds
CREATE TABLE IF NOT EXISTS public.threat_advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                -- nvd | github | owasp | dependabot | supabase | postgres | iac
  external_id TEXT NOT NULL,           -- CVE-2025-1234, GHSA-xxx, etc.
  title TEXT NOT NULL,
  severity TEXT NOT NULL,              -- critical | high | medium | low
  cvss NUMERIC,
  summary TEXT,
  affected_component TEXT,
  affected_versions TEXT,
  fixed_version TEXT,
  reference_url TEXT,
  published_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  test_scenario_key TEXT NOT NULL,     -- auto-derived key that pen-test suite iterates on
  mitigation_status TEXT NOT NULL DEFAULT 'open', -- open | mitigated | accepted_risk | false_positive
  mitigation_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_threat_advisories_status ON public.threat_advisories(mitigation_status, severity);
CREATE INDEX IF NOT EXISTS idx_threat_advisories_scenario ON public.threat_advisories(test_scenario_key);

GRANT SELECT ON public.threat_advisories TO authenticated;
GRANT ALL ON public.threat_advisories TO service_role;
ALTER TABLE public.threat_advisories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read threat advisories"
  ON public.threat_advisories FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role manages threat advisories"
  ON public.threat_advisories FOR ALL TO service_role USING (true) WITH CHECK (true);

-- MOC incident timeline (alerts, escalations, acks, runbook links)
CREATE TABLE IF NOT EXISTS public.moc_incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES public.incident_nocs(id) ON DELETE CASCADE,
  incident_code TEXT,
  event_type TEXT NOT NULL,   -- alert.sent | alert.delivered | escalation.routed | acknowledged | runbook.linked | mitigation.applied | resolved | note
  actor TEXT,                 -- user email / system / pagerduty / slack
  channel TEXT,               -- slack | email | sms | pagerduty | webhook
  target TEXT,                -- who/where the alert went
  runbook_key TEXT,
  latency_ms INTEGER,
  succeeded BOOLEAN,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moc_events_incident ON public.moc_incident_events(incident_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_moc_events_type ON public.moc_incident_events(event_type, occurred_at DESC);

GRANT SELECT ON public.moc_incident_events TO authenticated;
GRANT ALL ON public.moc_incident_events TO service_role;
ALTER TABLE public.moc_incident_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read moc timeline"
  ON public.moc_incident_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "service role writes moc timeline"
  ON public.moc_incident_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rerun request log so re-running failing modules is auditable and tied to a run
CREATE TABLE IF NOT EXISTS public.assurance_rerun_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.assurance_runs(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id),
  modules TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | dispatched | failed
  dispatch_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  workflow_run_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.assurance_rerun_requests TO authenticated;
GRANT ALL ON public.assurance_rerun_requests TO service_role;
ALTER TABLE public.assurance_rerun_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read rerun requests"
  ON public.assurance_rerun_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins create rerun requests"
  ON public.assurance_rerun_requests FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND requested_by = auth.uid());

CREATE POLICY "service role manages rerun requests"
  ON public.assurance_rerun_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
