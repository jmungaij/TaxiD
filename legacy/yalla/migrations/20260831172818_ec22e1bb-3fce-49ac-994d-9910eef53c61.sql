-- 1. De-duplicate requirement expansion (vacancy rule wins over universal rule)
CREATE OR REPLACE FUNCTION public.rec_document_requirements(
  p_vacancy_id uuid,
  p_education_status text DEFAULT NULL,
  p_qualification_level text DEFAULT NULL,
  p_completed_years integer DEFAULT NULL,
  p_consolidated boolean DEFAULT false
)
RETURNS TABLE (
  rule_id uuid,
  doc_key text,
  requirement_key text,
  label text,
  doc_class text,
  doc_type text,
  mandatory boolean,
  academic_year integer,
  consolidated boolean,
  requires_verification boolean,
  why_required text,
  ord integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_years integer := greatest(coalesce(p_completed_years, 0), 0);
  v_y integer;
  v_seen text[] := '{}';
BEGIN
  FOR v_rule IN
    SELECT DISTINCT ON (r.doc_key, lower(btrim(r.label)))
           r.*, (s.vacancy_id IS NOT NULL) AS vacancy_scoped
      FROM public.rec_document_requirement_rules r
      JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
     WHERE s.status = 'active'
       AND (s.scope = 'universal' OR s.vacancy_id = p_vacancy_id)
     ORDER BY r.doc_key, lower(btrim(r.label)),
              (s.vacancy_id IS NOT NULL) DESC, s.version DESC
  LOOP
    CONTINUE WHEN NOT public.rec_doc_condition_matches(v_rule.condition, p_education_status, p_qualification_level);

    IF v_rule.per_completed_year THEN
      IF coalesce(p_consolidated, false) AND v_rule.allow_consolidated THEN
        IF NOT (v_rule.doc_key || ':consolidated' = ANY (v_seen)) THEN
          v_seen := v_seen || (v_rule.doc_key || ':consolidated');
          RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':consolidated',
            v_rule.label || ' — consolidated (all completed years)', v_rule.doc_class, v_rule.doc_type,
            v_rule.mandatory, NULL::integer, true, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
        END IF;
      ELSE
        FOR v_y IN 1..v_years LOOP
          IF NOT (v_rule.doc_key || ':' || v_y::text = ANY (v_seen)) THEN
            v_seen := v_seen || (v_rule.doc_key || ':' || v_y::text);
            RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':' || v_y::text,
              v_rule.label || ' — Year ' || v_y::text, v_rule.doc_class, v_rule.doc_type,
              v_rule.mandatory, v_y, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
          END IF;
        END LOOP;
      END IF;
    ELSE
      IF NOT (v_rule.doc_key = ANY (v_seen)) THEN
        v_seen := v_seen || v_rule.doc_key;
        RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key,
          v_rule.label, v_rule.doc_class, v_rule.doc_type, v_rule.mandatory,
          NULL::integer, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- 2. Remove the ambiguous older refusal-recording overload
DROP FUNCTION IF EXISTS public.rec_record_apply_refusal(text, text, text, text, jsonb, jsonb, text);

-- 3. Harness reuses the platform-wide requirement set instead of shadowing it
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

  DELETE FROM public.rec_document_requirement_rules r
   USING public.rec_document_requirement_sets s
   WHERE r.set_id = s.id AND s.vacancy_id = v_id;

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
    VALUES (v_id, 'vacancy', v_cv, 1, 'active',
            'Synthetic matrix requirement set — inherits the platform-wide document rules.')
    RETURNING id INTO v_set;
  ELSE
    UPDATE public.rec_document_requirement_sets
       SET status = 'active', vacancy_content_version = v_cv, updated_at = now()
     WHERE id = v_set;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'vacancy_no', p_vacancy_no, 'public_slug', p_slug,
                            'content_version', v_cv, 'requirement_set', v_set);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_test_upsert_vacancy(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_test_upsert_vacancy(text, text, text, text, text, text) TO authenticated;