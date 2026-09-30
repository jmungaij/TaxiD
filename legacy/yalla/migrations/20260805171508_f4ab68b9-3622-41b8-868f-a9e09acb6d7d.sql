-- ============ helper: staff read predicate ============
CREATE OR REPLACE FUNCTION public.is_platform_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','super_admin','finance_admin','compliance_admin','operations_admin')
  )
$$;

-- ============ support tickets ============
CREATE TABLE public.corporate_support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  corporate_id uuid NOT NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  booking_ref text,
  opened_by uuid,
  assigned_to uuid,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_support_tickets_corp_idx ON public.corporate_support_tickets (corporate_id, status);
CREATE INDEX corporate_support_tickets_activity_idx ON public.corporate_support_tickets (last_activity_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_support_tickets TO authenticated;
GRANT ALL ON public.corporate_support_tickets TO service_role;
ALTER TABLE public.corporate_support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read corporate tickets" ON public.corporate_support_tickets
FOR SELECT TO authenticated USING (public.is_platform_staff(auth.uid()));
CREATE POLICY "admins write corporate tickets" ON public.corporate_support_tickets
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ ticket notes ============
CREATE TABLE public.corporate_support_ticket_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.corporate_support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_email text,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_support_ticket_notes_ticket_idx ON public.corporate_support_ticket_notes (ticket_id, created_at DESC);

GRANT SELECT, INSERT ON public.corporate_support_ticket_notes TO authenticated;
GRANT ALL ON public.corporate_support_ticket_notes TO service_role;
ALTER TABLE public.corporate_support_ticket_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read ticket notes" ON public.corporate_support_ticket_notes
FOR SELECT TO authenticated USING (public.is_platform_staff(auth.uid()));
CREATE POLICY "admins add ticket notes" ON public.corporate_support_ticket_notes
FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  AND author_user_id = auth.uid()
);

-- ============ ops alert rules ============
CREATE TABLE public.corporate_ops_alert_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  signal text NOT NULL,
  operator text NOT NULL DEFAULT 'gte',
  threshold numeric NOT NULL DEFAULT 1,
  severity text NOT NULL DEFAULT 'warning',
  enabled boolean NOT NULL DEFAULT true,
  channels text[] NOT NULL DEFAULT ARRAY['toast']::text[],
  target_roles text[] NOT NULL DEFAULT ARRAY['super_admin']::text[],
  cooldown_seconds integer NOT NULL DEFAULT 900,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_ops_alert_rules TO authenticated;
GRANT ALL ON public.corporate_ops_alert_rules TO service_role;
ALTER TABLE public.corporate_ops_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read corp alert rules" ON public.corporate_ops_alert_rules
FOR SELECT TO authenticated USING (public.is_platform_staff(auth.uid()));
CREATE POLICY "admins manage corp alert rules" ON public.corporate_ops_alert_rules
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ ops alert events ============
CREATE TABLE public.corporate_ops_alert_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id uuid REFERENCES public.corporate_ops_alert_rules(id) ON DELETE SET NULL,
  rule_name text NOT NULL,
  signal text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  corporate_id uuid,
  observed_value numeric,
  threshold numeric,
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_ops_alert_events_created_idx ON public.corporate_ops_alert_events (created_at DESC);

GRANT SELECT, UPDATE ON public.corporate_ops_alert_events TO authenticated;
GRANT ALL ON public.corporate_ops_alert_events TO service_role;
ALTER TABLE public.corporate_ops_alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read corp alert events" ON public.corporate_ops_alert_events
FOR SELECT TO authenticated USING (public.is_platform_staff(auth.uid()));
CREATE POLICY "admins ack corp alert events" ON public.corporate_ops_alert_events
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============ granular permission matrix ============
CREATE TABLE public.corporate_admin_permission_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  role text NOT NULL,
  capability text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, capability)
);
GRANT SELECT ON public.corporate_admin_permission_grants TO authenticated;
GRANT ALL ON public.corporate_admin_permission_grants TO service_role;
ALTER TABLE public.corporate_admin_permission_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read corp permission grants" ON public.corporate_admin_permission_grants
FOR SELECT TO authenticated USING (public.is_platform_staff(auth.uid()));
CREATE POLICY "super admins manage corp permission grants" ON public.corporate_admin_permission_grants
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'super_admin'));

-- ============ updated_at triggers ============
CREATE TRIGGER corporate_support_tickets_touch
BEFORE UPDATE ON public.corporate_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER corporate_ops_alert_rules_touch
BEFORE UPDATE ON public.corporate_ops_alert_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER corporate_admin_permission_grants_touch
BEFORE UPDATE ON public.corporate_admin_permission_grants
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.corporate_support_tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.corporate_support_ticket_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.corporate_ops_alert_events;
