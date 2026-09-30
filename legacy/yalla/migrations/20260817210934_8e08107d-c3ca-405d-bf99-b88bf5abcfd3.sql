INSERT INTO public.rec_question_bank
  (question_key, version, competency_code, competency_label, prompt, scenario, question_type,
   max_marks, probes, good_indicators, weak_indicators, scoring_anchors, expected_evidence, role_family, status)
VALUES
('ts_verified_sales', 1, 'verified_sales', 'Verified Sales Experience',
 'Think of the most recent role in which you personally had responsibility for generating sales. Take us through one specific sale you personally won, from the moment the opportunity entered your pipeline until the customer paid or the transaction was completed. What were you selling, who was the customer, what did you personally do, and what was the result?',
 NULL, 'behavioural', 6,
 ARRAY['How did you obtain the lead?','What was the customer''s need?','What did you personally do?','What was the value of the sale?','How long did conversion take?','How was your performance measured?'],
 ARRAY['Concrete, specific example','Clear personal contribution','Product or service identified','Customer identified','Measurable activity','Stated target','Conversion described','Outcome quantified'],
 ARRAY['Generic description of duties','Team achievement with no personal role','No numbers or measurement','Cannot name customer or product'],
 '[{"range":"0-1","meaning":"no credible evidence"},{"range":"2-3","meaning":"limited exposure"},{"range":"4","meaning":"competent evidence"},{"range":"5","meaning":"strong measurable evidence"},{"range":"6","meaning":"exceptional measurable sales evidence"}]'::jsonb,
 'Named customer, product, value, timeline and measured result', 'telesales', 'active'),

('ts_prospecting', 1, 'prospecting', 'Prospecting & Lead Qualification',
 'Explain exactly what you would do during your first two hours.',
 'It is 8:00 a.m. and your Yalla Mobility CRM contains 100 new leads. Some are individuals requesting rides, some are businesses asking about corporate mobility, some require rentals or charter services, and some have incomplete information.',
 'situational', 5,
 ARRAY['What information would make one lead more urgent than another?'],
 ARRAY['Segments leads','Qualifies before calling','Prioritises by value and probability','Identifies service requirement','Sets next action','Updates CRM'],
 ARRAY['Starts calling at random','No segmentation','No prioritisation logic','No CRM discipline'],
 '[{"range":"0-1","meaning":"random calling"},{"range":"2","meaning":"basic prioritisation"},{"range":"3","meaning":"logical qualification"},{"range":"4","meaning":"strong prioritisation and CRM discipline"},{"range":"5","meaning":"complete measurable lead-management process"}]'::jsonb,
 'A described sequence: segment, qualify, prioritise, contact, next action, CRM update', 'telesales', 'active'),

('ts_sales_process', 1, 'sales_process', 'Sales Process & Conversion',
 'A prospect tells you: "I need transport for my business." You have not yet established what they actually need. What questions would you ask before recommending a Yalla Mobility service?',
 NULL, 'role_specific', 5,
 ARRAY['How would you convert what you learned into a specific Yalla Mobility solution and a next step toward a sale?'],
 ARRAY['Asks who requires transport','Passenger volume and frequency','Routes, dates and times','Vehicle requirements','Business purpose','Commercial model and billing','Approval process','Urgency'],
 ARRAY['Immediately pitches a product','Two or three shallow questions','No path to a next step'],
 '[{"range":"0-1","meaning":"immediate product pitch"},{"range":"2","meaning":"basic questions"},{"range":"3","meaning":"reasonable discovery"},{"range":"4","meaning":"tailored solution"},{"range":"5","meaning":"consultative selling with a clear conversion path"}]'::jsonb,
 'Discovery questions plus a stated next step', 'telesales', 'active'),

('ts_objection_handling', 1, 'objection_handling', 'Objection Handling & Closing',
 'Respond to the interviewer playing the customer. You have three to four minutes.',
 'Interviewer: "Your competitor is offering the service for less money. Unless Yalla Mobility matches their price, I will use them."',
 'role_play', 6,
 ARRAY['What would make you decide NOT to discount the price?'],
 ARRAY['Stays composed','Does not discount immediately','Diagnoses the objection','Uncovers real decision criteria','Establishes value','Differentiates appropriately','Proposes a next step','Attempts a close'],
 ARRAY['Argues with the customer','Concedes price immediately','No diagnosis','No close attempt'],
 '[{"range":"0-1","meaning":"argues or discounts immediately"},{"range":"2","meaning":"basic response"},{"range":"3","meaning":"reasonable objection handling"},{"range":"4","meaning":"value-based handling"},{"range":"5","meaning":"handles and advances toward close"},{"range":"6","meaning":"sophisticated diagnosis, value selling and controlled close"}]'::jsonb,
 'Observed behaviour during the live objection exchange', 'telesales', 'active'),

('ts_yalla_solution', 1, 'yalla_solution', 'Yalla Mobility Solution Selling',
 'Take us through how you would diagnose the requirement and build the appropriate Yalla Mobility solution.',
 'A multinational company contacts Yalla Mobility. It has 60 employees requiring daily staff transport, visiting executives requiring airport transfers and chauffeur services, and occasional company events requiring buses. The procurement manager wants one reliable mobility partner rather than several suppliers.',
 'commercial', 7,
 ARRAY['What information would you need from procurement before preparing a commercially useful proposal?'],
 ARRAY['Maps staff transport to corporate mobility','Maps executives to airport transfer and chauffeur service','Maps events to bus, van or coach charter','Moves from requirement to proposal, quotation, account setup, approvals, booking, operations and reporting'],
 ARRAY['Recites products without mapping needs','Invents services Yalla does not offer','No commercial or operational sequence'],
 '[{"range":"0-1","meaning":"cannot identify appropriate services"},{"range":"2-3","meaning":"identifies some services"},{"range":"4","meaning":"maps requirements correctly"},{"range":"5","meaning":"builds a coherent solution"},{"range":"6","meaning":"demonstrates commercial and operational understanding"},{"range":"7","meaning":"demonstrates consultative mobility-selling capability"}]'::jsonb,
 'Requirement-to-solution mapping using services in the live Yalla catalogue only', 'telesales', 'active'),

('ts_customer_management', 1, 'customer_management', 'Customer Management',
 'Tell us about the most difficult customer you personally handled. What happened, what did you personally do, and what was the outcome?',
 NULL, 'behavioural', 4,
 ARRAY['What was the situation?','What action did you personally take?','What was the result?'],
 ARRAY['Listens','Takes ownership','Diagnoses the problem','Shows empathy','Communicates clearly','Resolves and retains the customer'],
 ARRAY['Blames the customer','No ownership','No outcome'],
 '[{"range":"0","meaning":"no evidence"},{"range":"1","meaning":"limited ownership"},{"range":"2","meaning":"reasonable handling"},{"range":"3","meaning":"strong recovery"},{"range":"4","meaning":"excellent ownership and resolution"}]'::jsonb,
 'Situation, action, result with a named outcome', 'telesales', 'active'),

('ts_crm_discipline', 1, 'crm_discipline', 'Operational / CRM Discipline',
 'Before leaving your workstation, exactly what information should exist in the CRM for every opportunity?',
 'You finish your shift with 30 prospects requiring follow-up tomorrow.',
 'operational', 4,
 ARRAY['What happens operationally if you make sales but fail to maintain accurate CRM records?'],
 ARRAY['Customer and contact','Requirement and service','Stage and qualification','Last interaction and objections','Quotation','Next action and next-contact date','Priority and owner','Conversion status'],
 ARRAY['Vague notes','No next action','Treats CRM as optional admin'],
 '[{"range":"0-1","meaning":"weak"},{"range":"2","meaning":"basic"},{"range":"3","meaning":"strong"},{"range":"4","meaning":"understands CRM as the operational source of truth"}]'::jsonb,
 'Named CRM fields plus consequences of poor records', 'telesales', 'active'),

('ts_productivity', 1, 'productivity', 'Productivity & Commercial Mathematics',
 'Approximately how many qualified conversations are required? Then: if only 50% of contacted leads become qualified conversations, approximately how many contacted leads would you need? Finally: if you are behind target halfway through the week, what operational metrics would you inspect before simply making more calls?',
 'Your weekly target is 20 completed sales. Your historical conversion rate from qualified conversations to sales is 20%.',
 'productivity', 4,
 ARRAY['20 ÷ 0.20 = 100 qualified conversations','100 ÷ 0.50 = 200 contacted leads','Which metrics would you inspect?'],
 ARRAY['Correct arithmetic','Reasons from target to activity','Inspects contact rate, qualification rate, conversion rate, average deal value, lead quality, follow-up rate, lost opportunities, objection patterns'],
 ARRAY['Incorrect arithmetic','Only answer is "make more calls"'],
 '[{"range":"0-1","meaning":"weak"},{"range":"2","meaning":"basic"},{"range":"3","meaning":"correct mathematics plus pipeline reasoning"},{"range":"4","meaning":"target, conversion, activity, diagnosis and action"}]'::jsonb,
 'Stated numbers (100 and 200) plus named diagnostic metrics', 'telesales', 'active'),

('ts_mobility_problem_solving', 1, 'mobility_problem_solving', 'Mobility Operations Problem Solving',
 'You are the telesales representative, not the dispatcher. What do you do?',
 'A corporate customer has booked transport for an important executive meeting. Thirty minutes before pickup, the assigned vehicle becomes unavailable. The customer calls you angry.',
 'operational', 4,
 ARRAY['Who do you contact and in what order?','What do you tell the customer, and when?','How is the incident documented?'],
 ARRAY['Owns customer communication','Verifies the booking and facts','Engages the responsible operations team','Escalates within authority','Seeks an approved alternative','Communicates continuously','Confirms resolution','Documents and follows up'],
 ARRAY['Blames operations','Escalates without ownership','Invents authority they do not have','Promises what cannot be delivered'],
 '[{"range":"0-1","meaning":"blames or escalates without ownership"},{"range":"2","meaning":"appropriate escalation"},{"range":"3","meaning":"effective coordination"},{"range":"4","meaning":"customer ownership, operational discipline and recovery"}]'::jsonb,
 'Described sequence respecting operational boundaries', 'telesales', 'active'),

('ts_sales_simulation', 1, 'sales_simulation', 'Live Yalla Sales Simulation',
 'Conduct the sales conversation. You have five minutes and you must lead the interaction.',
 'Interviewer: "I am a corporate operations manager. We currently use three different transport suppliers. I am considering Yalla Mobility, but I am not convinced you can provide everything we need."',
 'work_simulation', 5,
 ARRAY['Do not coach the candidate.'],
 ARRAY['Discovery and questioning (1)','Listening and diagnosis (1)','Yalla solution mapping (1)','Value proposition and objection handling (1)','Closing and next action (1)'],
 ARRAY['Waits to be led','Presents without discovery','No close or next action','Confidence without selling behaviour'],
 '[{"range":"0-1","meaning":"does not lead the conversation"},{"range":"2","meaning":"partial discovery only"},{"range":"3","meaning":"credible conversation with a next step"},{"range":"4","meaning":"strong discovery, mapping and objection handling"},{"range":"5","meaning":"complete consultative sale with a controlled close"}]'::jsonb,
 'Observed behaviour across the five scored simulation elements', 'telesales', 'active')
ON CONFLICT (question_key, version) DO NOTHING;

INSERT INTO public.rec_assessment_templates
  (template_key, version, title, role_family, status, total_marks, band_rules, notes)
VALUES ('yalla_telesales_v1', 1, 'Yalla Telesales Structured Assessment', 'telesales', 'pilot', 50,
 '[{"min":45,"max":50,"band":"exceptional","label":"Exceptional — priority hiring consideration"},
   {"min":40,"max":44,"band":"strong","label":"Strong — hiring consideration"},
   {"min":35,"max":39,"band":"competent","label":"Competent — further validation / conditional"},
   {"min":30,"max":34,"band":"borderline","label":"Borderline — additional assessment required"},
   {"min":0,"max":29,"band":"not_recommended","label":"Not recommended"}]'::jsonb,
 'Standardised core assessment. CV validation questions are supplementary and never replace these questions.')
ON CONFLICT (template_key, version) DO NOTHING;

INSERT INTO public.rec_assessment_template_items (template_id, question_id, sort_order, max_marks, critical_min, mandatory)
SELECT t.id, q.id, x.ord, x.marks, x.gate, true
  FROM public.rec_assessment_templates t
  JOIN (VALUES
    ('ts_verified_sales', 1, 6::numeric, NULL::numeric),
    ('ts_prospecting', 2, 5, NULL),
    ('ts_sales_process', 3, 5, NULL),
    ('ts_objection_handling', 4, 6, 3),
    ('ts_yalla_solution', 5, 7, 4),
    ('ts_customer_management', 6, 4, NULL),
    ('ts_crm_discipline', 7, 4, 2),
    ('ts_productivity', 8, 4, NULL),
    ('ts_mobility_problem_solving', 9, 4, NULL),
    ('ts_sales_simulation', 10, 5, 3)
  ) AS x(qkey, ord, marks, gate) ON true
  JOIN public.rec_question_bank q ON q.question_key = x.qkey AND q.version = 1
 WHERE t.template_key = 'yalla_telesales_v1' AND t.version = 1
ON CONFLICT (template_id, question_id) DO NOTHING;