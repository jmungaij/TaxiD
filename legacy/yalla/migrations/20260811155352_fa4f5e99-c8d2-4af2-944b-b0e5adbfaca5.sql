-- 1. Objective measurement & governance columns -------------------------------
ALTER TABLE public.org_objectives
  ADD COLUMN IF NOT EXISTS weight_pct numeric,
  ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS critical_min_pct numeric,
  ADD COLUMN IF NOT EXISTS measurement_frequency text,
  ADD COLUMN IF NOT EXISTS review_frequency text,
  ADD COLUMN IF NOT EXISTS data_source text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'not_available',
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS formula text,
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cross_functional boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS seed_batch text;

ALTER TABLE public.org_objectives DROP CONSTRAINT IF EXISTS org_objectives_source_type_check;
ALTER TABLE public.org_objectives ADD CONSTRAINT org_objectives_source_type_check
  CHECK (source_type = ANY (ARRAY['authoritative_system','verified_manual','imported','calculated','not_available']));

ALTER TABLE public.org_objectives DROP CONSTRAINT IF EXISTS org_objectives_kpi_unit_check;
-- normalise legacy free-text KPI units before applying the standard vocabulary
UPDATE public.org_objectives
   SET kpi_unit = 'currency',
       currency = COALESCE(currency, 'KES')
 WHERE kpi_unit NOT IN ('count','percent','currency','ratio','days','hours','score');

ALTER TABLE public.org_objectives ADD CONSTRAINT org_objectives_kpi_unit_check
  CHECK (kpi_unit = ANY (ARRAY['count','percent','currency','ratio','days','hours','score']));

ALTER TABLE public.org_objectives ADD COLUMN IF NOT EXISTS period_end date;

ALTER TABLE public.org_entities  ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.org_units     ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.org_positions ADD COLUMN IF NOT EXISTS seed_batch text;
ALTER TABLE public.staff_members ADD COLUMN IF NOT EXISTS seed_batch text;

CREATE UNIQUE INDEX IF NOT EXISTS org_objectives_seed_title_key
  ON public.org_objectives (seed_batch, title) WHERE seed_batch IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_members_seed_no_key
  ON public.staff_members (seed_batch, staff_no) WHERE seed_batch IS NOT NULL;

-- 2. Append-only authoritative KPI actuals ------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_kpi_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES public.org_objectives(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  note text,
  recorded_by uuid,
  seed_batch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_kpi_actuals_source_type_check
    CHECK (source_type = ANY (ARRAY['authoritative_system','verified_manual','imported','calculated'])),
  CONSTRAINT staff_kpi_actuals_period_check CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_staff_kpi_actuals_objective ON public.staff_kpi_actuals (objective_id, created_at DESC);

GRANT SELECT, INSERT ON public.staff_kpi_actuals TO authenticated;
GRANT ALL ON public.staff_kpi_actuals TO service_role;
ALTER TABLE public.staff_kpi_actuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read kpi actuals" ON public.staff_kpi_actuals;
CREATE POLICY "staff read kpi actuals" ON public.staff_kpi_actuals
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_objectives o
    WHERE o.id = staff_kpi_actuals.objective_id
      AND (public.is_staff_member() OR public.is_my_staff_record(o.staff_id) OR public.manages_staff_record(o.staff_id))
  ));

DROP POLICY IF EXISTS "admin record kpi actuals" ON public.staff_kpi_actuals;
CREATE POLICY "admin record kpi actuals" ON public.staff_kpi_actuals
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.staff_kpi_actuals_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'staff_kpi_actuals is append-only; record a correcting entry instead';
END;
$$;

DROP TRIGGER IF EXISTS staff_kpi_actuals_no_mutate ON public.staff_kpi_actuals;
CREATE TRIGGER staff_kpi_actuals_no_mutate
  BEFORE UPDATE OR DELETE ON public.staff_kpi_actuals
  FOR EACH ROW EXECUTE FUNCTION public.staff_kpi_actuals_immutable();

-- keep the objective's actual in step with the newest recorded actual
CREATE OR REPLACE FUNCTION public.sync_objective_actual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.org_objectives
     SET actual = NEW.value,
         actual_recorded_at = NEW.created_at,
         source_type = NEW.source_type
   WHERE id = NEW.objective_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_kpi_actuals_sync ON public.staff_kpi_actuals;
CREATE TRIGGER staff_kpi_actuals_sync
  AFTER INSERT ON public.staff_kpi_actuals
  FOR EACH ROW EXECUTE FUNCTION public.sync_objective_actual();

-- 3. Organisational integrity validation -------------------------------------
CREATE OR REPLACE FUNCTION public.validate_objective_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_owner uuid := COALESCE(NEW.owner_staff_id, NEW.staff_id);
  v_owner_unit uuid;
  v_owner_name text;
  v_owner_unit_name text;
  v_obj_unit_name text;
BEGIN
  IF NEW.weight_pct IS NOT NULL AND (NEW.weight_pct < 0 OR NEW.weight_pct > 100) THEN
    RAISE EXCEPTION 'Objective weight must be between 0 and 100 (got %)', NEW.weight_pct;
  END IF;
  IF NEW.deadline IS NOT NULL AND NEW.period_start IS NOT NULL AND NEW.deadline < NEW.period_start THEN
    RAISE EXCEPTION 'Objective deadline (%) cannot precede the period start (%)', NEW.deadline, NEW.period_start;
  END IF;
  IF NEW.kpi_unit = 'percent' AND (NEW.target <= 0 OR NEW.target > 100) THEN
    RAISE EXCEPTION 'Percentage KPI target must be greater than 0 and at most 100 (got %)', NEW.target;
  END IF;
  IF NEW.kpi_unit = 'count' AND (NEW.target <= 0 OR NEW.target <> trunc(NEW.target)) THEN
    RAISE EXCEPTION 'Count KPI target must be a positive whole number (got %)', NEW.target;
  END IF;
  IF NEW.kpi_unit = 'currency' AND COALESCE(NEW.currency,'') = '' THEN
    RAISE EXCEPTION 'Currency KPI requires a currency';
  END IF;

  IF v_owner IS NOT NULL AND NEW.unit_id IS NOT NULL AND NOT NEW.cross_functional THEN
    SELECT s.unit_id, s.full_name INTO v_owner_unit, v_owner_name
      FROM public.staff_members s WHERE s.id = v_owner;
    IF v_owner_unit IS NOT NULL AND v_owner_unit <> NEW.unit_id THEN
      SELECT name INTO v_owner_unit_name FROM public.org_units WHERE id = v_owner_unit;
      SELECT name INTO v_obj_unit_name FROM public.org_units WHERE id = NEW.unit_id;
      RAISE EXCEPTION 'Objective ownership conflict: % belongs to the % department and cannot be assigned to a % department objective',
        COALESCE(v_owner_name,'owner'), COALESCE(v_owner_unit_name,'(unassigned)'), COALESCE(v_obj_unit_name,'(unknown)');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS org_objectives_integrity ON public.org_objectives;
CREATE TRIGGER org_objectives_integrity
  BEFORE INSERT OR UPDATE ON public.org_objectives
  FOR EACH ROW EXECUTE FUNCTION public.validate_objective_integrity();

-- 4. One canonical performance calculation -----------------------------------
DROP VIEW IF EXISTS public.v_objective_performance;
CREATE VIEW public.v_objective_performance WITH (security_invoker = true) AS
WITH base AS (
  SELECT o.*,
    u.name AS unit_name,
    s.full_name AS owner_name,
    p.title AS owner_position,
    CASE WHEN o.actual IS NULL OR o.target IS NULL OR o.target = 0 THEN NULL
         ELSE round((o.actual / o.target) * 100, 1) END AS achievement_pct,
    CASE
      WHEN o.period_start IS NULL OR o.deadline IS NULL OR o.deadline <= o.period_start THEN NULL
      WHEN CURRENT_DATE <= o.period_start THEN 0
      WHEN CURRENT_DATE >= o.deadline THEN 100
      ELSE round(((CURRENT_DATE - o.period_start)::numeric / (o.deadline - o.period_start)::numeric) * 100, 1)
    END AS expected_pct
  FROM public.org_objectives o
  LEFT JOIN public.org_units u ON u.id = o.unit_id
  LEFT JOIN public.staff_members s ON s.id = COALESCE(o.owner_staff_id, o.staff_id)
  LEFT JOIN public.org_positions p ON p.id = s.position_id
)
SELECT b.*,
  CASE WHEN b.achievement_pct IS NULL OR b.expected_pct IS NULL THEN NULL
       ELSE round(b.achievement_pct - b.expected_pct, 1) END AS variance_pp,
  CASE WHEN b.achievement_pct IS NULL OR b.weight_pct IS NULL THEN NULL
       ELSE round((b.achievement_pct * b.weight_pct) / 100, 2) END AS weighted_score,
  CASE
    WHEN b.status IN ('cancelled','draft') THEN b.status
    WHEN b.actual IS NULL AND b.deadline IS NOT NULL AND b.deadline < CURRENT_DATE THEN 'overdue'
    WHEN b.actual IS NULL THEN 'awaiting_actual'
    WHEN b.achievement_pct > 100 THEN 'exceeded'
    WHEN b.achievement_pct >= 100 THEN 'achieved'
    WHEN b.period_start IS NOT NULL AND CURRENT_DATE < b.period_start THEN 'not_started'
    WHEN b.expected_pct IS NULL THEN 'active'
    WHEN b.achievement_pct >= b.expected_pct * 0.95 THEN 'on_track'
    WHEN b.achievement_pct >= b.expected_pct * 0.70 THEN 'at_risk'
    ELSE 'off_track'
  END AS computed_status,
  CASE
    WHEN b.achievement_pct IS NULL THEN NULL
    WHEN b.achievement_pct >= 95 THEN 'exceptional'
    WHEN b.achievement_pct >= 90 THEN 'excellent'
    WHEN b.achievement_pct >= 80 THEN 'effective'
    WHEN b.achievement_pct >= 70 THEN 'developing'
    WHEN b.achievement_pct >= 60 THEN 'below_standard'
    ELSE 'unsatisfactory'
  END AS rating,
  (b.is_critical AND b.achievement_pct IS NOT NULL
     AND b.achievement_pct < COALESCE(b.critical_min_pct, 80)) AS critical_breach
FROM base b;

GRANT SELECT ON public.v_objective_performance TO authenticated;

-- 5. Controlled seeding ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_staff360_performance_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  batch text := 'staff360-performance-v1';
  v_org uuid; v_div uuid; v_sales uuid; v_admin uuid;
  p_ceo uuid; p_smgr uuid; p_sadm uuid; p_amgr uuid; p_aadm uuid;
  s_ceo uuid; s_john uuid; s_amina uuid; s_david uuid; s_grace uuid;
  o_rev uuid;
  created int := 0;
  ps date := DATE '2026-01-01'; pe date := DATE '2026-12-31';
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id INTO v_org FROM public.org_entities ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    INSERT INTO public.org_entities (legal_name, trading_name, country, status, provenance, seed_batch)
    VALUES ('Yalla Beena Limited','Yalla Mobility','KE','active','SEEDED',batch) RETURNING id INTO v_org;
  END IF;

  SELECT id INTO v_div FROM public.org_units WHERE org_id = v_org AND unit_type = 'division' ORDER BY created_at LIMIT 1;

  SELECT id INTO v_sales FROM public.org_units WHERE org_id = v_org AND lower(name) = 'sales' LIMIT 1;
  IF v_sales IS NULL THEN
    INSERT INTO public.org_units (org_id,parent_unit_id,unit_type,name,code,currency,status,provenance,seed_batch)
    VALUES (v_org,v_div,'department','Sales','SLS100','KES','active','SEEDED',batch) RETURNING id INTO v_sales;
  END IF;

  SELECT id INTO v_admin FROM public.org_units
   WHERE org_id = v_org AND unit_type = 'department' AND lower(name) LIKE 'admin%' LIMIT 1;
  IF v_admin IS NULL THEN
    INSERT INTO public.org_units (org_id,parent_unit_id,unit_type,name,code,currency,status,provenance,seed_batch)
    VALUES (v_org,v_div,'department','Administration','ADM200','KES','active','SEEDED',batch) RETURNING id INTO v_admin;
  END IF;

  -- positions
  INSERT INTO public.org_positions (unit_id,title,code,status,provenance,seed_batch)
  VALUES (COALESCE(v_div,v_sales),'CEO / Managing Director','CEO-MD','active','SEEDED',batch)
  ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title RETURNING id INTO p_ceo;

  INSERT INTO public.org_positions (unit_id,reports_to_position_id,title,code,status,provenance,seed_batch)
  VALUES (v_sales,p_ceo,'Sales Manager – Mobility Services','SLS-MGR','active','SEEDED',batch)
  ON CONFLICT (code) DO UPDATE SET unit_id = EXCLUDED.unit_id, reports_to_position_id = EXCLUDED.reports_to_position_id
  RETURNING id INTO p_smgr;

  INSERT INTO public.org_positions (unit_id,reports_to_position_id,title,code,status,provenance,seed_batch)
  VALUES (v_sales,p_smgr,'Sales Administrator – Mobility Services','SLS-ADM','active','SEEDED',batch)
  ON CONFLICT (code) DO UPDATE SET unit_id = EXCLUDED.unit_id, reports_to_position_id = EXCLUDED.reports_to_position_id
  RETURNING id INTO p_sadm;

  INSERT INTO public.org_positions (unit_id,reports_to_position_id,title,code,status,provenance,seed_batch)
  VALUES (v_admin,p_ceo,'Manager – Administration','ADM-MGR','active','SEEDED',batch)
  ON CONFLICT (code) DO UPDATE SET unit_id = EXCLUDED.unit_id RETURNING id INTO p_amgr;

  INSERT INTO public.org_positions (unit_id,reports_to_position_id,title,code,status,provenance,seed_batch)
  VALUES (v_admin,p_amgr,'Administration Administrator','ADM-ADM','active','SEEDED',batch)
  ON CONFLICT (code) DO UPDATE SET unit_id = EXCLUDED.unit_id RETURNING id INTO p_aadm;

  -- staff
  INSERT INTO public.staff_members (org_id,staff_no,full_name,work_email,employment_status,employment_type,start_date,unit_id,position_id,provenance,seed_batch)
  VALUES (v_org,'SEED-000','Test CEO','ceo.test@example.invalid','active','permanent',ps,COALESCE(v_div,v_sales),p_ceo,'SEEDED',batch)
  ON CONFLICT (seed_batch,staff_no) DO UPDATE SET position_id = EXCLUDED.position_id RETURNING id INTO s_ceo;

  INSERT INTO public.staff_members (org_id,staff_no,full_name,work_email,employment_status,employment_type,start_date,unit_id,position_id,manager_staff_id,provenance,seed_batch)
  VALUES (v_org,'SEED-001','John Test','john.test@example.invalid','active','permanent',ps,v_sales,p_smgr,s_ceo,'SEEDED',batch)
  ON CONFLICT (seed_batch,staff_no) DO UPDATE SET unit_id = EXCLUDED.unit_id, position_id = EXCLUDED.position_id, manager_staff_id = EXCLUDED.manager_staff_id
  RETURNING id INTO s_john;

  INSERT INTO public.staff_members (org_id,staff_no,full_name,work_email,employment_status,employment_type,start_date,unit_id,position_id,manager_staff_id,provenance,seed_batch)
  VALUES (v_org,'SEED-002','Amina Test','amina.test@example.invalid','active','permanent',ps,v_sales,p_sadm,s_john,'SEEDED',batch)
  ON CONFLICT (seed_batch,staff_no) DO UPDATE SET unit_id = EXCLUDED.unit_id, position_id = EXCLUDED.position_id, manager_staff_id = EXCLUDED.manager_staff_id
  RETURNING id INTO s_amina;

  INSERT INTO public.staff_members (org_id,staff_no,full_name,work_email,employment_status,employment_type,start_date,unit_id,position_id,manager_staff_id,provenance,seed_batch)
  VALUES (v_org,'SEED-003','David Test','david.test@example.invalid','active','permanent',ps,v_admin,p_amgr,s_ceo,'SEEDED',batch)
  ON CONFLICT (seed_batch,staff_no) DO UPDATE SET unit_id = EXCLUDED.unit_id, position_id = EXCLUDED.position_id, manager_staff_id = EXCLUDED.manager_staff_id
  RETURNING id INTO s_david;

  INSERT INTO public.staff_members (org_id,staff_no,full_name,work_email,employment_status,employment_type,start_date,unit_id,position_id,manager_staff_id,provenance,seed_batch)
  VALUES (v_org,'SEED-004','Grace Test','grace.test@example.invalid','active','permanent',ps,v_admin,p_aadm,s_david,'SEEDED',batch)
  ON CONFLICT (seed_batch,staff_no) DO UPDATE SET unit_id = EXCLUDED.unit_id, position_id = EXCLUDED.position_id, manager_staff_id = EXCLUDED.manager_staff_id
  RETURNING id INTO s_grace;

  UPDATE public.org_units SET head_staff_id = s_john WHERE id = v_sales AND head_staff_id IS NULL;
  UPDATE public.org_units SET head_staff_id = s_david WHERE id = v_admin AND head_staff_id IS NULL;

  -- objectives helper
  CREATE TEMP TABLE IF NOT EXISTS _seed_obj (
    title text, kpi text, unit text, baseline numeric, target numeric, weight numeric,
    owner uuid, dept uuid, critical boolean, src text, source_type text, descr text
  ) ON COMMIT DROP;
  DELETE FROM _seed_obj;

  INSERT INTO _seed_obj VALUES
   ('Achieve Sales Revenue Target','Recognized Sales Revenue Achieved','currency',0,2500000,20,s_john,v_sales,true,'Revenue / authoritative financial record','authoritative_system','Achieve KES 2,500,000 in recognized sales revenue from qualifying Yalla Mobility mobility services.'),
   ('Increase Activated Corporate Accounts','Corporate Accounts Activated','count',0,25,15,s_john,v_sales,false,'Corporate accounts register','authoritative_system',null),
   ('Increase New Customer Acquisition','New Customers Acquired','count',0,100,10,s_john,v_sales,true,'Customer register','authoritative_system',null),
   ('Maintain Qualified Sales Pipeline','Qualified Pipeline Value','currency',0,7500000,15,s_john,v_sales,true,'Sales OS pipeline','authoritative_system',null),
   ('Improve Qualified Opportunity Conversion','Qualified Opportunity Conversion Rate','percent',0,25,10,s_john,v_sales,false,'Sales OS opportunities','calculated',null),
   ('Retain Existing Customers','Customer Retention Rate','percent',0,90,10,s_john,v_sales,true,'Customer register','calculated',null),
   ('Activate Strategic Commercial Partnerships','Strategic Partnerships Activated','count',0,10,10,s_john,v_sales,false,'Partnership register','verified_manual',null),
   ('Improve Sales Forecast Accuracy','Sales Forecast Accuracy','percent',0,90,10,s_john,v_sales,true,'Forecast vs actual revenue','calculated',null),
   ('Maintain Lead Processing SLA','Leads Processed Within SLA','percent',0,98,15,s_amina,v_sales,false,'Sales OS lead queue','authoritative_system',null),
   ('Maintain CRM Data Accuracy','CRM Data Accuracy','percent',0,99,15,s_amina,v_sales,false,'CRM audit','verified_manual',null),
   ('Improve Quotation Turnaround','Quotations Completed Within SLA','percent',0,95,12,s_amina,v_sales,false,'Quotation records','authoritative_system',null),
   ('Complete Customer Onboarding Within SLA','Customer Onboarding Completion','percent',0,95,12,s_amina,v_sales,false,'Onboarding records','authoritative_system',null),
   ('Maintain Sales Pipeline Integrity','Pipeline Records Meeting Data Standard','percent',0,98,12,s_amina,v_sales,false,'Pipeline data audit','calculated',null),
   ('Maintain Sales Documentation Accuracy','Error-Free Sales Documents','percent',0,99,10,s_amina,v_sales,false,'Document review log','verified_manual',null),
   ('Maintain Sales Enquiry Response SLA','Enquiries Handled Within SLA','percent',0,95,8,s_amina,v_sales,false,'Enquiry queue','authoritative_system',null),
   ('Deliver Accurate and Timely Sales Reports','Reports Submitted Correctly and On Time','percent',0,100,6,s_amina,v_sales,false,'Reporting register','verified_manual',null),
   ('Maintain Follow-Up Action Compliance','Follow-Up Actions Completed Within SLA','percent',0,95,5,s_amina,v_sales,false,'Work item records','authoritative_system',null),
   ('Maintain Sales Process Compliance','Process Compliance','percent',0,95,5,s_amina,v_sales,false,'Process audit','verified_manual',null),
   ('Achieve Administrative SLA','Administrative Requests Within SLA','percent',0,95,25,s_david,v_admin,false,'Administration request queue','authoritative_system',null),
   ('Maintain Administrative Compliance','Administrative Compliance','percent',0,98,20,s_david,v_admin,false,'Compliance register','verified_manual',null),
   ('Maintain Records Accuracy','Records Accuracy','percent',0,99,15,s_david,v_admin,false,'Records audit','verified_manual',null),
   ('Manage Administration Budget','Budget Utilisation Within Plan','percent',0,95,15,s_david,v_admin,false,'Finance budget records','authoritative_system',null),
   ('Improve Internal Service Satisfaction','Internal Service Satisfaction','percent',0,90,15,s_david,v_admin,false,'Internal service survey','verified_manual',null),
   ('Deliver Administrative Process Improvement','Process Improvements Delivered','count',0,4,10,s_david,v_admin,false,'Improvement register','verified_manual',null),
   ('Meet Administrative Request SLA','Requests Resolved Within SLA','percent',0,95,25,s_grace,v_admin,false,'Administration request queue','authoritative_system',null),
   ('Maintain Document Accuracy','Error-Free Documents','percent',0,99,20,s_grace,v_admin,false,'Document review log','verified_manual',null),
   ('Maintain Records Management Accuracy','Records Correctly Filed','percent',0,98,20,s_grace,v_admin,false,'Records audit','verified_manual',null),
   ('Respond to Internal Service Requests','Internal Requests Acknowledged Within SLA','percent',0,95,15,s_grace,v_admin,false,'Service desk records','authoritative_system',null),
   ('Submit Administrative Reports On Time','Reports Submitted On Time','percent',0,100,10,s_grace,v_admin,false,'Reporting register','verified_manual',null),
   ('Maintain Administrative Process Compliance','Administrative Process Compliance','percent',0,95,10,s_grace,v_admin,false,'Process audit','verified_manual',null);

  INSERT INTO public.org_objectives
    (org_id, level, unit_id, staff_id, owner_staff_id, title, description, kpi_label, kpi_unit,
     baseline, target, period_start, period_end, deadline, status, provenance, seed_batch,
     weight_pct, is_critical, critical_min_pct, measurement_frequency, review_frequency,
     data_source, source_type, currency, formula)
  SELECT v_org, 'department', o.dept, o.owner, o.owner, o.title, o.descr, o.kpi, o.unit,
     o.baseline, o.target, ps, pe, pe, 'active', 'SEEDED', batch,
     o.weight, o.critical, CASE WHEN o.critical THEN 80 ELSE NULL END, 'monthly', 'monthly',
     o.src, o.source_type, CASE WHEN o.unit = 'currency' THEN 'KES' ELSE NULL END,
     'Actual ÷ Target × 100'
  FROM _seed_obj o
  ON CONFLICT (seed_batch, title) DO UPDATE
    SET target = EXCLUDED.target, weight_pct = EXCLUDED.weight_pct, unit_id = EXCLUDED.unit_id,
        owner_staff_id = EXCLUDED.owner_staff_id, staff_id = EXCLUDED.staff_id,
        data_source = EXCLUDED.data_source, is_critical = EXCLUDED.is_critical;

  -- deliberate edge cases
  INSERT INTO public.org_objectives
    (org_id, level, unit_id, staff_id, owner_staff_id, title, description, kpi_label, kpi_unit,
     baseline, target, period_start, period_end, deadline, status, provenance, seed_batch,
     weight_pct, measurement_frequency, data_source, source_type, currency, formula, is_historical)
  VALUES
    (v_org,'employee',v_sales,s_john,s_john,'Cross-Sell Revenue (Awaiting Actual)','Control case: no verified actual has been recorded, so achievement must read as not recorded rather than zero.','Cross-Sell Revenue','currency',0,1000000,ps,pe,pe,'active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','not_available','KES','Actual ÷ Target × 100',false),
    (v_org,'employee',v_sales,s_john,s_john,'Q1 Launch Revenue (Overdue)','Control case: historical objective whose deadline has passed with no recorded actual.','Launch Revenue','currency',0,500000,DATE '2026-01-01',DATE '2026-03-31',DATE '2026-03-31','active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','not_available','KES','Actual ÷ Target × 100',true),
    (v_org,'employee',v_sales,s_john,s_john,'Corporate Renewal Revenue (Exceeded)','Control case: performance above target must not be capped at 100%.','Renewal Revenue','currency',0,1000000,ps,pe,pe,'active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','authoritative_system','KES','Actual ÷ Target × 100',false),
    (v_org,'employee',v_sales,s_john,s_john,'Upsell Revenue (At Risk)','Control case: achievement materially behind expected progress.','Upsell Revenue','currency',0,2500000,ps,pe,pe,'active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','authoritative_system','KES','Actual ÷ Target × 100',false)
  ON CONFLICT (seed_batch, title) DO NOTHING;

  -- authoritative actuals (only when none recorded yet, keeping the seed idempotent)
  PERFORM 1;
  INSERT INTO public.staff_kpi_actuals (objective_id, period_start, period_end, value, unit, source_type, source_ref, note, seed_batch)
  SELECT o.id, ps, pe, v.val, o.kpi_unit, 'imported', 'synthetic-authoritative-source', 'Seeded controlled experiment actual', batch
  FROM public.org_objectives o
  JOIN (VALUES
    ('Achieve Sales Revenue Target', 1875000::numeric),
    ('Increase Activated Corporate Accounts', 18),
    ('Increase New Customer Acquisition', 72),
    ('Maintain Qualified Sales Pipeline', 6000000),
    ('Improve Qualified Opportunity Conversion', 21),
    ('Retain Existing Customers', 88),
    ('Activate Strategic Commercial Partnerships', 7),
    ('Improve Sales Forecast Accuracy', 86),
    ('Corporate Renewal Revenue (Exceeded)', 1250000),
    ('Upsell Revenue (At Risk)', 900000)
  ) AS v(title, val) ON v.title = o.title
  WHERE o.seed_batch = batch
    AND NOT EXISTS (SELECT 1 FROM public.staff_kpi_actuals a WHERE a.objective_id = o.id);

  SELECT count(*) INTO created FROM public.org_objectives WHERE seed_batch = batch;

  RETURN jsonb_build_object(
    'ok', true, 'seed_batch', batch, 'org_id', v_org,
    'sales_unit', v_sales, 'admin_unit', v_admin,
    'objectives', created,
    'staff', (SELECT count(*) FROM public.staff_members WHERE seed_batch = batch),
    'actuals', (SELECT count(*) FROM public.staff_kpi_actuals WHERE seed_batch = batch));
END;
$$;

REVOKE ALL ON FUNCTION public.seed_staff360_performance_v1() FROM public;
GRANT EXECUTE ON FUNCTION public.seed_staff360_performance_v1() TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_staff360_performance_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE batch text := 'staff360-performance-v1'; n_obj int; n_staff int;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  ALTER TABLE public.staff_kpi_actuals DISABLE TRIGGER staff_kpi_actuals_no_mutate;
  DELETE FROM public.staff_kpi_actuals WHERE seed_batch = batch;
  ALTER TABLE public.staff_kpi_actuals ENABLE TRIGGER staff_kpi_actuals_no_mutate;
  DELETE FROM public.org_objectives WHERE seed_batch = batch;
  GET DIAGNOSTICS n_obj = ROW_COUNT;
  UPDATE public.org_units SET head_staff_id = NULL
   WHERE head_staff_id IN (SELECT id FROM public.staff_members WHERE seed_batch = batch);
  DELETE FROM public.staff_members WHERE seed_batch = batch;
  GET DIAGNOSTICS n_staff = ROW_COUNT;
  DELETE FROM public.org_positions WHERE seed_batch = batch;
  DELETE FROM public.org_units WHERE seed_batch = batch;
  RETURN jsonb_build_object('ok', true, 'objectives_removed', n_obj, 'staff_removed', n_staff);
END;
$$;

REVOKE ALL ON FUNCTION public.rollback_staff360_performance_v1() FROM public;
GRANT EXECUTE ON FUNCTION public.rollback_staff360_performance_v1() TO authenticated;