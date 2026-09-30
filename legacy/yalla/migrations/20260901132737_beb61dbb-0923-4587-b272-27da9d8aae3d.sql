DO $mig$
DECLARE
  v_def text;
  v_old text := '      IF coalesce((v_req->>''required'')::boolean, false)
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_docs) d
           WHERE d->>''doc_type'' = v_req->>''doc_type'') THEN';
  v_new text := '      -- The canonical requirement engine (public.rec_document_evaluate, run by
      -- rec_public_apply against this same payload) owns every requirement the
      -- vacancy''s document requirement set publishes. The blueprint list is only a
      -- display mirror: it must never act as a second requirement engine, and any
      -- remaining legacy requirement resolves documents by canonical identity
      -- (doc_key) as well as the legacy doc_type.
      CONTINUE WHEN EXISTS (
        SELECT 1
          FROM public.rec_document_requirement_rules r
          JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
         WHERE s.status = ''active''
           AND (s.vacancy_id = v_vac.id OR s.scope = ''universal'')
           AND r.doc_key = v_req->>''doc_type'');

      IF coalesce((v_req->>''required'')::boolean, false)
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_docs) d
           WHERE d->>''doc_key'' = v_req->>''doc_type''
              OR d->>''doc_type'' = v_req->>''doc_type'') THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rec_public_apply_core';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'public.rec_public_apply_core not found';
  END IF;

  IF position(v_old in v_def) = 0 THEN
    IF position('d->>''doc_key'' = v_req->>''doc_type''' in v_def) > 0 THEN
      RAISE NOTICE 'rec_public_apply_core already remediated';
      RETURN;
    END IF;
    RAISE EXCEPTION 'expected legacy blueprint document predicate not found in rec_public_apply_core';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

CREATE OR REPLACE FUNCTION public.rec_blueprint_provision(p_vacancy uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.rec_vacancies;
  v_intern boolean;
  v_bp uuid;
  v_version integer;
  v_docs jsonb;
  v_sections jsonb;
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;

  SELECT id, version INTO v_bp, v_version
    FROM public.rec_blueprints WHERE vacancy_id = p_vacancy AND status = 'active';
  IF v_bp IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'blueprint_id', v_bp, 'version', v_version);
  END IF;

  v_intern := v.employment_type = 'internship'
              OR EXISTS (SELECT 1 FROM public.rec_internship_specs s WHERE s.vacancy_id = p_vacancy);

  v_sections := CASE WHEN v_intern
    THEN '{"education": true, "attachment": true, "employment": false, "qualifications": false, "skills": false}'::jsonb
    ELSE '{"education": true, "employment": true, "qualifications": true, "skills": true}'::jsonb END;

  -- Display mirror of the canonical requirement set. `owned_by` records that the
  -- requirement engine, not this list, decides completeness, and `doc_key` carries
  -- the canonical identity so no consumer has to infer it from doc_type.
  v_docs := coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'doc_type', r.doc_key, 'doc_key', r.doc_key, 'label', r.label,
             'required', r.mandatory, 'owned_by', 'requirement_engine') ORDER BY r.ord)
      FROM public.rec_document_requirement_rules r
      JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
     WHERE s.status = 'active' AND (s.vacancy_id = p_vacancy OR s.scope = 'universal')),
    '[{"doc_type": "cv", "doc_key": "cv", "label": "CV / Curriculum Vitae", "required": true}]'::jsonb);

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.rec_blueprints WHERE vacancy_id = p_vacancy;

  INSERT INTO public.rec_blueprints(vacancy_id, version, status, cover_letter_mode,
                                    sections, document_requirements)
  VALUES (p_vacancy, v_version, 'active',
          CASE WHEN v_intern THEN 'optional' ELSE 'required' END,
          v_sections, v_docs)
  RETURNING id INTO v_bp;

  RETURN jsonb_build_object('ok', true, 'created', true, 'blueprint_id', v_bp,
                           'version', v_version, 'internship', v_intern,
                           'document_requirements', jsonb_array_length(v_docs));
END;
$function$;