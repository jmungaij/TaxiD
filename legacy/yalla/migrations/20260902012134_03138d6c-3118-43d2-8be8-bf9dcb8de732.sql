CREATE OR REPLACE FUNCTION public.rec_requirement_contract_compile(p_set uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.rec_document_requirement_sets;
  v public.rec_vacancies;
  v_errors text[] := '{}';
  v_warnings text[] := '{}';
  v_rules int; v_mand int; v_keyless int; v_labelless int; v_dupes int; v_verif int;
  v_universal int;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO s FROM public.rec_document_requirement_sets WHERE id = p_set;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Requirement version not found.'; END IF;

  SELECT count(*), count(*) FILTER (WHERE mandatory),
         count(*) FILTER (WHERE doc_key IS NULL OR btrim(doc_key) = ''),
         count(*) FILTER (WHERE label IS NULL OR btrim(label) = ''),
         count(*) FILTER (WHERE mandatory AND requires_verification)
    INTO v_rules, v_mand, v_keyless, v_labelless, v_verif
    FROM public.rec_document_requirement_rules WHERE set_id = p_set;

  SELECT count(*) INTO v_dupes FROM (
    SELECT doc_key, per_completed_year FROM public.rec_document_requirement_rules
     WHERE set_id = p_set AND mandatory GROUP BY 1,2 HAVING count(*) > 1) d;

  SELECT count(*) INTO v_universal FROM public.rec_document_requirement_sets
   WHERE scope = 'universal' AND status = 'active';

  -- Explicit ::text casts: `text[] || 'literal'` resolves the untyped literal as an
  -- array and fails with "malformed array literal".
  IF v_rules = 0 THEN v_errors := v_errors || 'REQUIREMENT_VERSION_HAS_NO_RULES'::text; END IF;
  IF v_rules > 0 AND v_mand = 0 THEN v_errors := v_errors || 'NO_MANDATORY_REQUIREMENT'::text; END IF;
  IF v_keyless > 0 THEN v_errors := v_errors || 'REQUIREMENT_WITHOUT_DOCUMENT_KEY'::text; END IF;
  IF v_labelless > 0 THEN v_errors := v_errors || 'REQUIREMENT_WITHOUT_LABEL'::text; END IF;
  IF v_dupes > 0 THEN v_errors := v_errors || 'DUPLICATE_MANDATORY_DOCUMENT_KEY'::text; END IF;
  IF v_verif = 0 THEN v_warnings := v_warnings || 'NO_MANDATORY_REQUIREMENT_NEEDS_VERIFICATION'::text; END IF;

  IF s.scope = 'vacancy' THEN
    SELECT * INTO v FROM public.rec_vacancies WHERE id = s.vacancy_id;
    IF v.id IS NULL THEN
      v_errors := v_errors || 'VACANCY_NOT_FOUND'::text;
    ELSE
      -- The application form is DERIVED from the approved contract. Requiring it here
      -- deadlocked approval against provisioning, so it is a warning, not an error.
      IF NOT EXISTS (SELECT 1 FROM public.rec_blueprints b WHERE b.vacancy_id = v.id AND b.status = 'active') THEN
        v_warnings := v_warnings || 'NO_ACTIVE_APPLICATION_BLUEPRINT'::text;
      END IF;
      IF coalesce(s.vacancy_content_version, -1) <> coalesce(v.content_version, -1) THEN
        v_errors := v_errors || 'VACANCY_CONTENT_VERSION_MISMATCH'::text;
      END IF;
    END IF;
    IF v_universal <> 1 THEN v_errors := v_errors || 'UNIVERSAL_ACTIVE_VERSION_NOT_UNIQUE'::text; END IF;
  END IF;

  RETURN jsonb_build_object(
    'set_id', s.id, 'scope', s.scope, 'vacancy_id', s.vacancy_id,
    'version', s.version, 'status', s.status,
    'rule_count', v_rules, 'mandatory_count', v_mand,
    'verification_required_count', v_verif,
    'errors', to_jsonb(v_errors), 'warnings', to_jsonb(v_warnings),
    'verdict', CASE WHEN cardinality(v_errors) = 0 THEN 'CONTRACT_VALID' ELSE 'CONTRACT_INVALID' END,
    'compiled_at', now());
END; $$;