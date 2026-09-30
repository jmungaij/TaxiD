-- 1. Governed approval routine: only a hiring authority may approve a vacancy.
CREATE OR REPLACE FUNCTION public.rec_vacancy_approve(p_vacancy uuid, p_note text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.rec_vacancies;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'Not authorised to approve a vacancy.';
  END IF;
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  UPDATE public.rec_vacancies
     SET approval_status = 'approved'
   WHERE id = p_vacancy;

  INSERT INTO public.rec_audit_events(action, object_type, object_id, previous_state, new_state, context)
  VALUES ('vacancy_approved', 'vacancy', p_vacancy,
          jsonb_build_object('approval_status', v.approval_status),
          jsonb_build_object('approval_status', 'approved'),
          jsonb_build_object('note', COALESCE(p_note, '')));

  RETURN jsonb_build_object('ok', true, 'vacancy_id', p_vacancy, 'approval_status', 'approved');
END; $$;

-- 2. Publication service: the ONLY sanctioned way to flip publication state.
--    Refuses to report "published" unless every public-eligibility gate holds.
CREATE OR REPLACE FUNCTION public.rec_vacancy_set_publication(
  p_vacancy uuid, p_publish boolean, p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v public.rec_vacancies; v_blockers text[] := '{}'; v_visible boolean;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'Not authorised to change publication state.';
  END IF;
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  IF p_publish THEN
    IF v.approval_status <> 'approved' THEN
      v_blockers := v_blockers || format('Approval is %s — the vacancy must be approved before publication.', v.approval_status);
    END IF;
    IF v.status <> 'open' THEN
      v_blockers := v_blockers || format('Vacancy status is %s — only an open vacancy can be published.', v.status);
    END IF;
    IF COALESCE(btrim(v.public_slug), '') = '' THEN
      v_blockers := v_blockers || 'The vacancy has no public link (slug).';
    END IF;
    IF v.position_id IS NULL AND COALESCE(btrim(v.position_exception_reason), '') = '' THEN
      v_blockers := v_blockers || 'Link an approved org position, or record a position exception reason.';
    END IF;

    INSERT INTO public.rec_audit_events(action, object_type, object_id, new_state, context)
    VALUES ('publication_requested', 'vacancy', p_vacancy,
            jsonb_build_object('publication_status', v.publication_status),
            jsonb_build_object('reason', COALESCE(p_reason, '')));

    IF array_length(v_blockers, 1) > 0 THEN
      INSERT INTO public.rec_audit_events(action, object_type, object_id, context)
      VALUES ('publication_failed', 'vacancy', p_vacancy, jsonb_build_object('blockers', to_jsonb(v_blockers)));
      RETURN jsonb_build_object('ok', false, 'status', 'PUBLICATION_FAILED',
                                'vacancy_id', p_vacancy, 'blockers', to_jsonb(v_blockers));
    END IF;

    INSERT INTO public.rec_audit_events(action, object_type, object_id)
    VALUES ('publication_validated', 'vacancy', p_vacancy);

    UPDATE public.rec_vacancies
       SET publication_status = 'published',
           published_at = COALESCE(published_at, now()),
           published_by = COALESCE(published_by, auth.uid())
     WHERE id = p_vacancy;
  ELSE
    UPDATE public.rec_vacancies
       SET publication_status = 'paused'
     WHERE id = p_vacancy;
  END IF;

  -- Verify the public projection actually agrees before reporting success.
  SELECT EXISTS (
    SELECT 1 FROM public.rec_vacancies x
    WHERE x.id = p_vacancy
      AND x.approval_status = 'approved'
      AND x.publication_status = 'published'
      AND x.status = 'open'
      AND x.published_at IS NOT NULL
  ) INTO v_visible;

  INSERT INTO public.rec_audit_events(action, object_type, object_id, new_state, context)
  VALUES (CASE WHEN p_publish THEN 'publication_succeeded' ELSE 'publication_paused' END,
          'vacancy', p_vacancy,
          jsonb_build_object('publication_status', CASE WHEN p_publish THEN 'published' ELSE 'paused' END),
          jsonb_build_object('careers_visible', v_visible, 'reason', COALESCE(p_reason, '')));

  RETURN jsonb_build_object(
    'ok', true,
    'status', CASE WHEN NOT p_publish THEN 'PAUSED'
                   WHEN v_visible THEN 'PUBLISHED'
                   ELSE 'PUBLISHED_WITH_RECONCILIATION_PENDING' END,
    'vacancy_id', p_vacancy,
    'careers_visible', v_visible,
    'blockers', to_jsonb(v_blockers)
  );
END; $$;

-- 3. Hard consistency guard: no code path may mark a vacancy published while it
--    is not publicly eligible. This is what allowed "Published + pending approval".
CREATE OR REPLACE FUNCTION public._rec_vacancy_publication_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.publication_status = 'published' THEN
    IF NEW.approval_status <> 'approved' THEN
      RAISE EXCEPTION 'Publication blocked: vacancy approval is % — approve it before publishing.', NEW.approval_status;
    END IF;
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'Publication blocked: vacancy status is % — only an open vacancy can be published.', NEW.status;
    END IF;
    IF NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS rec_vacancies_publication_consistency ON public.rec_vacancies;
CREATE TRIGGER rec_vacancies_publication_consistency
BEFORE INSERT OR UPDATE ON public.rec_vacancies
FOR EACH ROW EXECUTE FUNCTION public._rec_vacancy_publication_consistency();

GRANT EXECUTE ON FUNCTION public.rec_vacancy_approve(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_vacancy_set_publication(uuid, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rec_vacancy_approve(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_vacancy_set_publication(uuid, boolean, text) FROM anon;