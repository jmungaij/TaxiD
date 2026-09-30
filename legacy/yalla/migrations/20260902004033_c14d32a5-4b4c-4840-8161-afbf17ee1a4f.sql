-- 1. Structured requirement definition on the versioned contract -------------
ALTER TABLE public.rec_document_requirement_rules
  ADD COLUMN IF NOT EXISTS requirement_text text,
  ADD COLUMN IF NOT EXISTS hard_requirement boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_kind text NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS accepted_evidence_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS declaration_prompt text,
  ADD COLUMN IF NOT EXISTS response_required boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.rec_document_requirement_rules
    ADD CONSTRAINT rec_req_rules_evidence_kind_check
    CHECK (evidence_kind IN ('document','declaration','document_or_declaration'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Resolver publishes the structured fields --------------------------------
DROP FUNCTION IF EXISTS public.rec_document_requirements_versioned(uuid, uuid[], text, text, integer, boolean);

CREATE OR REPLACE FUNCTION public.rec_document_requirements_versioned(
  p_vacancy_id uuid, p_set_ids uuid[] DEFAULT NULL::uuid[],
  p_education_status text DEFAULT NULL::text, p_qualification_level text DEFAULT NULL::text,
  p_completed_years integer DEFAULT NULL::integer, p_consolidated boolean DEFAULT false)
RETURNS TABLE(rule_id uuid, doc_key text, requirement_key text, label text, doc_class text,
  doc_type text, mandatory boolean, academic_year integer, consolidated boolean,
  requires_verification boolean, why_required text, ord integer,
  requirement_text text, hard_requirement boolean, evidence_kind text,
  accepted_evidence_types text[], declaration_prompt text, response_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
     WHERE (
             (p_set_ids IS NULL
               AND s.status = 'active'
               AND (s.scope = 'universal' OR s.vacancy_id = p_vacancy_id))
             OR (p_set_ids IS NOT NULL AND s.id = ANY (p_set_ids))
           )
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
            v_rule.mandatory, NULL::integer, true, v_rule.requires_verification, v_rule.why_required, v_rule.ord,
            v_rule.requirement_text, v_rule.hard_requirement, v_rule.evidence_kind,
            v_rule.accepted_evidence_types, v_rule.declaration_prompt, v_rule.response_required;
        END IF;
      ELSE
        FOR v_y IN 1..v_years LOOP
          IF NOT (v_rule.doc_key || ':' || v_y::text = ANY (v_seen)) THEN
            v_seen := v_seen || (v_rule.doc_key || ':' || v_y::text);
            RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key || ':' || v_y::text,
              v_rule.label || ' — Year ' || v_y::text, v_rule.doc_class, v_rule.doc_type,
              v_rule.mandatory, v_y, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord,
              v_rule.requirement_text, v_rule.hard_requirement, v_rule.evidence_kind,
              v_rule.accepted_evidence_types, v_rule.declaration_prompt, v_rule.response_required;
          END IF;
        END LOOP;
      END IF;
    ELSE
      IF NOT (v_rule.doc_key = ANY (v_seen)) THEN
        v_seen := v_seen || v_rule.doc_key;
        RETURN QUERY SELECT v_rule.id, v_rule.doc_key, v_rule.doc_key,
          v_rule.label, v_rule.doc_class, v_rule.doc_type, v_rule.mandatory,
          NULL::integer, false, v_rule.requires_verification, v_rule.why_required, v_rule.ord,
          v_rule.requirement_text, v_rule.hard_requirement, v_rule.evidence_kind,
          v_rule.accepted_evidence_types, v_rule.declaration_prompt, v_rule.response_required;
      END IF;
    END IF;
  END LOOP;
END; $function$;

-- 3. Evaluator carries the structured fields onto every checklist item -------
CREATE OR REPLACE FUNCTION public.rec_document_evaluate_versioned(
  p_vacancy_id uuid, p_set_ids uuid[], p_education_status text, p_qualification_level text,
  p_completed_years integer, p_consolidated boolean, p_docs jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_req record;
  v_match jsonb;
  v_satisfied boolean;
  v_total integer := 0;
  v_ok integer := 0;
BEGIN
  FOR v_req IN
    SELECT * FROM public.rec_document_requirements_versioned(
      p_vacancy_id, p_set_ids, p_education_status, p_qualification_level,
      p_completed_years, p_consolidated)
  LOOP
    SELECT d INTO v_match FROM jsonb_array_elements(coalesce(p_docs,'[]'::jsonb)) d
    WHERE d->>'doc_key' = v_req.doc_key
      AND coalesce(nullif(d->>'academic_year','')::integer, -1) = coalesce(v_req.academic_year, -1)
      AND coalesce(nullif(d->>'storage_path',''),'') <> ''
      AND coalesce(nullif(d->>'size_bytes','')::bigint, 1) > 0
      AND coalesce(d->>'upload_status','complete') = 'complete'
    LIMIT 1;

    v_satisfied := v_match IS NOT NULL;
    IF v_req.mandatory THEN
      v_total := v_total + 1;
      IF v_satisfied THEN v_ok := v_ok + 1;
      ELSE v_missing := v_missing || v_req.label; END IF;
    END IF;

    v_items := v_items || jsonb_build_object(
      'requirement_key', v_req.requirement_key, 'rule_id', v_req.rule_id, 'doc_key', v_req.doc_key,
      'label', v_req.label, 'doc_class', v_req.doc_class, 'doc_type', v_req.doc_type,
      'mandatory', v_req.mandatory, 'academic_year', v_req.academic_year,
      'consolidated', v_req.consolidated, 'requires_verification', v_req.requires_verification,
      'why_required', v_req.why_required,
      'requirement_text', v_req.requirement_text,
      'hard_requirement', v_req.hard_requirement,
      'evidence_kind', v_req.evidence_kind,
      'accepted_evidence_types', to_jsonb(coalesce(v_req.accepted_evidence_types, '{}'::text[])),
      'declaration_prompt', v_req.declaration_prompt,
      'response_required', v_req.response_required,
      'state', CASE WHEN v_satisfied THEN 'uploaded' WHEN v_req.mandatory THEN 'missing' ELSE 'not_provided' END,
      'file_name', v_match->>'file_name',
      'document_id', v_match->>'id',
      'verification_status', v_match->>'verification_status',
      'verified_at', v_match->>'verified_at',
      'attested_at', v_match->>'attested_at');
  END LOOP;

  RETURN jsonb_build_object(
    'complete', array_length(v_missing,1) IS NULL,
    'mandatory_total', v_total, 'mandatory_satisfied', v_ok,
    'completion_percent', CASE WHEN v_total = 0 THEN 100 ELSE round((v_ok::numeric / v_total) * 100) END,
    'missing', to_jsonb(v_missing), 'items', v_items,
    'requirement_set_ids', coalesce(to_jsonb(p_set_ids), 'null'::jsonb),
    'requirement_binding', CASE WHEN p_set_ids IS NULL THEN 'latest_active' ELSE 'application_bound' END);
END; $function$;

-- 4. Draft rule editor accepts the structured fields ------------------------
CREATE OR REPLACE FUNCTION public.rec_requirement_rule_save(p_set uuid, p_rule jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.rec_document_requirement_sets; v_id uuid; v_types text[];
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO s FROM public.rec_document_requirement_sets WHERE id = p_set;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Requirement version not found.'; END IF;
  IF s.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft version can be edited — create a new version instead.'; END IF;
  IF coalesce(btrim(p_rule->>'doc_key'),'') = '' THEN RAISE EXCEPTION 'A document key is required.'; END IF;
  IF coalesce(btrim(p_rule->>'label'),'') = '' THEN RAISE EXCEPTION 'A label is required.'; END IF;

  IF p_rule ? 'accepted_evidence_types' AND jsonb_typeof(p_rule->'accepted_evidence_types') = 'array' THEN
    SELECT array_agg(btrim(x)) INTO v_types
      FROM jsonb_array_elements_text(p_rule->'accepted_evidence_types') x
     WHERE btrim(x) <> '';
  END IF;

  v_id := nullif(p_rule->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.rec_document_requirement_rules
      (set_id, doc_key, label, doc_class, doc_type, mandatory, per_completed_year,
       allow_consolidated, requires_verification, condition, why_required, ord,
       requirement_text, hard_requirement, evidence_kind, accepted_evidence_types,
       declaration_prompt, response_required)
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
                     (SELECT coalesce(max(ord),0) + 10 FROM public.rec_document_requirement_rules WHERE set_id = p_set)),
            nullif(btrim(coalesce(p_rule->>'requirement_text','')),''),
            coalesce((p_rule->>'hard_requirement')::boolean, false),
            coalesce(nullif(p_rule->>'evidence_kind',''),'document'),
            coalesce(v_types, '{}'::text[]),
            nullif(btrim(coalesce(p_rule->>'declaration_prompt','')),''),
            coalesce((p_rule->>'response_required')::boolean, false))
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
      requirement_text = coalesce(nullif(btrim(coalesce(p_rule->>'requirement_text','')),''), requirement_text),
      hard_requirement = coalesce((p_rule->>'hard_requirement')::boolean, hard_requirement),
      evidence_kind = coalesce(nullif(p_rule->>'evidence_kind',''), evidence_kind),
      accepted_evidence_types = coalesce(v_types, accepted_evidence_types),
      declaration_prompt = coalesce(nullif(btrim(coalesce(p_rule->>'declaration_prompt','')),''), declaration_prompt),
      response_required = coalesce((p_rule->>'response_required')::boolean, response_required),
      updated_at = now()
     WHERE id = v_id AND set_id = p_set;
    IF NOT FOUND THEN RAISE EXCEPTION 'Requirement rule not found on this version.'; END IF;
  END IF;

  PERFORM public._rec_requirement_log(p_set, 'rule_saved', 'draft', 'draft', NULL,
    jsonb_build_object('rule_id', v_id, 'doc_key', p_rule->>'doc_key'));
  RETURN jsonb_build_object('rule_id', v_id);
END; $function$;

-- 5. Candidate requirement responses ---------------------------------------
CREATE TABLE IF NOT EXISTS public.rec_requirement_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.rec_document_requirement_rules(id) ON DELETE SET NULL,
  requirement_key text NOT NULL,
  doc_key text,
  declared boolean NOT NULL DEFAULT false,
  declared_detail text,
  staff_status text NOT NULL DEFAULT 'pending',
  staff_note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_requirement_responses_status_check
    CHECK (staff_status IN ('pending','accepted','rejected')),
  CONSTRAINT rec_requirement_responses_unique UNIQUE (application_id, requirement_key)
);

GRANT SELECT ON public.rec_requirement_responses TO authenticated;
GRANT ALL ON public.rec_requirement_responses TO service_role;
ALTER TABLE public.rec_requirement_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment staff read requirement responses"
  ON public.rec_requirement_responses FOR SELECT TO authenticated
  USING (public.rec_can_read());

CREATE TABLE IF NOT EXISTS public.rec_requirement_response_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid,
  application_id uuid NOT NULL,
  requirement_key text NOT NULL,
  action text NOT NULL,
  previous_status text,
  new_status text,
  declared boolean,
  note text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_requirement_response_events TO authenticated;
GRANT ALL ON public.rec_requirement_response_events TO service_role;
ALTER TABLE public.rec_requirement_response_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment staff read requirement response history"
  ON public.rec_requirement_response_events FOR SELECT TO authenticated
  USING (public.rec_can_read());

CREATE OR REPLACE FUNCTION public._rec_requirement_response_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_rec_requirement_responses_touch ON public.rec_requirement_responses;
CREATE TRIGGER trg_rec_requirement_responses_touch
  BEFORE UPDATE ON public.rec_requirement_responses
  FOR EACH ROW EXECUTE FUNCTION public._rec_requirement_response_touch();

CREATE OR REPLACE FUNCTION public._rec_requirement_response_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'requirement response history is append-only'; END; $$;

DROP TRIGGER IF EXISTS trg_rec_requirement_response_events_ro ON public.rec_requirement_response_events;
CREATE TRIGGER trg_rec_requirement_response_events_ro
  BEFORE UPDATE OR DELETE ON public.rec_requirement_response_events
  FOR EACH ROW EXECUTE FUNCTION public._rec_requirement_response_events_append_only();

-- 6. Candidate records declarations for the application just submitted ------
CREATE OR REPLACE FUNCTION public.rec_public_requirement_responses(
  p_application_id uuid, p_responses jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_app public.rec_applications; r jsonb; v_id uuid; v_count int := 0;
BEGIN
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF v_app.created_at < now() - interval '2 hours' THEN
    RAISE EXCEPTION 'response_window_closed';
  END IF;

  FOR r IN SELECT x FROM jsonb_array_elements(coalesce(p_responses,'[]'::jsonb)) x LOOP
    IF coalesce(btrim(r->>'requirement_key'),'') = '' THEN CONTINUE; END IF;
    INSERT INTO public.rec_requirement_responses
      (application_id, rule_id, requirement_key, doc_key, declared, declared_detail)
    VALUES (p_application_id, nullif(r->>'rule_id','')::uuid, btrim(r->>'requirement_key'),
            nullif(btrim(coalesce(r->>'doc_key','')),''),
            coalesce((r->>'declared')::boolean, false),
            nullif(btrim(coalesce(r->>'declared_detail','')),''))
    ON CONFLICT (application_id, requirement_key) DO UPDATE
      SET declared = excluded.declared,
          declared_detail = excluded.declared_detail,
          rule_id = coalesce(excluded.rule_id, public.rec_requirement_responses.rule_id),
          doc_key = coalesce(excluded.doc_key, public.rec_requirement_responses.doc_key)
      WHERE public.rec_requirement_responses.staff_status = 'pending'
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      v_count := v_count + 1;
      INSERT INTO public.rec_requirement_response_events
        (response_id, application_id, requirement_key, action, new_status, declared, note)
      VALUES (v_id, p_application_id, btrim(r->>'requirement_key'), 'CANDIDATE_DECLARED',
              'pending', coalesce((r->>'declared')::boolean, false),
              nullif(btrim(coalesce(r->>'declared_detail','')),''));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('application_id', p_application_id, 'recorded', v_count);
END; $function$;

REVOKE ALL ON FUNCTION public.rec_public_requirement_responses(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_requirement_responses(uuid, jsonb) TO anon, authenticated, service_role;

-- 7. Staff decision on a declaration ---------------------------------------
CREATE OR REPLACE FUNCTION public.rec_requirement_response_review(
  p_response_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.rec_requirement_responses; v_next text; v_note text := nullif(btrim(p_note),'');
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v FROM public.rec_requirement_responses WHERE id = p_response_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'response_not_found'; END IF;

  v_next := CASE lower(p_action)
    WHEN 'accept' THEN 'accepted'
    WHEN 'reject' THEN 'rejected'
    WHEN 'reset'  THEN 'pending'
    ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'unsupported_action'; END IF;
  IF v_next = 'rejected' AND v_note IS NULL THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.rec_requirement_responses
     SET staff_status = v_next, staff_note = v_note,
         decided_by = CASE WHEN v_next = 'pending' THEN NULL ELSE auth.uid() END,
         decided_at = CASE WHEN v_next = 'pending' THEN NULL ELSE now() END
   WHERE id = p_response_id;

  INSERT INTO public.rec_requirement_response_events
    (response_id, application_id, requirement_key, action, previous_status, new_status, declared, note, actor_id)
  VALUES (v.id, v.application_id, v.requirement_key, 'STAFF_' || upper(v_next),
          v.staff_status, v_next, v.declared, v_note, auth.uid());

  RETURN jsonb_build_object('response_id', v.id, 'previous_status', v.staff_status, 'staff_status', v_next);
END; $function$;

REVOKE ALL ON FUNCTION public.rec_requirement_response_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_requirement_response_review(uuid, text, text) TO authenticated, service_role;

-- 8. Hard-requirement eligibility for an application -----------------------
CREATE OR REPLACE FUNCTION public.rec_requirement_eligibility(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status jsonb;
  v_items jsonb := '[]'::jsonb;
  it jsonb;
  v_resp public.rec_requirement_responses;
  v_hard int := 0; v_ok int := 0; v_blocked int := 0; v_pending int := 0;
  v_state text; v_verdict text;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  v_status := public.rec_application_document_status(p_application_id);

  FOR it IN SELECT x FROM jsonb_array_elements(coalesce(v_status->'items','[]'::jsonb)) x LOOP
    CONTINUE WHEN coalesce((it->>'hard_requirement')::boolean, false) = false;
    v_hard := v_hard + 1;
    SELECT * INTO v_resp FROM public.rec_requirement_responses
      WHERE application_id = p_application_id AND requirement_key = it->>'requirement_key';

    v_state := CASE
      WHEN v_resp.id IS NOT NULL AND v_resp.staff_status = 'rejected' THEN 'NOT_SATISFIED'
      WHEN it->>'verification_status' IN ('rejected','replacement_required') THEN 'NOT_SATISFIED'
      WHEN coalesce((it->>'response_required')::boolean, false)
           AND (v_resp.id IS NULL OR v_resp.declared = false) THEN 'DECLARATION_OUTSTANDING'
      WHEN it->>'evidence_kind' = 'declaration' THEN
        CASE WHEN v_resp.staff_status = 'accepted' THEN 'SATISFIED' ELSE 'AWAITING_REVIEW' END
      WHEN it->>'state' <> 'uploaded' THEN 'EVIDENCE_MISSING'
      WHEN coalesce((it->>'requires_verification')::boolean, true)
           AND coalesce(it->>'verification_status','uploaded') NOT IN ('verified','waived') THEN 'AWAITING_VERIFICATION'
      ELSE 'SATISFIED' END;

    IF v_state = 'SATISFIED' THEN v_ok := v_ok + 1;
    ELSIF v_state = 'NOT_SATISFIED' THEN v_blocked := v_blocked + 1;
    ELSE v_pending := v_pending + 1; END IF;

    v_items := v_items || jsonb_build_object(
      'requirement_key', it->>'requirement_key',
      'rule_id', it->>'rule_id',
      'label', it->>'label',
      'requirement_text', it->>'requirement_text',
      'evidence_kind', it->>'evidence_kind',
      'accepted_evidence_types', coalesce(it->'accepted_evidence_types','[]'::jsonb),
      'document_id', it->>'document_id',
      'file_name', it->>'file_name',
      'verification_status', it->>'verification_status',
      'response_required', coalesce((it->>'response_required')::boolean, false),
      'response_id', v_resp.id,
      'declared', v_resp.declared,
      'declared_detail', v_resp.declared_detail,
      'response_status', coalesce(v_resp.staff_status, 'not_answered'),
      'response_note', v_resp.staff_note,
      'state', v_state);
    v_resp := NULL;
  END LOOP;

  v_verdict := CASE
    WHEN v_hard = 0 THEN 'NO_HARD_REQUIREMENTS'
    WHEN v_blocked > 0 THEN 'NOT_ELIGIBLE'
    WHEN v_pending > 0 THEN 'EVIDENCE_PENDING'
    ELSE 'ELIGIBLE' END;

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'requirement_version', v_status->'requirement_version',
    'hard_total', v_hard, 'hard_satisfied', v_ok,
    'hard_blocked', v_blocked, 'hard_pending', v_pending,
    'verdict', v_verdict, 'items', v_items,
    'evaluated_at', now());
END; $function$;

REVOKE ALL ON FUNCTION public.rec_requirement_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_requirement_eligibility(uuid) TO authenticated, service_role;