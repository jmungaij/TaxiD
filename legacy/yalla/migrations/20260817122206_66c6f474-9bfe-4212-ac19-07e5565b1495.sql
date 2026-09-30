DO $mig$
DECLARE
  v_batch uuid;
  v_vac uuid := '4f5a1b34-710e-4d09-83a0-bff9f3bc8dac';
  v_cand uuid;
  v_app uuid;
  v_rec uuid;
  v_file uuid;
  r record;
  f record;
BEGIN
  INSERT INTO public.rec_migration_batches (batch_no, name, source_kind, source_platform, source_organization, original_campaign, import_date, notes, status, started_at, totals)
  VALUES ('MIG-202608-TELSAL3', 'Historical Telesales applications — Batch 3', 'email_applications', 'email', 'Yalla Mobility', 'Telesales (historical)', current_date,
          'Third tranche of historical Telesales CVs and cover letters received by email. 10 files; 4 are re-submissions of candidates already migrated in batches 1 and 2.',
          'processing', now(), jsonb_build_object('files', 10, 'expected_candidates', 6, 'expected_duplicates', 4))
  RETURNING id INTO v_batch;

  CREATE TEMP TABLE tmp_f (
    ord int, fname text, spath text, sha text, bytes bigint, pages int, kind text, doc_type text,
    person text, email text, phone text, location text, headline text, summary text,
    years numeric, cur_title text, cur_emp text, excerpt text,
    dup_of uuid,
    ev jsonb
  ) ON COMMIT DROP;

  INSERT INTO tmp_f VALUES
  (1,'NNET_NJERINYAGUTHII_Resume_102-1_1_1-2.pdf','MIG-202608-TELSAL3/lynnet-njeri-nyaguthii-resume.pdf','c56a5d4f02c47039d5e239d8b5a7c5167a99b8877640cca4e933c7b8d6d16cf9',169392,3,'resume','cv',
   'Lynnet Njeri Nyaguthii','njerilynnet05@gmail.com','0717220256','Kerugoya / Nairobi County',NULL,NULL,NULL,NULL,NULL,
   'LYNNET NJERI NYAGUTHII — Kerugoya Nairobi County | 0717220256 | njerilynnet05@gmail.com. Detail-oriented finance professional with experience in cashier supervision, account management and secretarial duties. Safaricom Brand Ambassador (Samchi Enterprises, 07/2024-12/2024); Front Office Supervisor, Magunas Supermarket K LTD (01/2021-07/2024).',
   '93e83410-b78f-4372-8871-ce1883fd4b0d', NULL),
  (2,'Gracencia_Anindo.pdf','MIG-202608-TELSAL3/gracencia-anindo-cv.pdf','f3a24e7fca0b31438e382906d1f217bc12dbe1ef963f071f76c6bb5c20d1efe9',991031,2,'resume','cv',
   'Gracencia Anindo',NULL,NULL,'Nairobi, Kenya','Call centre agent — sales, cashiering and customer support',
   'Sales and marketing (Carlcare Service Limited, Nairobi, 2018-2020), cashier (Smart Home Supermarket, 2021-2023) and call centre agent (Simple Pay, Nairobi, 2024-2026). Handles inbound customer calls, complaint resolution, record updates and daily team targets.',
   4,'Call Centre Agent','Simple Pay',
   'Sales and Marketer — Carlcare Service Limited/Nairobi/2018-2020: sales strategies, client demonstrations, client relations, sales data tracking and reporting. Cashier — Smart Home Supermarket/Nairobi/2021-2023: customer service, transactions, POS system, cross-selling and sales referrals. Call Center — Simple Pay/Nairobi/2024-2026: answered customer calls, resolved problems, handled complaints and follow-ups, recorded customer details in system, worked with team to meet daily targets. No contact details or education section present in document.',
   NULL,
   '[{"a":"location_nairobi","t":"Nairobi (inferred from employer locations)","c":0.5,"l":"work history"},
     {"a":"sales_experience_years","t":"~4 years across sales, cashiering and call centre roles (2018-2026)","n":4,"c":0.6,"l":"work history"},
     {"a":"telesales_evidence","t":"Call centre agent at Simple Pay — answered customer calls, met daily targets","c":0.65,"l":"Call center — Simple Pay"},
     {"a":"crm_proficiency","t":"Recorded and updated customer details in system; POS operation","c":0.4,"l":"Call center / Cashier"},
     {"a":"customer_service_evidence","t":"Complaint handling, follow-ups and customer support across three roles","c":0.8,"l":"work history"},
     {"a":"communication_skills","t":"States good communication and time management in fast-paced environment","c":0.5,"l":"Call center — Simple Pay"}]'::jsonb),
  (3,'Jacinta_Mutunga_cover_letter_8_1.pdf','MIG-202608-TELSAL3/jacinta-mutunga-cover-letter.pdf','5d848c734e580c50d44a082a4774ba4303241f2755ae456adc54886bad06dd68',12466,1,'cover_letter','cover_letter',
   'Jacinta Mutunga','cintamutheu@gmail.com','0712086088','Kenya','Telesales applicant — 5 years sales and customer service',
   'Cover letter only. Five-plus years of sales and customer service experience including Aetlantiq Group Limited (Hisense), promoting and selling electronics and assisting customers with product needs. States confidence in communication, customer engagement, product promotion and hitting sales targets.',
   5,'Sales Representative','Aetlantiq Group Limited (Hisense)',
   'Jacinta Mutunga, 0712086088, cintamutheu@gmail.com, 16/08/2026. RE: APPLICATION FOR TELESALES REPRESENTATIVE. Over five years of experience in sales and customer service, including Aetlantiq Group Limited (Hisense), promoting and selling electronics while assisting customers with their product needs. Confident in communication, customer engagement, product promotion and achieving sales targets. Readily available for work or interviews.',
   NULL,
   '[{"a":"location_nairobi","t":"Kenya stated; city not specified","c":0.35,"l":"letterhead"},
     {"a":"sales_experience_years","t":"Over five years in sales and customer service (self-reported)","n":5,"c":0.6,"l":"Cover Letter"},
     {"a":"telesales_evidence","t":"Applies directly for Telesales Representative; no telesales role evidenced","c":0.4,"l":"Cover Letter"},
     {"a":"customer_service_evidence","t":"Assisted customers with product needs at Hisense retail","c":0.6,"l":"Cover Letter"},
     {"a":"communication_skills","t":"Self-reported confidence in communication and persuasion","c":0.45,"l":"Cover Letter"}]'::jsonb),
  (4,'LAURYN_RAMOGI_COVER_LETTER_AND_CV_copy.pdf','MIG-202608-TELSAL3/lauryn-ramogi-cover-letter-cv.pdf','9c787f563ef73defaca5203178575b48f6ee41e0e086ac4be664edc31502ffe8',80294,3,'resume','cv',
   'Lauryn Truphosa Ramogi','laurynwilliams65@gmail.com','+254727983427','Nairobi, Kenya','Call centre agent — inbound and outbound customer operations',
   'Over five years in contact centre and financial services. Call Centre Agent at Call Centre International (CCI) processing 100+ inbound inquiries daily at 95% accuracy and 90% CSAT; previously Contact Centre Agent and Customer Service Representative at Kenya Commercial Bank with 98% first-call resolution and inbound/outbound campaigns.',
   5,'Call Centre Agent','Call Centre International (CCI)',
   'Lauryn Truphosa Ramogi, laurynwilliams65@gmail.com, +254 727 983 427, Nairobi, Kenya. Over 5 years exceeding performance metrics in high-volume environments. At KCB achieved 98% first-call resolution and implemented 3 process improvements (+10% service efficiency). Call Centre Agent at CCI: 100+ inbound inquiries daily, 95% accuracy, 90% customer satisfaction, exceeded KPIs contributing 15% team productivity gain; American phone etiquette and data privacy adherence. Skills: CRM Software | Call Center Management Systems | Data Entry | Microsoft Office Suite | Customer Relationship Management. Managed inbound and outbound customer communications, 50+ interactions. Education: Diploma in Broadcast Journalism, Kenya Institute of Mass Communication 2019; Certificate 2015; ICDL Certificates.',
   NULL,
   '[{"a":"location_nairobi","t":"Nairobi, Kenya stated in header","c":0.95,"l":"contact details"},
     {"a":"sales_experience_years","t":"5+ years customer operations incl. outbound communications","n":5,"c":0.75,"l":"Cover Letter / Experience"},
     {"a":"telesales_evidence","t":"Managed inbound and outbound customer communications; 100+ calls daily at CCI","c":0.9,"l":"Call Centre Agent — CCI"},
     {"a":"crm_proficiency","t":"CRM software and call centre management systems listed as core skills","c":0.85,"l":"skills"},
     {"a":"customer_service_evidence","t":"98% first-call resolution at KCB; 90% CSAT at CCI","c":0.95,"l":"Experience"},
     {"a":"education_qualification","t":"Diploma in Broadcast Journalism, KIMC (2019); ICDL certificates","c":0.85,"l":"education"},
     {"a":"communication_skills","t":"Broadcast journalism training; American phone etiquette mastery","c":0.9,"l":"Cover Letter"}]'::jsonb),
  (5,'WAKONYO_WAHOME_CV.pdf','MIG-202608-TELSAL3/susan-wakonyo-wahome-cv.pdf','b40d2ccca22e81d6225aaecb82c83894d1a431bf6df877a9c81192a34ce59248',166267,3,'resume','cv',
   'Susan Wakonyo Wahome','wakonyowahome@gmail.com','+254704636944','Nairobi, Kenya',NULL,NULL,NULL,NULL,NULL,
   'SUSAN WAKONYO WAHOME — +254 704636944, wakonyowahome@gmail.com. Certified Virtual Assistant; Sales Executive at Masterpiece Security Company (Sept 2025-present) handling tendering, RFI/RFP/RFQ, weekly sales reports, lead generation; Sales Associate & Social Media Manager, The Shoe Boutique & Bellsimo Secrets (Oct 2024-Mar 2025).',
   'bbada18c-747c-442c-989b-34a2b93f5e74', NULL),
  (6,'joyces_resume.pdf','MIG-202608-TELSAL3/joyce-mawia-mati-resume.pdf','fd984804c495ef80c45004b9e41b013613e25956a6f78e774c481ddb2ce8c915',123830,3,'resume','cv',
   'Joyce Mawia Mati','matijoyce75@gmail.com','0704566355','Nairobi, Kenya',NULL,NULL,NULL,NULL,NULL,
   'JOYCE MAWIA MATI — matijoyce75@gmail.com, 0704566355, Nairobi. Telesales Representative with 2 years of outbound/inbound sales, lead generation and customer retention. Skills: cold calling, Salesforce, HubSpot, Zendesk, dialer systems, objection handling, B2B sales. Degree in Public Relations (Mount Kenya University, 2024).',
   '5e260cfd-49aa-4b48-9c5b-be88d7eb6226', NULL),
  (7,'Nicole_Mumo_Updated_CV_2026_3.pdf','MIG-202608-TELSAL3/nicole-mumo-cv.pdf','d6b407aad07416b8c71fdd59da7bab7f408f9c398f29ba35e7e20e126887f21d',124190,4,'resume','cv',
   'Nicole Mumo','nicolemumo2020@gmail.com','+254707973897','Nairobi, Kenya','Client relationship manager — lead follow-up and client acquisition',
   'Customer service and sales professional currently Client Relationship Manager at Username Investment Limited, following up on leads and prospective buyers, reporting sales progress and client activity. Prior roles at Unique Investor Properties, Erean Limited and Mediamax (K24 TV). Diploma in Television Programs Production.',
   3,'Client Relationship Manager','Username Investment Limited',
   'Nicole Mumo, nicolemumo2020@gmail.com, +254 707973897. Motivated Customer Service professional with experience in sales, marketing and administrative roles. Key skills: exceptional customer service, meeting sales targets through lead generation and client acquisition, negotiation, problem-solving under pressure, Microsoft Office, multitasking. Client Relationship Manager, Username Investment Limited, Nairobi, Aug 2025-date: following up on leads and potential buyers; reporting customer feedback, sales progress and client activity to management; identifying and engaging prospective clients through various channels. Earlier: Unique Investor Properties (UIP), Erean Limited, Mediamax Limited (K24 TV), all Nairobi. Education: Diploma in Television Programs Production and Programming; KCSE.',
   NULL,
   '[{"a":"location_nairobi","t":"All roles based in Nairobi, Kenya","c":0.9,"l":"work history"},
     {"a":"sales_experience_years","t":"~3 years in sales and client relationship roles","n":3,"c":0.65,"l":"work history"},
     {"a":"telesales_evidence","t":"Lead follow-up and prospective client engagement across channels; no dedicated telesales role","c":0.55,"l":"Client Relationship Manager"},
     {"a":"crm_proficiency","t":"Reports client activity and sales progress; no named CRM tool","c":0.35,"l":"Client Relationship Manager"},
     {"a":"customer_service_evidence","t":"Customer service across sales, marketing and administrative roles","c":0.75,"l":"key skills"},
     {"a":"education_qualification","t":"Diploma in Television Programs Production and Programming","c":0.6,"l":"education"},
     {"a":"communication_skills","t":"Strong communication with negotiation and presentation experience","c":0.65,"l":"key skills"}]'::jsonb),
  (8,'Winfred_Mukami_Karani_Resume_2026.pdf','MIG-202608-TELSAL3/winfred-mukami-karani-resume.pdf','2478cda8f8c35bb7685cf42241450a9d98906d285b1729e95a9e24b945664c3a',89937,3,'resume','cv',
   'Winfred Mukami Karani','winmukamik@gmail.com','+254701746798','Nairobi, Kenya','Sales specialist and customer experience professional',
   '4+ years in B2C sales, customer relationship management and proactive outreach across financial services and wellness. Currently Customer Service Representative at Africa Advance and Industrial Limited; previously Aventus Group and Shanti Wellness Africa. Bilingual English/Kiswahili with broadcast media background.',
   4,'Customer Service Representative','Africa Advance and Industrial Limited',
   'WINFRED MUKAMI KARANI — Sales Specialist & Customer Experience Professional, +254 701 746 798, winmukamik@gmail.com, Nairobi, Kenya. Dynamic Sales Specialist with 4+ years in B2C sales, customer relationship management and proactive outreach across financial services and wellness sectors. Core competencies: Sales & Negotiation, CRM, Upselling & Cross-Selling, Proactive Outreach, Bilingual (English & Kiswahili). Customer Service Representative, Africa Advance and Industrial Limited, Nairobi, 2025-present: first point of contact across multiple communication channels; maintains records of all customer interactions in the CRM system; recommends products contributing to upsell and cross-sell. Aventus Group: maintained accurate documentation of sales transactions and customer interactions in the CRM system. Shanti Wellness Africa. Education: Diploma in Journalism & Mass Media Studies, Nairobi Institute of Business Studies (Dec 2020).',
   NULL,
   '[{"a":"location_nairobi","t":"Nairobi, Kenya stated in header and all roles","c":0.95,"l":"contact details"},
     {"a":"sales_experience_years","t":"4+ years B2C sales and customer relationship management","n":4,"c":0.85,"l":"professional summary"},
     {"a":"telesales_evidence","t":"Proactive outreach and multi-channel customer contact with upsell/cross-sell","c":0.75,"l":"core competencies"},
     {"a":"crm_proficiency","t":"Maintains customer interactions and sales transactions in CRM system across two employers","c":0.9,"l":"Experience"},
     {"a":"customer_service_evidence","t":"First point of contact for inquiries, complaints and service requests","c":0.9,"l":"Customer Service Representative"},
     {"a":"education_qualification","t":"Diploma in Journalism & Mass Media Studies (2020)","c":0.85,"l":"education"},
     {"a":"communication_skills","t":"Bilingual English/Kiswahili; broadcast media and written communication","c":0.9,"l":"core competencies"}]'::jsonb),
  (9,'Victoria_Wambui_Telesales_suppoort-2.pdf','MIG-202608-TELSAL3/victoria-wambui-maina-telesales.pdf','4b7d127f49540e7e50b45e7d360e17d668cb78f4f166f0deb1e2aa0995ec2804',173948,5,'resume','cv',
   'Victoria Wambui Maina','vwambui950@gmail.com','+254707493616','Nairobi, Kenya',NULL,NULL,NULL,NULL,NULL,
   'VICTORIA WAMBUI MAINA — +254 707 493 616, vwambui950@gmail.com. Telesales and customer relationship professional with over four years in telesales, customer service, lead follow-up, sales support and CRM management (Zoho CRM), objection handling, cross-selling and target tracking.',
   'ab89b85f-329c-4b73-ab76-8547ceb5ab24', NULL),
  (10,'Ruth_kungu_resume.pdf','MIG-202608-TELSAL3/ruth-wairimu-kungu-resume.pdf','e0429f77f5964f7e947ffac723264a8ead6084f0e453056ac2f3b417c525ecdb',451322,3,'resume','cv',
   'Ruth Wairimu Kungu','ruthkungumimo@gmail.com','+254702137613','Nairobi, Kenya','Customer service professional — multi-channel support and CRM',
   'Over eight years of customer service across manufacturing, retail, financial services and technology outsourcing. Resolves inquiries across multiple channels, processes orders, handles complaints and generates reports. Bachelor of Journalism and Communication (Kenya Methodist University).',
   8,'Customer Service Representative',NULL,
   'RUTH WAIRIMU KUNGU — ruthkungumimo@gmail.com, (+254) 702 137 613, P.O. Box 1110-00621 Nairobi. Customer service professional with over eight years of experience in manufacturing, retail, financial services and technology outsourcing. Excels in resolving customer inquiries across multiple channels, building strong relationships, accurate order processing, complaint resolution and report generation. Education: Bachelor of Journalism and Communication (Communications Major), Kenya Methodist University 2015-2018; Diploma in Journalism and Mass Communication, Mount Kenya University. Skills include Customer Relationship Management (CRM) and Call Center Operations; reviewed and updated records in CRM system accurately; contributed to CRM updates and record maintenance initiatives.',
   NULL,
   '[{"a":"location_nairobi","t":"Nairobi postal address on CV header","c":0.85,"l":"contact details"},
     {"a":"sales_experience_years","t":"8+ years customer service with order processing; sales-specific tenure not itemised","n":3,"c":0.5,"l":"summary"},
     {"a":"telesales_evidence","t":"Call centre operations listed; multi-channel inquiry resolution","c":0.6,"l":"skills"},
     {"a":"crm_proficiency","t":"Reviewed and updated records in CRM system; CRM listed as a core skill","c":0.8,"l":"Experience / skills"},
     {"a":"customer_service_evidence","t":"Eight years of multi-sector customer service and complaint resolution","c":0.95,"l":"summary"},
     {"a":"education_qualification","t":"Bachelor of Journalism and Communication, Kenya Methodist University","c":0.9,"l":"education"},
     {"a":"communication_skills","t":"Communications degree and diploma in journalism and mass communication","c":0.9,"l":"education"}]'::jsonb);

  FOR f IN SELECT * FROM tmp_f ORDER BY ord LOOP
    INSERT INTO public.rec_migration_files (batch_id, original_file_name, storage_path, mime_type, size_bytes, sha256, file_kind, doc_type, status, extracted_text, page_count, attempts)
    VALUES (v_batch, f.fname, f.spath, 'application/pdf', f.bytes, f.sha, 'document', f.doc_type, 'parsed', f.excerpt, f.pages, 1)
    RETURNING id INTO v_file;

    INSERT INTO public.rec_migration_records (
      batch_id, source_row_key, source_row_no, source_platform, source_candidate_ref, source_vacancy_ref,
      source_status, raw_payload, normalized, extraction, extraction_confidence, state,
      identity_match_kind, identity_similarity, vacancy_id, vacancy_map_kind, attempts)
    VALUES (
      v_batch, f.sha, f.ord, 'email', f.fname, 'Telesales',
      'historical_application',
      jsonb_build_object('file_id', v_file, 'original_file_name', f.fname, 'storage_path', f.spath, 'sha256', f.sha),
      jsonb_build_object('full_name', f.person, 'email', f.email, 'phone', f.phone, 'location', f.location,
                         'headline', f.headline, 'years_experience', f.years,
                         'current_title', f.cur_title, 'current_employer', f.cur_emp),
      jsonb_build_object('doc_type', f.doc_type, 'page_count', f.pages, 'evidence', coalesce(f.ev, '[]'::jsonb)),
      CASE WHEN f.dup_of IS NOT NULL THEN 0.90
           WHEN f.email IS NULL OR f.phone IS NULL THEN 0.52
           WHEN f.doc_type = 'cover_letter' THEN 0.61
           ELSE 0.86 END,
      CASE WHEN f.dup_of IS NOT NULL THEN 'DUPLICATE_REVIEW' ELSE 'IMPORTED' END,
      CASE WHEN f.dup_of IS NOT NULL THEN 'exact' ELSE 'new' END,
      CASE WHEN f.dup_of IS NOT NULL THEN 1.00 ELSE 0 END,
      v_vac, 'existing', 1)
    RETURNING id INTO v_rec;

    IF f.dup_of IS NOT NULL THEN
      -- Re-submission of an already-migrated candidate: attach a new document version only.
      INSERT INTO public.rec_migration_duplicates (batch_id, record_id, candidate_id, classification, similarity, signals, resolution, resolved_at, resolution_notes)
      VALUES (v_batch, v_rec, f.dup_of, 'exact', 1.00,
              jsonb_build_object('name_match', true, 'email_match', f.email IS NOT NULL, 'phone_match', f.phone IS NOT NULL, 'vacancy', 'Telesales'),
              'merged', now(),
              'File re-submitted in batch 3; linked to the existing candidate and stored as an additional document version. No new application created.');

      INSERT INTO public.rec_candidate_documents (candidate_id, application_id, doc_type, file_name, original_file_name, storage_path, mime_type, size_bytes, file_hash, version_no, is_preferred, created_by_migration, migration_batch_id)
      SELECT f.dup_of, (SELECT id FROM public.rec_applications WHERE candidate_id = f.dup_of AND vacancy_id = v_vac LIMIT 1),
             f.doc_type, f.fname, f.fname, f.spath, 'application/pdf', f.bytes, f.sha,
             1 + coalesce((SELECT max(version_no) FROM public.rec_candidate_documents d WHERE d.candidate_id = f.dup_of), 0),
             false, true, v_batch
      WHERE NOT EXISTS (SELECT 1 FROM public.rec_candidate_documents d WHERE d.file_hash = f.sha);

      UPDATE public.rec_migration_records SET imported_candidate_id = f.dup_of, import_outcome = 'linked_existing', imported_at = now() WHERE id = v_rec;
      CONTINUE;
    END IF;

    INSERT INTO public.rec_candidates (candidate_no, full_name, email, phone, location, headline, summary, years_experience,
      current_title, current_employer, source, engagement_status, record_state, consent_given,
      created_by_migration, migration_batch_id, source_platform, source_candidate_ref)
    VALUES ('CAND-MIG-TS3-' || lpad(f.ord::text, 3, '0'), f.person, f.email, f.phone, f.location, f.headline, f.summary, f.years,
      f.cur_title, f.cur_emp, 'migration', 'passive', 'active', false, true, v_batch, 'email', f.fname)
    RETURNING id INTO v_cand;

    INSERT INTO public.rec_applications (application_no, candidate_id, vacancy_id, source, source_detail, applied_at,
      stage, status, priority, migration_batch_id, source_platform, source_application_ref, source_vacancy_ref,
      source_status, source_applied_at, created_by_migration)
    VALUES ('APP-MIG-TS3-' || lpad(f.ord::text, 3, '0'), v_cand, v_vac, 'migration', 'Historical email application (batch 3)', now(),
      'screening', 'active', 'normal', v_batch, 'email', f.fname, 'Telesales', 'historical_application', now(), true)
    RETURNING id INTO v_app;

    INSERT INTO public.rec_candidate_documents (candidate_id, application_id, doc_type, file_name, original_file_name, storage_path, mime_type, size_bytes, file_hash, version_no, is_preferred, created_by_migration, migration_batch_id)
    VALUES (v_cand, v_app, f.doc_type, f.fname, f.fname, f.spath, 'application/pdf', f.bytes, f.sha, 1, true, true, v_batch);

    INSERT INTO public.rec_evidence_facts (candidate_id, application_id, attribute, value_text, value_numeric, source_kind, source_ref, source_locator, confidence, extracted_by)
    SELECT v_cand, v_app, e->>'a', e->>'t', NULLIF(e->>'n','')::numeric, 'cv', f.fname, e->>'l', (e->>'c')::numeric, 'rec-cv-extract'
    FROM jsonb_array_elements(f.ev) e;

    UPDATE public.rec_migration_records
       SET imported_candidate_id = v_cand, imported_application_id = v_app, import_outcome = 'created', imported_at = now(), candidate_id = v_cand
     WHERE id = v_rec;
  END LOOP;

  -- Score the newly created applications with the published Telesales scorecard,
  -- running under an authorised recruiter identity.
  PERFORM set_config('request.jwt.claims', json_build_object('sub','a117e336-d44f-4045-a585-4c69d67be840','role','authenticated')::text, true);
  FOR r IN SELECT id FROM public.rec_applications WHERE migration_batch_id = v_batch ORDER BY application_no LOOP
    PERFORM public.rec_evaluate_application(r.id);
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);

  UPDATE public.rec_migration_batches
     SET status = 'imported', completed_at = now(), rollback_available = true,
         totals = jsonb_build_object('files', 10, 'records', 10, 'candidates_created', 6, 'duplicates_linked', 4),
         quality = jsonb_build_object('low_confidence_records', 2, 'missing_contact', 1, 'cover_letter_only', 1)
   WHERE id = v_batch;
END $mig$;