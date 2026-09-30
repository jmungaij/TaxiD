-- 1. Vacancy public identity
ALTER TABLE public.rec_vacancies
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS public_summary text,
  ADD COLUMN IF NOT EXISTS published_by uuid;

CREATE OR REPLACE FUNCTION public.rec_slugify(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(p_text,'')), '[^a-z0-9]+', '-', 'g'));
$$;

UPDATE public.rec_vacancies v
SET public_slug = public.rec_slugify(v.title) || '-' || lower(right(replace(v.id::text,'-',''), 6))
WHERE v.public_slug IS NULL;

ALTER TABLE public.rec_vacancies ALTER COLUMN public_slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rec_vacancies_public_slug_key ON public.rec_vacancies(public_slug);

CREATE OR REPLACE FUNCTION public.rec_vacancy_slug_default()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.public_slug IS NULL OR NEW.public_slug = '' THEN
    NEW.public_slug := public.rec_slugify(NEW.title) || '-' || lower(right(replace(NEW.id::text,'-',''), 6));
  END IF;
  IF NEW.publication_status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  IF NEW.publication_status = 'published' AND NEW.published_by IS NULL THEN
    NEW.published_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_vacancy_slug_default ON public.rec_vacancies;
CREATE TRIGGER trg_rec_vacancy_slug_default
BEFORE INSERT OR UPDATE ON public.rec_vacancies
FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_slug_default();

-- 2. Vacancy lifecycle audit
CREATE OR REPLACE FUNCTION public.rec_vacancy_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'vacancy.created';
  ELSE
    IF OLD.approval_status IS DISTINCT FROM NEW.approval_status THEN
      v_action := 'vacancy.approval.' || NEW.approval_status;
    ELSIF OLD.publication_status IS DISTINCT FROM NEW.publication_status THEN
      v_action := 'vacancy.publication.' || NEW.publication_status;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      v_action := 'vacancy.status.' || NEW.status;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
  VALUES (
    auth.uid(), v_action, 'vacancy', NEW.id,
    CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('approval_status', OLD.approval_status, 'publication_status', OLD.publication_status, 'status', OLD.status) ELSE NULL END,
    jsonb_build_object('approval_status', NEW.approval_status, 'publication_status', NEW.publication_status, 'status', NEW.status, 'published_at', NEW.published_at),
    jsonb_build_object('vacancy_no', NEW.vacancy_no, 'title', NEW.title, 'public_slug', NEW.public_slug),
    'system'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_vacancy_audit ON public.rec_vacancies;
CREATE TRIGGER trg_rec_vacancy_audit
AFTER INSERT OR UPDATE ON public.rec_vacancies
FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_audit();

-- 3. Remove broad public table access; expose only curated read functions
DROP POLICY IF EXISTS "rec public read published vacancies" ON public.rec_vacancies;
REVOKE ALL ON public.rec_vacancies FROM anon;

CREATE OR REPLACE FUNCTION public.rec_public_vacancies()
RETURNS TABLE (
  id uuid, public_slug text, vacancy_no text, title text, public_summary text,
  location text, employment_type text, work_arrangement text, headcount integer,
  required_skills text[], preferred_skills text[], qualifications text[],
  responsibilities text[], min_years_experience numeric, target_hire_date date,
  published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, v.public_slug, v.vacancy_no, v.title, v.public_summary,
         v.location, v.employment_type, v.work_arrangement, v.headcount,
         v.required_skills, v.preferred_skills, v.qualifications,
         v.responsibilities, v.min_years_experience, v.target_hire_date,
         v.published_at
  FROM public.rec_vacancies v
  WHERE v.approval_status = 'approved'
    AND v.publication_status = 'published'
    AND v.status = 'open'
    AND v.published_at IS NOT NULL
  ORDER BY v.published_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.rec_public_vacancy(p_slug text)
RETURNS TABLE (
  id uuid, public_slug text, vacancy_no text, title text, public_summary text,
  location text, employment_type text, work_arrangement text, headcount integer,
  required_skills text[], preferred_skills text[], qualifications text[],
  responsibilities text[], min_years_experience numeric, target_hire_date date,
  published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.rec_public_vacancies() pv WHERE pv.public_slug = p_slug;
$$;

REVOKE ALL ON FUNCTION public.rec_public_vacancies() FROM public;
REVOKE ALL ON FUNCTION public.rec_public_vacancy(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rec_public_vacancies() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_public_vacancy(text) TO anon, authenticated;

-- 4. Application profile detail
CREATE TABLE IF NOT EXISTS public.rec_application_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  academic_qualifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  professional_qualifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  employment_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills text[] NOT NULL DEFAULT '{}',
  consent_privacy boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  submitted_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);

GRANT SELECT, INSERT, UPDATE ON public.rec_application_profiles TO authenticated;
GRANT ALL ON public.rec_application_profiles TO service_role;
ALTER TABLE public.rec_application_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read application profiles" ON public.rec_application_profiles
FOR SELECT TO authenticated USING (
  public.rec_can_read() OR EXISTS (
    SELECT 1 FROM public.rec_candidates c WHERE c.id = rec_application_profiles.candidate_id AND c.user_id = auth.uid()
  )
);
CREATE POLICY "rec staff write application profiles" ON public.rec_application_profiles
FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete application profiles" ON public.rec_application_profiles
FOR DELETE TO authenticated USING (public.is_platform_admin());

DROP TRIGGER IF EXISTS trg_rec_application_profiles_touch ON public.rec_application_profiles;
CREATE TRIGGER trg_rec_application_profiles_touch
BEFORE UPDATE ON public.rec_application_profiles
FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();

-- 5. Secure public application intake
CREATE OR REPLACE FUNCTION public.rec_public_apply(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vac public.rec_vacancies;
  v_email text := lower(nullif(trim(p_payload->>'email'), ''));
  v_name text := nullif(trim(p_payload->>'full_name'), '');
  v_candidate public.rec_candidates;
  v_app_id uuid;
  v_app_no text;
  v_doc jsonb;
  v_docs jsonb := coalesce(p_payload->'documents', '[]'::jsonb);
BEGIN
  IF v_email IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'full_name and email are required';
  END IF;
  IF coalesce((p_payload->>'consent_privacy')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'privacy consent is required';
  END IF;

  SELECT * INTO v_vac FROM public.rec_vacancies
  WHERE public_slug = p_payload->>'vacancy_slug'
    AND approval_status = 'approved'
    AND publication_status = 'published'
    AND status = 'open'
    AND published_at IS NOT NULL;

  IF v_vac.id IS NULL THEN
    RAISE EXCEPTION 'vacancy is not open for applications';
  END IF;

  SELECT * INTO v_candidate FROM public.rec_candidates WHERE lower(email) = v_email LIMIT 1;

  IF v_candidate.id IS NULL THEN
    INSERT INTO public.rec_candidates (
      candidate_no, full_name, email, phone, location, headline, summary,
      linkedin_url, portfolio_url, years_experience, current_employer, current_title,
      source, engagement_status, consent_given, consent_at
    ) VALUES (
      'CAN-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)),
      v_name, v_email, nullif(trim(p_payload->>'phone'),''), nullif(trim(p_payload->>'location'),''),
      nullif(trim(p_payload->>'headline'),''), nullif(trim(p_payload->>'summary'),''),
      nullif(trim(p_payload->>'linkedin_url'),''), nullif(trim(p_payload->>'portfolio_url'),''),
      nullif(p_payload->>'years_experience','')::numeric,
      nullif(trim(p_payload->>'current_employer'),''), nullif(trim(p_payload->>'current_title'),''),
      'public_careers', 'active', true, now()
    ) RETURNING * INTO v_candidate;
  ELSE
    UPDATE public.rec_candidates SET
      full_name = coalesce(v_name, full_name),
      phone = coalesce(nullif(trim(p_payload->>'phone'),''), phone),
      location = coalesce(nullif(trim(p_payload->>'location'),''), location),
      current_employer = coalesce(nullif(trim(p_payload->>'current_employer'),''), current_employer),
      current_title = coalesce(nullif(trim(p_payload->>'current_title'),''), current_title),
      consent_given = true,
      consent_at = coalesce(consent_at, now()),
      updated_at = now()
    WHERE id = v_candidate.id AND record_state <> 'locked';
  END IF;

  SELECT id, application_no INTO v_app_id, v_app_no
  FROM public.rec_applications
  WHERE candidate_id = v_candidate.id AND vacancy_id = v_vac.id
  LIMIT 1;

  IF v_app_id IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', true, 'application_id', v_app_id, 'application_no', v_app_no, 'vacancy_title', v_vac.title);
  END IF;

  v_app_no := 'APP-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.rec_applications (
    application_no, candidate_id, vacancy_id, source, cover_letter,
    stage, status, priority, recruiter_staff_id, hiring_manager_staff_id
  ) VALUES (
    v_app_no, v_candidate.id, v_vac.id, 'public_careers',
    nullif(trim(p_payload->>'cover_letter'),''),
    'applied', 'active', 'normal', v_vac.recruiter_staff_id, v_vac.hiring_manager_staff_id
  ) RETURNING id INTO v_app_id;

  INSERT INTO public.rec_application_profiles (
    application_id, candidate_id, academic_qualifications, professional_qualifications,
    employment_history, skills, consent_privacy, consent_at
  ) VALUES (
    v_app_id, v_candidate.id,
    coalesce(p_payload->'academic_qualifications', '[]'::jsonb),
    coalesce(p_payload->'professional_qualifications', '[]'::jsonb),
    coalesce(p_payload->'employment_history', '[]'::jsonb),
    coalesce((SELECT array_agg(value) FROM jsonb_array_elements_text(coalesce(p_payload->'skills','[]'::jsonb)) AS t(value)), '{}'),
    true, now()
  );

  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
    IF coalesce(v_doc->>'storage_path','') <> '' THEN
      INSERT INTO public.rec_candidate_documents (candidate_id, application_id, doc_type, file_name, storage_path, mime_type, size_bytes)
      VALUES (
        v_candidate.id, v_app_id,
        coalesce(v_doc->>'doc_type','supporting'),
        coalesce(v_doc->>'file_name','document'),
        v_doc->>'storage_path',
        v_doc->>'mime_type',
        nullif(v_doc->>'size_bytes','')::bigint
      );
    END IF;
  END LOOP;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, context, source)
  VALUES (
    auth.uid(), 'application.submitted', 'application', v_app_id,
    jsonb_build_object('stage', 'applied', 'status', 'active'),
    jsonb_build_object('application_no', v_app_no, 'vacancy_id', v_vac.id, 'vacancy_title', v_vac.title, 'candidate_id', v_candidate.id),
    'public_careers'
  );

  RETURN jsonb_build_object('duplicate', false, 'application_id', v_app_id, 'application_no', v_app_no, 'vacancy_title', v_vac.title, 'vacancy_id', v_vac.id);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_apply(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.rec_public_apply(jsonb) TO anon, authenticated;

-- 6. Storage rules for public applicant documents
DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;
CREATE POLICY "public applicants upload recruitment docs" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'recruitment-applications' AND (storage.foldername(name))[1] = 'public-applications');

DROP POLICY IF EXISTS "recruitment staff read application docs" ON storage.objects;
CREATE POLICY "recruitment staff read application docs" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'recruitment-applications' AND (public.rec_can_read() OR public.is_platform_admin()));
