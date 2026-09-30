CREATE OR REPLACE FUNCTION public.rec_test_upsert_vacancy(
  p_vacancy_no text,
  p_title text,
  p_slug text,
  p_approval_status text,
  p_publication_status text,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_set uuid;
  v_cv integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_vacancy_no NOT LIKE 'VAC-QA-%' OR p_slug NOT LIKE 'qa-%' THEN
    RAISE EXCEPTION 'test harness only accepts VAC-QA-* fixtures';
  END IF;

  INSERT INTO public.rec_vacancies (
    vacancy_no, title, employment_type, work_arrangement, location, headcount,
    sla_days, priority, approval_status, publication_status, status, public_slug,
    public_summary, position_exception_reason
  ) VALUES (
    p_vacancy_no, p_title, 'permanent', 'onsite', 'Nairobi', 1,
    30, 'normal', p_approval_status, p_publication_status, p_status, p_slug,
    'Automated publication-lifecycle test fixture.',
    'Synthetic certification fixture — not a real establishment position.'
  )
  ON CONFLICT (vacancy_no) DO UPDATE SET
    approval_status = excluded.approval_status,
    publication_status = excluded.publication_status,
    status = excluded.status,
    public_slug = excluded.public_slug,
    title = excluded.title,
    position_exception_reason = COALESCE(public.rec_vacancies.position_exception_reason, excluded.position_exception_reason),
    updated_at = now()
  RETURNING id, content_version INTO v_id, v_cv;

  INSERT INTO public.rec_blueprints (vacancy_id, version, status)
  VALUES (v_id, 1, 'active')
  ON CONFLICT DO NOTHING;

  UPDATE public.rec_blueprints SET status = 'active', updated_at = now()
   WHERE vacancy_id = v_id;

  SELECT id INTO v_set FROM public.rec_document_requirement_sets
   WHERE vacancy_id = v_id ORDER BY version DESC LIMIT 1;

  IF v_set IS NULL THEN
    INSERT INTO public.rec_document_requirement_sets
      (vacancy_id, scope, vacancy_content_version, version, status, notes)
    VALUES (v_id, 'vacancy', v_cv, 1, 'active', 'Synthetic matrix requirement set.')
    RETURNING id INTO v_set;
  ELSE
    UPDATE public.rec_document_requirement_sets
       SET status = 'active', vacancy_content_version = v_cv, updated_at = now()
     WHERE id = v_set;
  END IF;

  INSERT INTO public.rec_document_requirement_rules
    (set_id, doc_key, label, doc_class, doc_type, mandatory, requires_verification, ord)
  VALUES
    (v_set, 'cv',   'CV / Curriculum Vitae', 'universal', 'cv',          true, false, 10),
    (v_set, 'kcse', 'KCSE Certificate',      'education', 'certificate', true, false, 20),
    (v_set, 'kcpe', 'KCPE Certificate',      'education', 'certificate', true, false, 30)
  ON CONFLICT (set_id, doc_key) DO NOTHING;

  RETURN jsonb_build_object('id', v_id, 'vacancy_no', p_vacancy_no, 'public_slug', p_slug,
                            'content_version', v_cv, 'requirement_set', v_set);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_test_upsert_vacancy(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_test_upsert_vacancy(text, text, text, text, text, text) TO authenticated;