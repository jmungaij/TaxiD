-- ============================================================================
-- YALLA MOBILITY — COMMERCIAL SALES ORGANISATION REALIGNMENT
-- Three-specialist sales engine under the Sales Team Leader, inside the
-- existing Recruitment 360 + org architecture. Non-destructive: legacy roles
-- are archived/historical, never deleted.
-- ============================================================================

-- ------------------------------------------------------------ 0. Unit rename
UPDATE public.org_units
SET name = 'Sales & Commercial', updated_at = now()
WHERE id = '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc' AND name = 'Sales';

-- ------------------------------------------------- 1. New canonical positions
INSERT INTO public.org_positions
  (id, code, title, unit_id, reports_to_position_id, job_purpose, responsibilities, authority, kpis, approved_headcount, status, provenance, seed_batch)
VALUES
  ('7a11a000-5a1e-4262-8ead-260826000001', 'SLS-LEAD', 'Sales Team Leader',
   '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', 'ad01c730-f57f-4495-b674-2a53cbb80b0a',
   'Owns the Sales & Commercial team: team revenue, target, pipeline, conversion, productivity, forecast, coaching, performance management, commercial discipline, sales quality and KPI governance.',
   ARRAY['Own team revenue, target attainment, pipeline and conversion','Run the daily/weekly/monthly sales operating rhythm','Coach and performance-manage the three specialist roles','Govern forecasts, commercial discipline and sales quality','Own team KPI governance and reconciliation to source records'],
   ARRAY['Approves sales team operating rhythm and cadence','Owns pipeline, conversion and forecast reviews','Escalation point for approved pricing authority workflows'],
   '["team_revenue","team_target_attainment","team_pipeline","team_conversion","team_productivity","team_forecast_accuracy","coaching_cadence","commercial_discipline","sales_quality","kpi_governance"]'::jsonb,
   1, 'active', 'SEEDED', 'sales-org-realignment-2026-08-26'),

  ('7a11a000-5a1e-4262-8ead-260826000002', 'SLS-MOB', 'Mobility Specialist',
   '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', '7a11a000-5a1e-4262-8ead-260826000001',
   'Create, acquire, develop, retain and grow customers across Yalla Mobility''s core mobility ecosystem — rides, airport transfers, corporate mobility, ground mobility and rentals. Principal customer-facing mobility sales professional, owning the journey from customer need to repeat business and account growth.',
   ARRAY['Prospect and generate new customers across riders, professionals, SMEs, corporates, NGOs, institutions, hotels and travel businesses','Qualify leads and conduct customer discovery; recommend appropriate Yalla Mobility services','Convert enquiries into bookings and develop corporate mobility opportunities','Build account relationships, increase frequency, drive repeat bookings, cross-sell and reactivate dormant customers','Maintain CRM accuracy, pipeline, forecasts and interaction records'],
   ARRAY['Owns customer acquisition and mobility revenue within assigned accounts','Hands charter, rental and complex quotation work to the Sales Support Specialist, preserving originating attribution','No independent pricing-override or discount authority'],
   '["new_customers_acquired","new_corporate_accounts","qualified_leads","qualified_opportunities","bookings","revenue","commissionable_revenue","conversion_rate","repeat_business_rate","retention","account_growth","cross_sell_revenue","pipeline_value","pipeline_coverage","crm_completeness","forecast_accuracy"]'::jsonb,
   1, 'active', 'SEEDED', 'sales-org-realignment-2026-08-26'),

  ('7a11a000-5a1e-4262-8ead-260826000003', 'SLS-SUP', 'Sales Support Specialist',
   '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', '7a11a000-5a1e-4262-8ead-260826000001',
   'Commercially active inside-sales specialist who accelerates response, qualification, specification, quotation, proposal, follow-up and conversion across ground charter, air charter, rentals, leasing and corporate mobility. The commercial bridge between customer, sales, pricing, fleet/supply, charter, rentals and operations.',
   ARRAY['Receive and qualify sales enquiries; capture complete customer specifications','Prepare quotation requests and coordinate pricing, fleet, charter and aircraft availability through the appropriate owners','Prepare proposals, follow up quotations, track expiry and pending decisions','Monitor quote-to-booking conversion; reactivate dormant and unclosed opportunities','Maintain opportunity records, CRM hygiene, sales documentation and commercial reporting support'],
   ARRAY['Operates strictly within approved authority — never independently approves unauthorised discounts, guarantees vehicle/aircraft availability or operational feasibility, approves exceptional contract terms or overrides pricing authority','Escalates complex opportunities to the appropriate specialist or operational owner'],
   '["qualified_enquiries_processed","response_time","quotation_turnaround_time","quotations_issued","quote_to_booking_conversion","booking_conversion","supported_revenue","attributable_commissionable_revenue","dormant_opportunity_reactivation","crm_completeness","follow_up_completion","lost_opportunity_recovery","pipeline_hygiene","support_sla_compliance"]'::jsonb,
   1, 'active', 'SEEDED', 'sales-org-realignment-2026-08-26'),

  ('7a11a000-5a1e-4262-8ead-260826000004', 'SLS-PRT', 'Mobility Partnerships Specialist',
   '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', '7a11a000-5a1e-4262-8ead-260826000001',
   'Develop, acquire, activate, manage and grow Yalla Mobility''s commercial partnership portfolio as a revenue-generating portfolio across demand/distribution, supply and technology partners — using the existing Yalla Partners architecture. A signed agreement is not success; activation and commercial output are.',
   ARRAY['Identify, prospect and qualify strategic partners (travel & tourism, tour operators, DMCs, travel agencies, hotels, lodges, resorts, corporate, institutional, event, destination, referral and distribution partners)','Develop partnership propositions and negotiate within approved authority','Coordinate onboarding, verification, approval and activation of partners','Develop supply relationships (driver partners, fleet operators, charter operators, logistics/carrier, rental and leasing partners) and technology partners (API, white-label, platform)','Grow partner transactions, revenue per active partner, retention and portfolio expansion; maintain accurate Yalla Partners records'],
   ARRAY['Owns partner portfolio development within the existing Yalla Partners platform — no parallel partner database','Routes partner-generated leads to the correct sales owner, preserving attribution','No independent commercial-terms authority beyond approved frameworks'],
   '["new_partners_acquired","activated_partners","active_partner_rate","partner_generated_leads","partner_generated_bookings","partner_generated_revenue","partner_supplied_capacity","partner_conversion","partner_retention","partner_portfolio_growth","revenue_per_active_partner","repeat_partner_transactions","strategic_partnerships","pipeline_value","commissionable_partner_revenue"]'::jsonb,
   1, 'active', 'SEEDED', 'sales-org-realignment-2026-08-26');

-- ------------------------------------------- 2. Supersede legacy positions
-- (archived, never deleted — historical references stay intact)
UPDATE public.org_positions SET status = 'archived', updated_at = now()
WHERE id IN (
  'b22a79d3-4c2d-40b5-a2d9-dcde5aa0a054',  -- Customer Success Coordinator (POS-CS-COORD)
  '027d16a4-b5b3-46d0-a3e9-05bcd42da5ca'   -- Sales Administrator – Mobility Services (SLS-ADM)
);

-- -------------------------------------------- 3. Supersede legacy vacancies
-- (closed + historical; applications, interviews and audit trail preserved)
UPDATE public.rec_vacancies
SET status = 'closed', closed_at = now(), publication_status = 'archived',
    is_historical = true, updated_at = now()
WHERE vacancy_no IN ('VAC-202608-OGRMH', 'VAC-202608-9EY9J');  -- Sales Manager, Sales Administration

-- ---------------------------------------------------- 4. Canonical vacancies
INSERT INTO public.rec_vacancies
  (id, vacancy_no, title, public_slug, unit_id, position_id, reports_to_position_id,
   employment_type, work_arrangement, location, headcount, is_replacement, currency,
   required_skills, preferred_skills, qualifications, competencies, min_years_experience,
   responsibilities, kpis, priority, target_hire_date, opened_at, sla_days,
   approval_status, publication_status, published_at, channels, status,
   public_summary, content_version, role_purpose, accountability_groups,
   success_outcomes, technical_tools, suitability, qualification_level,
   equivalent_experience_accepted, experience_statement, application_deadline,
   recruitment_process, is_historical)
VALUES
-- ─────────────────────────────── ROLE 1: MOBILITY SPECIALIST ──────────────
('7a11b000-5a1e-4262-8ead-260826000011', 'VAC-202608-MOB01', 'Mobility Specialist',
 'mobility-specialist-9f2c41',
 '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', '7a11a000-5a1e-4262-8ead-260826000002',
 '7a11a000-5a1e-4262-8ead-260826000001',
 'contract', 'onsite', 'Nairobi, Kenya', 1, false, 'KES',
 ARRAY['Prospecting and lead qualification','Consultative selling','Negotiation and closing','Customer discovery','CRM discipline and pipeline management','Commercial communication'],
 ARRAY['Ride-hailing or mobility industry experience','Corporate transport, travel or hospitality sales','Account management','Reactivation and retention selling','Ground charter or rental product familiarity'],
 ARRAY['Diploma or bachelor''s degree in Sales, Marketing, Business Administration, Commerce, Business Development, Hospitality, Tourism, Transport, Logistics, Communications or a related field','Equivalent demonstrable commercial experience will be considered'],
 ARRAY['Communication','Prospecting','Customer acquisition','Negotiation','Follow-through','Commercial judgement','Target orientation','Relationship management'],
 2, '{}'::text[],
 ARRAY['new_customers_acquired','new_corporate_accounts','qualified_leads','qualified_opportunities','bookings','revenue','commissionable_revenue','conversion_rate','repeat_business_rate','retention','account_growth','cross_sell_revenue','pipeline_value','pipeline_coverage','crm_completeness','forecast_accuracy'],
 'high', '2026-11-02', now(), 30,
 'approved', 'published', now(), ARRAY['careers_portal'], 'open',
 $$Yalla Mobility is hiring a Mobility Specialist to create, acquire, develop, retain and grow customers across our mobility ecosystem — individual rides, airport transfers, scheduled and intercity mobility, corporate mobility programmes, ground movement and rentals.

You are the principal customer-facing mobility sales professional: you prospect, qualify, recommend the right Yalla Mobility service, convert enquiries into bookings, and grow accounts through repeat business, reactivation, cross-selling and upselling. You own the customer journey from need, to discovery, to solution, to booking, to fulfilment, to repeat business and account growth.

Location: Nairobi, Kenya (on-site). Reports to: Sales Team Leader.

Compensation: This position operates on a commission-based contract with performance-based bonuses in accordance with Yalla Mobility's approved commercial incentive structure.$$, 1,
 $$Create, acquire, develop, retain and grow customers across Yalla Mobility's core mobility ecosystem. The Mobility Specialist is the principal customer-facing mobility sales professional, accountable for the full customer journey — customer need, discovery, mobility solution, quote/booking, fulfilment, repeat business and account growth.$$,
 '[{"group":"Customer acquisition & revenue","bullets":["Prospect actively and generate new customers across individual riders, frequent riders, professionals, SMEs, corporates, NGOs, institutions, hotels, travel businesses and executive clients","Qualify leads and conduct customer discovery to identify mobility requirements","Recommend appropriate Yalla Mobility services and convert enquiries into bookings","Contribute to team sales targets"]},{"group":"Corporate & recurring mobility","bullets":["Develop corporate mobility opportunities: employee mobility, staff transportation, corporate ride programmes, recurring corporate transport, business travel and executive corporate travel","Build account relationships and increase customer frequency","Drive repeat bookings across rides, airport transfers, ground mobility and rentals"]},{"group":"Retention, reactivation & account growth","bullets":["Track repeat usage, inactivity, declining usage, cancellations and account opportunities","Identify dormant customers and run reactivation programmes","Cross-sell and upsell across the Yalla Mobility product ecosystem","Escalate commercially relevant customer complaints and operational issues"]},{"group":"Pipeline, CRM & forecasting","bullets":["Maintain CRM accuracy — every qualified lead carries an owner, status, next action, next-action date, source, product and customer/account","Maintain the sales pipeline, track opportunities and forecast closures","Record customer interactions and follow up quotations"]},{"group":"Commercial teamwork & handoffs","bullets":["Coordinate handoffs to the Sales Support Specialist for charter, rental and complex transport quotations","Work with the Mobility Partnerships Specialist on partner-generated demand","Preserve originating, account and opportunity ownership on every commercial handoff"]}]'::jsonb,
 ARRAY['New customers and new corporate accounts acquired','Qualified leads and qualified opportunities created','Bookings, revenue and commissionable revenue delivered','Conversion rate, repeat-business rate and retention improved','Account growth and cross-sell revenue','Pipeline value and coverage with accurate forecasts','Complete and current CRM records'],
 ARRAY['CRM and pipeline tooling','Yalla Mobility booking and quotation platforms','Productivity suites (documents, spreadsheets, presentations)'],
 ARRAY['Energised by prospecting and winning new customers','Comfortable working to revenue targets on a commission-based contract','Builds long-term account relationships, not one-off transactions','Nairobi-based and able to work on-site'],
 'Diploma or bachelor''s degree', true,
 '2+ years of relevant commercial, sales or customer-facing experience preferred — ideally in ride-hailing, mobility, corporate transport, travel, hospitality, customer acquisition, account management or transport sales.',
 '2026-10-15',
 '[{"step":"Application","detail":"Submit your application through the Yalla Careers portal. You will receive an application reference immediately."},{"step":"Application review","detail":"Our recruitment team reviews applications against the role requirements."},{"step":"Screening","detail":"Selected candidates may be invited to a screening conversation."},{"step":"Assessment or interview","detail":"Depending on the role, candidates may complete an assessment and/or an interview."},{"step":"Final decision","detail":"Successful candidates proceed to offer and onboarding."}]'::jsonb,
 false),

-- ─────────────────────────── ROLE 2: SALES SUPPORT SPECIALIST ─────────────
('7a11b000-5a1e-4262-8ead-260826000012', 'VAC-202608-SUP01', 'Sales Support Specialist',
 'sales-support-specialist-3e7b58',
 '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', '7a11a000-5a1e-4262-8ead-260826000003',
 '7a11a000-5a1e-4262-8ead-260826000001',
 'contract', 'onsite', 'Nairobi, Kenya', 1, false, 'KES',
 ARRAY['Inside sales or sales coordination','Requirement gathering and specification','Quotation preparation','Commercial communication','CRM discipline','Follow-up and conversion'],
 ARRAY['Transport booking or charter sales support','Vehicle rental or leasing','Ground charter product knowledge (bus, van, coach, shuttle, staff, event, tourism and project transport)','Air charter awareness (jet, turboprop, helicopter, executive and corporate aviation)','Corporate mobility programmes'],
 ARRAY['Diploma or bachelor''s degree in Sales, Marketing, Business Administration, Commerce, Business Development, Hospitality, Tourism, Transport, Logistics, Communications or a related field','Equivalent demonstrable commercial experience will be considered'],
 ARRAY['Responsiveness','Accuracy','Organisation','Commercial judgement','Problem solving','Follow-through','Target orientation'],
 2, '{}'::text[],
 ARRAY['qualified_enquiries_processed','response_time','quotation_turnaround_time','quotations_issued','quote_to_booking_conversion','booking_conversion','supported_revenue','attributable_commissionable_revenue','dormant_opportunity_reactivation','crm_completeness','follow_up_completion','lost_opportunity_recovery','pipeline_hygiene','support_sla_compliance'],
 'high', '2026-11-02', now(), 30,
 'approved', 'published', now(), ARRAY['careers_portal'], 'open',
 $$Yalla Mobility is hiring a Sales Support Specialist — a commercially active inside-sales specialist who accelerates response, qualification, specification, quotation, proposal, follow-up and conversion across ground charter, air charter, rentals, leasing and corporate mobility.

This is not a secretarial, receptionist or passive back-office role. You are the commercial bridge between the customer, the sales team, pricing, fleet and supply, charter, rentals and operations — turning qualified enquiries into bookings and revenue.

Location: Nairobi, Kenya (on-site). Reports to: Sales Team Leader.

Compensation: This position operates on a commission-based contract with performance-based bonuses in accordance with Yalla Mobility's approved commercial incentive structure.$$, 1,
 $$Accelerate commercial response and convert qualified enquiries into revenue by supporting the Sales Team Leader and the sales team. The role is especially important for pricing, fleet matching, vehicle availability, charter specifications, complex transport requirements, multiple quotations, proposal preparation, follow-up and booking conversion.$$,
 '[{"group":"Enquiry intake & qualification","bullets":["Receive sales enquiries and qualify requirements","Capture complete customer specifications","Identify specialist opportunities and escalate complex opportunities to the appropriate owner"]},{"group":"Quotation & proposal engine","bullets":["Prepare quotation requests and coordinate pricing","Coordinate fleet availability, charter availability and aircraft availability through the appropriate owners","Prepare proposals, track quotation expiry and track pending customer decisions"]},{"group":"Conversion & follow-up","bullets":["Follow up quotations and monitor quotation-to-booking conversion","Reactivate unclosed and dormant opportunities","Recover lost opportunities where commercially sound"]},{"group":"Pipeline hygiene & reporting","bullets":["Maintain opportunity records and update the CRM","Support pipeline reviews and commercial reporting","Maintain sales documentation"]},{"group":"Commercial authority discipline","bullets":["Operate within approved authority — never independently approve unauthorised discounts, guarantee vehicle or aircraft availability, guarantee aviation permissions or operational feasibility, approve exceptional contract terms, or override pricing authority","Route all such matters through approved authority workflows"]}]'::jsonb,
 ARRAY['Qualified enquiries processed within response SLAs','Fast quotation turnaround and quotations issued','Quote-to-booking and booking conversion','Supported revenue and directly attributable commissionable revenue','Dormant opportunity reactivation and lost-opportunity recovery','CRM completeness, follow-up completion and pipeline hygiene','Support SLA compliance'],
 ARRAY['CRM','Quotation and proposal tooling','Yalla Mobility pricing and fleet systems'],
 ARRAY['Commercially active — this is a sales role, not administration','Thrives on speed, accuracy and follow-through','Comfortable coordinating pricing, fleet, charter and operations','Nairobi-based and able to work on-site'],
 'Diploma or bachelor''s degree', true,
 '2+ years of relevant commercial or customer-facing experience preferred — ideally in inside sales, sales coordination, quotations, transport booking, charter sales support, vehicle rental, CRM-driven sales or commercially oriented customer service.',
 '2026-10-15',
 '[{"step":"Application","detail":"Submit your application through the Yalla Careers portal. You will receive an application reference immediately."},{"step":"Application review","detail":"Our recruitment team reviews applications against the role requirements."},{"step":"Screening","detail":"Selected candidates may be invited to a screening conversation."},{"step":"Assessment or interview","detail":"Depending on the role, candidates may complete an assessment and/or an interview."},{"step":"Final decision","detail":"Successful candidates proceed to offer and onboarding."}]'::jsonb,
 false),

-- ─────────────────────── ROLE 3: MOBILITY PARTNERSHIPS SPECIALIST ─────────
('7a11b000-5a1e-4262-8ead-260826000013', 'VAC-202608-PRT01', 'Mobility Partnerships Specialist',
 'mobility-partnerships-specialist-6d4a92',
 '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc', '7a11a000-5a1e-4262-8ead-260826000004',
 '7a11a000-5a1e-4262-8ead-260826000001',
 'contract', 'onsite', 'Nairobi, Kenya', 1, false, 'KES',
 ARRAY['Partnership or channel sales','Partner qualification and negotiation','Relationship management','CRM and partner record discipline','Commercial judgement'],
 ARRAY['Travel, tourism or hospitality partnerships','Fleet, charter, rental or logistics networks','Affiliate or referral programmes','B2B partnership development','Account management'],
 ARRAY['Diploma or bachelor''s degree in Sales, Marketing, Business Administration, Commerce, Business Development, Hospitality, Tourism, Transport, Logistics, Communications or a related field','Equivalent demonstrable commercial experience will be considered'],
 ARRAY['Negotiation','Relationship building','Commercial judgement','Target orientation','Organisation','Communication'],
 2, '{}'::text[],
 ARRAY['new_partners_acquired','activated_partners','active_partner_rate','partner_generated_leads','partner_generated_bookings','partner_generated_revenue','partner_supplied_capacity','partner_conversion','partner_retention','partner_portfolio_growth','revenue_per_active_partner','repeat_partner_transactions','strategic_partnerships','pipeline_value','commissionable_partner_revenue'],
 'high', '2026-11-02', now(), 30,
 'approved', 'published', now(), ARRAY['careers_portal'], 'open',
 $$Yalla Mobility is hiring a Mobility Partnerships Specialist to develop, acquire, activate, manage and grow our commercial partnership portfolio as a revenue-generating portfolio.

You will own the partnership value chain — qualify, onboard, verify, approve, activate, generate demand and supply, transact, grow, retain and expand — across demand and distribution partners (travel and tourism, tour operators, DMCs, travel agencies, hotels, lodges, resorts, corporate, institutional, event, destination, referral and distribution partners), supply partners (driver partners, fleet operators, charter operators, logistics and carrier partners, rental and leasing partners) and technology partners (API, white-label and platform partners), using the existing Yalla Partners platform.

A signed agreement is not a successful partnership — activation and commercial output are.

Location: Nairobi, Kenya (on-site). Reports to: Sales Team Leader.

Compensation: This position operates on a commission-based contract with performance-based bonuses in accordance with Yalla Mobility's approved commercial incentive structure.$$, 1,
 $$Develop, acquire, activate, manage and grow Yalla Mobility's commercial partnership portfolio, treating Yalla Partners as a revenue-generating commercial portfolio — never merely a partner administration function.$$,
 '[{"group":"Partner acquisition","bullets":["Identify and prospect strategic partners across travel & tourism, tour operators, DMCs, travel agencies, hotels, lodges, resorts, corporate and institutional partners, commerce/retail, event, destination, referral and distribution partners","Qualify partners and develop partnership propositions","Negotiate within approved authority and acquire partners"]},{"group":"Onboarding & activation","bullets":["Coordinate onboarding and support verification and approval","Activate partners — a signed agreement is not success until the partner is activated and transacting","Monitor activation and first-transaction milestones"]},{"group":"Portfolio growth & revenue","bullets":["Develop partner portfolios and generate partner demand","Develop supply relationships: driver partners, fleet operators, charter operators, logistics/carrier partners, rental and leasing partners","Develop technology and integration opportunities: API, white-label and platform partners","Increase transactions, partner revenue and revenue per active partner"]},{"group":"Retention & performance","bullets":["Monitor partner performance and identify growth opportunities","Retain, expand and renew partnerships","Maintain accurate partner records in the Yalla Partners platform"]},{"group":"Sales integration & attribution","bullets":["Route partner-generated leads to the correct sales owner","Preserve originating, account, partner and opportunity ownership and commission attribution on every handoff"]}]'::jsonb,
 ARRAY['New partners acquired and activated, with a healthy active partner rate','Partner-generated leads, bookings and revenue','Partner-supplied capacity','Partner conversion, retention and portfolio growth','Revenue per active partner and repeat partner transactions','Strategic partnerships and pipeline value','Commissionable partner revenue'],
 ARRAY['Yalla Partners platform','CRM','Partner performance dashboards'],
 ARRAY['Treats partnerships as a revenue portfolio, not administration','Measures success by activation and commercial output','Builds long-term channel relationships','Nairobi-based and able to work on-site'],
 'Diploma or bachelor''s degree', true,
 '2+ years of relevant commercial or customer-facing experience preferred — ideally in partnership sales, channel development, travel partnerships, hospitality, fleet partnerships, transport networks, affiliate/referral sales, B2B partnerships or account management.',
 '2026-10-15',
 '[{"step":"Application","detail":"Submit your application through the Yalla Careers portal. You will receive an application reference immediately."},{"step":"Application review","detail":"Our recruitment team reviews applications against the role requirements."},{"step":"Screening","detail":"Selected candidates may be invited to a screening conversation."},{"step":"Assessment or interview","detail":"Depending on the role, candidates may complete an assessment and/or an interview."},{"step":"Final decision","detail":"Successful candidates proceed to offer and onboarding."}]'::jsonb,
 false);

-- ------------------------------------------- 5. Application blueprints
INSERT INTO public.rec_blueprints
  (id, vacancy_id, version, status, cover_letter_mode, sections, document_requirements, assessment, interview, workflow)
VALUES
  ('7a11c000-5a1e-4262-8ead-260826000021', '7a11b000-5a1e-4262-8ead-260826000011', 1, 'active', 'optional',
   '{"education":true,"qualifications":true,"employment":true,"skills":true}'::jsonb,
   '[{"doc_type":"cv","label":"CV / Résumé","required":true},{"doc_type":"cover_letter","label":"Cover letter","required":false},{"doc_type":"certificate","label":"Academic or professional certificates","required":false,"multiple":true},{"doc_type":"supporting","label":"Other supporting documents","required":false,"multiple":true}]'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('7a11c000-5a1e-4262-8ead-260826000022', '7a11b000-5a1e-4262-8ead-260826000012', 1, 'active', 'optional',
   '{"education":true,"qualifications":true,"employment":true,"skills":true}'::jsonb,
   '[{"doc_type":"cv","label":"CV / Résumé","required":true},{"doc_type":"cover_letter","label":"Cover letter","required":false},{"doc_type":"certificate","label":"Academic or professional certificates","required":false,"multiple":true},{"doc_type":"supporting","label":"Other supporting documents","required":false,"multiple":true}]'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('7a11c000-5a1e-4262-8ead-260826000023', '7a11b000-5a1e-4262-8ead-260826000013', 1, 'active', 'optional',
   '{"education":true,"qualifications":true,"employment":true,"skills":true}'::jsonb,
   '[{"doc_type":"cv","label":"CV / Résumé","required":true},{"doc_type":"cover_letter","label":"Cover letter","required":false},{"doc_type":"certificate","label":"Academic or professional certificates","required":false,"multiple":true},{"doc_type":"supporting","label":"Other supporting documents","required":false,"multiple":true}]'::jsonb,
   '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);

-- ------------------------------------------- 6. Blueprint questions
INSERT INTO public.rec_blueprint_questions
  (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
VALUES
  -- Mobility Specialist
  ('7a11c000-5a1e-4262-8ead-260826000021', 1, 'compensation_acknowledgement',
   'This position operates on a commission-based contract with performance-based bonuses. Do you understand and accept this compensation model?',
   'Commission and performance-based bonuses are payable in accordance with the applicable Yalla Mobility commission and incentive structure. Answer Yes to proceed.',
   'boolean', '[]'::jsonb, true, 'knockout', 0),
  ('7a11c000-5a1e-4262-8ead-260826000021', 2, 'work_authorisation',
   'Are you legally authorised to work in Kenya?', NULL,
   'boolean', '[]'::jsonb, true, 'knockout', 0),
  ('7a11c000-5a1e-4262-8ead-260826000021', 3, 'notice_period',
   'What is your notice period?', NULL,
   'single_choice', '["Immediately","Within 2 weeks","1 month","2 months","3 months or more"]'::jsonb, true, 'informational', 0),
  ('7a11c000-5a1e-4262-8ead-260826000021', 4, 'mobility_sales_years',
   'How many years of sales or customer-acquisition experience do you have (mobility, transport, travel, hospitality or related)?', NULL,
   'number', '[]'::jsonb, true, 'scored', 3),
  ('7a11c000-5a1e-4262-8ead-260826000021', 5, 'acquisition_scenario',
   'Describe how you would acquire and grow a corporate mobility account for Yalla Mobility in Nairobi.', NULL,
   'long_text', '[]'::jsonb, true, 'scored', 4),
  ('7a11c000-5a1e-4262-8ead-260826000021', 6, 'cross_sell_scenario',
   'A frequent airport-transfer customer mentions staff transport challenges. Walk through how you would develop this into a corporate mobility opportunity.', NULL,
   'long_text', '[]'::jsonb, true, 'scored', 3),

  -- Sales Support Specialist
  ('7a11c000-5a1e-4262-8ead-260826000022', 1, 'compensation_acknowledgement',
   'This position operates on a commission-based contract with performance-based bonuses. Do you understand and accept this compensation model?',
   'Commission and performance-based bonuses are payable in accordance with the applicable Yalla Mobility commission and incentive structure. Answer Yes to proceed.',
   'boolean', '[]'::jsonb, true, 'knockout', 0),
  ('7a11c000-5a1e-4262-8ead-260826000022', 2, 'work_authorisation',
   'Are you legally authorised to work in Kenya?', NULL,
   'boolean', '[]'::jsonb, true, 'knockout', 0),
  ('7a11c000-5a1e-4262-8ead-260826000022', 3, 'notice_period',
   'What is your notice period?', NULL,
   'single_choice', '["Immediately","Within 2 weeks","1 month","2 months","3 months or more"]'::jsonb, true, 'informational', 0),
  ('7a11c000-5a1e-4262-8ead-260826000022', 4, 'support_experience_years',
   'How many years of inside sales, sales coordination or quotation support experience do you have?', NULL,
   'number', '[]'::jsonb, true, 'scored', 3),
  ('7a11c000-5a1e-4262-8ead-260826000022', 5, 'quotation_scenario',
   'A client needs a 45-seater coach for a 3-day conference plus airport transfers for executives. Outline how you would specify the requirement, coordinate pricing and availability, and prepare the quotation.', NULL,
   'long_text', '[]'::jsonb, true, 'scored', 4),
  ('7a11c000-5a1e-4262-8ead-260826000022', 6, 'followup_scenario',
   'How do you follow up an issued quotation that has gone quiet without damaging the customer relationship?', NULL,
   'long_text', '[]'::jsonb, true, 'scored', 3),

  -- Mobility Partnerships Specialist
  ('7a11c000-5a1e-4262-8ead-260826000023', 1, 'compensation_acknowledgement',
   'This position operates on a commission-based contract with performance-based bonuses. Do you understand and accept this compensation model?',
   'Commission and performance-based bonuses are payable in accordance with the applicable Yalla Mobility commission and incentive structure. Answer Yes to proceed.',
   'boolean', '[]'::jsonb, true, 'knockout', 0),
  ('7a11c000-5a1e-4262-8ead-260826000023', 2, 'work_authorisation',
   'Are you legally authorised to work in Kenya?', NULL,
   'boolean', '[]'::jsonb, true, 'knockout', 0),
  ('7a11c000-5a1e-4262-8ead-260826000023', 3, 'notice_period',
   'What is your notice period?', NULL,
   'single_choice', '["Immediately","Within 2 weeks","1 month","2 months","3 months or more"]'::jsonb, true, 'informational', 0),
  ('7a11c000-5a1e-4262-8ead-260826000023', 4, 'partnership_years',
   'How many years of partnership, channel or B2B sales experience do you have?', NULL,
   'number', '[]'::jsonb, true, 'scored', 3),
  ('7a11c000-5a1e-4262-8ead-260826000023', 5, 'partner_activation_scenario',
   'Describe how you would identify, qualify and activate a hotel partner to generate airport-transfer and ride demand for Yalla Mobility.', NULL,
   'long_text', '[]'::jsonb, true, 'scored', 4),
  ('7a11c000-5a1e-4262-8ead-260826000023', 6, 'portfolio_growth_scenario',
   'How do you grow revenue per active partner once a partner is onboarded and transacting?', NULL,
   'long_text', '[]'::jsonb, true, 'scored', 3);

-- ------------------------------------------- 7. Assessment scorecards
INSERT INTO public.rec_scorecards (id, vacancy_id, version, status, notes)
VALUES
  ('7a11d000-5a1e-4262-8ead-260826000031', '7a11b000-5a1e-4262-8ead-260826000011', 1, 'active',
   'Mobility Specialist — customer acquisition, consultative selling, closing, mobility product knowledge, account growth, CRM, communication, retention and commercial judgement.'),
  ('7a11d000-5a1e-4262-8ead-260826000032', '7a11b000-5a1e-4262-8ead-260826000012', 1, 'active',
   'Sales Support Specialist — responsiveness, requirement gathering, quotation accuracy, commercial communication, follow-up, CRM discipline, conversion, problem solving, product knowledge and commercial judgement.'),
  ('7a11d000-5a1e-4262-8ead-260826000033', '7a11b000-5a1e-4262-8ead-260826000013', 1, 'active',
   'Mobility Partnerships Specialist — partnership acquisition, partner qualification, negotiation, relationship management, channel development, partner activation, portfolio growth, revenue generation, commercial judgement and CRM discipline.');

INSERT INTO public.rec_scorecard_criteria
  (scorecard_id, code, label, criterion_type, weight, scoring_method, evidence_source, sort_order)
VALUES
  ('7a11d000-5a1e-4262-8ead-260826000031','customer_acquisition','Customer acquisition','scored',10,'manual','interview',1),
  ('7a11d000-5a1e-4262-8ead-260826000031','prospecting','Prospecting','scored',10,'manual','interview',2),
  ('7a11d000-5a1e-4262-8ead-260826000031','consultative_selling','Consultative selling','scored',10,'manual','interview',3),
  ('7a11d000-5a1e-4262-8ead-260826000031','closing','Closing','scored',10,'manual','interview',4),
  ('7a11d000-5a1e-4262-8ead-260826000031','mobility_product_knowledge','Mobility product knowledge','scored',10,'manual','assessment',5),
  ('7a11d000-5a1e-4262-8ead-260826000031','account_growth','Account growth','scored',10,'manual','interview',6),
  ('7a11d000-5a1e-4262-8ead-260826000031','crm_discipline','CRM discipline','scored',10,'manual','screening',7),
  ('7a11d000-5a1e-4262-8ead-260826000031','communication','Communication','scored',10,'manual','interview',8),
  ('7a11d000-5a1e-4262-8ead-260826000031','retention_focus','Retention & reactivation focus','scored',10,'manual','interview',9),
  ('7a11d000-5a1e-4262-8ead-260826000031','commercial_judgement','Commercial judgement','scored',10,'manual','interview',10),

  ('7a11d000-5a1e-4262-8ead-260826000032','sales_responsiveness','Sales responsiveness','scored',10,'manual','screening',1),
  ('7a11d000-5a1e-4262-8ead-260826000032','requirement_gathering','Requirement gathering','scored',10,'manual','interview',2),
  ('7a11d000-5a1e-4262-8ead-260826000032','quotation_accuracy','Quotation accuracy','scored',10,'manual','assessment',3),
  ('7a11d000-5a1e-4262-8ead-260826000032','commercial_communication','Commercial communication','scored',10,'manual','interview',4),
  ('7a11d000-5a1e-4262-8ead-260826000032','follow_up_discipline','Follow-up discipline','scored',10,'manual','interview',5),
  ('7a11d000-5a1e-4262-8ead-260826000032','crm_hygiene','CRM discipline & hygiene','scored',10,'manual','screening',6),
  ('7a11d000-5a1e-4262-8ead-260826000032','conversion_focus','Conversion focus','scored',10,'manual','interview',7),
  ('7a11d000-5a1e-4262-8ead-260826000032','problem_solving','Problem solving','scored',10,'manual','interview',8),
  ('7a11d000-5a1e-4262-8ead-260826000032','product_knowledge','Charter, rental & leasing product knowledge','scored',10,'manual','assessment',9),
  ('7a11d000-5a1e-4262-8ead-260826000032','commercial_judgement','Commercial judgement & authority discipline','scored',10,'manual','interview',10),

  ('7a11d000-5a1e-4262-8ead-260826000033','partnership_acquisition','Partnership acquisition','scored',10,'manual','interview',1),
  ('7a11d000-5a1e-4262-8ead-260826000033','partner_qualification','Partner qualification','scored',10,'manual','assessment',2),
  ('7a11d000-5a1e-4262-8ead-260826000033','negotiation','Negotiation','scored',10,'manual','interview',3),
  ('7a11d000-5a1e-4262-8ead-260826000033','relationship_management','Relationship management','scored',10,'manual','interview',4),
  ('7a11d000-5a1e-4262-8ead-260826000033','channel_development','Channel development','scored',10,'manual','interview',5),
  ('7a11d000-5a1e-4262-8ead-260826000033','partner_activation','Partner activation','scored',10,'manual','interview',6),
  ('7a11d000-5a1e-4262-8ead-260826000033','portfolio_growth','Portfolio growth','scored',10,'manual','interview',7),
  ('7a11d000-5a1e-4262-8ead-260826000033','revenue_generation','Revenue generation','scored',10,'manual','interview',8),
  ('7a11d000-5a1e-4262-8ead-260826000033','commercial_judgement','Commercial judgement','scored',10,'manual','interview',9),
  ('7a11d000-5a1e-4262-8ead-260826000033','crm_discipline','CRM discipline','scored',10,'manual','screening',10);

-- ------------------------------------------- 8. Lead routing rules
CREATE TABLE public.sales_lead_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  lead_context text NOT NULL,
  product_scope text NOT NULL,
  primary_position_code text NOT NULL,
  supporting_position_code text,
  account_owner_preserved boolean NOT NULL DEFAULT false,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_lead_routing_rules TO authenticated;
GRANT ALL ON public.sales_lead_routing_rules TO service_role;
ALTER TABLE public.sales_lead_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read lead routing rules"
  ON public.sales_lead_routing_rules FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public._sales_routing_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_sales_routing_touch BEFORE UPDATE ON public.sales_lead_routing_rules
  FOR EACH ROW EXECUTE FUNCTION public._sales_routing_touch();

INSERT INTO public.sales_lead_routing_rules
  (rule_key, lead_context, product_scope, primary_position_code, supporting_position_code, account_owner_preserved, notes, sort_order)
VALUES
  ('rides', 'New customer enquiry', 'Rides, everyday mobility, scheduled and intercity rides, executive/chauffeur mobility', 'SLS-MOB', NULL, false, 'Individual ride and everyday mobility demand.', 1),
  ('corporate_mobility', 'New customer enquiry', 'Employee mobility, staff transportation, corporate ride programmes, business and executive travel', 'SLS-MOB', NULL, false, 'Corporate mobility programmes owned by the Mobility Specialist.', 2),
  ('airport_transfers', 'New customer enquiry', 'Airport transfers', 'SLS-MOB', NULL, false, NULL, 3),
  ('customer_mobility_requirement', 'New customer enquiry', 'General customer mobility requirement', 'SLS-MOB', NULL, false, 'Default owner for customer-side mobility demand.', 4),
  ('charter_complex_transport', 'New customer enquiry', 'Ground charter (bus, van, coach, shuttle, staff, event, tourism, project transport) and air charter', 'SLS-SUP', NULL, false, 'Sales Support coordinates requirements and quotation, then hands to the appropriate specialist/operational owner for fulfilment validation.', 5),
  ('rental_enquiry', 'New customer enquiry', 'Car, SUV, executive and luxury rentals; corporate rentals; approved leasing products', 'SLS-SUP', 'SLS-MOB', false, 'Sales Support coordinates; Mobility/Rental commercial owner supports conversion.', 6),
  ('partner_opportunity', 'Partner opportunity', 'Demand/distribution, supply and technology partnerships', 'SLS-PRT', NULL, false, 'All partnership development routes to the Mobility Partnerships Specialist (Yalla Partners platform).', 7),
  ('existing_customer', 'Existing customer', 'Any product', 'ACCOUNT_OWNER', NULL, true, 'Route to the existing account owner; prevent duplicate acquisition credit and duplicate customer records.', 8),
  ('existing_partner', 'Existing partner', 'Any product', 'PARTNER_OWNER', NULL, true, 'Route to the existing partner owner; preserve relationship history.', 9),
  ('cross_product_opportunity', 'Cross-product opportunity', 'Multiple Yalla Mobility products', 'ORIGINATING_OWNER', 'SUPPORTING_SPECIALIST', true, 'Preserve the originating owner and assign a supporting specialist; commission attribution follows the approved structure.', 10);
