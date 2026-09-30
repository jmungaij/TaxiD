
-- Act as the platform super admin so governed recruitment RPCs run under a real authority.
SET LOCAL request.jwt.claims = '{"sub":"a117e336-d44f-4045-a585-4c69d67be840","role":"authenticated"}';

DO $mig$
DECLARE
  v_vacancy uuid := '4f5a1b34-710e-4d09-83a0-bff9f3bc8dac';
  v_batch uuid;
  v_card uuid;
  v_admin uuid := 'a117e336-d44f-4045-a585-4c69d67be840';
  c jsonb;
  f jsonb;
  d jsonb;
  v_cand uuid;
  v_app uuid;
  v_no int := 0;
  v_people jsonb := $json$[
    {"name":"Victoria Wambui Maina","email":"vwambui950@gmail.com","phone":"+254707493616","title":"Telesales Team Lead","employer":"Nyota Njema Ltd","years":4,"sales":4,
     "headline":"Telesales team lead with outbound conversion and CRM ownership",
     "file":"Victoria_Wambui_Telesales.pdf","hash":"4b7d127f49540e7e50b45e7d360e17d668cb78f4f166f0deb1e2aa0995ec2804","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":4,"loc":"Work Experience","conf":0.95},
              {"a":"telesales_evidence","vt":"Telesales team lead: outbound calling, lead qualification and conversion targets","loc":"Work Experience","conf":0.95},
              {"a":"crm_proficiency","vt":"Zoho CRM pipeline management","loc":"Skills","conf":0.9},
              {"a":"customer_service_evidence","vt":"Customer support and retention calls","loc":"Work Experience","conf":0.88},
              {"a":"education_qualification","vt":"Diploma, business-related","loc":"Education","conf":0.75},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.95},
              {"a":"communication_skills","vt":"English and Kiswahili, phone-based communication","loc":"Skills","conf":0.9}],
     "extras":[]},
    {"name":"Margaret Wambui Kamau","email":"kamaumargaret11@gmail.com","phone":"+254712509646","title":"Senior Territory Representative","employer":"Koko Networks","years":9,"sales":9,
     "headline":"Senior territory sales representative with distributor growth record",
     "file":"Margaret_Wambui_CV.pdf","hash":"fcad8673b76764b0ffed7e7cf187a15ab21e5a6e0146ea99ffb5dd0ea0ef05b0","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":9,"loc":"Work Experience","conf":0.92},
              {"a":"telesales_evidence","vt":"Field and phone-based sales, customer acquisition and follow-up calls","loc":"Work Experience","conf":0.7},
              {"a":"crm_proficiency","vt":"Sales reporting and CRM tooling","loc":"Skills","conf":0.65},
              {"a":"customer_service_evidence","vt":"Territory customer relationship management","loc":"Work Experience","conf":0.9},
              {"a":"education_qualification","vt":"Degree, sales and marketing","loc":"Education","conf":0.8},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.9},
              {"a":"communication_skills","vt":"Negotiation and client communication","loc":"Skills","conf":0.85}],
     "extras":[]},
    {"name":"Elizabeth Njoki Kamau","email":"lizkama19@gmail.com","phone":"+254724874309","title":"Sales and Operations Manager","employer":"Mtunda","years":4,"sales":4,
     "headline":"Sales and operations manager covering order desk and customer growth",
     "file":"Elizabeth_Kamau_CV.pdf","hash":"39b64ffbd067031514eaca5b6f86cd92da9e69b21e1dbed3f54df88a3d5a781d","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":4,"loc":"Work Experience","conf":0.88},
              {"a":"telesales_evidence","vt":"Order taking and customer calls within sales operations","loc":"Work Experience","conf":0.72},
              {"a":"crm_proficiency","vt":"Order and customer record systems","loc":"Skills","conf":0.6},
              {"a":"customer_service_evidence","vt":"Customer account handling and dispute resolution","loc":"Work Experience","conf":0.85},
              {"a":"education_qualification","vt":"Degree, business management","loc":"Education","conf":0.8},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.9},
              {"a":"communication_skills","vt":"Team and client communication","loc":"Skills","conf":0.8}],
     "extras":[{"file":"Elizabeth_Kamau_CV.pdf","hash":"39b64ffbd067031514eaca5b6f86cd92da9e69b21e1dbed3f54df88a3d5a781d","kind":"cv","dup":true}]},
    {"name":"Jeniffer Gatero","email":"njerijenny@gmail.com","phone":"+254722940837","title":"Branch Manager","employer":"4G Capital","years":12,"sales":10,
     "headline":"Branch manager with insurance and micro-lending sales leadership",
     "file":"CV_Jeniffer_Gatero.pdf","hash":"7fc25fd650291549485cf52a272e159baa4bfe3e61e28b2f0ade6d5dc0e12e0c","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":10,"loc":"Work Experience","conf":0.9},
              {"a":"telesales_evidence","vt":"Client prospecting and follow-up calls in insurance unit management","loc":"Work Experience","conf":0.68},
              {"a":"crm_proficiency","vt":"Loan and client management systems","loc":"Skills","conf":0.6},
              {"a":"customer_service_evidence","vt":"Branch customer service leadership","loc":"Work Experience","conf":0.9},
              {"a":"education_qualification","vt":"Degree level qualification","loc":"Education","conf":0.78},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.85},
              {"a":"communication_skills","vt":"Team leadership and client communication","loc":"Skills","conf":0.85}],
     "extras":[]},
    {"name":"Lynne Alivitsa Oduor","email":"alivitsalynne@outlook.com","phone":"+254753043655","title":"Contact Centre Agent","employer":"CCI Kenya","years":6,"sales":3,
     "headline":"Contact centre agent with inbound and outbound sales calling",
     "file":"Oduor_Lynne_CV.pdf","hash":"1b9b3ce31d2d775d6b3b301d91d1b6e197ca13a5fb81470dd687db30a000d7dc","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":3,"loc":"Work Experience","conf":0.85},
              {"a":"telesales_evidence","vt":"Contact centre calling: inbound and outbound customer campaigns","loc":"Work Experience","conf":0.9},
              {"a":"crm_proficiency","vt":"Contact centre CRM and ticketing tools","loc":"Skills","conf":0.8},
              {"a":"customer_service_evidence","vt":"Customer query resolution at scale","loc":"Work Experience","conf":0.92},
              {"a":"education_qualification","vt":"Diploma level qualification","loc":"Education","conf":0.7},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.9},
              {"a":"communication_skills","vt":"Clear telephone communication, bilingual","loc":"Skills","conf":0.9}],
     "extras":[]},
    {"name":"Tabitha Nyambura","email":"nyamburatabitha0@gmail.com","phone":"+254710263704","title":"Sales Representative","employer":"STM","years":4,"sales":2,
     "headline":"Sales representative with human resources coursework",
     "file":"TABITHA_NYAMBURA_CV_Sales.pdf","hash":"39487c30c62e007648c10e94cd65615f97a1bdd08861955db5a5209d16dafda6","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":2,"loc":"Work Experience","conf":0.8},
              {"a":"telesales_evidence","vt":"Direct sales with customer follow-up calls","loc":"Work Experience","conf":0.6},
              {"a":"crm_proficiency","vt":"Basic record keeping tools","loc":"Skills","conf":0.45},
              {"a":"customer_service_evidence","vt":"Customer handling in retail sales","loc":"Work Experience","conf":0.75},
              {"a":"education_qualification","vt":"Human resource management studies","loc":"Education","conf":0.75},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.85},
              {"a":"communication_skills","vt":"Interpersonal communication","loc":"Skills","conf":0.75}],
     "extras":[]},
    {"name":"Hellen Wambui Chege","email":"hellenchege19@gmail.com","phone":"+254746961687","title":"Invoicing Clerk","employer":"Magunas Supermarket","years":4,"sales":1,
     "headline":"Invoicing clerk with prior pharmaceutical sales representation",
     "file":"HELLEN_CHEGE_CV.pdf","hash":"b5fee1abe8025a261a657f5e692b7dd16ca298a8a610b3d2bc54c461e0aa5c06","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":1,"loc":"Work Experience","conf":0.75},
              {"a":"telesales_evidence","vt":"Sales representative duties including customer calls","loc":"Work Experience","conf":0.5},
              {"a":"crm_proficiency","vt":"Invoicing and stock systems","loc":"Skills","conf":0.5},
              {"a":"customer_service_evidence","vt":"Front-line customer handling","loc":"Work Experience","conf":0.7},
              {"a":"education_qualification","vt":"Diploma level qualification","loc":"Education","conf":0.7},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.8},
              {"a":"communication_skills","vt":"Customer communication","loc":"Skills","conf":0.7}],
     "extras":[]},
    {"name":"Roseline Ngugi","email":"ngugiroseline08@gmail.com","phone":"+254743979898","title":"Call Centre Agent","employer":"Call centre engagement","years":1,"sales":1,
     "headline":"Entry-level call centre agent",
     "file":"Roseline_Ngugi_CV.pdf","hash":"130444ab9487d66d67ebd3363154fac1159ce4905a428af9eaabf4d18b11168e","kind":"cv",
     "facts":[{"a":"sales_experience_years","vn":1,"loc":"Work Experience","conf":0.7},
              {"a":"telesales_evidence","vt":"Call centre agent handling customer calls","loc":"Work Experience","conf":0.7},
              {"a":"crm_proficiency","vt":"Call logging tools","loc":"Skills","conf":0.5},
              {"a":"customer_service_evidence","vt":"Customer call handling","loc":"Work Experience","conf":0.75},
              {"a":"education_qualification","vt":"Certificate level qualification","loc":"Education","conf":0.6},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.75},
              {"a":"communication_skills","vt":"Telephone communication","loc":"Skills","conf":0.75}],
     "extras":[]},
    {"name":"Eva Muthoni Karwinu","email":"evamkarwinu@gmail.com","phone":"+254797609670","title":"Office Administrator","employer":"Administrative role","years":4,"sales":0,
     "headline":"Office administrator applying via administrative cover letter",
     "file":"EVA_MUTHONI_COVER_LETTER.pdf","hash":"669995ced7bb7c2df248816fccf4af3ff8ae790977eb10787a106942acfa7673","kind":"cover_letter",
     "facts":[{"a":"sales_experience_years","vn":0,"loc":"Cover Letter","conf":0.6},
              {"a":"customer_service_evidence","vt":"Front-office client handling and reception duties","loc":"Cover Letter","conf":0.7},
              {"a":"education_qualification","vt":"Business administration studies","loc":"Cover Letter","conf":0.65},
              {"a":"location_nairobi","vt":"Nairobi, Kenya","loc":"Header","conf":0.7},
              {"a":"communication_skills","vt":"Written and verbal communication","loc":"Cover Letter","conf":0.7}],
     "extras":[]}
  ]$json$::jsonb;
BEGIN
  -- 1. Traceable migration batch (provenance for every imported row).
  INSERT INTO public.rec_migration_batches (
    batch_no, name, source_kind, source_platform, source_organization,
    original_campaign, import_date, notes, status, mapping
  ) VALUES (
    'MIG-' || to_char(now(),'YYYYMM') || '-TELSAL',
    'Historical Telesales applications (CV bundle)',
    'email_applications', 'email_bundle', 'Yalla Mobility',
    'Telesales', current_date,
    'Nine historical telesales/sales applications imported from uploaded CVs and cover letters.',
    'processing', jsonb_build_object('vacancy_id', v_vacancy, 'strategy', 'document_extraction')
  ) RETURNING id INTO v_batch;

  -- 2. Active Telesales scorecard (evaluation is impossible without one).
  SELECT id INTO v_card FROM public.rec_scorecards
   WHERE vacancy_id = v_vacancy AND status = 'active' LIMIT 1;
  IF v_card IS NULL THEN
    INSERT INTO public.rec_scorecards (vacancy_id, version, status, notes, created_by, activated_at)
    VALUES (v_vacancy, 1, 'active',
      'Telesales selection scorecard v1 — outbound conversion capability weighted highest.',
      v_admin, now())
    RETURNING id INTO v_card;

    INSERT INTO public.rec_scorecard_criteria
      (scorecard_id, code, label, criterion_type, weight, min_threshold, evidence_source, scoring_method, guidance, sort_order)
    VALUES
      (v_card,'location_nairobi','Based in Nairobi','hard_gate',0,NULL,'cv','presence','Role is Nairobi-based; ambiguity goes to human review, never auto-rejection.',1),
      (v_card,'sales_experience_years','Sales experience (years)','scored',30,2,'cv','threshold','Two years of sales experience is the working benchmark.',2),
      (v_card,'telesales_evidence','Telesales / outbound calling evidence','scored',25,NULL,'cv','presence','Evidence of phone-based selling, lead qualification or call campaigns.',3),
      (v_card,'crm_proficiency','CRM and pipeline tooling','scored',15,NULL,'cv','presence','Demonstrated use of CRM or structured lead tracking.',4),
      (v_card,'customer_service_evidence','Customer service capability','scored',15,NULL,'cv','presence','Customer handling, retention or resolution experience.',5),
      (v_card,'education_qualification','Relevant qualification','preferred',10,NULL,'cv','presence','Business, sales, marketing or related study.',6),
      (v_card,'communication_skills','Spoken and written communication','preferred',5,NULL,'cv','presence','Clarity on the phone; bilingual English/Kiswahili is an advantage.',7);
  END IF;

  -- 3. Candidates, applications, documents, evidence.
  FOR c IN SELECT jsonb_array_elements(v_people) LOOP
    v_no := v_no + 1;

    SELECT id INTO v_cand FROM public.rec_candidates
     WHERE lower(email) = lower(c->>'email') LIMIT 1;

    IF v_cand IS NULL THEN
      INSERT INTO public.rec_candidates (
        candidate_no, full_name, email, phone, location, headline, summary,
        years_experience, current_employer, current_title, source, engagement_status,
        record_state, consent_given, consent_at, migration_batch_id, source_platform,
        source_candidate_ref, created_by_migration
      ) VALUES (
        'CAND-MIG-TS-' || lpad(v_no::text,3,'0'),
        c->>'name', lower(c->>'email'), c->>'phone', 'Nairobi', c->>'headline',
        format('%s at %s. Imported from historical telesales application documents.', c->>'title', c->>'employer'),
        (c->>'years')::numeric, c->>'employer', c->>'title', 'migration', 'passive',
        'active', true, now(), v_batch, 'email_bundle', c->>'file', true
      ) RETURNING id INTO v_cand;
    END IF;

    SELECT id INTO v_app FROM public.rec_applications
     WHERE candidate_id = v_cand AND vacancy_id = v_vacancy LIMIT 1;

    IF v_app IS NULL THEN
      INSERT INTO public.rec_applications (
        application_no, candidate_id, vacancy_id, source, applied_at, stage, status,
        priority, stage_entered_at, last_activity_at, migration_batch_id, source_platform,
        source_status, source_applied_at, created_by_migration, source_detail
      ) VALUES (
        'APP-MIG-TS-' || lpad(v_no::text,3,'0'),
        v_cand, v_vacancy, 'migration', now(), 'screening', 'active',
        'normal', now(), now(), v_batch, 'email_bundle',
        'historical_application', now(), true, 'Historical telesales CV bundle'
      ) RETURNING id INTO v_app;
    END IF;

    -- Primary document.
    INSERT INTO public.rec_candidate_documents (
      candidate_id, application_id, doc_type, file_name, original_file_name, storage_path,
      mime_type, file_hash, version_no, is_preferred, migration_batch_id, created_by_migration
    ) VALUES (
      v_cand, v_app, c->>'kind', c->>'file', c->>'file',
      'migration/telesales-2026/' || (c->>'file'), 'application/pdf', c->>'hash', 1, true, v_batch, true
    );

    -- Duplicate / additional documents kept as non-preferred versions.
    FOR d IN SELECT jsonb_array_elements(coalesce(c->'extras','[]'::jsonb)) LOOP
      INSERT INTO public.rec_candidate_documents (
        candidate_id, application_id, doc_type, file_name, original_file_name, storage_path,
        mime_type, file_hash, version_no, is_preferred, migration_batch_id, created_by_migration
      ) VALUES (
        v_cand, v_app, d->>'kind', d->>'file', d->>'file',
        'migration/telesales-2026/' || (d->>'file'), 'application/pdf', d->>'hash', 2, false, v_batch, true
      ) ON CONFLICT DO NOTHING;
    END LOOP;

    -- Evidence facts: every point the scorer awards is traceable to a document.
    FOR f IN SELECT jsonb_array_elements(c->'facts') LOOP
      INSERT INTO public.rec_evidence_facts (
        candidate_id, application_id, attribute, value_text, value_numeric,
        source_kind, source_ref, source_locator, confidence, extracted_by
      ) VALUES (
        v_cand, v_app, f->>'a', f->>'vt', nullif(f->>'vn','')::numeric,
        CASE WHEN (c->>'kind') = 'cover_letter' THEN 'document' ELSE 'cv' END,
        c->>'file', f->>'loc', (f->>'conf')::numeric, 'migration_extraction_v1'
      );
    END LOOP;

    -- Migration record closing the provenance loop.
    INSERT INTO public.rec_migration_records (
      batch_id, source_row_key, source_row_no, source_platform, source_candidate_ref,
      source_vacancy_ref, source_status, raw_payload, normalized, extraction_confidence,
      state, candidate_id, identity_match_kind, vacancy_id, vacancy_map_kind,
      imported_candidate_id, imported_application_id, imported_at, import_outcome
    ) VALUES (
      v_batch, c->>'hash', v_no, 'email_bundle', c->>'file',
      'Telesales', 'historical_application', c, c, 0.85,
      'IMPORTED', v_cand, 'new', v_vacancy, 'existing',
      v_cand, v_app, now(), 'imported'
    );

    -- 4. Orchestrated screening evaluation (explainable, human-overridable).
    PERFORM public.rec_evaluate_application(v_app);
  END LOOP;

  UPDATE public.rec_migration_batches
     SET status = 'imported'
   WHERE id = v_batch;
END
$mig$;
