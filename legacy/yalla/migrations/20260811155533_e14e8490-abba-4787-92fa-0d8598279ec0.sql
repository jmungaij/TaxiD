CREATE OR REPLACE FUNCTION public.staff360_seed_allowed()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.is_platform_admin() OR current_user IN ('service_role','postgres','supabase_admin');
END;
$$;
REVOKE ALL ON FUNCTION public.staff360_seed_allowed() FROM public;
GRANT EXECUTE ON FUNCTION public.staff360_seed_allowed() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_staff360_performance_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  batch text := 'staff360-performance-v1';
  v_org uuid; v_div uuid; v_sales uuid; v_admin uuid;
  p_ceo uuid; p_smgr uuid; p_sadm uuid; p_amgr uuid; p_aadm uuid;
  s_ceo uuid; s_john uuid; s_amina uuid; s_david uuid; s_grace uuid;
  created int := 0;
  ps date := DATE '2026-01-01'; pe date := DATE '2026-12-31';
BEGIN
  IF NOT public.staff360_seed_allowed() THEN RAISE EXCEPTION 'forbidden'; END IF;

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
     'Actual / Target x 100'
  FROM _seed_obj o
  ON CONFLICT (seed_batch, title) DO UPDATE
    SET target = EXCLUDED.target, weight_pct = EXCLUDED.weight_pct, unit_id = EXCLUDED.unit_id,
        owner_staff_id = EXCLUDED.owner_staff_id, staff_id = EXCLUDED.staff_id,
        data_source = EXCLUDED.data_source, is_critical = EXCLUDED.is_critical;

  INSERT INTO public.org_objectives
    (org_id, level, unit_id, staff_id, owner_staff_id, title, description, kpi_label, kpi_unit,
     baseline, target, period_start, period_end, deadline, status, provenance, seed_batch,
     weight_pct, measurement_frequency, data_source, source_type, currency, formula, is_historical)
  VALUES
    (v_org,'employee',v_sales,s_john,s_john,'Cross-Sell Revenue (Awaiting Actual)','Control case: no verified actual has been recorded, so achievement must read as not recorded rather than zero.','Cross-Sell Revenue','currency',0,1000000,ps,pe,pe,'active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','not_available','KES','Actual / Target x 100',false),
    (v_org,'employee',v_sales,s_john,s_john,'Q1 Launch Revenue (Overdue)','Control case: historical objective whose deadline has passed with no recorded actual.','Launch Revenue','currency',0,500000,DATE '2026-01-01',DATE '2026-03-31',DATE '2026-03-31','active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','not_available','KES','Actual / Target x 100',true),
    (v_org,'employee',v_sales,s_john,s_john,'Corporate Renewal Revenue (Exceeded)','Control case: performance above target must not be capped at 100%.','Renewal Revenue','currency',0,1000000,ps,pe,pe,'active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','authoritative_system','KES','Actual / Target x 100',false),
    (v_org,'employee',v_sales,s_john,s_john,'Upsell Revenue (At Risk)','Control case: achievement materially behind expected progress.','Upsell Revenue','currency',0,2500000,ps,pe,pe,'active','SEEDED',batch,NULL,'monthly','Revenue / authoritative financial record','authoritative_system','KES','Actual / Target x 100',false)
  ON CONFLICT (seed_batch, title) DO NOTHING;

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
    ('Maintain Lead Processing SLA', 96),
    ('Maintain CRM Data Accuracy', 97),
    ('Improve Quotation Turnaround', 93),
    ('Achieve Administrative SLA', 92),
    ('Maintain Administrative Compliance', 97),
    ('Meet Administrative Request SLA', 90),
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

CREATE OR REPLACE FUNCTION public.rollback_staff360_performance_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE batch text := 'staff360-performance-v1'; n_obj int; n_staff int;
BEGIN
  IF NOT public.staff360_seed_allowed() THEN RAISE EXCEPTION 'forbidden'; END IF;
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