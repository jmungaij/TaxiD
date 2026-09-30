-- ============================================================
-- 1. VACANCY HR STRUCTURE
-- ============================================================
ALTER TABLE public.rec_vacancies
  ADD COLUMN IF NOT EXISTS role_purpose text,
  ADD COLUMN IF NOT EXISTS accountability_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS success_outcomes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS technical_tools text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS suitability text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS qualification_level text,
  ADD COLUMN IF NOT EXISTS equivalent_experience_accepted boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS experience_statement text,
  ADD COLUMN IF NOT EXISTS application_deadline date,
  ADD COLUMN IF NOT EXISTS reports_to_position_id uuid REFERENCES public.org_positions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position_exception_reason text,
  ADD COLUMN IF NOT EXISTS recruitment_process jsonb NOT NULL DEFAULT '[]'::jsonb;

-- flat responsibilities are DERIVED from the grouped accountabilities
CREATE OR REPLACE FUNCTION public.rec_vacancy_flatten_accountabilities()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF jsonb_typeof(NEW.accountability_groups) = 'array'
     AND jsonb_array_length(NEW.accountability_groups) > 0 THEN
    SELECT coalesce(array_agg(b ORDER BY g_ord, b_ord), '{}')
      INTO NEW.responsibilities
    FROM jsonb_array_elements(NEW.accountability_groups) WITH ORDINALITY AS g(grp, g_ord),
         jsonb_array_elements_text(coalesce(grp->'bullets','[]'::jsonb)) WITH ORDINALITY AS b(b, b_ord);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER rec_vacancies_flatten_accountabilities
  BEFORE INSERT OR UPDATE ON public.rec_vacancies
  FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_flatten_accountabilities();

-- publication requires a linked authoritative position (or a recorded exception)
CREATE OR REPLACE FUNCTION public.rec_vacancy_require_position()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.publication_status = 'published'
     AND NEW.position_id IS NULL
     AND coalesce(trim(NEW.position_exception_reason), '') = '' THEN
    RAISE EXCEPTION 'a vacancy cannot be published without a linked position (or a recorded position exception reason)';
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- 2. ORGANISATION CORRECTIONS + POSITION LINKAGE
-- ============================================================
UPDATE public.org_units SET name = 'Administration' WHERE name = 'Adminsitration';
UPDATE public.org_positions SET title = 'Sales Administrator – Mobility Services'
 WHERE title = 'Sales Adminstrator- Mobility Services';

INSERT INTO public.org_positions (unit_id, reports_to_position_id, title, code, job_purpose, grade, approved_headcount, status, provenance)
SELECT '8aaeba60-da84-45f9-9c91-0e1fb7df8ddc',
       'ad01c730-f57f-4495-b674-2a53cbb80b0a',
       'Customer Success Coordinator',
       'POS-CS-COORD',
       'Owns the customer relationship from first enquiry through service fulfilment and post-service follow-up, supporting retention, repeat business and service quality across Yalla Mobility services.',
       'Officer', 1, 'active', 'LIVE'
WHERE NOT EXISTS (SELECT 1 FROM public.org_positions WHERE code = 'POS-CS-COORD');

UPDATE public.rec_vacancies v SET
  position_id = p.id,
  unit_id = p.unit_id,
  reports_to_position_id = p.reports_to_position_id
FROM public.org_positions p
WHERE (v.public_slug = 'customer-success-coordinator-506f36' AND p.code = 'POS-CS-COORD')
   OR (v.public_slug = 'sales-manager-72683b' AND p.id = 'ad01c730-f57f-4495-b674-2a53cbb80b0a')
   OR (v.public_slug = 'sales-administration-cd247c' AND p.id = '027d16a4-b5b3-46d0-a3e9-05bcd42da5ca');

CREATE TRIGGER rec_vacancies_require_position
  BEFORE INSERT OR UPDATE ON public.rec_vacancies
  FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_require_position();

-- ============================================================
-- 3. CUSTOMER SUCCESS COORDINATOR ADVERT CONTENT (British English)
-- ============================================================
UPDATE public.rec_vacancies SET
  public_summary = 'Own the customer relationship from first enquiry through service fulfilment and follow-up, combining customer success, service coordination and commercial support.',
  role_purpose = 'Yalla Mobility is looking for a Customer Success Coordinator to manage customer relationships from the first enquiry through service fulfilment and post-service follow-up. The role combines customer success, service coordination and commercial support: helping customers access the right Yalla Mobility services, making sure every booking is delivered as promised, and supporting retention, repeat business and account growth. You will work closely with the Sales Manager, drivers, fleet teams and service partners, and you will be the customer''s point of continuity across the whole service journey.',
  accountability_groups = '[
    {"group":"Customer success and relationship management","bullets":[
      "Own day-to-day relationships with assigned customers and corporate accounts.",
      "Respond to customer enquiries promptly and professionally across phone, email and messaging channels.",
      "Follow up after every service to confirm satisfaction and capture feedback.",
      "Resolve complaints and service issues, coordinating service recovery where needed.",
      "Maintain a complete and accurate history of customer communication and commitments."
    ]},
    {"group":"Sales and account growth","bullets":[
      "Qualify incoming enquiries and convert them into bookings or service requests.",
      "Support customer acquisition and the onboarding of new corporate accounts.",
      "Prepare and follow up quotations and service confirmations with the Sales Manager.",
      "Identify repeat business, upselling and cross-selling opportunities across Yalla Mobility services.",
      "Re-engage inactive and dormant customers through structured outreach."
    ]},
    {"group":"Service coordination and fulfilment","bullets":[
      "Coordinate customer bookings from initiation through to completion.",
      "Liaise with drivers, operators, fleet teams and service partners to secure fulfilment.",
      "Confirm service details with customers before delivery and monitor fulfilment status.",
      "Resolve service exceptions and escalate operational issues through the correct channel."
    ]},
    {"group":"CRM, reporting and operational support","bullets":[
      "Keep customer, booking and account records accurate and current in the CRM.",
      "Track customer commitments and service promises through to completion.",
      "Prepare customer success, acquisition, retention and fulfilment reports.",
      "Support the Sales Manager with customer handovers and post-sale relationship management."
    ]}
  ]'::jsonb,
  competencies = ARRAY[
    'Customer relationship management',
    'Customer service and service recovery',
    'Customer acquisition and lead qualification',
    'Service coordination and follow-through',
    'Clear written and verbal communication',
    'Problem solving under pressure',
    'Commercial awareness',
    'Accuracy and record keeping'
  ],
  technical_tools = ARRAY[
    'CRM platforms',
    'Microsoft Office',
    'Google Workspace',
    'Scheduling and booking systems',
    'Customer messaging platforms (including WhatsApp Business)'
  ],
  required_skills = ARRAY[
    'Customer relationship management',
    'Customer service',
    'Customer acquisition',
    'Lead qualification',
    'Service coordination',
    'Communication',
    'Problem solving',
    'CRM usage',
    'Follow-through',
    'Commercial awareness'
  ],
  preferred_skills = ARRAY[
    'B2B customer success',
    'Corporate mobility',
    'Transport services',
    'Ride hailing',
    'Fleet services',
    'Logistics',
    'Travel services',
    'Telesales',
    'Account management',
    'Dispatch coordination',
    'Sales pipeline management'
  ],
  qualification_level = 'Diploma or bachelor''s degree',
  qualifications = ARRAY[
    'Business Administration',
    'Marketing',
    'Sales',
    'Customer Experience',
    'Hospitality',
    'Logistics',
    'Transport Management',
    'Communications'
  ],
  equivalent_experience_accepted = true,
  experience_statement = 'Minimum 2 years of relevant professional experience in customer success, customer service, sales support, account management, service coordination or a related customer-facing role.',
  success_outcomes = ARRAY[
    'Customers receive timely, professional communication at every stage.',
    'Bookings progress smoothly from enquiry through to fulfilment.',
    'Customer issues are resolved promptly and appropriately.',
    'CRM records remain accurate, complete and current.',
    'Customer commitments and follow-ups are completed reliably.',
    'Retention and repeat business improve across assigned accounts.',
    'Service quality and account growth are supported measurably.'
  ],
  suitability = ARRAY[
    'you enjoy working directly with customers;',
    'you are commercially minded;',
    'you are highly organised and follow through on commitments;',
    'you can coordinate several moving parts at once;',
    'you communicate confidently in writing and on the phone;',
    'you stay calm while resolving customer issues;',
    'you enjoy improving the customer experience.'
  ],
  recruitment_process = '[
    {"step":"Application","detail":"Submit your application through the Yalla Careers portal. You will receive an application reference immediately."},
    {"step":"Application review","detail":"Our recruitment team reviews applications against the role requirements."},
    {"step":"Screening","detail":"Selected candidates may be invited to a screening conversation."},
    {"step":"Assessment or interview","detail":"Depending on the role, candidates may complete an assessment and/or an interview."},
    {"step":"Final decision","detail":"Successful candidates proceed to offer and onboarding."}
  ]'::jsonb,
  updated_at = now()
WHERE public_slug = 'customer-success-coordinator-506f36';

-- shared default recruitment process for the other published vacancies
UPDATE public.rec_vacancies SET recruitment_process = '[
    {"step":"Application","detail":"Submit your application through the Yalla Careers portal. You will receive an application reference immediately."},
    {"step":"Application review","detail":"Our recruitment team reviews applications against the role requirements."},
    {"step":"Screening","detail":"Selected candidates may be invited to a screening conversation."},
    {"step":"Assessment or interview","detail":"Depending on the role, candidates may complete an assessment and/or an interview."},
    {"step":"Final decision","detail":"Successful candidates proceed to offer and onboarding."}
  ]'::jsonb
WHERE publication_status = 'published' AND jsonb_array_length(recruitment_process) = 0;

-- ============================================================
-- 4. PUBLIC VACANCY DETAIL (single authoritative read)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_public_vacancy_detail(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.rec_vacancies;
  v_alias uuid;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies
   WHERE public_slug = p_slug AND approval_status = 'approved'
     AND publication_status = 'published' AND status = 'open' AND published_at IS NOT NULL;

  IF v.id IS NULL THEN
    SELECT vacancy_id INTO v_alias FROM public.rec_vacancy_slug_aliases WHERE slug = p_slug;
    IF v_alias IS NOT NULL THEN
      SELECT * INTO v FROM public.rec_vacancies
       WHERE id = v_alias AND approval_status = 'approved'
         AND publication_status = 'published' AND status = 'open' AND published_at IS NOT NULL;
    END IF;
  END IF;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('open', false);
  END IF;

  RETURN jsonb_build_object(
    'open', true,
    'canonical_slug', v.public_slug,
    'vacancy', jsonb_build_object(
      'id', v.id, 'vacancy_no', v.vacancy_no, 'title', v.title,
      'public_summary', v.public_summary, 'role_purpose', v.role_purpose,
      'location', v.location, 'employment_type', v.employment_type,
      'work_arrangement', v.work_arrangement, 'headcount', v.headcount,
      'min_years_experience', v.min_years_experience,
      'experience_statement', v.experience_statement,
      'accountability_groups', v.accountability_groups,
      'required_skills', v.required_skills, 'preferred_skills', v.preferred_skills,
      'competencies', v.competencies, 'technical_tools', v.technical_tools,
      'qualification_level', v.qualification_level, 'qualifications', v.qualifications,
      'equivalent_experience_accepted', v.equivalent_experience_accepted,
      'success_outcomes', v.success_outcomes, 'suitability', v.suitability,
      'recruitment_process', v.recruitment_process,
      'application_deadline', v.application_deadline,
      'published_at', v.published_at, 'content_version', v.content_version,
      'department', (SELECT u.name FROM public.org_units u WHERE u.id = v.unit_id),
      'position_title', (SELECT p.title FROM public.org_positions p WHERE p.id = v.position_id),
      'reports_to', (SELECT p.title FROM public.org_positions p WHERE p.id = v.reports_to_position_id)
    ),
    'other_openings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'public_slug', o.public_slug, 'title', o.title, 'location', o.location,
        'employment_type', o.employment_type, 'work_arrangement', o.work_arrangement)
        ORDER BY o.published_at DESC)
      FROM public.rec_vacancies o
      WHERE o.id <> v.id AND o.approval_status = 'approved'
        AND o.publication_status = 'published' AND o.status = 'open'
        AND o.published_at IS NOT NULL), '[]'::jsonb)
  );
END; $$;