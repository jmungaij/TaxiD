-- ============ Module 2: Enterprise Customer Operations & Resolution Center ============

CREATE TABLE IF NOT EXISTS public.support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number text NOT NULL UNIQUE DEFAULT ('CASE-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  channel text NOT NULL DEFAULT 'app',
  category text NOT NULL DEFAULT 'general',
  subcategory text,
  priority text NOT NULL DEFAULT 'medium',
  severity text NOT NULL DEFAULT 'sev3',
  status text NOT NULL DEFAULT 'new',
  subject text NOT NULL,
  description text,
  requester_user_id uuid,
  requester_name text,
  requester_email text,
  requester_phone text,
  rider_id uuid,
  driver_id uuid,
  corporate_account_id uuid,
  trip_id uuid,
  delivery_id uuid,
  payment_reference text,
  refund_request_id uuid,
  assigned_to uuid,
  assigned_team text,
  sla_response_due_at timestamptz,
  sla_resolution_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  sla_response_breached boolean NOT NULL DEFAULT false,
  sla_resolution_breached boolean NOT NULL DEFAULT false,
  escalation_level int NOT NULL DEFAULT 0,
  fraud_risk_score int NOT NULL DEFAULT 0,
  sentiment text,
  satisfaction_score int,
  resolution_notes text,
  tags text[] NOT NULL DEFAULT '{}',
  source_reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_cases_priority_chk CHECK (priority IN ('low','medium','high','urgent')),
  CONSTRAINT support_cases_severity_chk CHECK (severity IN ('sev1','sev2','sev3','sev4')),
  CONSTRAINT support_cases_status_chk CHECK (status IN ('new','triaged','assigned','in_progress','pending_customer','pending_approval','escalated','resolved','closed','cancelled')),
  CONSTRAINT support_cases_channel_chk CHECK (channel IN ('app','email','phone','whatsapp','chatbot','corporate_portal','social','internal'))
);

CREATE INDEX IF NOT EXISTS idx_support_cases_status ON public.support_cases(status);
CREATE INDEX IF NOT EXISTS idx_support_cases_priority ON public.support_cases(priority);
CREATE INDEX IF NOT EXISTS idx_support_cases_assigned ON public.support_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_cases_requester ON public.support_cases(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_support_cases_created_at ON public.support_cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_cases_corporate ON public.support_cases(corporate_account_id);

GRANT SELECT, INSERT, UPDATE ON public.support_cases TO authenticated;
GRANT ALL ON public.support_cases TO service_role;
ALTER TABLE public.support_cases ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  from_value text,
  to_value text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_case_events_case ON public.support_case_events(case_id, created_at DESC);

GRANT SELECT, INSERT ON public.support_case_events TO authenticated;
GRANT ALL ON public.support_case_events TO service_role;
ALTER TABLE public.support_case_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.support_cases(id) ON DELETE CASCADE,
  author_user_id uuid,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_case_notes_visibility_chk CHECK (visibility IN ('internal','customer'))
);
CREATE INDEX IF NOT EXISTS idx_support_case_notes_case ON public.support_case_notes(case_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.support_case_notes TO authenticated;
GRANT ALL ON public.support_case_notes TO service_role;
ALTER TABLE public.support_case_notes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.support_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  priority text NOT NULL,
  response_minutes int NOT NULL DEFAULT 60,
  resolution_minutes int NOT NULL DEFAULT 1440,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, priority)
);

GRANT SELECT ON public.support_sla_policies TO authenticated;
GRANT ALL ON public.support_sla_policies TO service_role;
ALTER TABLE public.support_sla_policies ENABLE ROW LEVEL SECURITY;

-- ---------- policies ----------
CREATE POLICY "Staff manage support cases" ON public.support_cases
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role(auth.uid(),'compliance_admin') OR requester_user_id = auth.uid()
  );

CREATE POLICY "Staff insert support cases" ON public.support_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.has_role(auth.uid(),'compliance_admin') OR requester_user_id = auth.uid()
  );

CREATE POLICY "Staff update support cases" ON public.support_cases
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));

CREATE POLICY "Staff read case events" ON public.support_case_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin')
    OR EXISTS (SELECT 1 FROM public.support_cases c WHERE c.id = case_id AND c.requester_user_id = auth.uid())
  );

CREATE POLICY "Staff append case events" ON public.support_case_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));

CREATE POLICY "Staff read case notes" ON public.support_case_notes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin')
    OR (visibility = 'customer' AND EXISTS (SELECT 1 FROM public.support_cases c WHERE c.id = case_id AND c.requester_user_id = auth.uid()))
  );

CREATE POLICY "Staff write case notes" ON public.support_case_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));

CREATE POLICY "Staff edit own case notes" ON public.support_case_notes
  FOR UPDATE TO authenticated
  USING (author_user_id = auth.uid())
  WITH CHECK (author_user_id = auth.uid());

CREATE POLICY "Staff read sla policies" ON public.support_sla_policies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage sla policies" ON public.support_sla_policies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ---------- triggers ----------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_support_cases_updated_at ON public.support_cases;
CREATE TRIGGER trg_support_cases_updated_at BEFORE UPDATE ON public.support_cases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_support_case_notes_updated_at ON public.support_case_notes;
CREATE TRIGGER trg_support_case_notes_updated_at BEFORE UPDATE ON public.support_case_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_support_sla_policies_updated_at ON public.support_sla_policies;
CREATE TRIGGER trg_support_sla_policies_updated_at BEFORE UPDATE ON public.support_sla_policies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.support_cases_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.support_case_events(case_id, actor_user_id, action, to_value, note)
    VALUES (NEW.id, auth.uid(), 'case_created', NEW.status, NEW.subject);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.support_case_events(case_id, actor_user_id, action, from_value, to_value)
    VALUES (NEW.id, auth.uid(), 'status_changed', OLD.status, NEW.status);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO public.support_case_events(case_id, actor_user_id, action, from_value, to_value)
    VALUES (NEW.id, auth.uid(), 'assignment_changed', OLD.assigned_to::text, NEW.assigned_to::text);
  END IF;

  IF NEW.escalation_level IS DISTINCT FROM OLD.escalation_level THEN
    INSERT INTO public.support_case_events(case_id, actor_user_id, action, from_value, to_value)
    VALUES (NEW.id, auth.uid(), 'escalation_changed', OLD.escalation_level::text, NEW.escalation_level::text);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_cases_audit ON public.support_cases;
CREATE TRIGGER trg_support_cases_audit AFTER INSERT OR UPDATE ON public.support_cases
FOR EACH ROW EXECUTE FUNCTION public.support_cases_audit();

-- append-only integrity for the timeline
CREATE OR REPLACE FUNCTION public.support_case_events_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'support_case_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_support_case_events_immutable ON public.support_case_events;
CREATE TRIGGER trg_support_case_events_immutable BEFORE UPDATE OR DELETE ON public.support_case_events
FOR EACH ROW EXECUTE FUNCTION public.support_case_events_immutable();

-- ---------- seed SLA defaults ----------
INSERT INTO public.support_sla_policies(category, priority, response_minutes, resolution_minutes)
VALUES
  ('general','low',480,4320), ('general','medium',240,2880),
  ('general','high',60,1440), ('general','urgent',15,480),
  ('payment','urgent',10,240), ('payment','high',30,720),
  ('safety','urgent',5,120), ('safety','high',15,480),
  ('fraud','urgent',10,360), ('delivery','high',60,1440),
  ('corporate','high',60,1440)
ON CONFLICT (category, priority) DO NOTHING;