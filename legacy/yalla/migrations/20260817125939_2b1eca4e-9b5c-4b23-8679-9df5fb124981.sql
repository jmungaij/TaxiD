DO $mig$
DECLARE
  v_batch uuid;
  v_vac uuid := '4f5a1b34-710e-4d09-83a0-bff9f3bc8dac';
  v_actor uuid := 'a117e336-d44f-4045-a585-4c69d67be840';
  v_cand uuid;
  v_app uuid;
  v_rec uuid;
  v_file uuid;
  c jsonb;
  f jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);

  INSERT INTO public.rec_migration_batches (
    batch_no, name, source_kind, source_platform, original_campaign, import_date,
    status, started_at, notes, created_by)
  VALUES ('MIG-202608-TELSAL4', 'Historical Telesales — Batch 4', 'email_applications',
          'email_inbox', 'Telesales 2026 historical applications', current_date,
          'processing', now(),
          'Five files received; one identified as a non-recruitment document (Kiswahili school assignment) and held as an exception.',
          v_actor)
  RETURNING id INTO v_batch;

  FOR c IN SELECT * FROM jsonb_array_elements($j$[
    {"no":"001","file":"asunta-nyambura-cv.pdf","orig":"Asunta_Nyambura_ATS_CV_2.pdf",
     "sha":"92337ef1cb07790bbcfc46cb39b61506ef5ba056578417be2c7e035bbf9748ff","bytes":127213,"pages":2,
     "name":"Asunta Nyambura","email":"nyamburaasunta623@gmail.com","phone":"+254724721381",
     "location":"Nairobi, Kenya","years":5,"employer":"Contact Center Infrastructure (CCI)",
     "title":"Team Leader — AmeriGas Campaign",
     "headline":"Contact centre team leader · 5 years customer operations",
     "summary":"Results-driven customer service professional with 5+ years in contact centre operations, hospitality and team leadership. Leads AmeriGas campaign agents at CCI Tatu City; skilled in call centre operations, CRM and POS systems.",
     "conf":0.94,
     "facts":[
       {"a":"location_nairobi","t":"Nairobi, Kenya","n":null,"c":0.96,"l":"page 1 · header"},
       {"a":"sales_experience_years","t":"5 years customer operations incl. upselling to revenue targets","n":5,"c":0.82,"l":"page 1 · professional summary"},
       {"a":"relevant_experience","t":"5 years contact centre operations and team leadership","n":5,"c":0.93,"l":"page 1 · work experience"},
       {"a":"telesales_evidence","t":"Handled inbound calls with telephone etiquette; promoted upselling to meet revenue targets","n":null,"c":0.78,"l":"page 1 · customer care agent"},
       {"a":"crm_proficiency","t":"CRM systems and POS systems","n":null,"c":0.9,"l":"page 1 · professional summary"},
       {"a":"customer_service_evidence","t":"Complaint resolution, first-call resolution, warranty and refund handling","n":null,"c":0.95,"l":"page 1-2 · duties"},
       {"a":"education_qualification","t":"Diploma in Airline Cabin Crew / Travel and Tourism (2019); KCSE","n":null,"c":0.88,"l":"page 2 · education"},
       {"a":"communication_skills","t":"Exceptional verbal and written communication skills","n":null,"c":0.86,"l":"page 2 · core competencies"}
     ]},
    {"no":"002","file":"grace-mutheu-telesales-cv.pdf","orig":"graceresumeTelesalesExecutive.pdf",
     "sha":"e06ad3fecaeda131cbdb96ab3c3ea4a72ea2390f41bb6ec5c73a0762f2cfc63b","bytes":74629,"pages":2,
     "name":"Grace Mutheu","email":"gracepatricks94@gmail.com","phone":"+254707602724",
     "location":null,"years":5,"employer":"DTI Group","title":"Customer Care / Telesales Executive",
     "headline":"Telesales executive · 5 years sales and customer care",
     "summary":"Sales and customer care professional with 5 years driving sales growth; former Telesales Agent at Platinum Group Africa (lead generation, script-based selling, target attainment) and currently customer care at DTI Group.",
     "conf":0.79,
     "facts":[
       {"a":"sales_experience_years","t":"5 years sales, incl. Telesales Agent Aug 2023 – Jan 2025","n":5,"c":0.9,"l":"page 1 · summary + work experience"},
       {"a":"relevant_experience","t":"Telesales and customer care across Platinum Group Africa and DTI Group","n":5,"c":0.9,"l":"page 1 · work experience"},
       {"a":"telesales_evidence","t":"Lead generation, script-based sales talks, exceeding sales goals, appointment setting","n":null,"c":0.95,"l":"page 1 · telesales agent"},
       {"a":"customer_service_evidence","t":"Handles complaints, meets response-time and satisfaction targets","n":null,"c":0.9,"l":"page 1 · customer care"},
       {"a":"education_qualification","t":"Diploma in Customer Care and Customer Services; Diploma in Sales and Marketing","n":null,"c":0.9,"l":"page 2 · education"},
       {"a":"communication_skills","t":"Strong communication and interpersonal skills","n":null,"c":0.84,"l":"page 2 · key skills"}
     ]},
    {"no":"003","file":"elizabeth-momanyi-cv.pdf","orig":"ELIZABETH_.N._MOMANYI_CV_1.pdf",
     "sha":"c05ab954d6e2661dbd52cf53e12e04b1b64763f6e2e66425532d519fd176b923","bytes":285944,"pages":2,
     "name":"Elizabeth N. Momanyi","email":"Lizmomanyi204@gmail.com","phone":"+254723934439",
     "location":"Nairobi, Kenya","years":2,"employer":"Nutrawell Africa","title":"Customer Service / Marketing Call Agent",
     "headline":"Customer service and outbound call agent · Nairobi",
     "summary":"Customer-oriented professional with inbound and outbound sales calling experience across a school admissions desk and the Safaricom call centre; uses CRM tools, MS Suite and Google Workspace for interaction logging.",
     "conf":0.88,
     "facts":[
       {"a":"location_nairobi","t":"Nairobi, Kenya","n":null,"c":0.95,"l":"page 1 · header"},
       {"a":"sales_experience_years","t":"Inbound and outbound sales calls from 06/2025","n":2,"c":0.66,"l":"page 1 · marketing call agent"},
       {"a":"relevant_experience","t":"Call centre and front-office customer engagement (Safaricom call centre; admissions desk)","n":2,"c":0.8,"l":"page 1-2 · work experience"},
       {"a":"telesales_evidence","t":"Conducted inbound and outbound sales calls recommending programmes; overdue payment follow-up calls","n":null,"c":0.88,"l":"page 1 · duties"},
       {"a":"crm_proficiency","t":"CRM tools, MS Suite, Google Workspace for interaction data entry","n":null,"c":0.92,"l":"page 1 · professional summary"},
       {"a":"customer_service_evidence","t":"Maintained professional tone on all calls; accurate call records","n":null,"c":0.87,"l":"page 1 · duties"},
       {"a":"education_qualification","t":"Diploma in Business Administration","n":null,"c":0.85,"l":"page 2 · education"},
       {"a":"communication_skills","t":"Excellent communication skills, calm under pressure","n":null,"c":0.83,"l":"page 1 · summary"}
     ]},
    {"no":"004","file":"sarah-ouma-cv.pdf","orig":"SARAH_OUMA_CV-1_1.pdf",
     "sha":"14e9852b56d5fa40c84a65d4a8dbc8386f7159981623788f2109cc303f15b394","bytes":711921,"pages":3,
     "name":"Sarah Ouma","email":"sarahouma533@gmail.com","phone":"+254741952186",
     "location":"Kimbo, Nairobi, Kenya","years":6,"employer":"Microfinance lender","title":"Loan Officer / Team Supervisor",
     "headline":"Lending and credit professional seeking a Loan Officer role",
     "summary":"Loan officer with credit evaluation, risk assessment and team leadership experience; supervised loan officers against monthly lending targets. Stated objective is a Loan Officer role rather than telesales.",
     "conf":0.62,
     "facts":[
       {"a":"location_nairobi","t":"Kimbo, 00100 Nairobi, Kenya","n":null,"c":0.88,"l":"page 1 · header"},
       {"a":"sales_experience_years","t":"Lending target attainment and team supervision","n":6,"c":0.58,"l":"page 1 · summary"},
       {"a":"relevant_experience","t":"Loan processing, credit evaluation and team leadership","n":6,"c":0.7,"l":"page 1 · summary"},
       {"a":"customer_service_evidence","t":"Client-facing lending advisory","n":null,"c":0.55,"l":"page 1 · key skills"},
       {"a":"communication_skills","t":"Team leadership and client guidance","n":null,"c":0.52,"l":"page 1 · key skills"}
     ]}
  ]$j$::jsonb) LOOP

    INSERT INTO public.rec_migration_files (
      batch_id, original_file_name, storage_path, mime_type, size_bytes, sha256,
      file_kind, doc_type, status, page_count, attempts, uploaded_by)
    VALUES (v_batch, c->>'orig', 'MIG-202608-TELSAL4/' || (c->>'file'), 'application/pdf',
            (c->>'bytes')::bigint, c->>'sha', 'document', 'cv', 'parsed', (c->>'pages')::int, 1, v_actor)
    RETURNING id INTO v_file;

    INSERT INTO public.rec_candidates (
      candidate_no, full_name, email, phone, location, headline, summary, years_experience,
      current_employer, current_title, source, engagement_status, consent_given,
      migration_batch_id, source_platform, source_candidate_ref, created_by_migration)
    VALUES ('CAND-MIG-TS4-' || (c->>'no'), c->>'name', nullif(c->>'email',''), nullif(c->>'phone',''),
            c->>'location', c->>'headline', c->>'summary', (c->>'years')::numeric,
            c->>'employer', c->>'title', 'migration', 'active', false,
            v_batch, 'email_inbox', c->>'orig', true)
    RETURNING id INTO v_cand;

    INSERT INTO public.rec_applications (
      application_no, candidate_id, vacancy_id, source, source_detail, applied_at,
      stage, status, migration_batch_id, source_platform, source_application_ref,
      source_vacancy_ref, source_status, created_by_migration)
    VALUES ('APP-MIG-TS4-' || (c->>'no'), v_cand, v_vac, 'migration', 'historical email application',
            now() - interval '21 days', 'screening', 'active', v_batch, 'email_inbox',
            'MIG-TS4-' || (c->>'no'), 'Telesales', 'received', true)
    RETURNING id INTO v_app;

    INSERT INTO public.rec_candidate_documents (
      candidate_id, application_id, doc_type, file_name, storage_path, mime_type, size_bytes, uploaded_by)
    VALUES (v_cand, v_app, 'cv', c->>'orig',
            'MIG-202608-TELSAL4/' || (c->>'file'), 'application/pdf', (c->>'bytes')::bigint, v_actor);

    INSERT INTO public.rec_migration_records (
      batch_id, source_row_key, source_row_no, source_platform, source_candidate_ref,
      source_vacancy_ref, raw_payload, normalized, extraction, extraction_confidence,
      state, candidate_id, identity_match_kind, vacancy_id, vacancy_map_kind,
      imported_candidate_id, imported_application_id, imported_at, import_outcome, attempts)
    VALUES (v_batch, c->>'sha', (c->>'no')::int, 'email_inbox', c->>'orig', 'Telesales',
            jsonb_build_object('file', c->>'orig', 'sha256', c->>'sha', 'storage_file_id', v_file),
            jsonb_build_object('full_name', c->>'name', 'email', c->>'email', 'phone', c->>'phone',
                               'location', c->>'location', 'years_experience', c->>'years'),
            c->'facts', (c->>'conf')::numeric,
            'IMPORTED', v_cand, 'new', v_vac, 'existing', v_cand, v_app, now(), 'imported', 1)
    RETURNING id INTO v_rec;

    FOR f IN SELECT * FROM jsonb_array_elements(c->'facts') LOOP
      INSERT INTO public.rec_evidence_facts (
        candidate_id, application_id, attribute, value_text, value_numeric,
        source_kind, source_ref, source_locator, confidence, extracted_by)
      VALUES (v_cand, v_app, f->>'a', f->>'t',
              CASE WHEN f->>'n' IS NULL THEN NULL ELSE (f->>'n')::numeric END,
              'cv', c->>'orig', f->>'l', (f->>'c')::numeric, 'rec-cv-extract/migration-batch-4');
    END LOOP;

    PERFORM public.rec_evaluate_application(v_app);
  END LOOP;

  -- Non-recruitment document: stored, never turned into an application.
  INSERT INTO public.rec_migration_files (
    batch_id, original_file_name, storage_path, mime_type, size_bytes, sha256,
    file_kind, doc_type, status, page_count, attempts, parse_error, uploaded_by)
  VALUES (v_batch, '2026_AGOSTI_F3_ASSGN.pdf',
          'MIG-202608-TELSAL4/nonrecruitment-kiswahili-assignment.pdf', 'application/pdf',
          226192, 'a78ab07c94ebfb4b0d1d550da87ed35714498a917445e5f068e9c863d58afa59',
          'document', 'other', 'skipped', 4,
          1, 'NOT_A_RECRUITMENT_DOCUMENT: Kiswahili Form 3 school assignment — no candidate identity, employment history or application intent.', v_actor);

  INSERT INTO public.rec_migration_records (
    batch_id, source_row_key, source_row_no, source_platform, source_candidate_ref,
    raw_payload, normalized, extraction, extraction_confidence, state,
    exception_code, exception_reason, attempts)
  VALUES (v_batch, 'a78ab07c94ebfb4b0d1d550da87ed35714498a917445e5f068e9c863d58afa59', 5,
          'email_inbox', '2026_AGOSTI_F3_ASSGN.pdf',
          jsonb_build_object('file', '2026_AGOSTI_F3_ASSGN.pdf'), '{}'::jsonb, '{}'::jsonb, 0,
          'EXCEPTION', 'NOT_A_RECRUITMENT_DOCUMENT',
          'Kiswahili Form 3 school assignment — excluded from the Telesales pipeline; retained for provenance only.', 1);

  UPDATE public.rec_migration_batches
     SET status = 'imported', completed_at = now(),
         totals = jsonb_build_object('files', 5, 'records', 5, 'candidates_created', 4,
                                     'applications_created', 4, 'exceptions', 1),
         quality = jsonb_build_object('mean_extraction_confidence', 0.808,
                                      'low_confidence_records', 1,
                                      'missing_location', 1)
   WHERE id = v_batch;
END $mig$;