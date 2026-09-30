-- ============================================================ settings
CREATE TABLE IF NOT EXISTS public.sales_engine_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  business_days_only boolean NOT NULL DEFAULT true,
  warn_ratio numeric(4,3) NOT NULL DEFAULT 0.800,
  closing_soon_days int NOT NULL DEFAULT 14,
  stale_followup_days int NOT NULL DEFAULT 7,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_engine_settings TO authenticated;
GRANT ALL ON public.sales_engine_settings TO service_role;
ALTER TABLE public.sales_engine_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings readable by staff" ON public.sales_engine_settings
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);
INSERT INTO public.sales_engine_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============================================================ SLA policies
CREATE TABLE IF NOT EXISTS public.sales_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process text NOT NULL CHECK (process = ANY (ARRAY[
    'LEAD_RESPONSE','QUALIFICATION','INFORMATION_REQUEST',
    'PROPOSAL_FOLLOWUP','CONTRACT_FOLLOWUP','ACCOUNT_ACTIVATION'])),
  label text NOT NULL,
  minutes int NOT NULL CHECK (minutes > 0),
  warn_ratio numeric(4,3) NOT NULL DEFAULT 0.800,
  pause_on_customer boolean NOT NULL DEFAULT false,
  match_service text,
  match_priority text,
  match_source text,
  match_tier text,
  match_territory text,
  match_position_code text,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_sla_policies TO authenticated;
GRANT ALL ON public.sales_sla_policies TO service_role;
ALTER TABLE public.sales_sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla policies readable by staff" ON public.sales_sla_policies
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);
CREATE INDEX IF NOT EXISTS sales_sla_policies_lookup ON public.sales_sla_policies (process, is_active, effective_from DESC);

INSERT INTO public.sales_sla_policies (process, label, minutes, pause_on_customer)
SELECT * FROM (VALUES
  ('LEAD_RESPONSE','First meaningful sales response',240,false),
  ('QUALIFICATION','Qualify a new enquiry',2880,false),
  ('INFORMATION_REQUEST','Respond after the customer replies',1440,true),
  ('PROPOSAL_FOLLOWUP','Follow up an issued proposal',4320,false),
  ('CONTRACT_FOLLOWUP','Follow up a contract',2880,false),
  ('ACCOUNT_ACTIVATION','Activate the account after contracting',2880,false)
) v(a,b,c,d)
WHERE NOT EXISTS (SELECT 1 FROM public.sales_sla_policies);

-- ============================================================ SLA clocks
CREATE TABLE IF NOT EXISTS public.sales_sla_clocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process text NOT NULL,
  policy_id uuid REFERENCES public.sales_sla_policies(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_ref text,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  work_item_id uuid,
  sla_minutes int NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paused_at timestamptz,
  paused_minutes int NOT NULL DEFAULT 0,
  completed_at timestamptz,
  breached_at timestamptz,
  escalation_level int NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_sla_clocks TO authenticated;
GRANT ALL ON public.sales_sla_clocks TO service_role;
ALTER TABLE public.sales_sla_clocks ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS sales_sla_clocks_open_key
  ON public.sales_sla_clocks (process, entity_type, entity_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_sla_clocks_staff ON public.sales_sla_clocks (staff_member_id, completed_at, due_at);
CREATE POLICY "sla clocks readable by owner or manager" ON public.sales_sla_clocks
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
    OR staff_member_id = public._my_staff_member_id()
    OR EXISTS (SELECT 1 FROM public.staff_members s
                WHERE s.id = sales_sla_clocks.staff_member_id
                  AND s.manager_staff_id = public._my_staff_member_id())
  );

CREATE TABLE IF NOT EXISTS public.sales_sla_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clock_id uuid REFERENCES public.sales_sla_clocks(id) ON DELETE CASCADE,
  action text NOT NULL,
  escalation_level int,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_sla_events TO authenticated;
GRANT ALL ON public.sales_sla_events TO service_role;
ALTER TABLE public.sales_sla_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla events readable by staff" ON public.sales_sla_events
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);

CREATE OR REPLACE FUNCTION public._sales_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'AUDIT_RECORD_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS trg_sales_sla_events_append_only ON public.sales_sla_events;
CREATE TRIGGER trg_sales_sla_events_append_only BEFORE UPDATE OR DELETE ON public.sales_sla_events
  FOR EACH ROW EXECUTE FUNCTION public._sales_append_only();

-- ============================================================ routing
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS strategic_owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL;
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS territory text;
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS registration_number text;
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS tax_identifier text;
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS email_domain text;
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.crm_accounts ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.sales_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind = ANY (ARRAY['TERRITORY','CAPABILITY','TEAM'])),
  label text NOT NULL,
  match_country text,
  match_city text,
  match_territory text,
  match_service text,
  match_tier text,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE CASCADE,
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  notes text,
  set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_routing_rules TO authenticated;
GRANT ALL ON public.sales_routing_rules TO service_role;
ALTER TABLE public.sales_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "routing rules readable by staff" ON public.sales_routing_rules
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.sales_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  account_id uuid,
  from_staff_id uuid,
  to_staff_id uuid,
  rule_kind text NOT NULL,
  rule_id uuid,
  reason text,
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_assignment_events TO authenticated;
GRANT ALL ON public.sales_assignment_events TO service_role;
ALTER TABLE public.sales_assignment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignment events readable by staff" ON public.sales_assignment_events
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);
DROP TRIGGER IF EXISTS trg_sales_assignment_append_only ON public.sales_assignment_events;
CREATE TRIGGER trg_sales_assignment_append_only BEFORE UPDATE OR DELETE ON public.sales_assignment_events
  FOR EACH ROW EXECUTE FUNCTION public._sales_append_only();

-- ============================================================ month-end freeze
CREATE TABLE IF NOT EXISTS public.sales_period_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  staff_member_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  target_kes numeric(14,2) NOT NULL DEFAULT 0,
  revenue_kes numeric(14,2) NOT NULL DEFAULT 0,
  attainment_pct numeric(8,2),
  won_count int NOT NULL DEFAULT 0,
  decided_count int NOT NULL DEFAULT 0,
  open_pipeline_kes numeric(14,2) NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'CLOSED' CHECK (status = ANY (ARRAY['CLOSED','REOPENED'])),
  closed_by uuid,
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start, staff_member_id)
);
GRANT SELECT ON public.sales_period_closures TO authenticated;
GRANT ALL ON public.sales_period_closures TO service_role;
ALTER TABLE public.sales_period_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "closures readable by staff" ON public.sales_period_closures
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.sales_period_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id uuid NOT NULL REFERENCES public.sales_period_closures(id) ON DELETE CASCADE,
  amount_kes numeric(14,2) NOT NULL,
  reason text NOT NULL,
  authorised_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_period_adjustments TO authenticated;
GRANT ALL ON public.sales_period_adjustments TO service_role;
ALTER TABLE public.sales_period_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adjustments readable by staff" ON public.sales_period_adjustments
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);
DROP TRIGGER IF EXISTS trg_sales_adjustments_append_only ON public.sales_period_adjustments;
CREATE TRIGGER trg_sales_adjustments_append_only BEFORE UPDATE OR DELETE ON public.sales_period_adjustments
  FOR EACH ROW EXECUTE FUNCTION public._sales_append_only();

-- ============================================================ touch triggers
CREATE OR REPLACE FUNCTION public._sales_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sla_policies_touch ON public.sales_sla_policies;
CREATE TRIGGER trg_sla_policies_touch BEFORE UPDATE ON public.sales_sla_policies FOR EACH ROW EXECUTE FUNCTION public._sales_touch();
DROP TRIGGER IF EXISTS trg_sla_clocks_touch ON public.sales_sla_clocks;
CREATE TRIGGER trg_sla_clocks_touch BEFORE UPDATE ON public.sales_sla_clocks FOR EACH ROW EXECUTE FUNCTION public._sales_touch();
DROP TRIGGER IF EXISTS trg_routing_rules_touch ON public.sales_routing_rules;
CREATE TRIGGER trg_routing_rules_touch BEFORE UPDATE ON public.sales_routing_rules FOR EACH ROW EXECUTE FUNCTION public._sales_touch();
