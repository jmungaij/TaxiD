DO $realign$
DECLARE
  v_id uuid := '3c4bc11d-9efa-455b-9e44-0912f1506f36';
  v_snap jsonb;
  v_hash text;
  v_bp uuid := '9b60564f-c93b-4e19-900d-2b8e7ff31519';
  v_bp2 uuid := '7a13b000-5a1e-4262-8ead-260826000051';
  v_sc uuid := '7a13c000-5a1e-4262-8ead-260826000061';
BEGIN
  -------------------------------------------------------------
  -- 0. Compensation configuration column (role → policy link)
  -------------------------------------------------------------
  ALTER TABLE public.rec_vacancies ADD COLUMN IF NOT EXISTS compensation_config jsonb;

  -------------------------------------------------------------
  -- 1. Preserve the superseded published content (version 5)
  -------------------------------------------------------------
  SELECT to_jsonb(v) INTO v_snap FROM public.rec_vacancies v WHERE v.id = v_id;
  IF v_snap IS NULL THEN
    RAISE EXCEPTION 'Vacancy % not found', v_id;
  END IF;
  INSERT INTO public.rec_vacancy_versions (vacancy_id, version, content_hash, snapshot)
  SELECT v_id, (v_snap->>'content_version')::int, v_snap->>'content_hash', v_snap
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rec_vacancy_versions
    WHERE vacancy_id = v_id AND version = (v_snap->>'content_version')::int
  );

  -------------------------------------------------------------
  -- 2. Vacancy realignment
  -------------------------------------------------------------
  v_hash := md5('Sales Team Leader — Yalla Mobility' || '::v6');

  UPDATE public.rec_vacancies SET
    title = 'Sales Team Leader — Yalla Mobility',
    position_id = '7a11a000-5a1e-4262-8ead-260826000001',
    reports_to_position_id = 'ad01c730-f57f-4495-b674-2a53cbb80b0a',
    location = 'Nairobi, Kenya',
    employment_type = 'commission_based',
    work_arrangement = 'onsite',
    headcount = 1,
    min_years_experience = 3,
    salary_min_cents = NULL,
    salary_max_cents = NULL,
    role_purpose = 'Lead and develop the Yalla Mobility sales function by acquiring new customers, developing business opportunities, converting sales, growing existing accounts and generating revenue across Yalla Mobility''s corporate mobility and charter portfolio. The role is specifically responsible for developing and managing business across Employee & Corporate Mobility, Ground Charter, Air Charter and Short-Term Vehicle Rentals & Leasing. The Sales Team Leader will lead and coach sales activity, develop customer and corporate accounts, build and manage the sales pipeline, convert qualified opportunities into bookings and contracts, grow repeat business, and deliver measurable revenue performance. The role is structured as a commission-based commercial leadership position, with earnings consisting of commissions on qualifying business generated and performance-based bonuses tied to agreed sales and business-development outcomes.',
    public_summary = 'Lead and grow Yalla Mobility''s sales function across four commercial verticals — Employee & Corporate Mobility, Ground Charter, Air Charter and Short-Term Vehicle Rentals & Leasing. You will acquire corporate and institutional customers, coach sales personnel, convert qualified opportunities into bookings and contracts, and grow repeat business. Contract: Commission-Based Contract. Compensation: Commission + Performance-Based Bonuses, payable in accordance with the applicable Yalla Mobility commission and incentive structure. Based on-site in Nairobi, reporting to the Sales Manager / Head of Sales.',
    public_slug = 'sales-team-leader-yalla-mobility-x2pkv',
    blueprint_key = 'stl-yalla-mobility-v2',
    experience_statement = 'Minimum 3 years of relevant sales or business-development experience, with demonstrated ability to lead, supervise or coach sales personnel. Strong preference for B2B, corporate, transport/mobility, charter or vehicle rental sales experience with pipeline and CRM discipline.',
    qualification_level = 'Diploma or bachelor''s degree',
    equivalent_experience_accepted = true,
    qualifications = ARRAY['Sales','Marketing','Business Administration','Commerce','Business Development','Hospitality','Tourism','Logistics','Transport Management','Communications'],
    required_skills = ARRAY['Sales leadership','Prospecting','Lead generation','Business development','Consultative selling','Corporate sales','Negotiation','Closing','Account development','Pipeline management','CRM discipline','Sales forecasting','Commercial judgement','Team coaching','Performance management','Customer relationship management'],
    preferred_skills = ARRAY['Corporate mobility','Ground transport','Charter sales','Aviation charter','Vehicle rental','Leasing','Travel services','B2B sales','Enterprise sales','Strategic partnerships'],
    competencies = ARRAY['Sales leadership and coaching','Prospecting and lead generation','Consultative and corporate selling','Negotiation and closing','Account development and retention','Pipeline management and CRM discipline','Sales forecasting and commercial judgement','Performance management'],
    responsibilities = ARRAY[
      'Lead and coach sales personnel; allocate sales opportunities and support team execution.',
      'Set daily, weekly and monthly commercial priorities and monitor individual and team sales performance.',
      'Coach representatives on prospecting, qualification, negotiation and closing; drive sales discipline and CRM adoption.',
      'Generate new business opportunities and prospect corporate and institutional customers.',
      'Identify employers, institutions, NGOs, corporates, SMEs, hotels and project-based organisations with recurring mobility requirements.',
      'Develop corporate mobility programmes, ground charter, air charter and short-term vehicle rental and leasing opportunities.',
      'Qualify leads, conduct discovery and identify customer requirements.',
      'Prepare or coordinate quotations, present commercial solutions and negotiate within authorised commercial parameters.',
      'Close bookings, contracts and recurring accounts; ensure every opportunity is properly recorded in the CRM.',
      'Grow existing accounts, generate repeat business and cross-sell relevant Yalla Mobility services within the approved portfolio.',
      'Reactivate dormant customers and develop account plans for high-value customers.',
      'Coordinate with Operations, Fleet, Charter, Aviation, Pricing, Finance, Customer Success and the Partner Network to confirm services are commercially and operationally deliverable before making binding commitments.',
      'Coordinate aviation opportunities with the authorised aviation/charter operations function; never independently make aviation safety, regulatory, operational or aircraft availability guarantees.'
    ],
    accountability_groups = '[
      {"group":"Sales leadership","bullets":["Lead and coach sales personnel.","Allocate sales opportunities and support team execution.","Set daily, weekly and monthly commercial priorities.","Monitor individual and team sales performance.","Coach representatives on prospecting, qualification, negotiation and closing.","Drive sales discipline and CRM adoption."]},
      {"group":"Business development","bullets":["Generate new business opportunities.","Prospect corporate and institutional customers.","Develop strategic accounts.","Identify organisations with recurring mobility requirements.","Develop corporate mobility programmes.","Develop ground charter opportunities.","Develop air charter opportunities.","Develop vehicle rental and leasing opportunities."]},
      {"group":"Sales conversion","bullets":["Qualify leads and conduct discovery.","Identify customer requirements.","Prepare or coordinate quotations.","Present commercial solutions.","Negotiate within authorised commercial parameters.","Close bookings, contracts and recurring accounts.","Ensure commercial opportunities are properly recorded in CRM."]},
      {"group":"Account development","bullets":["Grow existing accounts.","Generate repeat business.","Cross-sell relevant Yalla Mobility services within the approved portfolio.","Reactivate dormant customers.","Develop account plans for high-value customers."]},
      {"group":"Commercial coordination","bullets":["Coordinate with Operations, Fleet, Charter, Aviation, Pricing, Finance, Customer Success and the Partner Network.","Establish that proposed services are commercially and operationally deliverable before making binding commitments.","Coordinate aviation opportunities with the authorised aviation/charter operations function."]}
    ]'::jsonb,
    success_outcomes = ARRAY[
      'Employee & Corporate Mobility: corporate accounts acquired, contracted recurring mobility value, corporate booking volume and account retention.',
      'Ground Charter: qualified charter opportunities, quote-to-book conversion, charter revenue and repeat charter customers.',
      'Air Charter: qualified aviation opportunities, quote-to-book conversion, charter revenue and high-value account acquisition.',
      'Short-Term Rentals & Leasing: rental customers acquired, rental revenue, leasing opportunities, repeat rental business and account value.'
    ],
    kpis = ARRAY[
      'Commissionable revenue','Total sales revenue','Sales target attainment','New corporate accounts','New customers acquired',
      'Qualified pipeline value','Lead-to-opportunity conversion','Quote-to-booking conversion','Booking-to-revenue conversion',
      'Repeat business','Account growth','Average deal value','Pipeline coverage','Forecast accuracy','Team sales target attainment'
    ],
    suitability = ARRAY[
      'Mandatory: 3+ years relevant sales/business-development experience.',
      'Mandatory: demonstrated ability to generate customers or revenue, prospect and close.',
      'Mandatory: CRM/pipeline experience and strong commercial communication.',
      'Mandatory: ability to work on-site in Nairobi.',
      'Mandatory: ability to work under commission/performance-based compensation.',
      'Preferred: team leadership, corporate sales, mobility, charter, aviation, vehicle rental/leasing, B2B account management.'
    ],
    recruitment_process = '[
      {"step":"Application","detail":"Submit your application through the Yalla Careers portal. You will receive an application reference immediately."},
      {"step":"Compensation acknowledgement","detail":"Confirm that you understand and accept the commission-based contract with performance-based bonuses. A No response flags your application for recruiter review — it is not an automatic rejection."},
      {"step":"Application review","detail":"Our recruitment team reviews applications against the role requirements, including sales experience, leadership capability and vertical exposure."},
      {"step":"Screening","detail":"Selected candidates are invited to a screening conversation covering prospecting, closing and CRM discipline."},
      {"step":"Assessment or interview","detail":"Candidates complete a weighted commercial assessment and/or panel interview covering sales performance, business development, negotiation, leadership and portfolio understanding."},
      {"step":"Final decision","detail":"Successful candidates proceed to offer and onboarding under the commission-based contract."}
    ]'::jsonb,
    compensation_config = jsonb_build_object(
      'model', 'commission_plus_performance_bonus',
      'contract_type', 'commission_based',
      'plan_code', 'YMC-2026-V1',
      'plan_reference', 'sales_commission_plans',
      'qualifying_event', 'Qualifying revenue on a confirmed booking/contract, recorded as a sales_commission_events row via commission_generate_event',
      'attribution_chain', jsonb_build_array('lead','opportunity','sales_owner','quote','booking_or_contract','qualifying_revenue','commission_event','commission_calculation','approval','payout'),
      'bonus_dimensions', jsonb_build_array('sales target attainment','new corporate accounts','qualified pipeline','revenue generation','conversion rate','repeat business','account growth','team target attainment','strategic account acquisition'),
      'bonus_configuration', 'Bonus KPIs, targets, periods, thresholds and eligibility are configured commercially; no bonus amounts or percentages are published here',
      'public_statement', 'Commission and performance-based bonuses are payable in accordance with the applicable Yalla Mobility commission and incentive structure.',
      'commission_ownership_note', 'Lead source, sales owner, account owner, service fulfilment owner and commission owner are distinct; attribution is auditable and double commission is prevented by unique event constraints'
    ),
    content_version = 6,
    content_hash = v_hash,
    updated_at = now()
  WHERE id = v_id;

  -------------------------------------------------------------
  -- 3. Slug alias: old Customer Success URL keeps resolving
  -------------------------------------------------------------
  INSERT INTO public.rec_vacancy_slug_aliases (slug, vacancy_id)
  VALUES ('customer-success-coordinator-506f36', v_id)
  ON CONFLICT DO NOTHING;

  -------------------------------------------------------------
  -- 4. Blueprint v2 — supersede v1, install new question set
  -------------------------------------------------------------
  UPDATE public.rec_blueprints SET status = 'retired' WHERE id = v_bp AND status = 'active';

  INSERT INTO public.rec_blueprints (id, vacancy_id, version, status, cover_letter_mode, sections, document_requirements)
  VALUES (v_bp2, v_id, 2, 'active', 'optional',
    '{"education":true,"employment":true,"qualifications":true,"skills":true}'::jsonb,
    '[{"doc_type":"cv","label":"CV / Résumé","required":true},{"doc_type":"cover_letter","label":"Cover letter","required":false},{"doc_type":"certificate","label":"Academic or professional certificates","required":false,"multiple":true},{"doc_type":"supporting","label":"Other supporting documents","required":false,"multiple":true}]'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight) VALUES
   (v_bp2, 1, 'work_authorisation', 'Are you legally authorised to work in Kenya?', NULL, 'boolean', '[]'::jsonb, true, 'knockout', 0),
   (v_bp2, 2, 'commission_model_acceptance', 'This position operates on a commission-based contract with performance-based bonuses in accordance with Yalla Mobility''s approved commercial incentive structure. Do you understand and accept this compensation model?', 'A "No" response flags your application for recruiter review — it is not an automatic rejection.', 'boolean', '[]'::jsonb, true, 'informational', 0),
   (v_bp2, 3, 'onsite_nairobi', 'This role is on-site in Nairobi, Kenya. Are you able to work on-site in Nairobi?', NULL, 'boolean', '[]'::jsonb, true, 'informational', 0),
   (v_bp2, 4, 'sales_bd_years', 'How many years of sales or business-development experience do you have?', NULL, 'number', '[]'::jsonb, true, 'scored', 3),
   (v_bp2, 5, 'sales_leadership_experience', 'Describe your experience leading, supervising or coaching sales personnel.', 'Include team size, how you set priorities and how you coached performance.', 'long_text', '[]'::jsonb, true, 'scored', 3),
   (v_bp2, 6, 'revenue_generation_evidence', 'Describe the customers or revenue you have personally generated: how you prospected, qualified, negotiated and closed the business.', NULL, 'long_text', '[]'::jsonb, true, 'scored', 4),
   (v_bp2, 7, 'vertical_exposure', 'Which of these markets have you sold into?', 'Select all that apply.', 'multi_choice', '["Employee & corporate mobility","Ground charter (bus, van, coach, group transport)","Air charter / business aviation","Short-term vehicle rentals & leasing","None of these"]'::jsonb, true, 'scored', 2),
   (v_bp2, 8, 'crm_pipeline_discipline', 'Which CRM or sales pipeline tools have you used, and how did you keep your pipeline accurate?', NULL, 'long_text', '[]'::jsonb, true, 'scored', 2),
   (v_bp2, 9, 'closing_scenario', 'Describe a corporate or B2B deal you closed that you are proud of — the discovery, the negotiation and the close.', NULL, 'long_text', '[]'::jsonb, true, 'scored', 3),
   (v_bp2, 10, 'notice_period', 'What is your notice period?', NULL, 'single_choice', '["Immediate","2 weeks","1 month","2 months","3 months or more"]'::jsonb, true, 'informational', 0)
  ON CONFLICT DO NOTHING;

  -------------------------------------------------------------
  -- 5. Assessment scorecard — approved weighting model
  -------------------------------------------------------------
  UPDATE public.rec_scorecards SET status = 'retired'
  WHERE vacancy_id = v_id AND status = 'active';

  INSERT INTO public.rec_scorecards (id, vacancy_id, version, status, notes)
  VALUES (v_sc, v_id, 1, 'active', 'Sales Team Leader commercial assessment model v1 — weights approved in role realignment brief')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.rec_scorecard_criteria (scorecard_id, code, label, criterion_type, weight, evidence_source, scoring_method, guidance, sort_order) VALUES
   (v_sc, 'sales_performance', 'Sales performance', 'scored', 20, 'interview_and_assessment', 'manual', 'Demonstrated revenue generation and target attainment history.', 1),
   (v_sc, 'business_development', 'Business development', 'scored', 15, 'interview_and_assessment', 'manual', 'Prospecting, lead generation and new-opportunity creation.', 2),
   (v_sc, 'corporate_account_acquisition', 'Corporate / account acquisition', 'scored', 10, 'interview_and_assessment', 'manual', 'Winning corporate, institutional or strategic accounts.', 3),
   (v_sc, 'negotiation_closing', 'Negotiation & closing', 'scored', 10, 'interview_and_assessment', 'manual', 'Negotiation within authorised parameters and closing discipline.', 4),
   (v_sc, 'sales_leadership', 'Sales leadership', 'scored', 10, 'interview_and_assessment', 'manual', 'Leading, supervising and coaching sales personnel.', 5),
   (v_sc, 'pipeline_crm_discipline', 'Pipeline / CRM discipline', 'scored', 10, 'interview_and_assessment', 'manual', 'Pipeline hygiene, forecasting and CRM adoption.', 6),
   (v_sc, 'commercial_judgement', 'Commercial judgement', 'scored', 10, 'interview_and_assessment', 'manual', 'Sound commercial decisions; deliverability before commitment.', 7),
   (v_sc, 'portfolio_understanding', 'Portfolio understanding', 'scored', 10, 'interview_and_assessment', 'manual', 'Grasp of the four verticals: corporate mobility, ground charter, air charter, rentals & leasing.', 8),
   (v_sc, 'communication_problem_solving', 'Communication / problem solving', 'scored', 5, 'interview_and_assessment', 'manual', 'Commercial communication and structured problem solving.', 9)
  ON CONFLICT DO NOTHING;
END $realign$;