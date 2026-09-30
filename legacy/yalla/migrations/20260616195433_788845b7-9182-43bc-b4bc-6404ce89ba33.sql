
DO $$ BEGIN CREATE TYPE public.noc_incident_status AS ENUM ('open','investigating','identified','monitoring','resolved','postmortem');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.noc_severity AS ENUM ('SEV1','SEV2','SEV3','SEV4','SEV5');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.service_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number TEXT NOT NULL UNIQUE DEFAULT ('INC-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  service_name TEXT NOT NULL,
  title TEXT NOT NULL,
  severity public.noc_severity NOT NULL DEFAULT 'SEV3',
  status public.noc_incident_status NOT NULL DEFAULT 'open',
  impact_summary TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  commander UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  postmortem_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_incidents TO authenticated;
GRANT ALL ON public.service_incidents TO service_role;
ALTER TABLE public.service_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "si_admin_all" ON public.service_incidents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_si_status ON public.service_incidents(status, detected_at DESC);
CREATE INDEX idx_si_service ON public.service_incidents(service_name);

CREATE TABLE public.service_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  metric TEXT NOT NULL,
  threshold NUMERIC,
  observed NUMERIC,
  severity public.noc_severity NOT NULL DEFAULT 'SEV4',
  state TEXT NOT NULL DEFAULT 'firing',
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  incident_id UUID REFERENCES public.service_incidents(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_alerts TO authenticated;
GRANT ALL ON public.service_alerts TO service_role;
ALTER TABLE public.service_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sa_admin_all" ON public.service_alerts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_sa_firing ON public.service_alerts(fired_at DESC) WHERE state = 'firing';

CREATE TABLE public.noc_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  layout JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.noc_dashboards TO authenticated;
GRANT ALL ON public.noc_dashboards TO service_role;
ALTER TABLE public.noc_dashboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nd_admin_all" ON public.noc_dashboards FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.noc_runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  service_name TEXT,
  alert_pattern TEXT,
  content_md TEXT NOT NULL,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.noc_runbooks TO authenticated;
GRANT ALL ON public.noc_runbooks TO service_role;
ALTER TABLE public.noc_runbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nr_admin_all" ON public.noc_runbooks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_nr_service ON public.noc_runbooks(service_name);

CREATE TRIGGER trg_si_updated BEFORE UPDATE ON public.service_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_nd_updated BEFORE UPDATE ON public.noc_dashboards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_nr_updated BEFORE UPDATE ON public.noc_runbooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.service_incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_alerts;
