-- ============================================================================
-- PART A — SALES COMMISSION SPINE
-- Approved structure: 3.75% of qualified gross revenue + 0.25% of gross revenue
-- on attainment of the monthly target. Attribution resolves through the
-- existing sales_lead_routing_rules to the correct specialist role owner.
-- ============================================================================

CREATE TABLE public.sales_commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_rate_bp integer NOT NULL CHECK (base_rate_bp BETWEEN 0 AND 10000),
  performance_rate_bp integer NOT NULL DEFAULT 0 CHECK (performance_rate_bp BETWEEN 0 AND 10000),
  performance_trigger text NOT NULL DEFAULT 'monthly_target_attainment',
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded')),
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sales_commission_plans_one_active ON public.sales_commission_plans (status) WHERE status = 'active';
GRANT SELECT ON public.sales_commission_plans TO authenticated;
GRANT ALL ON public.sales_commission_plans TO service_role;
ALTER TABLE public.sales_commission_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_plans_read ON public.sales_commission_plans FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[]));

CREATE TABLE public.sales_commission_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_code text NOT NULL,
  period_month date NOT NULL,
  target_revenue_cents bigint NOT NULL CHECK (target_revenue_cents > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','superseded')),
  set_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (position_code, period_month)
);
GRANT SELECT ON public.sales_commission_targets TO authenticated;
GRANT ALL ON public.sales_commission_targets TO service_role;
ALTER TABLE public.sales_commission_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_targets_read ON public.sales_commission_targets FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[]));

CREATE TABLE public.sales_commission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_no text NOT NULL UNIQUE,
  source_type text NOT NULL CHECK (source_type IN ('booking','transaction','manual')),
  source_id text NOT NULL,
  booking_ref text,
  lead_context text,
  product_scope text,
  qualified_revenue_cents bigint NOT NULL CHECK (qualified_revenue_cents >= 0),
  currency text NOT NULL DEFAULT 'KES',
  period_month date NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.sales_commission_plans(id),
  owner_position_code text NOT NULL,
  owner_staff_id uuid,
  attribution_role text NOT NULL DEFAULT 'primary' CHECK (attribution_role IN ('primary','supporting')),
  share_pct numeric(5,2) NOT NULL DEFAULT 100 CHECK (share_pct > 0 AND share_pct <= 100),
  base_rate_bp integer NOT NULL,
  base_commission_cents bigint NOT NULL,
  performance_rate_bp integer NOT NULL DEFAULT 0,
  performance_eligible boolean NOT NULL DEFAULT false,
  performance_commission_cents bigint NOT NULL DEFAULT 0,
  total_commission_cents bigint NOT NULL,
  revenue_qualification jsonb NOT NULL DEFAULT '{}'::jsonb,
  kpi_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','rejected','attributed')),
  approver_id uuid,
  decided_at timestamptz,
  decision_reason text,
  idempotency_key text UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_never_for_interns CHECK (owner_position_code NOT ILIKE '%intern%' AND owner_position_code NOT LIKE 'TSI-%')
);
CREATE INDEX commission_events_owner_month ON public.sales_commission_events (owner_position_code, period_month);
GRANT SELECT ON public.sales_commission_events TO authenticated;
GRANT ALL ON public.sales_commission_events TO service_role;
ALTER TABLE public.sales_commission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_events_read ON public.sales_commission_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[])
         OR owner_staff_id = auth.uid() OR created_by = auth.uid());

CREATE TABLE public.sales_commission_event_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.sales_commission_events(id),
  action text NOT NULL,
  actor_id uuid,
  before_state jsonb,
  after_state jsonb,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_commission_event_audit TO authenticated;
GRANT ALL ON public.sales_commission_event_audit TO service_role;
ALTER TABLE public.sales_commission_event_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_audit_read ON public.sales_commission_event_audit FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[]));

CREATE OR REPLACE FUNCTION public._sales_commission_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN
  RAISE EXCEPTION 'Commission audit trail is append-only: % is not permitted.', TG_OP;
END; $f$;
CREATE TRIGGER commission_audit_immutable BEFORE UPDATE OR DELETE ON public.sales_commission_event_audit
  FOR EACH ROW EXECUTE FUNCTION public._sales_commission_audit_immutable();

CREATE OR REPLACE FUNCTION public._sales_commission_event_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN
  IF OLD.status = 'attributed' THEN
    RAISE EXCEPTION 'Commission event % is payout-attributed and locked.', OLD.event_no;
  END IF;
  IF OLD.status IN ('approved','rejected')
     AND (NEW.qualified_revenue_cents, NEW.base_commission_cents, NEW.performance_commission_cents, NEW.total_commission_cents, NEW.owner_position_code)
         IS DISTINCT FROM
         (OLD.qualified_revenue_cents, OLD.base_commission_cents, OLD.performance_commission_cents, OLD.total_commission_cents, OLD.owner_position_code) THEN
    RAISE EXCEPTION 'Commercial terms of commission event % are frozen after decision.', OLD.event_no;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $f$;
CREATE TRIGGER commission_event_lock BEFORE UPDATE ON public.sales_commission_events
  FOR EACH ROW EXECUTE FUNCTION public._sales_commission_event_lock();

CREATE OR REPLACE FUNCTION public.commission_generate_event(
  p_source_type text, p_source_id text, p_revenue_cents bigint, p_period_month date,
  p_lead_context text DEFAULT NULL, p_product_scope text DEFAULT NULL, p_booking_ref text DEFAULT NULL,
  p_currency text DEFAULT 'KES', p_owner_position_code text DEFAULT NULL, p_owner_staff_id uuid DEFAULT NULL,
  p_attribution_role text DEFAULT 'primary', p_share_pct numeric DEFAULT 100, p_idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_plan public.sales_commission_plans%ROWTYPE;
  v_owner text;
  v_month date := date_trunc('month', p_period_month)::date;
  v_target bigint;
  v_month_rev bigint;
  v_perf boolean := false;
  v_base bigint; v_perf_amt bigint := 0; v_total bigint;
  v_id uuid; v_no text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to generate commission events.';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.sales_commission_events WHERE idempotency_key = p_idempotency_key;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  SELECT * INTO v_plan FROM public.sales_commission_plans
   WHERE status='active' AND effective_from <= v_month AND (effective_to IS NULL OR effective_to >= v_month)
   ORDER BY effective_from DESC LIMIT 1;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'No active commission plan covers %.', v_month; END IF;

  v_owner := NULLIF(btrim(COALESCE(p_owner_position_code,'')),'') ;
  IF v_owner IS NULL THEN
    SELECT primary_position_code INTO v_owner FROM public.sales_lead_routing_rules
     WHERE active
       AND (lead_context = COALESCE(p_lead_context, lead_context))
       AND (product_scope = COALESCE(p_product_scope, product_scope))
     ORDER BY (lead_context = p_lead_context AND product_scope = p_product_scope) DESC, sort_order
     LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'No sales lead routing rule resolves an owner for this revenue.'; END IF;
  IF v_owner ILIKE '%intern%' OR v_owner LIKE 'TSI-%' THEN
    RAISE EXCEPTION 'Commission attribution to internship positions is prohibited.';
  END IF;

  SELECT target_revenue_cents INTO v_target FROM public.sales_commission_targets
   WHERE position_code = v_owner AND period_month = v_month AND status = 'active';
  SELECT COALESCE(SUM(qualified_revenue_cents),0) + p_revenue_cents INTO v_month_rev
    FROM public.sales_commission_events
   WHERE owner_position_code = v_owner AND period_month = v_month AND status <> 'rejected';
  v_perf := v_target IS NOT NULL AND v_month_rev >= v_target;

  v_base := round(p_revenue_cents * v_plan.base_rate_bp / 10000.0 * p_share_pct / 100.0);
  IF v_perf THEN v_perf_amt := round(p_revenue_cents * v_plan.performance_rate_bp / 10000.0 * p_share_pct / 100.0); END IF;
  v_total := v_base + v_perf_amt;

  INSERT INTO public.sales_commission_events (
    event_no, source_type, source_id, booking_ref, lead_context, product_scope,
    qualified_revenue_cents, currency, period_month, plan_id, owner_position_code, owner_staff_id,
    attribution_role, share_pct, base_rate_bp, base_commission_cents, performance_rate_bp,
    performance_eligible, performance_commission_cents, total_commission_cents,
    revenue_qualification, kpi_outcome, idempotency_key, created_by
  ) VALUES (
    'COM-' || to_char(v_month,'YYYYMM') || '-' || upper(substr(gen_random_uuid()::text,1,6)),
    p_source_type, p_source_id, p_booking_ref, p_lead_context, p_product_scope,
    p_revenue_cents, p_currency, v_month, v_plan.id, v_owner, p_owner_staff_id,
    p_attribution_role, p_share_pct, v_plan.base_rate_bp, v_base, v_plan.performance_rate_bp,
    v_perf, v_perf_amt, v_total,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'booking_ref', p_booking_ref,
      'rule', 'Qualified gross revenue as asserted by authorised commercial staff; upstream verification required'),
    jsonb_build_object('period_month', v_month, 'target_revenue_cents', v_target,
      'month_revenue_cents', v_month_rev,
      'attainment_pct', CASE WHEN v_target IS NOT NULL AND v_target > 0 THEN round(v_month_rev * 100.0 / v_target, 2) END,
      'performance_eligible', v_perf),
    p_idempotency_key, auth.uid()
  ) RETURNING id, event_no INTO v_id, v_no;

  INSERT INTO public.sales_commission_event_audit (event_id, action, actor_id, after_state, reason)
  VALUES (v_id, 'GENERATED', auth.uid(),
    jsonb_build_object('event_no', v_no, 'owner_position_code', v_owner, 'qualified_revenue_cents', p_revenue_cents,
      'base_commission_cents', v_base, 'performance_eligible', v_perf, 'total_commission_cents', v_total),
    'Commission event generated from qualified revenue.');
  RETURN v_id;
END; $f$;

CREATE OR REPLACE FUNCTION public.commission_submit_event(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v public.sales_commission_events%ROWTYPE;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[])
     AND (SELECT created_by FROM public.sales_commission_events WHERE id = p_event_id) IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorised to submit this commission event.';
  END IF;
  SELECT * INTO v FROM public.sales_commission_events WHERE id = p_event_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Commission event not found.'; END IF;
  IF v.status <> 'draft' THEN RAISE EXCEPTION 'Only draft events can be submitted (current: %).', v.status; END IF;
  UPDATE public.sales_commission_events SET status = 'pending_approval' WHERE id = p_event_id;
  INSERT INTO public.sales_commission_event_audit (event_id, action, actor_id, before_state, after_state)
  VALUES (p_event_id, 'SUBMITTED', auth.uid(), jsonb_build_object('status','draft'), jsonb_build_object('status','pending_approval'));
END; $f$;

CREATE OR REPLACE FUNCTION public.commission_decide_event(p_event_id uuid, p_decision text, p_reason text, p_changes jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v public.sales_commission_events%ROWTYPE;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','director','general_manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to approve commission events.';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected.'; END IF;
  IF p_decision = 'rejected' AND COALESCE(btrim(p_reason),'') = '' THEN RAISE EXCEPTION 'A rejection reason is required.'; END IF;
  SELECT * INTO v FROM public.sales_commission_events WHERE id = p_event_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Commission event not found.'; END IF;
  IF v.status <> 'pending_approval' THEN RAISE EXCEPTION 'Only pending events can be decided (current: %).', v.status; END IF;
  UPDATE public.sales_commission_events
     SET status = p_decision, approver_id = auth.uid(), decided_at = now(), decision_reason = p_reason
   WHERE id = p_event_id;
  INSERT INTO public.sales_commission_event_audit (event_id, action, actor_id, before_state, after_state, changes, reason)
  VALUES (p_event_id, upper(p_decision), auth.uid(),
    jsonb_build_object('status','pending_approval'),
    jsonb_build_object('status', p_decision, 'approver_id', auth.uid(), 'decided_at', now()),
    COALESCE(p_changes,'{}'::jsonb), p_reason);
END; $f$;

CREATE OR REPLACE FUNCTION public.commission_attribute_payout(p_event_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE v public.sales_commission_events%ROWTYPE;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to attribute payouts.';
  END IF;
  SELECT * INTO v FROM public.sales_commission_events WHERE id = p_event_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Commission event not found.'; END IF;
  IF v.status <> 'approved' THEN RAISE EXCEPTION 'Only approved events can be payout-attributed (current: %).', v.status; END IF;
  UPDATE public.sales_commission_events SET status = 'attributed' WHERE id = p_event_id;
  INSERT INTO public.sales_commission_event_audit (event_id, action, actor_id, before_state, after_state)
  VALUES (p_event_id, 'PAYOUT_ATTRIBUTED', auth.uid(),
    jsonb_build_object('status','approved'), jsonb_build_object('status','attributed'));
END; $f$;

GRANT EXECUTE ON FUNCTION public.commission_generate_event(text,text,bigint,date,text,text,text,text,text,uuid,text,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_submit_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_decide_event(uuid,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_attribute_payout(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.v_sales_commission_reconciliation AS
SELECT e.id, e.event_no, e.period_month, e.source_type, e.source_id, e.booking_ref,
       e.lead_context, e.product_scope, e.qualified_revenue_cents, e.currency,
       e.owner_position_code, p.title AS owner_position_title,
       e.attribution_role, e.share_pct, e.base_rate_bp, e.base_commission_cents,
       e.performance_eligible, e.performance_commission_cents, e.total_commission_cents,
       t.target_revenue_cents, (e.kpi_outcome->>'attainment_pct')::numeric AS attainment_pct,
       e.status, e.approver_id, e.decided_at, e.created_at
  FROM public.sales_commission_events e
  LEFT JOIN public.org_positions p ON p.code = e.owner_position_code
  LEFT JOIN public.sales_commission_targets t
    ON t.position_code = e.owner_position_code AND t.period_month = e.period_month AND t.status = 'active';
GRANT SELECT ON public.v_sales_commission_reconciliation TO authenticated;

-- Approved Yalla Mobility commission & incentive structure (no target amounts invented).
INSERT INTO public.sales_commission_plans (code, name, base_rate_bp, performance_rate_bp, performance_trigger, effective_from, status, approved_at, notes)
VALUES ('YMC-2026-V1', 'Yalla Mobility Commission & Incentive Structure v1',
  375, 25, 'monthly_target_attainment', DATE '2026-08-01', 'active', now(),
  'Approved structure: 3.75% of qualified gross revenue on every eligible sale, plus 0.25% of gross revenue for the month upon successful attainment of the specialist monthly revenue target. Handoff sharing follows sales_lead_routing_rules primary/supporting ownership with account ownership preserved. Performance commission activates only when an active monthly target exists and is attained.');

-- ============================================================================
-- PART B — TECHNICAL SUPPORT INTERNSHIP: YALLA PARTNERS (3 positions, 6 months)
-- ============================================================================

INSERT INTO public.intern_cohorts (id, programme_id, name, start_date, end_date, duration_weeks, intake_size, status, target_outcomes)
VALUES ('7a12b000-5a1e-4262-8ead-260826000021',
  '32fb8d29-b9c8-4845-8bc6-7f1bd57677a6',
  'YMEITA-TSPT-2026-A',
  DATE '2026-10-05', DATE '2027-04-05', 26, 3, 'PLANNED',
  'Technical Support Internship Unit — Yalla Partners. Three interns providing first-line technical support across partner application, onboarding, portals, API, white-label and technology integration pathways, with disciplined escalation, documentation and knowledge-base contribution. Support-quality metrics only; no revenue or commission targets.');

INSERT INTO public.rec_vacancies (
  id, vacancy_no, title, employment_type, work_arrangement, location, headcount,
  is_replacement, currency, required_skills, preferred_skills, qualifications, competencies,
  min_years_experience, responsibilities, kpis, priority, sla_days, approval_status,
  publication_status, status, public_slug, public_summary, role_purpose,
  accountability_groups, success_outcomes, qualification_level, equivalent_experience_accepted,
  application_deadline, target_hire_date, reports_to_position_id, position_exception_reason,
  recruitment_process, content_version, opened_at
) VALUES (
  '7a12a000-5a1e-4262-8ead-260826000011',
  'INT-2608-TSI01',
  'Technical Support Internship — Yalla Partners Platform Support — Nairobi',
  'internship', 'hybrid', 'Nairobi, Kenya', 3,
  false, 'KES',
  ARRAY['Troubleshooting','Technical documentation','HTTP / REST / JSON fundamentals','Web technologies','Databases and SQL basics','Version control (Git)'],
  ARRAY['Software testing / QA','Networking fundamentals','Customer or user support experience'],
  ARRAY['Diploma or Bachelor''s degree in Information Technology, Software Engineering, Computer Science, Information Systems or a related technical discipline','Equivalent technical qualifications considered where demonstrable technical competence is strong'],
  ARRAY['Analytical thinking','Problem solving','Communication','Patience','Documentation discipline','Attention to detail','Teamwork','Partner orientation'],
  0,
  ARRAY['Provide first-line technical support across the Yalla Partners ecosystem (application, onboarding, portals, API, white-label and integration pathways)','Triage, categorise, work and document partner support tickets through the support workflow','Distinguish user, system, data, configuration, permission, integration and operational errors and escalate correctly','Escalate security and elevated-authority issues immediately','Identify partner data-quality problems without making unauthorised changes','Contribute reusable articles to the partner support knowledge base'],
  ARRAY['Tickets handled and documented','First-response performance','Resolution quality (no closure without a valid resolution)','Escalation accuracy','Knowledge-base contributions','Learning milestones (month 1 / 3 / 6 reviews)'],
  'high', 30, 'approved',
  'draft', 'open',
  'technical-support-intern-yalla-partners-9a3f1c',
  'Six-month technical support internship (3 positions) within the Yalla Partners ecosystem: first-line support for partner onboarding, portals, API and integration pathways, with structured escalation and knowledge-base contribution.',
  'The Technical Support Intern — Yalla Partners supports the technical operation, onboarding, enablement and day-to-day usability of the Yalla Mobility partner ecosystem, working at the intersection of technology, partner operations, technical support, data quality and user enablement.',
  '[]'::jsonb,
  ARRAY['Interns triage, resolve or correctly escalate 100% of assigned partner support tickets','Zero unauthorised actions on verification, compliance, finance, credentials or security controls','A reusable partner support knowledge base seeded with reviewed articles','Month 1 onboarding, month 3 midpoint and month 6 final assessments completed for all three interns'],
  'Diploma', true,
  DATE '2026-09-25', DATE '2026-10-05',
  '7a11a000-5a1e-4262-8ead-260826000001',
  'Internship position — primary supervision by the assigned internship supervisor of record under the YMEITA framework; functional alignment to Yalla Partners / Partnerships operations under the Sales Team Leader span. No dedicated technical lead post exists in the current organisation structure, so no new senior position was created.',
  '[]'::jsonb, 1, now()
);

INSERT INTO public.rec_internship_specs (
  id, vacancy_id, programme_id, cohort_id, primary_track_id, internship_type,
  duration_weeks, start_date, end_date, application_deadline,
  host_function, department, business_unit,
  supervisor_staff_id, mentor_staff_id, approving_manager_staff_id,
  programme_purpose, learning_objectives, learning_outcomes, productivity_mandate, kpis,
  academic_eligibility, required_documents, curriculum_map, competencies, practical_capabilities,
  assessment_design, interview_framework, selection_weights, success_profile, development_plan,
  application_questions, spec_status, idempotency_key
) VALUES (
  '7a12c000-5a1e-4262-8ead-260826000031',
  '7a12a000-5a1e-4262-8ead-260826000011',
  '32fb8d29-b9c8-4845-8bc6-7f1bd57677a6',
  '7a12b000-5a1e-4262-8ead-260826000021',
  'd9d9e193-5266-42f7-ae4e-cb143d261f90',
  'PROFESSIONAL', 26, DATE '2026-10-05', DATE '2027-04-05', DATE '2026-09-25',
  'Yalla Partners', 'Technical Support / Platform Operations', 'Yalla Mobility',
  '62a834c9-be98-475b-b26b-74826079df5a', '62a834c9-be98-475b-b26b-74826079df5a', '175de640-a629-404c-aca1-9eadca73338b',
  'Develop three early-career technical support professionals able to provide disciplined first-line technical support across the Yalla Partners ecosystem — partner application, onboarding, portals, API, white-label and technology integration pathways — with correct triage, escalation, documentation and knowledge-base contribution, while respecting every security and authority boundary.',
  '[{"competency":"Yalla Mobility ecosystem and Yalla Partners partner categories","evidence":"Ecosystem map covering demand, supply and integration partner families with their portals and journeys","assessment":"Month 1 onboarding review with supervisor"},
    {"competency":"Partner portal first-line support and structured troubleshooting","evidence":"Worked tickets with correct category, symptoms, environment, steps and outcome","assessment":"Month 2 ticket quality review"},
    {"competency":"API and integration support fundamentals (HTTP, REST, JSON, authentication)","evidence":"Interpreted 400/401/500 error scenarios and guided sandbox test coordination","assessment":"Month 3 technical assessment"},
    {"competency":"White-label, operator, logistics and driver portal support with correct escalation","evidence":"Escalation records routed to L2/L3, security or operations with complete context","assessment":"Month 4 escalation accuracy audit"},
    {"competency":"Root-cause identification, QA discipline and defect reporting","evidence":"Reproducible defect reports and test cases accepted by the platform team","assessment":"Month 5 QA and defect review"},
    {"competency":"Independent supervised first-line support and support analytics","evidence":"Recurring-issue analysis and knowledge-base articles adopted into the support library","assessment":"Month 6 final internship assessment and project review"}]'::jsonb,
  '[{"action":"Triage and work assigned partner support tickets","competency":"Structured troubleshooting","context":"Yalla Partners portals and application flow","evidence":"Ticket records with correct category, priority and resolution notes"},
    {"action":"Distinguish user, system, data, configuration, permission, integration and operational errors","competency":"Issue classification","context":"Partner support queue","evidence":"Classification accuracy sampled by supervisor"},
    {"action":"Escalate security and elevated-authority issues immediately","competency":"Security awareness and authority discipline","context":"All partner support work","evidence":"Escalation log with zero unauthorised intervention"},
    {"action":"Convert recurring issues into reusable knowledge articles","competency":"Technical documentation","context":"Yalla Partners knowledge base","evidence":"Published knowledge-base articles linked from resolved tickets"}]'::jsonb,
  '[{"work":"Handle assigned first-line partner support tickets through the ticket workflow","measure":"Tickets triaged, worked and documented per week with correct categorisation"},
    {"work":"Identify partner data-quality problems","measure":"Verified data-quality findings logged for correction under controlled permissions"},
    {"work":"Contribute to the partner support knowledge base","measure":"Reusable articles drafted and reviewed per month"}]'::jsonb,
  '[{"kpi":"Tickets handled","target":"All assigned tickets worked within the support workflow","evidence_source":"Partner support ticket system"},
    {"kpi":"First-response performance","target":"First response within the agreed support window on assigned tickets","evidence_source":"Partner support ticket system"},
    {"kpi":"Resolution quality","target":"A ticket closed without a valid recorded resolution never counts as resolved","evidence_source":"Supervisor ticket audit"},
    {"kpi":"Escalation accuracy","target":"Security and elevated-authority issues escalated immediately, 100% of the time","evidence_source":"Escalation records"},
    {"kpi":"Knowledge-base contribution","target":"At least one reviewed article per month from month 3","evidence_source":"Knowledge base"},
    {"kpi":"Learning milestones","target":"Month 1 onboarding, month 3 midpoint and month 6 final reviews completed","evidence_source":"Supervisor assessment"}]'::jsonb,
  '{"qualification_level":"Diploma","programme_families":["Information Technology","Software Engineering","Computer Science","Information Systems","related technical discipline"],"year_of_study":"Any year, including recent completers","minimum_grade":"No minimum grade — capability is assessed from evidence; degree holders are not automatically ranked above diploma holders","attachment_letter_required":false}'::jsonb,
  ARRAY['CV','Academic certificate or transcript','National ID','Cover letter'],
  '[{"course":"Databases and SQL","capability":"Investigating partner data-quality problems without arbitrary changes"},
    {"course":"Web technologies and networking","capability":"Diagnosing portal, browser, session and connectivity issues"},
    {"course":"Programming fundamentals","capability":"Reading JSON payloads and reasoning about API requests and responses"},
    {"course":"Systems analysis and design","capability":"Structured root-cause analysis and clear defect reporting"}]'::jsonb,
  '[{"competency":"Analytical troubleshooting","evidence":"Structured diagnosis demonstrated in assessment scenarios"},
    {"competency":"API and HTTP fundamentals","evidence":"Correct interpretation of 400/401/500 classes in the technical assessment"},
    {"competency":"Documentation discipline","evidence":"Complete ticket and knowledge-base documentation"},
    {"competency":"Security awareness","evidence":"Immediate escalation of suspicious activity; credentials never requested or shared"},
    {"competency":"Partner-oriented communication","evidence":"Clear, patient guidance in support interactions"}]'::jsonb,
  ARRAY['Triage and categorise a partner support ticket correctly','Guide a partner through login, application and portal troubleshooting','Interpret common API error responses at first-line level','Write a complete troubleshooting and resolution record','Escalate a security concern immediately with full context'],
  '[{"stage":"Assessment 1 — Technical fundamentals","instrument":"Timed exercise covering computing, web, database and networking basics","passing":"Sound fundamentals with correct reasoning","weight":10},
    {"stage":"Assessment 2 — Troubleshooting scenario (Scenario A)","instrument":"Partner can log in but cannot see their dashboard","passing":"Considers permission, configuration, session, browser and backend causes in a structured order","weight":15},
    {"stage":"Assessment 3 — API fundamentals (Scenario B)","instrument":"API partner receives HTTP 401","passing":"Explains authentication causes and never suggests sharing or bypassing credentials","weight":15},
    {"stage":"Assessment 4 — Data integrity (Scenario C)","instrument":"Partner reports duplicate vehicle records","passing":"Investigates provenance and duplicates without arbitrarily deleting data","weight":10},
    {"stage":"Assessment 5 — Security judgement (Scenario D)","instrument":"Partner reports suspicious account activity","passing":"Immediate escalation; no unauthorised investigation","weight":15},
    {"stage":"Assessment 6 — Structured support (Scenario E)","instrument":"Partner cannot complete an application","passing":"Methodical reproduction, environment capture and guided resolution","weight":10},
    {"stage":"Assessment 7 — Documentation exercise","instrument":"Write a knowledge-base draft from a worked ticket","passing":"Reusable, complete, free of credentials and sensitive data","weight":10},
    {"stage":"Assessment 8 — Communication exercise","instrument":"Explain a technical issue to a non-technical partner","passing":"Clear, patient, accurate communication","weight":15}]'::jsonb,
  '[{"question":"Walk us through troubleshooting a user who cannot log in.","rubric":"Structured elimination: credentials, account state, session, browser, backend; no password handling; escalation when exhausted.","max_marks":20},
    {"question":"What does an HTTP 401 error generally indicate, and how would you guide an API partner?","rubric":"Authentication failure causes; documentation guidance; credentials protected at all times.","max_marks":20},
    {"question":"Why should production credentials never be shared?","rubric":"Understands confidentiality, accountability, blast radius and audit impact.","max_marks":15},
    {"question":"A partner reports suspicious account activity. What do you do?","rubric":"Immediate escalation to security; preserves evidence; no unauthorised investigation.","max_marks":20},
    {"question":"Why is documentation important in technical support?","rubric":"Reusability, continuity, auditability and quality measurement.","max_marks":15},
    {"question":"Tell us about a technical problem you solved. What was your process?","rubric":"Evidence of methodical problem solving and learning.","max_marks":10}]'::jsonb,
  '{"technical_assessment":40,"interview":30,"academic_evidence":15,"communication":15}'::jsonb,
  ARRAY['Resolves first-line tickets with correct categorisation and complete documentation','Escalates every security and elevated-authority issue without exception','Builds trusted working relationships with partners through patient, accurate guidance','Converts recurring issues into knowledge-base assets','Completes the six-month learning plan with a final support-quality project'],
  '[{"phase":"Month 1","focus":"Ecosystem orientation, partner categories, support processes, security fundamentals, ticketing and documentation"},
    {"phase":"Month 2","focus":"Partner portals, account and user support, troubleshooting and data quality"},
    {"phase":"Month 3","focus":"API fundamentals: HTTP, REST, JSON, authentication and integration support; midpoint review"},
    {"phase":"Month 4","focus":"White-label, technology, operator and logistics portal support with structured escalation"},
    {"phase":"Month 5","focus":"Advanced troubleshooting, root-cause analysis, QA, test cases, defect reporting and knowledge-base development"},
    {"phase":"Month 6","focus":"Independent supervised first-line support, support analytics, recurring-issue analysis, final project and final assessment"}]'::jsonb,
  '[{"question":"What is your highest technical qualification?","input":"Short text","required":true},
    {"question":"What is your field of study?","input":"Short text","required":true},
    {"question":"Have you worked with APIs? Describe what you did.","input":"Long text","required":true},
    {"question":"How familiar are you with REST and JSON?","input":"Long text","required":true},
    {"question":"Have you used Git or another version-control system?","input":"Short text","required":true},
    {"question":"Have you provided technical or user support before? Describe it.","input":"Long text","required":false},
    {"question":"Describe how you would troubleshoot a user who cannot log in.","input":"Long text","required":true},
    {"question":"Describe what an HTTP 401 error generally indicates.","input":"Long text","required":true},
    {"question":"Why should production credentials never be shared?","input":"Long text","required":true},
    {"question":"Why is documentation important in technical support?","input":"Long text","required":true}]'::jsonb,
  'DRAFT', 'tsi-yalla-partners-2026-a'
);

-- Publish through the existing governance triggers (validates the spec, then flips it to PUBLISHED).
UPDATE public.rec_vacancies
   SET publication_status = 'published', published_at = now(), published_by = NULL
 WHERE id = '7a12a000-5a1e-4262-8ead-260826000011';

-- ============================================================================
-- PART C — PARTNER SUPPORT TICKETING + KNOWLEDGE BASE
-- No partner-facing support system existed (corporate_support_tickets is
-- corporate-scoped), so this is the canonical partner support spine.
-- ============================================================================

CREATE TABLE public.partner_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL UNIQUE DEFAULT ('PST-' || upper(substr(gen_random_uuid()::text,1,8))),
  partner_id uuid,
  partner_name text,
  partner_category text,
  portal text,
  category text NOT NULL CHECK (category IN ('ACCOUNT_ACCESS','PARTNER_PROFILE','PORTAL_UI','DATA','BOOKING_QUOTATION','INTEGRATION','DEVICE_BROWSER','PERMISSIONS','OPERATIONAL','SECURITY')),
  severity text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  priority text NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3','P4')),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','TRIAGED','ASSIGNED','IN_PROGRESS','WAITING_FOR_PARTNER','ESCALATED','RESOLVED','CLOSED')),
  escalation_level text NOT NULL DEFAULT 'L1' CHECK (escalation_level IN ('L1','L2','L3','SECURITY','OPERATIONS')),
  escalated_to text,
  subject text NOT NULL,
  description text,
  troubleshooting_notes text,
  resolution text,
  kb_article_id uuid,
  assigned_to uuid,
  reported_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_support_tickets_queue ON public.partner_support_tickets (status, assigned_to);
GRANT SELECT, INSERT, UPDATE ON public.partner_support_tickets TO authenticated;
GRANT ALL ON public.partner_support_tickets TO service_role;
ALTER TABLE public.partner_support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_tickets_read ON public.partner_support_tickets FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() OR reported_by = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','director','general_manager']::public.app_role[]));
CREATE POLICY partner_tickets_insert ON public.partner_support_tickets FOR INSERT TO authenticated
  WITH CHECK (reported_by = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','director','general_manager']::public.app_role[]));
CREATE POLICY partner_tickets_update ON public.partner_support_tickets FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','director','general_manager']::public.app_role[]));

CREATE OR REPLACE FUNCTION public._partner_support_resolution_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN
  IF NEW.status IN ('RESOLVED','CLOSED') AND OLD.status IS DISTINCT FROM NEW.status
     AND COALESCE(btrim(COALESCE(NEW.resolution,'')),'') = '' THEN
    RAISE EXCEPTION 'Ticket % cannot be % without a recorded resolution.', OLD.ticket_no, NEW.status;
  END IF;
  IF NEW.category = 'SECURITY' AND NEW.escalation_level = 'L1' AND NEW.status NOT IN ('NEW') THEN
    RAISE EXCEPTION 'Security tickets must be escalated beyond L1 before they can be worked.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $f$;
CREATE TRIGGER partner_support_resolution_gate BEFORE UPDATE ON public.partner_support_tickets
  FOR EACH ROW EXECUTE FUNCTION public._partner_support_resolution_gate();

CREATE TABLE public.partner_support_kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.partner_support_kb_articles TO authenticated;
GRANT ALL ON public.partner_support_kb_articles TO service_role;
ALTER TABLE public.partner_support_kb_articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_kb_read ON public.partner_support_kb_articles FOR SELECT TO authenticated
  USING (status = 'published' OR created_by = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','director','general_manager']::public.app_role[]));
CREATE POLICY partner_kb_write ON public.partner_support_kb_articles FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','director','general_manager']::public.app_role[]));
CREATE POLICY partner_kb_update ON public.partner_support_kb_articles FOR UPDATE TO authenticated
  USING (created_by = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','director','general_manager']::public.app_role[]));

-- Seed starter knowledge-base entries (drafts for supervisor review).
INSERT INTO public.partner_support_kb_articles (slug, title, category, body, status) VALUES
 ('partner-login-troubleshooting','Partner login and account access troubleshooting','ACCOUNT_ACCESS','Structured first-line steps: confirm the account exists and is activated, verify the partner is using the correct portal URL, guide a password reset through the self-service flow (never request or handle the password), clear cache/session, and check for lockouts. Escalate to L2 when account state or permissions need elevated access. Never share or request credentials.', 'draft'),
 ('api-401-authentication-failures','API 401 authentication failures — first-line guide','INTEGRATION','HTTP 401 indicates an authentication failure. Check with the partner: correct environment (sandbox vs production), credential validity and rotation status, Authorization header format, and clock skew. Never ask the partner to share secret keys; use the credential console and rotation flow instead. Escalate persistent failures to L3 engineering.', 'draft'),
 ('security-suspicious-activity-escalation','Suspicious account activity — immediate escalation','SECURITY','Any report of suspicious logins, unexpected access or data activity is a SECURITY ticket: record the report verbatim, preserve timestamps and evidence, do not investigate beyond recording, set escalation_level to SECURITY and notify the security/administration team immediately.', 'draft');
