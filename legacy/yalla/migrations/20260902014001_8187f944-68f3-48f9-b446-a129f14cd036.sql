-- 1. Explicit assessment applicability decision (removes the silent NOT_APPLICABLE)
CREATE TABLE IF NOT EXISTS public.rec_vacancy_assessment_decisions (
  vacancy_id uuid PRIMARY KEY REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('REQUIRED','NOT_APPLICABLE')),
  reason text NOT NULL,
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_vacancy_assessment_decisions TO authenticated;
GRANT ALL ON public.rec_vacancy_assessment_decisions TO service_role;
ALTER TABLE public.rec_vacancy_assessment_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rec_vad_read ON public.rec_vacancy_assessment_decisions;
CREATE POLICY rec_vad_read ON public.rec_vacancy_assessment_decisions
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.recruitment.read'));

CREATE OR REPLACE FUNCTION public.rec_vacancy_assessment_decision_set(
  p_vacancy uuid, p_decision text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_row public.rec_vacancy_assessment_decisions;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: staff.recruitment.manage required';
  END IF;
  IF p_decision NOT IN ('REQUIRED','NOT_APPLICABLE') THEN
    RAISE EXCEPTION 'INVALID_DECISION: %', p_decision;
  END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED: an applicability decision must be justified';
  END IF;

  INSERT INTO public.rec_vacancy_assessment_decisions(vacancy_id, decision, reason, decided_by)
  VALUES (p_vacancy, p_decision, btrim(p_reason), auth.uid())
  ON CONFLICT (vacancy_id) DO UPDATE
     SET decision = excluded.decision, reason = excluded.reason,
         decided_by = excluded.decided_by, decided_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.rec_audit_events(actor, action, object, new_state, context, source)
  VALUES (auth.uid(), 'rec.vacancy.assessment_decision', p_vacancy::text,
          to_jsonb(v_row), jsonb_build_object('decision', p_decision), 'rec_vacancy_assessment_decision_set');

  RETURN to_jsonb(v_row);
END $fn$;

REVOKE ALL ON FUNCTION public.rec_vacancy_assessment_decision_set(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_vacancy_assessment_decision_set(uuid,text,text) TO authenticated, service_role;

-- 2. Corporate Sales competency framework (one competency per hard requirement)
INSERT INTO public.rec_competencies(code,label,description,role_family,is_active) VALUES
 ('cs_ride_hailing_experience','Ride-hailing corporate sales experience','Depth and authenticity of at least two years corporate sales experience inside a ride-hailing or comparable mobility platform.','corporate_sales',true),
 ('cs_portfolio_growth','Corporate portfolio acquisition & growth','Ability to acquire, retain and expand a corporate account portfolio, evidenced by named accounts and outcomes.','corporate_sales',true),
 ('cs_corporate_mobility','Corporate travel & mobility domain','Command of corporate travel, transportation and mobility buying, policy and stakeholder dynamics.','corporate_sales',true),
 ('cs_target_performance','Target and KPI performance','Consistency of meeting or exceeding quota, with verifiable numbers and the mechanisms used.','corporate_sales',true),
 ('cs_field_execution','Field execution readiness','Self-direction and willingness to run intensive field prospecting, corporate visits and meetings from day one.','corporate_sales',true)
ON CONFLICT (code) DO UPDATE SET label=excluded.label, description=excluded.description,
  role_family=excluded.role_family, is_active=true, updated_at=now();

INSERT INTO public.rec_vacancy_competencies(vacancy_id,competency_code,weight,mandatory,min_marks,sort_order)
SELECT 'c1ef4b1e-6ff1-469f-b7e5-3d15b9a9e4d4'::uuid, c.code, c.w, true, c.m, c.o
FROM (VALUES
 ('cs_ride_hailing_experience',25,6,10),
 ('cs_portfolio_growth',25,6,20),
 ('cs_corporate_mobility',20,5,30),
 ('cs_target_performance',20,5,40),
 ('cs_field_execution',10,2,50)
) AS c(code,w,m,o)
ON CONFLICT (vacancy_id,competency_code) DO UPDATE
  SET weight=excluded.weight, mandatory=excluded.mandatory,
      min_marks=excluded.min_marks, sort_order=excluded.sort_order, updated_at=now();

-- 3. Published question versions bound to those competencies
INSERT INTO public.rec_question_bank(
  question_key,version,competency_code,competency_label,prompt,question_type,max_marks,
  probes,good_indicators,weak_indicators,scoring_anchors,expected_evidence,role_family,
  status,publication_status,difficulty,origin,published_at)
SELECT q.k,1,q.cc,c.label,q.prompt,q.qt,q.marks,
  q.probes::text[], q.good::text[], q.weak::text[],
  jsonb_build_object('0','No credible evidence','1','Asserted but unverifiable',
                     '2','Specific but partial','3','Specific, quantified and verifiable'),
  q.evidence,'corporate_sales','active','published',q.diff,'human',now()
FROM (VALUES
 ('cs_q_ride_hailing_v1','cs_ride_hailing_experience','Walk through your corporate sales role at a ride-hailing or mobility platform: dates, employer, territory, and the corporate segments you sold into.','cv_validation',10,
   ARRAY['Which platform and exact period?','What was your quota and segment?'],ARRAY['Named platform and verifiable dates','Quota and segment stated'],ARRAY['Vague employer or period','Consumer-side work presented as corporate'],'Contract, payslip or reference confirming the period and role','advanced'),
 ('cs_q_portfolio_v1','cs_portfolio_growth','Describe a corporate portfolio you owned: how you acquired accounts, retained them, and grew revenue. Give named accounts and numbers.','role_specific',10,
   ARRAY['Starting vs ending portfolio value?','What caused the growth?'],ARRAY['Named accounts with before/after revenue','Clear retention mechanism'],ARRAY['Only inbound accounts','No numbers'],'Portfolio or account-performance evidence','advanced'),
 ('cs_q_mobility_v1','cs_corporate_mobility','A corporate client wants to move staff transport from allowances to a managed mobility programme. How do you structure the proposal and who must approve it?','situational',10,
   ARRAY['Which stakeholders and why?','How do you handle policy and cost control?'],ARRAY['Correct buying-centre map','Policy, controls and reporting addressed'],ARRAY['Treats it as a consumer sale'],'Reasoning quality assessed against the rubric','intermediate'),
 ('cs_q_targets_v1','cs_target_performance','State your last four quarterly targets and actual attainment, and explain the mechanism you used to hit them.','commercial',10,
   ARRAY['Exact figures per quarter?','What did you do when behind?'],ARRAY['Quantified attainment','Repeatable mechanism described'],ARRAY['Only qualitative claims'],'Sales performance evidence or reference','advanced'),
 ('cs_q_field_v1','cs_field_execution','Plan your first two weeks of field activity in Nairobi: prospect list construction, visit cadence and weekly output commitment.','work_simulation',10,
   ARRAY['How many visits per day?','How is the list built?'],ARRAY['Concrete cadence and output','Independent, self-directed plan'],ARRAY['Waits for leads to be provided'],'Plan quality assessed against the rubric','intermediate')
) AS q(k,cc,prompt,qt,marks,probes,good,weak,evidence,diff)
JOIN public.rec_competencies c ON c.code = q.cc
ON CONFLICT (question_key,version) DO NOTHING;

-- 4a. Compose the paper as a DRAFT (its item list is only mutable while draft)
INSERT INTO public.rec_assessment_templates(
  template_key,version,title,role_family,vacancy_id,status,total_marks,band_rules,notes,
  blueprint_id,blueprint_version,coverage)
SELECT 'vac-VAC-202609-L6QO4',1,'Corporate Sales Specialist — competency assessment v1',
       'corporate_sales','c1ef4b1e-6ff1-469f-b7e5-3d15b9a9e4d4','draft',50,
       jsonb_build_object('pass',30,'strong',40,'critical_min_rule','every mandatory competency must meet its minimum'),
       'Composed from the five mandatory vacancy requirements; one question per competency.',
       bp.id,bp.version,
       jsonb_build_object('competencies',jsonb_build_array('cs_ride_hailing_experience','cs_portfolio_growth','cs_corporate_mobility','cs_target_performance','cs_field_execution'))
FROM (SELECT id, version FROM public.rec_blueprints
       WHERE vacancy_id='c1ef4b1e-6ff1-469f-b7e5-3d15b9a9e4d4' AND status='active'
       ORDER BY version DESC LIMIT 1) bp
ON CONFLICT (template_key,version) DO UPDATE
  SET status='draft', blueprint_id=excluded.blueprint_id, blueprint_version=excluded.blueprint_version,
      coverage=excluded.coverage, total_marks=excluded.total_marks, band_rules=excluded.band_rules,
      updated_at=now();

-- 4b. Items
INSERT INTO public.rec_assessment_template_items(template_id,question_id,sort_order,max_marks,critical_min,mandatory)
SELECT t.id, qb.id, i.o, 10, i.m, true
FROM public.rec_assessment_templates t
JOIN (VALUES ('cs_q_ride_hailing_v1',10,6),('cs_q_portfolio_v1',20,6),('cs_q_mobility_v1',30,5),
             ('cs_q_targets_v1',40,5),('cs_q_field_v1',50,2)) AS i(k,o,m) ON true
JOIN public.rec_question_bank qb ON qb.question_key=i.k AND qb.version=1
WHERE t.template_key='vac-VAC-202609-L6QO4' AND t.version=1
  AND NOT EXISTS (SELECT 1 FROM public.rec_assessment_template_items x
                   WHERE x.template_id=t.id AND x.question_id=qb.id);

-- 4c. Activate only once the composition is complete
UPDATE public.rec_assessment_templates t
   SET status='active', activated_at=now(), updated_at=now()
 WHERE t.template_key='vac-VAC-202609-L6QO4' AND t.version=1
   AND (SELECT count(*) FROM public.rec_assessment_template_items i WHERE i.template_id=t.id) = 5;

-- 5. This vacancy explicitly REQUIRES an assessment
INSERT INTO public.rec_vacancy_assessment_decisions(vacancy_id,decision,reason)
VALUES ('c1ef4b1e-6ff1-469f-b7e5-3d15b9a9e4d4','REQUIRED',
        'Senior commercial hire with five hard evidence requirements; competency scoring is required evidence.')
ON CONFLICT (vacancy_id) DO UPDATE SET decision='REQUIRED', reason=excluded.reason, decided_at=now();

-- 6. Readiness: distinguish NOT_CONFIGURED from a recorded NOT_APPLICABLE exemption
CREATE OR REPLACE FUNCTION public.rec_publication_readiness(p_vacancy uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_spec public.rec_internship_specs;
  v_bp public.rec_blueprints;
  v_req record;
  v_cfg record;
  v_e2e public.rec_publication_gate_runs;
  v_gate jsonb;
  v_domains jsonb := '[]'::jsonb;
  v_comp integer;
  v_tmpl integer;
  v_dec public.rec_vacancy_assessment_decisions;
  v_comp_state text; v_comp_reason text; v_comp_action text;
  v_as_state text; v_as_reason text;
  v_prereq_ok boolean;
  v_doc_state text;
  v_doc_reason text;
  v_doc_action text;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RETURN jsonb_build_object('verdict','UNKNOWN','reason','Vacancy not found.'); END IF;

  SELECT * INTO c FROM public.rec_application_contract WHERE id;
  SELECT * INTO v_spec FROM public.rec_internship_specs WHERE vacancy_id = p_vacancy;
  SELECT * INTO v_bp FROM public.rec_blueprints WHERE vacancy_id = p_vacancy AND status = 'active';
  SELECT rs.id, rs.version, rs.vacancy_content_version INTO v_req
    FROM public.rec_document_requirement_sets rs
   WHERE rs.vacancy_id = p_vacancy AND rs.status = 'active' ORDER BY rs.version DESC LIMIT 1;
  SELECT rs.version, rs.status INTO v_cfg
    FROM public.rec_document_requirement_sets rs
   WHERE rs.vacancy_id = p_vacancy AND rs.status IN ('draft','review','approved')
     AND EXISTS (SELECT 1 FROM public.rec_document_requirement_rules r WHERE r.set_id = rs.id)
   ORDER BY rs.version DESC LIMIT 1;
  SELECT * INTO v_e2e FROM public.rec_publication_gate_runs
   WHERE vacancy_id = p_vacancy AND gate = 'E2E' ORDER BY created_at DESC LIMIT 1;
  v_gate := public.rec_publication_gate_status(p_vacancy);

  SELECT count(*) INTO v_comp FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy;
  SELECT count(*) INTO v_tmpl FROM public.rec_assessment_templates
   WHERE vacancy_id = p_vacancy AND status = 'active';
  SELECT * INTO v_dec FROM public.rec_vacancy_assessment_decisions WHERE vacancy_id = p_vacancy;

  v_domains := v_domains || jsonb_build_object(
    'key','programme','label','Programme configuration',
    'state', CASE WHEN v.employment_type = 'internship' AND v_spec.id IS NULL THEN 'FAIL' ELSE 'PASS' END,
    'reason', CASE WHEN v.employment_type = 'internship' AND v_spec.id IS NULL
                   THEN 'The internship has no programme specification.' ELSE 'Vacancy configuration is present.' END,
    'dependency', null, 'owner','Recruitment lead','action','Open the internship builder');

  v_domains := v_domains || jsonb_build_object(
    'key','education','label','Education requirements',
    'state', CASE WHEN public.rec_education_policy(p_vacancy) <> '{}'::jsonb THEN 'PASS' ELSE 'FAIL' END,
    'reason','The education policy engine resolves an executable contract for this vacancy.',
    'dependency','programme','owner','Recruitment lead','action','Configure education requirements');

  IF v_req.version IS NOT NULL
     AND coalesce(v_req.vacancy_content_version,-1) = coalesce(v.content_version,-1) THEN
    v_doc_state := 'PASS';
    v_doc_reason := format('Requirement contract v%s bound to content v%s.', v_req.version, v.content_version);
    v_doc_action := 'Review requirement contract';
  ELSIF v_cfg.version IS NOT NULL AND v_cfg.status IN ('draft','review') THEN
    v_doc_state := 'FAIL';
    v_doc_reason := format('Requirement version v%s is %s. Approve it — automated provisioning may not publish an unapproved contract.',
                           v_cfg.version, upper(v_cfg.status));
    v_doc_action := 'Approve requirement version';
  ELSIF v_req.version IS NULL THEN
    v_doc_state := 'FAIL';
    v_doc_reason := 'No vacancy-scoped requirement contract is active.';
    v_doc_action := 'Prepare publication contract';
  ELSE
    v_doc_state := 'FAIL';
    v_doc_reason := format('Contract is bound to content v%s; the vacancy is v%s.',
                           v_req.vacancy_content_version, v.content_version);
    v_doc_action := 'Prepare publication contract';
  END IF;

  v_domains := v_domains || jsonb_build_object(
    'key','document_contract','label','Document requirement contract',
    'state', v_doc_state, 'reason', v_doc_reason,
    'dependency','education','owner','Recruitment lead','action', v_doc_action);

  v_domains := v_domains || jsonb_build_object(
    'key','blueprint','label','Application blueprint',
    'state', CASE WHEN v_bp.id IS NULL THEN 'FAIL'
                  WHEN v_req.id IS NOT NULL AND v_bp.requirement_set_id IS DISTINCT FROM v_req.id THEN 'FAIL'
                  ELSE 'PASS' END,
    'reason', CASE WHEN v_bp.id IS NULL THEN 'No active application form exists for this vacancy.'
                   WHEN v_req.id IS NOT NULL AND v_bp.requirement_set_id IS DISTINCT FROM v_req.id
                     THEN format('Blueprint v%s was compiled from a different requirement version — it must be re-provisioned.', v_bp.version)
                   ELSE format('Blueprint v%s active, compiled from requirement v%s.',
                               v_bp.version, coalesce(v_bp.requirement_version, v_req.version)) END,
    'dependency','document_contract','owner','Recruitment lead','action','Prepare publication contract');

  -- Competency framework: an absent map is NOT_CONFIGURED (a blocker), never a silent exemption.
  IF v_comp > 0 THEN
    v_comp_state := 'PASS';
    v_comp_reason := format('%s competencies mapped to this vacancy.', v_comp);
    v_comp_action := 'Review competency map';
  ELSIF v_dec.decision = 'NOT_APPLICABLE' THEN
    v_comp_state := 'NOT_APPLICABLE';
    v_comp_reason := format('Competency assessment was explicitly recorded as not applicable on %s: %s',
                            to_char(v_dec.decided_at,'YYYY-MM-DD'), v_dec.reason);
    v_comp_action := 'Review applicability decision';
  ELSE
    v_comp_state := 'FAIL';
    v_comp_reason := 'NOT CONFIGURED — no competencies are mapped and no exemption has been recorded. '
                  || 'Map the competencies for this role, or record an explicit not-applicable decision with a reason.';
    v_comp_action := 'Map competencies';
  END IF;

  v_domains := v_domains || jsonb_build_object(
    'key','competencies','label','Competency framework',
    'state', v_comp_state, 'reason', v_comp_reason,
    'dependency','programme','owner','SME / Hiring manager','action', v_comp_action);

  IF v_dec.decision = 'NOT_APPLICABLE' THEN
    v_as_state := 'NOT_APPLICABLE';
    v_as_reason := format('No assessment paper is required: %s', v_dec.reason);
  ELSIF v_comp = 0 THEN
    v_as_state := 'PENDING';
    v_as_reason := 'Cannot compose a paper until the competency map is configured.';
  ELSIF v_tmpl > 0 THEN
    v_as_state := 'PASS';
    v_as_reason := 'An active assessment paper is bound to this vacancy.';
  ELSE
    v_as_state := 'FAIL';
    v_as_reason := 'Competencies are mapped but no assessment paper has been activated.';
  END IF;

  v_domains := v_domains || jsonb_build_object(
    'key','assessment','label','Assessment blueprint',
    'state', v_as_state, 'reason', v_as_reason,
    'dependency','competencies','owner','SME / HR','action','Compose assessment paper');

  v_domains := v_domains || jsonb_build_object(
    'key','careers_build','label','Careers build registration',
    'state', CASE WHEN coalesce(c.careers_build_id,'') <> '' THEN 'PASS' ELSE 'FAIL' END,
    'reason', CASE WHEN coalesce(c.careers_build_id,'') <> ''
                   THEN format('Build %s registered as authoritative.', c.careers_build_id)
                   ELSE 'No deployed careers build is registered — the stale-bundle handshake cannot be evaluated.' END,
    'dependency', null, 'owner','Platform engineering','action','Register current deployment');

  v_domains := v_domains || jsonb_build_object(
    'key','security','label','Validation & access control',
    'state', CASE WHEN (v_gate->'gates'->'validation'->>'passed')::boolean THEN 'PASS' ELSE 'FAIL' END,
    'reason', coalesce(nullif((v_gate->'gates'->'validation'->'blockers')::text,'[]'),
                       'Approval, status, public link and org position are all in order.'),
    'dependency','programme','owner','Recruitment lead','action','Resolve validation blockers');

  v_prereq_ok := v_bp.id IS NOT NULL AND v_req.version IS NOT NULL AND coalesce(c.careers_build_id,'') <> '';
  v_domains := v_domains || jsonb_build_object(
    'key','e2e','label','Synthetic end-to-end run',
    'state', CASE WHEN NOT v_prereq_ok THEN 'PENDING'
                  WHEN (v_gate->'gates'->'e2e'->>'passed')::boolean THEN 'PASS' ELSE 'FAIL' END,
    'reason', CASE WHEN NOT v_prereq_ok
                     THEN 'Cannot run until the blueprint, requirement contract and careers build exist.'
                   ELSE coalesce(nullif((v_gate->'gates'->'e2e'->'blockers')::text,'[]'),
                                 format('%s of %s cases passed.', v_e2e.cases_passed, v_e2e.cases_total)) END,
    'dependency','blueprint','owner','Recruitment engineering','action','Prepare publication contract');

  v_domains := v_domains || jsonb_build_object(
    'key','publication','label','Publication approval',
    'state', CASE WHEN v.publication_status = 'published' THEN 'PASS' ELSE 'PENDING' END,
    'reason', format('Publication status is %s; gate verdict is %s.', v.publication_status, v_gate->>'verdict'),
    'dependency','e2e','owner','Hiring authority','action','Publish vacancy');

  RETURN jsonb_build_object(
    'vacancy_id', v.id, 'vacancy_no', v.vacancy_no, 'title', v.title,
    'employment_type', v.employment_type, 'content_version', v.content_version,
    'publication_status', v.publication_status, 'checked_at', now(),
    'domains', v_domains,
    'gate', v_gate,
    'verdict', v_gate->>'verdict');
END $fn$;

REVOKE ALL ON FUNCTION public.rec_publication_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_publication_readiness(uuid) TO authenticated, service_role;
