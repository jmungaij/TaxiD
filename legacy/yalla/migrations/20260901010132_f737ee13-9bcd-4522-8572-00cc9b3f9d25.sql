CREATE OR REPLACE FUNCTION public.rec_publication_gate_status(p_vacancy uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.rec_vacancies;
  c public.rec_application_contract;
  v_req record;
  v_e2e public.rec_publication_gate_runs;
  v_val text[] := '{}';
  v_con text[] := '{}';
  v_e2e_block text[] := '{}';
  v_has_blueprint boolean;
  v_max_age interval := interval '14 days';
BEGIN
  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN
    RETURN jsonb_build_object('verdict','UNKNOWN','reason','Vacancy not found.');
  END IF;

  IF v.approval_status <> 'approved' THEN
    v_val := v_val || format('Approval is %s — the vacancy must be approved.', v.approval_status)::text;
  END IF;
  IF v.status <> 'open' THEN
    v_val := v_val || format('Vacancy status is %s — only an open vacancy can be published.', v.status)::text;
  END IF;
  IF coalesce(btrim(v.public_slug), '') = '' THEN
    v_val := v_val || 'The vacancy has no public link (slug).'::text;
  END IF;
  IF v.position_id IS NULL AND coalesce(btrim(v.position_exception_reason), '') = '' THEN
    v_val := v_val || 'Link an approved org position, or record a position exception reason.'::text;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.rec_blueprints b WHERE b.vacancy_id = v.id AND b.status = 'active')
    INTO v_has_blueprint;
  IF NOT v_has_blueprint THEN
    v_val := v_val || 'No active application blueprint — candidates would have no form to complete.'::text;
  END IF;

  SELECT rs.version, rs.vacancy_content_version
    INTO v_req
  FROM public.rec_document_requirement_sets rs
  WHERE rs.vacancy_id = v.id AND rs.status = 'active'
  ORDER BY rs.version DESC LIMIT 1;

  SELECT * INTO c FROM public.rec_application_contract WHERE id;

  IF v_req.version IS NULL THEN
    v_con := v_con || 'No active document requirement set — the requirement contract is undefined.'::text;
  ELSIF coalesce(v_req.vacancy_content_version, -1) <> coalesce(v.content_version, -1) THEN
    v_con := v_con || format(
      'The requirement set was built for vacancy content v%s but the vacancy is now v%s — republish the requirement set.',
      coalesce(v_req.vacancy_content_version, 0), coalesce(v.content_version, 0))::text;
  END IF;
  IF c.id IS NULL THEN
    v_con := v_con || 'No authoritative careers application contract is configured.'::text;
  ELSIF coalesce(c.careers_build_id, '') = '' THEN
    v_con := v_con || 'No careers build is registered as current — the stale-bundle handshake cannot be evaluated.'::text;
  END IF;

  SELECT * INTO v_e2e
  FROM public.rec_publication_gate_runs r
  WHERE r.vacancy_id = v.id AND r.gate = 'E2E'
  ORDER BY r.created_at DESC LIMIT 1;

  IF v_e2e.id IS NULL THEN
    v_e2e_block := v_e2e_block || 'No end-to-end application run has been recorded for this vacancy.'::text;
  ELSE
    IF v_e2e.outcome <> 'PASS' THEN
      v_e2e_block := v_e2e_block || format('The last end-to-end run failed (%s of %s cases passed).',
        coalesce(v_e2e.cases_passed, 0), coalesce(v_e2e.cases_total, 0))::text;
    END IF;
    IF coalesce(v_e2e.content_version, -1) <> coalesce(v.content_version, -1) THEN
      v_e2e_block := v_e2e_block || format(
        'The end-to-end run covered vacancy content v%s; the vacancy is now v%s — rerun the matrix.',
        coalesce(v_e2e.content_version, 0), coalesce(v.content_version, 0))::text;
    END IF;
    IF v_e2e.created_at < now() - v_max_age THEN
      v_e2e_block := v_e2e_block || format('The end-to-end evidence is older than %s.', v_max_age::text)::text;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'vacancy_id', v.id,
    'vacancy_no', v.vacancy_no,
    'title', v.title,
    'public_slug', v.public_slug,
    'content_version', v.content_version,
    'publication_status', v.publication_status,
    'checked_at', now(),
    'gates', jsonb_build_object(
      'validation', jsonb_build_object('passed', array_length(v_val,1) IS NULL, 'blockers', to_jsonb(v_val)),
      'contract', jsonb_build_object(
        'passed', array_length(v_con,1) IS NULL,
        'blockers', to_jsonb(v_con),
        'requirement_version', v_req.version,
        'authoritative_build_id', c.careers_build_id),
      'e2e', jsonb_build_object(
        'passed', array_length(v_e2e_block,1) IS NULL,
        'blockers', to_jsonb(v_e2e_block),
        'run_id', v_e2e.id,
        'suite', v_e2e.suite,
        'cases_total', v_e2e.cases_total,
        'cases_passed', v_e2e.cases_passed,
        'executed_at', v_e2e.created_at)
    ),
    'blockers', to_jsonb(v_val || v_con || v_e2e_block),
    'verdict', CASE WHEN array_length(v_val || v_con || v_e2e_block, 1) IS NULL THEN 'READY' ELSE 'BLOCKED' END
  );
END;
$function$;