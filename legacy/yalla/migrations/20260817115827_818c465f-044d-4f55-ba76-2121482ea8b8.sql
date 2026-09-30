DO $mig$
DECLARE
  v_batch uuid;
  v_vacancy uuid := '4f5a1b34-710e-4d09-83a0-bff9f3bc8dac';
  v_data jsonb;
  v_row jsonb;
  v_fact jsonb;
  v_file uuid;
  v_cand uuid;
  v_app uuid;
  v_rec uuid;
  v_i integer := 0;
  v_dup_cand uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"616f5a72-5bc0-4c04-b5ee-0ed7b90120b9","role":"authenticated"}', true);

  IF EXISTS (SELECT 1 FROM public.rec_migration_batches WHERE batch_no = 'MIG-202608-TELSAL2') THEN
    RAISE NOTICE 'batch already seeded';
    RETURN;
  END IF;

  INSERT INTO public.rec_migration_batches
    (batch_no, name, source_kind, source_platform, source_organization, original_campaign,
     import_date, notes, status, mapping, totals, rollback_available, started_at, completed_at)
  VALUES
    ('MIG-202608-TELSAL2', 'Historical Telesales applications — bundle 2 (CV + cover letters)',
     'email_applications', 'email', 'Yalla Beena Limited', 'Telesales Executive (historical)',
     current_date, 'Second tranche of 10 emailed CVs and cover letters for the Telesales vacancy. Documents uploaded to the recruitment-migration bucket; extraction is evidence-bound with per-field confidence.',
     'imported', '{}'::jsonb, '{}'::jsonb, true, now(), now())
  RETURNING id INTO v_batch;

  v_data := $json$[
    {"name":"Susan Wakonyo Wahome","email":null,"phone":"0704636944","location":"Nairobi, Kenya",
     "headline":"Sales Executive — corporate client engagement","years":2,
     "summary":"Sales role at Masterpiece Security Services: prospecting, quotations and proposals, lead follow-up, client liaison. BSc Biochemistry.",
     "file":{"n":"Susan_Wakonyo_Wahome_Cover_Letter.docx","s":"2b5305168bd34f304989697602fb7205a21d0847085b357ff5d3d1c30b3310a9","b":20970,"m":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","d":"cover_letter"},
     "conf":0.72,
     "facts":[
       {"a":"location_nairobi","t":"Nairobi, Kenya","c":0.9,"l":"cover letter header"},
       {"a":"sales_experience_years","n":2,"t":"2 years sales and business development","c":0.7,"l":"paragraph 2"},
       {"a":"telesales_evidence","t":"Applying for Telesales Executive; engages prospective clients by phone and follow-up","c":0.68,"l":"paragraph 3"},
       {"a":"crm_proficiency","t":"Digital platforms for marketing and customer engagement (no named CRM)","c":0.4,"l":"paragraph 4"},
       {"a":"customer_service_evidence","t":"Client liaison, requirement coordination and relationship management","c":0.8,"l":"paragraph 2"},
       {"a":"education_qualification","t":"BSc Biochemistry","c":0.85,"l":"paragraph 5"},
       {"a":"communication_skills","t":"Structured written application, negotiation and follow-up skills claimed","c":0.85,"l":"whole document"}
     ]},
    {"name":"Joyce Mawia Mati","email":"matijoyce75@gmail.com","phone":"0704566355","location":"Nairobi, Kenya",
     "headline":"Telesales Representative — outbound and inbound sales","years":2,
     "summary":"2 years telesales: cold calling, lead generation, retention, target achievement. Salesforce, HubSpot, Zendesk, dialer systems. Diploma in International Relations and Diplomacy.",
     "file":{"n":"Joyce_Mawia_Mati_CV.docx","s":"63393d3a42f70e18198b791a058945adcdc109ceaf82fbbb59c76b78ad8a82a7","b":19741,"m":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","d":"cv"},
     "conf":0.93,
     "facts":[
       {"a":"location_nairobi","t":"Nairobi, P.O. Box 50990-00100","c":0.92,"l":"personal details"},
       {"a":"sales_experience_years","n":2,"t":"2 years of outbound/inbound telesales","c":0.92,"l":"professional summary"},
       {"a":"telesales_evidence","t":"Cold calling, objection handling, closing high-value deals, script adherence","c":0.95,"l":"key skills"},
       {"a":"crm_proficiency","t":"Salesforce, HubSpot, Zendesk, dialer systems, MS Excel","c":0.93,"l":"software"},
       {"a":"customer_service_evidence","t":"Customer retention and satisfaction scores maintained","c":0.9,"l":"professional summary"},
       {"a":"education_qualification","t":"Diploma, International Relations and Diplomacy — Management University of Africa","c":0.8,"l":"professional qualifications"},
       {"a":"communication_skills","t":"Active listening, negotiation, persuasion","c":0.88,"l":"soft skills"}
     ]},
    {"name":"Jane Waithira Kamau","email":"jkwaithira850@gmail.com","phone":"0702003675","location":"Kitui, Kenya",
     "headline":"Telesales representative — 3 years sales and customer service","years":3,
     "summary":"Three years in sales, customer service, lead generation and client relationship management. Outbound and inbound calling, target achievement, CRM systems.",
     "file":{"n":"Jane_Waithira_Kamau_CV.pdf","s":"c7b0ec38c2ca5ed9e34afd110f67fd9a8f490bdca350e1ff155ff21d493a7d9f","b":165996,"m":"application/pdf","d":"cv"},
     "conf":0.66,
     "facts":[
       {"a":"sales_experience_years","n":3,"t":"three years of experience in sales and customer service","c":0.9,"l":"personal profile"},
       {"a":"telesales_evidence","t":"Outbound and inbound calls, converting prospects, achieving sales targets","c":0.9,"l":"personal profile"},
       {"a":"crm_proficiency","t":"Skilled in CRM system (unnamed)","c":0.65,"l":"personal profile"},
       {"a":"customer_service_evidence","t":"Excellent customer support, objection handling, retention","c":0.85,"l":"personal profile"},
       {"a":"education_qualification","t":"Management and leadership coursework stated in career objective","c":0.6,"l":"career objective"},
       {"a":"communication_skills","t":"Kiswahili and English, excellent interpersonal and communication skills","c":0.82,"l":"skills list"}
     ]},
    {"name":"Catherine Wambui Wairimu","email":"catherinewairimu121@gmail.com","phone":"0715621431","location":null,
     "headline":"Telesales and customer care — Lesedi Developers, Platinum Credit","years":5,
     "summary":"Telesales at Lesedi Developers (2020-2021), customer care at Platinum Credit (2022-2023). Business Management, NIBS College.",
     "file":{"n":"Catherine_Wairimu_CV.docx","s":"23f9c74cd4f1a20da1b15166be72cae62c394769a9be5a45a68d92eca22afec4","b":14875,"m":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","d":"cv"},
     "conf":0.78,
     "facts":[
       {"a":"sales_experience_years","n":5,"t":"Telesales 2020-2021 and customer care 2022-2023 plus later roles","c":0.75,"l":"work experience"},
       {"a":"telesales_evidence","t":"Initiating sales with potential customers over the phone, meeting sales quotas","c":0.88,"l":"Lesedi Developers — Telesales"},
       {"a":"crm_proficiency","t":"Keeping a record of calls and relevant details (no CRM named)","c":0.45,"l":"Lesedi Developers — Telesales"},
       {"a":"customer_service_evidence","t":"Customer care at Platinum Credit — product information and issue handling","c":0.9,"l":"Platinum Credit Ltd"},
       {"a":"education_qualification","t":"Business Management, NIBS College 2017-2019; Certificate in Computer Packages","c":0.8,"l":"academic background"},
       {"a":"communication_skills","t":"Telephone sales and customer information delivery","c":0.75,"l":"work experience"}
     ]},
    {"name":"Lyne Muriki Kathambi","email":"lynemuriki@gmail.com","phone":"0741983109","location":"Nairobi, Kenya",
     "headline":"Sales and marketing — credit sales and asset financing","years":2,
     "summary":"Credit sales, asset financing, SME business development. Salesperson at Kenya Coach Industries. BEd Science.",
     "file":{"n":"Lyne_Muriki_CV.pdf","s":"46acfe1694db10301e704f2820e51b17de05b812601309272c4c6ad91cba229f","b":245295,"m":"application/pdf","d":"cv"},
     "conf":0.86,
     "facts":[
       {"a":"location_nairobi","t":"Nairobi, Kenya","c":0.95,"l":"contact line"},
       {"a":"sales_experience_years","n":2,"t":"Credit sales and salesperson roles","c":0.7,"l":"experience"},
       {"a":"telesales_evidence","t":"Lead generation and customer follow-up; no explicit outbound calling role","c":0.5,"l":"skills 1 and 5"},
       {"a":"crm_proficiency","t":"Ability to adapt to new CRM and onboarding systems (no CRM used)","c":0.55,"l":"skills 4"},
       {"a":"customer_service_evidence","t":"Customer relationship management, quotations and follow-up","c":0.72,"l":"experience"},
       {"a":"education_qualification","t":"Bachelor of Education (Science), Mathematics and Chemistry","c":0.85,"l":"professional summary"},
       {"a":"communication_skills","t":"Product presentation and negotiation with customers","c":0.8,"l":"experience"}
     ]},
    {"name":"Lenity Mukami Muriuki","email":"lenity77@gmail.com","phone":"0790220383","location":null,
     "headline":"Sales and marketing — 4 years","years":4,
     "summary":"Scanned CV (CamScanner). Sales experience with marketing qualification; extraction required OCR so several fields are low confidence.",
     "file":{"n":"Lenity_Mukami_CV.pdf","s":"efc35eb3eee18e62c06b621dc53f2034a784772f275682df2a77ae0ba96b8b2c","b":669893,"m":"application/pdf","d":"cv"},
     "conf":0.48,
     "facts":[
       {"a":"sales_experience_years","n":4,"t":"OCR text indicates approximately 4 years sales experience","c":0.55,"l":"OCR page 2"},
       {"a":"customer_service_evidence","t":"Good interpersonal skills, client handling (OCR)","c":0.6,"l":"OCR page 1 personal attributes"},
       {"a":"education_qualification","t":"Marketing qualification (OCR, partially legible)","c":0.52,"l":"OCR page 2 education background"},
       {"a":"communication_skills","t":"English and Kiswahili spoken and written (OCR)","c":0.6,"l":"OCR page 1"}
     ]},
    {"name":"Lynnet Njeri Nyaguthii","email":"njerilynnet05@gmail.com","phone":"0717220256","location":"Kerugoya / Nairobi County",
     "headline":"Front office supervisor and brand ambassador","years":9,
     "summary":"Safaricom brand ambassador, front office supervisor at Magunas Supermarket. Financial reporting, CRM, team leadership.",
     "file":{"n":"Lynnet_Njeri_CV.pdf","s":"c56a5d4f02c47039d5e239d8b5a7c5167a99b8877640cca4e933c7b8d6d16cf9","b":169392,"m":"application/pdf","d":"cv"},
     "conf":0.8,
     "facts":[
       {"a":"location_nairobi","t":"Header reads Kerugoya Nairobi County — ambiguous base location","c":0.55,"l":"header line"},
       {"a":"sales_experience_years","n":9,"t":"Brand ambassador and supervisory roles 2021-2024","c":0.82,"l":"work history"},
       {"a":"telesales_evidence","t":"Field promotion of Safaricom products; no outbound calling desk role","c":0.5,"l":"Safaricom Brand Ambassador"},
       {"a":"crm_proficiency","t":"Customer relationship management listed as a skill","c":0.7,"l":"skills"},
       {"a":"customer_service_evidence","t":"Resolved customer queries and complaints; front office supervision","c":0.9,"l":"work history"},
       {"a":"education_qualification","t":"Finance and accounts training referenced","c":0.65,"l":"professional summary"},
       {"a":"communication_skills","t":"Customer education and stakeholder collaboration","c":0.8,"l":"work history"}
     ]},
    {"name":"Teresia Wangari Ndegwa","email":"wteresia100@gmail.com","phone":"0702789528","location":null,
     "headline":"Office assistant and shop supervisor","years":3,
     "summary":"Office assistant at Bossmi Travel and Tours (2024-2026); Lush Beauty and Cosmetics (2023). Client records, phone handling, invoices.",
     "file":{"n":"Teresia_Wangari_CV.pdf","s":"97dc2210d7045eeaea9c9a4aa976e2d57c83c5137d40655b048b57a78effc335","b":139603,"m":"application/pdf","d":"cv"},
     "conf":0.7,
     "facts":[
       {"a":"sales_experience_years","n":3,"t":"Retail and travel office roles 2023-2026","c":0.6,"l":"work experience"},
       {"a":"crm_proficiency","t":"Client details entered into databases (no CRM named)","c":0.4,"l":"Bossmi Travel and Tours"},
       {"a":"customer_service_evidence","t":"Answering phone calls, responding to emails, assisting walk-in clients","c":0.82,"l":"Bossmi Travel and Tours"},
       {"a":"education_qualification","t":"Not clearly stated in the document","c":0.5,"l":"document scan"},
       {"a":"communication_skills","t":"Effective communicator, active listener","c":0.72,"l":"personal profile statement"}
     ]},
    {"name":"Margaret Gathoni","email":"Maggiematthew543@gmail.com","phone":"+254710352987","location":"Nairobi, Kenya",
     "headline":"Office administrator and receptionist","years":1,
     "summary":"Office receptionist and administrator at Pritex Solutions; data entry clerk. Digital marketing freelance work. Limited direct sales exposure.",
     "file":{"n":"Margaret_Gathoni_CV.pdf","s":"8d78513ec18f4bf4e383a9391f1a091b1437bded23cc736504caaa22219adda8","b":23729,"m":"application/pdf","d":"cv"},
     "conf":0.84,
     "facts":[
       {"a":"location_nairobi","t":"Kenyan, Nairobi-based contact numbers","c":0.7,"l":"contact details"},
       {"a":"sales_experience_years","n":1,"t":"Administrative and reception roles; about one year of commercial exposure","c":0.7,"l":"professional experience"},
       {"a":"crm_proficiency","t":"Corporate database management and records","c":0.45,"l":"professional summary"},
       {"a":"customer_service_evidence","t":"Front-office hospitality, visitor management, client experience","c":0.85,"l":"Office Receptionist and Administrator"},
       {"a":"education_qualification","t":"Business management professional background","c":0.7,"l":"professional summary"},
       {"a":"communication_skills","t":"Outstanding communication and professional etiquette","c":0.8,"l":"professional summary"}
     ]},
    {"name":"Anne Njeri Njui","email":null,"phone":null,"location":"Nairobi, Kenya",
     "headline":"Sales and marketing diploma — travel and ticketing coursework","years":null,
     "summary":"Cover letter only (addressed to a third party, 24/10/2025). Diploma in Sales and Marketing, NIBS. No CV, no contact details, no employment history supplied.",
     "file":{"n":"Anne_Njeri_Njui_Cover_Letter.docx","s":"1a24654b9a98b678f6c494b5dd87d750e23224f65121e9c97bc24acb147f2456","b":13016,"m":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","d":"cover_letter"},
     "conf":0.35,
     "facts":[
       {"a":"location_nairobi","t":"P.O Box 9644-00300 Nairobi","c":0.78,"l":"letter header"},
       {"a":"education_qualification","t":"Diploma in Sales and Marketing, Nairobi Institute of Business Studies","c":0.75,"l":"paragraph 2"},
       {"a":"communication_skills","t":"Short cover letter, limited detail","c":0.5,"l":"whole document"}
     ]}
  ]$json$::jsonb;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_data) LOOP
    v_i := v_i + 1;

    INSERT INTO public.rec_migration_files
      (batch_id, original_file_name, storage_path, mime_type, size_bytes, sha256,
       file_kind, doc_type, status, page_count, attempts, extracted_text)
    VALUES
      (v_batch, v_row->'file'->>'n',
       'MIG-202608-TELSAL2/' || (v_row->'file'->>'n'),
       v_row->'file'->>'m', (v_row->'file'->>'b')::bigint, v_row->'file'->>'s',
       'document', v_row->'file'->>'d', 'parsed', NULL, 1,
       v_row->>'summary')
    RETURNING id INTO v_file;

    INSERT INTO public.rec_candidates
      (candidate_no, full_name, email, phone, location, headline, summary, years_experience,
       source, engagement_status, consent_given, record_state,
       migration_batch_id, source_platform, source_candidate_ref, created_by_migration)
    VALUES
      ('CAND-MIG-TS2-' || lpad(v_i::text, 3, '0'),
       v_row->>'name', v_row->>'email', v_row->>'phone', v_row->>'location',
       v_row->>'headline', v_row->>'summary',
       CASE WHEN v_row->>'years' IS NULL THEN NULL ELSE (v_row->>'years')::numeric END,
       'migration', 'passive', false, 'active',
       v_batch, 'email', v_row->'file'->>'n', true)
    RETURNING id INTO v_cand;

    INSERT INTO public.rec_applications
      (application_no, candidate_id, vacancy_id, source, applied_at, stage, status, priority,
       migration_batch_id, source_platform, source_application_ref, source_vacancy_ref,
       source_status, source_applied_at, created_by_migration, stage_entered_at, last_activity_at)
    VALUES
      ('APP-MIG-TS2-' || lpad(v_i::text, 3, '0'), v_cand, v_vacancy, 'migration', now(),
       'screening', 'active', 'normal',
       v_batch, 'email', v_row->'file'->>'n', 'Telesales Executive (historical)',
       'received', now(), true, now(), now())
    RETURNING id INTO v_app;

    INSERT INTO public.rec_candidate_documents
      (candidate_id, application_id, doc_type, file_name, storage_path, mime_type, size_bytes,
       migration_batch_id, original_file_name, file_hash, version_no, is_preferred, created_by_migration)
    VALUES
      (v_cand, v_app, v_row->'file'->>'d', v_row->'file'->>'n',
       'MIG-202608-TELSAL2/' || (v_row->'file'->>'n'),
       v_row->'file'->>'m', (v_row->'file'->>'b')::bigint,
       v_batch, v_row->'file'->>'n', v_row->'file'->>'s', 1, true, true);

    INSERT INTO public.rec_migration_records
      (batch_id, source_row_key, source_row_no, source_platform, source_candidate_ref,
       source_vacancy_ref, source_status, source_applied_at, raw_payload, normalized, extraction,
       extraction_confidence, state, candidate_id, identity_match_kind, vacancy_id, vacancy_map_kind)
    VALUES
      (v_batch, v_row->'file'->>'s', v_i, 'email', v_row->'file'->>'n',
       'Telesales Executive (historical)', 'received', now(),
       jsonb_build_object('file', v_row->'file'->>'n'),
       jsonb_build_object('full_name', v_row->>'name', 'email', v_row->>'email',
                          'phone', v_row->>'phone', 'location', v_row->>'location'),
       jsonb_build_object('facts', v_row->'facts'),
       (v_row->>'conf')::numeric, 'IMPORTED', v_cand, 'new', v_vacancy, 'existing')
    RETURNING id INTO v_rec;

    INSERT INTO public.rec_migration_record_files (record_id, file_id, doc_type, match_method, match_confidence)
    VALUES (v_rec, v_file, v_row->'file'->>'d', 'filename_identity', 0.95);

    FOR v_fact IN SELECT * FROM jsonb_array_elements(v_row->'facts') LOOP
      INSERT INTO public.rec_evidence_facts
        (candidate_id, application_id, attribute, value_text, value_numeric,
         source_kind, source_ref, source_locator, confidence, extracted_by)
      VALUES
        (v_cand, v_app, v_fact->>'a', v_fact->>'t',
         CASE WHEN v_fact->>'n' IS NULL THEN NULL ELSE (v_fact->>'n')::numeric END,
         CASE WHEN (v_row->'file'->>'d') = 'cover_letter' THEN 'document' ELSE 'cv' END,
         v_row->'file'->>'n', v_fact->>'l', (v_fact->>'c')::numeric, 'extraction_engine');
    END LOOP;

    INSERT INTO public.rec_migration_events (batch_id, record_id, action, reason, detail)
    VALUES (v_batch, v_rec, 'imported',
            'Historical application imported from emailed document bundle',
            jsonb_build_object('file', v_row->'file'->>'n', 'confidence', v_row->>'conf'));

    PERFORM public.rec_evaluate_application(v_app);
  END LOOP;

  -- One genuine identity ambiguity to adjudicate: shared given name with a batch 1 candidate.
  SELECT id INTO v_dup_cand FROM public.rec_candidates WHERE full_name = 'Margaret Wambui Kamau' LIMIT 1;
  IF v_dup_cand IS NOT NULL THEN
    INSERT INTO public.rec_migration_duplicates
      (batch_id, record_id, candidate_id, classification, similarity, signals, resolution)
    SELECT v_batch, r.id, v_dup_cand, 'possible', 0.42,
           jsonb_build_object('given_name_match', true, 'email_match', false, 'phone_match', false,
                              'note', 'Shares the given name Margaret with an existing batch 1 candidate; contact details differ.'),
           'pending'
      FROM public.rec_migration_records r
      JOIN public.rec_candidates c ON c.id = r.candidate_id
     WHERE r.batch_id = v_batch AND c.full_name = 'Margaret Gathoni';
  END IF;

  UPDATE public.rec_migration_batches
     SET totals = jsonb_build_object('files', 10, 'records', 10, 'candidates', 10, 'applications', 10)
   WHERE id = v_batch;
END
$mig$;