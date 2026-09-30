-- 1. Lifecycle statuses
ALTER TABLE public.rec_document_requirement_sets
  DROP CONSTRAINT IF EXISTS rec_document_requirement_sets_status_check;
ALTER TABLE public.rec_document_requirement_sets
  ADD CONSTRAINT rec_document_requirement_sets_status_check
  CHECK (status = ANY (ARRAY['draft','review','approved','active','superseded','retired']));

-- 2. Append-only lifecycle audit trail
CREATE TABLE IF NOT EXISTS public.rec_requirement_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.rec_document_requirement_sets(id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  version integer,
  action text NOT NULL,
  status_before text,
  status_after text,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_requirement_lifecycle_events TO authenticated;
GRANT ALL ON public.rec_requirement_lifecycle_events TO service_role;
ALTER TABLE public.rec_requirement_lifecycle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read requirement lifecycle" ON public.rec_requirement_lifecycle_events;
CREATE POLICY "staff read requirement lifecycle"
  ON public.rec_requirement_lifecycle_events FOR SELECT TO authenticated
  USING (public.rec_can_read());

CREATE OR REPLACE FUNCTION public._rec_requirement_lifecycle_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'requirement lifecycle audit events are append-only';
END; $$;
DROP TRIGGER IF EXISTS trg_rec_requirement_lifecycle_append_only ON public.rec_requirement_lifecycle_events;
CREATE TRIGGER trg_rec_requirement_lifecycle_append_only
  BEFORE UPDATE OR DELETE ON public.rec_requirement_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public._rec_requirement_lifecycle_append_only();

CREATE OR REPLACE FUNCTION public._rec_requirement_log(
  p_set uuid, p_action text, p_before text, p_after text, p_note text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.rec_requirement_lifecycle_events
    (set_id, vacancy_id, version, action, status_before, status_after, note, detail, actor_id)
  SELECT s.id, s.vacancy_id, s.version, p_action, p_before, p_after, nullif(btrim(coalesce(p_note,'')),''),
         coalesce(p_detail,'{}'::jsonb), auth.uid()
    FROM public.rec_document_requirement_sets s WHERE s.id = p_set;
END; $$;
REVOKE ALL ON FUNCTION public._rec_requirement_log(uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Contract compiler
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

  IF v_rules = 0 THEN v_errors := v_errors || 'REQUIREMENT_VERSION_HAS_NO_RULES'; END IF;
  IF v_rules > 0 AND v_mand = 0 THEN v_errors := v_errors || 'NO_MANDATORY_REQUIREMENT'; END IF;
  IF v_keyless > 0 THEN v_errors := v_errors || 'REQUIREMENT_WITHOUT_DOCUMENT_KEY'; END IF;
  IF v_labelless > 0 THEN v_errors := v_errors || 'REQUIREMENT_WITHOUT_LABEL'; END IF;
  IF v_dupes > 0 THEN v_errors := v_errors || 'DUPLICATE_MANDATORY_DOCUMENT_KEY'; END IF;
  IF v_verif = 0 THEN v_warnings := v_warnings || 'NO_MANDATORY_REQUIREMENT_NEEDS_VERIFICATION'; END IF;

  IF s.scope = 'vacancy' THEN
    SELECT * INTO v FROM public.rec_vacancies WHERE id = s.vacancy_id;
    IF v.id IS NULL THEN
      v_errors := v_errors || 'VACANCY_NOT_FOUND';
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.rec_blueprints b WHERE b.vacancy_id = v.id AND b.status = 'active') THEN
        v_errors := v_errors || 'NO_ACTIVE_APPLICATION_BLUEPRINT';
      END IF;
      IF coalesce(s.vacancy_content_version, -1) <> coalesce(v.content_version, -1) THEN
        v_errors := v_errors || 'VACANCY_CONTENT_VERSION_MISMATCH';
      END IF;
    END IF;
    IF v_universal <> 1 THEN v_errors := v_errors || 'UNIVERSAL_ACTIVE_VERSION_NOT_UNIQUE'; END IF;
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
REVOKE ALL ON FUNCTION public.rec_requirement_contract_compile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_contract_compile(uuid) TO authenticated;

-- 4. Draft creation (clones the newest version's rules)
CREATE OR REPLACE FUNCTION public.rec_requirement_draft_create(
  p_scope text, p_vacancy uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v public.rec_vacancies;
  v_source uuid; v_next int; v_new uuid; v_copied int := 0;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_scope NOT IN ('universal','vacancy') THEN RAISE EXCEPTION 'Invalid scope.'; END IF;
  IF p_scope = 'vacancy' AND p_vacancy IS NULL THEN RAISE EXCEPTION 'A vacancy is required for a vacancy-scoped version.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.rec_document_requirement_sets s
     WHERE s.scope = p_scope
       AND ((p_scope = 'universal' AND s.vacancy_id IS NULL) OR s.vacancy_id = p_vacancy)
       AND s.status IN ('draft','review','approved')
  ) THEN
    RAISE EXCEPTION 'An unpublished requirement version already exists for this owner — finish or discard it first.';
  END IF;

  SELECT s.id, s.version + 1 INTO v_source, v_next
    FROM public.rec_document_requirement_sets s
   WHERE s.scope = p_scope
     AND ((p_scope = 'universal' AND s.vacancy_id IS NULL) OR s.vacancy_id = p_vacancy)
   ORDER BY s.version DESC LIMIT 1;
  v_next := coalesce(v_next, 1);

  IF p_scope = 'vacancy' THEN
    SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Vacancy not found.'; END IF;
  END IF;

  INSERT INTO public.rec_document_requirement_sets
    (vacancy_id, scope, vacancy_content_version, version, status, effective_from, notes, created_by)
  VALUES (CASE WHEN p_scope = 'vacancy' THEN p_vacancy END, p_scope,
          CASE WHEN p_scope = 'vacancy' THEN v.content_version END,
          v_next, 'draft', now(), nullif(btrim(coalesce(p_notes,'')),''), auth.uid())
  RETURNING id INTO v_new;

  IF v_source IS NOT NULL THEN
    INSERT INTO public.rec_document_requirement_rules
      (set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year,
       allow_consolidated, requires_verification, condition, why_required, ord)
    SELECT v_new, r.doc_key, r.label, r.doc_class, r.doc_type, r.mandatory, r.per_completed_year,
           r.allow_consolidated, r.requires_verification, r.condition, r.why_required, r.ord
      FROM public.rec_document_requirement_rules r WHERE r.set_id = v_source;
    SELECT count(*) INTO v_copied FROM public.rec_document_requirement_rules WHERE set_id = v_new;
  END IF;

  UPDATE public.rec_document_requirement_sets SET supersedes_set_id = v_source WHERE id = v_new;
  PERFORM public._rec_requirement_log(v_new, 'draft_created', NULL, 'draft', p_notes,
    jsonb_build_object('cloned_from', v_source, 'rules_copied', v_copied));

  RETURN jsonb_build_object('set_id', v_new, 'version', v_next, 'cloned_from', v_source, 'rules_copied', v_copied);
END; $$;
REVOKE ALL ON FUNCTION public.rec_requirement_draft_create(text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_draft_create(text,uuid,text) TO authenticated;

-- 5. Draft rule editing
CREATE OR REPLACE FUNCTION public.rec_requirement_rule_save(p_set uuid, p_rule jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.rec_document_requirement_sets; v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO s FROM public.rec_document_requirement_sets WHERE id = p_set;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Requirement version not found.'; END IF;
  IF s.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft version can be edited — create a new version instead.'; END IF;
  IF coalesce(btrim(p_rule->>'doc_key'),'') = '' THEN RAISE EXCEPTION 'A document key is required.'; END IF;
  IF coalesce(btrim(p_rule->>'label'),'') = '' THEN RAISE EXCEPTION 'A label is required.'; END IF;

  v_id := nullif(p_rule->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.rec_document_requirement_rules
      (set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year,
       allow_consolidated, requires_verification, condition, why_required, ord)
    VALUES (p_set, btrim(p_rule->>'doc_key'), btrim(p_rule->>'label'),
            coalesce(nullif(p_rule->>'doc_class',''),'universal'),
            coalesce(nullif(p_rule->>'doc_type',''),'certificate'),
            coalesce((p_rule->>'mandatory')::boolean, true),
            coalesce((p_rule->>'per_completed_year')::boolean, false),
            coalesce((p_rule->>'allow_consolidated')::boolean, false),
            coalesce((p_rule->>'requires_verification')::boolean, true),
            coalesce(p_rule->'condition','{}'::jsonb),
            nullif(btrim(coalesce(p_rule->>'why_required','')),''),
            coalesce((p_rule->>'ord')::int,
                     (SELECT coalesce(max(ord),0) + 10 FROM public.rec_document_requirement_rules WHERE set_id = p_set)))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.rec_document_requirement_rules SET
      doc_key = btrim(p_rule->>'doc_key'),
      label = btrim(p_rule->>'label'),
      doc_class = coalesce(nullif(p_rule->>'doc_class',''), doc_class),
      doc_type = coalesce(nullif(p_rule->>'doc_type',''), doc_type),
      mandatory = coalesce((p_rule->>'mandatory')::boolean, mandatory),
      per_completed_year = coalesce((p_rule->>'per_completed_year')::boolean, per_completed_year),
      allow_consolidated = coalesce((p_rule->>'allow_consolidated')::boolean, allow_consolidated),
      requires_verification = coalesce((p_rule->>'requires_verification')::boolean, requires_verification),
      condition = coalesce(p_rule->'condition', condition),
      why_required = coalesce(nullif(btrim(coalesce(p_rule->>'why_required','')),''), why_required),
      ord = coalesce((p_rule->>'ord')::int, ord),
      updated_at = now()
     WHERE id = v_id AND set_id = p_set;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requirement rule not found on this version.'; END IF;
  END IF;

  PERFORM public._rec_requirement_log(p_set, 'rule_saved', 'draft', 'draft', NULL,
    jsonb_build_object('rule_id', v_id, 'doc_key', p_rule->>'doc_key'));
  RETURN jsonb_build_object('rule_id', v_id);
END; $$;
REVOKE ALL ON FUNCTION public.rec_requirement_rule_save(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_rule_save(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rec_requirement_rule_remove(p_rule uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_set uuid; v_key text; v_status text;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT r.set_id, r.doc_key, s.status INTO v_set, v_key, v_status
    FROM public.rec_document_requirement_rules r
    JOIN public.rec_document_requirement_sets s ON s.id = r.set_id
   WHERE r.id = p_rule;
  IF v_set IS NULL THEN RAISE EXCEPTION 'Requirement rule not found.'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Only a draft version can be edited — create a new version instead.'; END IF;
  DELETE FROM public.rec_document_requirement_rules WHERE id = p_rule;
  PERFORM public._rec_requirement_log(v_set, 'rule_removed', 'draft', 'draft', NULL,
    jsonb_build_object('rule_id', p_rule, 'doc_key', v_key));
  RETURN jsonb_build_object('removed', p_rule);
END; $$;
REVOKE ALL ON FUNCTION public.rec_requirement_rule_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_rule_remove(uuid) TO authenticated;

-- 6. Lifecycle transitions with four-eyes separation
CREATE OR REPLACE FUNCTION public.rec_requirement_lifecycle_action(
  p_set uuid, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s public.rec_document_requirement_sets;
  v_actor uuid := auth.uid();
  v_compile jsonb;
  v_prev uuid;
  v_after text;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO s FROM public.rec_document_requirement_sets WHERE id = p_set;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Requirement version not found.'; END IF;

  IF p_action = 'submit_review' THEN
    IF s.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft version can be submitted for review.'; END IF;
    v_compile := public.rec_requirement_contract_compile(p_set);
    IF v_compile->>'verdict' <> 'CONTRACT_VALID' THEN
      RAISE EXCEPTION 'Contract invalid: %', (v_compile->>'errors');
    END IF;
    v_after := 'review';
    UPDATE public.rec_document_requirement_sets SET status = 'review', updated_at = now() WHERE id = p_set;

  ELSIF p_action = 'approve' THEN
    IF s.status <> 'review' THEN RAISE EXCEPTION 'Only a version under review can be approved.'; END IF;
    IF s.created_by IS NOT NULL AND s.created_by = v_actor THEN
      RAISE EXCEPTION 'Four-eyes control: the person who created this version cannot approve it.';
    END IF;
    v_compile := public.rec_requirement_contract_compile(p_set);
    IF v_compile->>'verdict' <> 'CONTRACT_VALID' THEN
      RAISE EXCEPTION 'Contract invalid: %', (v_compile->>'errors');
    END IF;
    v_after := 'approved';
    UPDATE public.rec_document_requirement_sets
       SET status = 'approved',
           reviewed_by = coalesce(reviewed_by, v_actor), reviewed_at = coalesce(reviewed_at, now()),
           approved_by = v_actor, approved_at = now(), updated_at = now()
     WHERE id = p_set;

  ELSIF p_action = 'publish' THEN
    IF s.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved version can be published.'; END IF;
    IF s.created_by IS NOT NULL AND s.created_by = v_actor THEN
      RAISE EXCEPTION 'Four-eyes control: the person who created this version cannot publish it.';
    END IF;
    v_compile := public.rec_requirement_contract_compile(p_set);
    IF v_compile->>'verdict' <> 'CONTRACT_VALID' THEN
      RAISE EXCEPTION 'Contract invalid: %', (v_compile->>'errors');
    END IF;

    SELECT id INTO v_prev FROM public.rec_document_requirement_sets
     WHERE scope = s.scope
       AND ((s.scope = 'universal' AND vacancy_id IS NULL) OR vacancy_id = s.vacancy_id)
       AND status = 'active' AND id <> s.id
     ORDER BY version DESC LIMIT 1;

    IF v_prev IS NOT NULL THEN
      UPDATE public.rec_document_requirement_sets
         SET status = 'superseded', effective_until = now(),
             superseded_by_set_id = s.id, updated_at = now()
       WHERE id = v_prev;
      PERFORM public._rec_requirement_log(v_prev, 'superseded', 'active', 'superseded', p_note,
        jsonb_build_object('superseded_by', s.id));
    END IF;

    v_after := 'active';
    UPDATE public.rec_document_requirement_sets
       SET status = 'active', published_by = v_actor, published_at = now(),
           supersedes_set_id = coalesce(v_prev, supersedes_set_id), updated_at = now()
     WHERE id = p_set;

  ELSIF p_action = 'retire' THEN
    IF s.status NOT IN ('active','superseded') THEN RAISE EXCEPTION 'Only a published version can be retired.'; END IF;
    v_after := 'retired';
    UPDATE public.rec_document_requirement_sets
       SET status = 'retired', effective_until = coalesce(effective_until, now()), updated_at = now()
     WHERE id = p_set;

  ELSIF p_action = 'discard' THEN
    IF s.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft version can be discarded.'; END IF;
    PERFORM public._rec_requirement_log(p_set, 'discarded', 'draft', 'discarded', p_note, '{}'::jsonb);
    DELETE FROM public.rec_document_requirement_rules WHERE set_id = p_set;
    DELETE FROM public.rec_document_requirement_sets WHERE id = p_set;
    RETURN jsonb_build_object('set_id', p_set, 'status', 'discarded');
  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action;
  END IF;

  PERFORM public._rec_requirement_log(p_set, p_action, s.status, v_after, p_note,
    coalesce(v_compile, '{}'::jsonb));
  RETURN jsonb_build_object('set_id', p_set, 'status', v_after, 'compile', v_compile);
END; $$;
REVOKE ALL ON FUNCTION public.rec_requirement_lifecycle_action(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_lifecycle_action(uuid,text,text) TO authenticated;

-- 7. Version comparison
CREATE OR REPLACE FUNCTION public.rec_requirement_version_compare(p_from uuid, p_to uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH a AS (SELECT * FROM public.rec_document_requirement_rules WHERE set_id = p_from),
       b AS (SELECT * FROM public.rec_document_requirement_rules WHERE set_id = p_to),
  added AS (
    SELECT jsonb_agg(jsonb_build_object('doc_key', b.doc_key, 'label', b.label,
      'mandatory', b.mandatory, 'requires_verification', b.requires_verification) ORDER BY b.ord) j
      FROM b WHERE NOT EXISTS (SELECT 1 FROM a WHERE a.doc_key = b.doc_key AND a.per_completed_year = b.per_completed_year)),
  removed AS (
    SELECT jsonb_agg(jsonb_build_object('doc_key', a.doc_key, 'label', a.label,
      'mandatory', a.mandatory, 'requires_verification', a.requires_verification) ORDER BY a.ord) j
      FROM a WHERE NOT EXISTS (SELECT 1 FROM b WHERE b.doc_key = a.doc_key AND b.per_completed_year = a.per_completed_year)),
  changed AS (
    SELECT jsonb_agg(jsonb_build_object('doc_key', b.doc_key, 'label', b.label,
      'from', jsonb_build_object('mandatory', a.mandatory, 'requires_verification', a.requires_verification,
                                 'label', a.label, 'doc_class', a.doc_class, 'allow_consolidated', a.allow_consolidated),
      'to', jsonb_build_object('mandatory', b.mandatory, 'requires_verification', b.requires_verification,
                               'label', b.label, 'doc_class', b.doc_class, 'allow_consolidated', b.allow_consolidated)
      ) ORDER BY b.ord) j
      FROM b JOIN a ON a.doc_key = b.doc_key AND a.per_completed_year = b.per_completed_year
     WHERE (a.mandatory, a.requires_verification, a.label, a.doc_class, a.allow_consolidated)
        IS DISTINCT FROM (b.mandatory, b.requires_verification, b.label, b.doc_class, b.allow_consolidated))
  SELECT jsonb_build_object(
    'from_set', p_from, 'to_set', p_to,
    'added', coalesce((SELECT j FROM added), '[]'::jsonb),
    'removed', coalesce((SELECT j FROM removed), '[]'::jsonb),
    'changed', coalesce((SELECT j FROM changed), '[]'::jsonb))
    INTO v_result;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.rec_requirement_version_compare(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_requirement_version_compare(uuid,uuid) TO authenticated;

-- 8. History view: add lifecycle provenance
CREATE OR REPLACE VIEW public.rec_requirement_version_history AS
SELECT s.id AS set_id, s.scope, s.vacancy_id, v.title AS vacancy_title, v.public_slug,
       s.version, s.status, s.effective_from, s.vacancy_content_version, s.notes,
       s.created_at, s.updated_at,
       (SELECT count(*) FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id) AS rule_count,
       (SELECT count(*) FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id AND r.mandatory) AS mandatory_count,
       (SELECT coalesce(array_agg(r.doc_key ORDER BY r.ord), '{}') FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id) AS doc_keys,
       (SELECT coalesce(array_agg(r.doc_key ORDER BY r.ord), '{}') FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id AND r.mandatory) AS mandatory_doc_keys,
       (SELECT count(*) FROM public.rec_applications a
         WHERE a.document_requirement_set_id = s.id OR a.document_requirement_universal_set_id = s.id) AS bound_applications,
       (SELECT coalesce(array_agg(r.doc_key ORDER BY r.ord), '{}') FROM public.rec_document_requirement_rules r WHERE r.set_id = s.id AND r.requires_verification) AS verification_required_keys,
       s.created_by, s.reviewed_by, s.reviewed_at, s.approved_by, s.approved_at,
       s.published_by, s.published_at, s.effective_until,
       s.supersedes_set_id, s.superseded_by_set_id
  FROM public.rec_document_requirement_sets s
  LEFT JOIN public.rec_vacancies v ON v.id = s.vacancy_id
 WHERE public.rec_can_read();

GRANT SELECT ON public.rec_requirement_version_history TO authenticated;