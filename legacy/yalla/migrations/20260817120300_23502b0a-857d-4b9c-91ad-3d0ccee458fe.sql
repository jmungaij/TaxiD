ALTER TABLE public.rec_evidence_facts
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid,
  ADD COLUMN IF NOT EXISTS adjudicated boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.rec_evidence_adjudications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  attribute text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('verify','override','reject','waive_gate','set_rejection_reason')),
  before_fact_id uuid,
  before_value text,
  before_confidence numeric,
  after_fact_id uuid,
  after_value text,
  after_confidence numeric,
  reason_code text NOT NULL,
  reason_notes text,
  evaluation_before jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluation_after jsonb NOT NULL DEFAULT '{}'::jsonb,
  adjudicated_by uuid,
  adjudicator_email text,
  adjudicated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rec_evidence_adjud_app_idx
  ON public.rec_evidence_adjudications (application_id, adjudicated_at DESC);
CREATE INDEX IF NOT EXISTS rec_evidence_adjud_vac_idx
  ON public.rec_evidence_adjudications (vacancy_id, adjudicated_at DESC);

GRANT SELECT, INSERT ON public.rec_evidence_adjudications TO authenticated;
GRANT ALL ON public.rec_evidence_adjudications TO service_role;

ALTER TABLE public.rec_evidence_adjudications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec staff read adjudications" ON public.rec_evidence_adjudications;
CREATE POLICY "rec staff read adjudications"
  ON public.rec_evidence_adjudications FOR SELECT TO authenticated
  USING (public.rec_can_read());

DROP POLICY IF EXISTS "rec staff insert adjudications" ON public.rec_evidence_adjudications;
CREATE POLICY "rec staff insert adjudications"
  ON public.rec_evidence_adjudications FOR INSERT TO authenticated
  WITH CHECK (public.rec_is_recruiter() AND adjudicated_by = auth.uid());

CREATE OR REPLACE FUNCTION public.rec_block_adjudication_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'rec_evidence_adjudications is append-only — adjudications cannot be edited or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_adjud_append_only ON public.rec_evidence_adjudications;
CREATE TRIGGER trg_rec_adjud_append_only
  BEFORE UPDATE OR DELETE ON public.rec_evidence_adjudications
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_adjudication_mutation();

-- Screening engine: ignore superseded facts, prefer human-verified evidence.
CREATE OR REPLACE FUNCTION public.rec_evaluate_application(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_app record;
  v_card record;
  v_crit record;
  v_results jsonb := '[]'::jsonb;
  v_gate_failures text[] := '{}';
  v_missing text[] := '{}';
  v_earned numeric := 0;
  v_weight numeric := 0;
  v_conf_sum numeric := 0;
  v_conf_n integer := 0;
  v_fact record;
  v_crit_earned numeric;
  v_crit_status text;
  v_evidence text;
  v_score numeric;
  v_eligibility text;
  v_reco text;
  v_eval_id uuid;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to evaluate applications';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  SELECT * INTO v_card FROM public.rec_scorecards
   WHERE vacancy_id = v_app.vacancy_id AND status = 'active';
  IF v_card IS NULL THEN
    RAISE EXCEPTION 'vacancy has no active scorecard — publish one before evaluating candidates';
  END IF;

  FOR v_crit IN
    SELECT * FROM public.rec_scorecard_criteria WHERE scorecard_id = v_card.id ORDER BY sort_order
  LOOP
    -- Best available evidence: adjudicated/manual evidence outranks extraction,
    -- superseded facts are never counted, then highest confidence wins.
    SELECT * INTO v_fact
      FROM public.rec_evidence_facts
     WHERE attribute = v_crit.code
       AND superseded_at IS NULL
       AND (application_id = p_application_id OR candidate_id = v_app.candidate_id)
     ORDER BY (source_kind = 'manual') DESC, adjudicated DESC, confidence DESC, created_at DESC
     LIMIT 1;

    v_crit_earned := 0;
    IF v_fact IS NULL THEN
      v_crit_status := 'missing_evidence';
      v_evidence := 'No evidence recorded';
      v_missing := v_missing || v_crit.label;
      IF v_crit.criterion_type = 'hard_gate' THEN
        v_crit_status := 'requires_review';
      END IF;
    ELSE
      v_conf_sum := v_conf_sum + v_fact.confidence;
      v_conf_n := v_conf_n + 1;
      v_evidence := format('%s (%s%s, confidence %s)',
        COALESCE(v_fact.value_text, v_fact.value_numeric::text),
        v_fact.source_kind,
        COALESCE(' ' || v_fact.source_locator, ''),
        round(v_fact.confidence, 2));

      IF v_crit.min_threshold IS NOT NULL AND v_fact.value_numeric IS NOT NULL THEN
        IF v_fact.value_numeric >= v_crit.min_threshold THEN
          v_crit_status := 'pass';
          v_crit_earned := v_crit.weight;
        ELSE
          v_crit_status := CASE WHEN v_crit.criterion_type = 'hard_gate' THEN 'fail' ELSE 'partial' END;
          v_crit_earned := CASE
            WHEN v_crit.criterion_type = 'hard_gate' THEN 0
            ELSE round(v_crit.weight * LEAST(1, v_fact.value_numeric / NULLIF(v_crit.min_threshold, 0)), 2)
          END;
        END IF;
      ELSE
        v_crit_status := CASE WHEN v_fact.confidence >= 0.6 THEN 'pass' ELSE 'requires_review' END;
        v_crit_earned := round(v_crit.weight * LEAST(1, v_fact.confidence), 2);
      END IF;

      IF v_crit.criterion_type = 'hard_gate' AND v_crit_status = 'fail' THEN
        v_gate_failures := v_gate_failures || v_crit.label;
      END IF;
    END IF;

    IF v_crit.criterion_type IN ('scored','preferred') THEN
      v_weight := v_weight + v_crit.weight;
      v_earned := v_earned + v_crit_earned;
    END IF;

    v_results := v_results || jsonb_build_object(
      'code', v_crit.code,
      'label', v_crit.label,
      'type', v_crit.criterion_type,
      'weight', v_crit.weight,
      'earned', CASE WHEN v_crit.criterion_type IN ('scored','preferred') THEN v_crit_earned ELSE NULL END,
      'status', v_crit_status,
      'evidence', v_evidence,
      'source_kind', v_fact.source_kind,
      'source_ref', v_fact.source_ref,
      'confidence', v_fact.confidence
    );
  END LOOP;

  v_score := CASE WHEN v_weight > 0 THEN round(100 * v_earned / v_weight, 2) ELSE 0 END;

  v_eligibility := CASE
    WHEN array_length(v_gate_failures, 1) > 0 THEN 'not_eligible'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_results) r
       WHERE r->>'type' = 'hard_gate' AND r->>'status' IN ('requires_review','missing_evidence')
    ) THEN 'requires_review'
    ELSE 'eligible'
  END;

  v_reco := CASE
    WHEN v_eligibility = 'not_eligible' THEN 'do_not_advance'
    WHEN v_eligibility = 'requires_review' THEN 'review'
    WHEN v_score >= 70 THEN 'advance'
    WHEN v_score >= 50 THEN 'review'
    ELSE 'do_not_advance'
  END;

  UPDATE public.rec_application_evaluations
     SET is_current = false
   WHERE application_id = p_application_id AND is_current;

  INSERT INTO public.rec_application_evaluations (
    application_id, vacancy_id, scorecard_id, scorecard_version, eligibility,
    weighted_score, max_score, criterion_results, gate_failures, missing_evidence,
    recommendation, confidence, computed_by
  ) VALUES (
    p_application_id, v_app.vacancy_id, v_card.id, v_card.version, v_eligibility,
    v_score, 100, v_results, v_gate_failures, v_missing, v_reco,
    CASE WHEN v_conf_n > 0 THEN round(v_conf_sum / v_conf_n, 2) ELSE NULL END,
    auth.uid()
  ) RETURNING id INTO v_eval_id;

  UPDATE public.rec_applications
     SET ai_match_score = v_score,
         knockout_flagged = (v_eligibility = 'not_eligible'),
         updated_at = now()
   WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'evaluation_id', v_eval_id, 'eligibility', v_eligibility, 'score', v_score,
    'recommendation', v_reco, 'gate_failures', v_gate_failures,
    'missing_evidence', v_missing, 'criteria', v_results
  );
END;
$function$;

-- Manual adjudication of a single evidence attribute, with an audit trail.
CREATE OR REPLACE FUNCTION public.rec_adjudicate_evidence(
  p_application_id uuid,
  p_attribute text,
  p_decision text,
  p_reason_code text,
  p_value_text text DEFAULT NULL,
  p_value_numeric numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_confidence numeric DEFAULT 1.0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_app record;
  v_before record;
  v_before_eval jsonb := '{}'::jsonb;
  v_after_eval jsonb := '{}'::jsonb;
  v_new_fact uuid;
  v_adj uuid;
  v_email text;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to adjudicate evidence';
  END IF;
  IF p_decision NOT IN ('verify','override','reject','waive_gate','set_rejection_reason') THEN
    RAISE EXCEPTION 'unknown adjudication decision: %', p_decision;
  END IF;
  IF coalesce(btrim(p_reason_code), '') = '' THEN
    RAISE EXCEPTION 'a reason code is required for every adjudication';
  END IF;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  SELECT to_jsonb(e) INTO v_before_eval
    FROM public.rec_application_evaluations e
   WHERE e.application_id = p_application_id AND e.is_current;

  SELECT * INTO v_before
    FROM public.rec_evidence_facts
   WHERE application_id = p_application_id AND attribute = p_attribute AND superseded_at IS NULL
   ORDER BY (source_kind = 'manual') DESC, confidence DESC, created_at DESC
   LIMIT 1;

  IF p_decision = 'set_rejection_reason' THEN
    IF coalesce(btrim(p_value_text), '') = '' THEN
      RAISE EXCEPTION 'a rejection reason is required';
    END IF;
    UPDATE public.rec_applications
       SET rejection_reason = p_value_text, last_activity_at = now()
     WHERE id = p_application_id;

  ELSIF p_decision = 'verify' THEN
    IF v_before IS NULL THEN RAISE EXCEPTION 'no evidence recorded for %', p_attribute; END IF;
    UPDATE public.rec_evidence_facts
       SET verified_by = auth.uid(), verified_at = now(), adjudicated = true
     WHERE id = v_before.id;

  ELSIF p_decision = 'reject' THEN
    IF v_before IS NULL THEN RAISE EXCEPTION 'no evidence recorded for %', p_attribute; END IF;
    UPDATE public.rec_evidence_facts
       SET superseded_at = now(), adjudicated = true
     WHERE id = v_before.id;

  ELSE -- override / waive_gate: record a manual, human-attributed fact
    IF p_value_text IS NULL AND p_value_numeric IS NULL THEN
      RAISE EXCEPTION 'a verified value is required to override evidence';
    END IF;
    IF v_before IS NOT NULL THEN
      UPDATE public.rec_evidence_facts
         SET superseded_at = now(), adjudicated = true
       WHERE id = v_before.id;
    END IF;
    INSERT INTO public.rec_evidence_facts (
      candidate_id, application_id, attribute, value_text, value_numeric,
      source_kind, source_ref, source_locator, confidence, extracted_by,
      verified_by, verified_at, adjudicated
    ) VALUES (
      v_app.candidate_id, p_application_id, p_attribute,
      COALESCE(p_value_text, p_value_numeric::text), p_value_numeric,
      'manual', 'recruiter_adjudication', p_reason_code,
      LEAST(1, GREATEST(0, COALESCE(p_confidence, 1.0))), 'recruiter',
      auth.uid(), now(), true
    ) RETURNING id INTO v_new_fact;

    IF v_before IS NOT NULL THEN
      UPDATE public.rec_evidence_facts SET superseded_by = v_new_fact WHERE id = v_before.id;
    END IF;
  END IF;

  IF p_decision <> 'set_rejection_reason' THEN
    v_after_eval := public.rec_evaluate_application(p_application_id);
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.rec_evidence_adjudications (
    application_id, candidate_id, vacancy_id, attribute, decision,
    before_fact_id, before_value, before_confidence,
    after_fact_id, after_value, after_confidence,
    reason_code, reason_notes, evaluation_before, evaluation_after,
    adjudicated_by, adjudicator_email
  ) VALUES (
    p_application_id, v_app.candidate_id, v_app.vacancy_id, p_attribute, p_decision,
    v_before.id, COALESCE(v_before.value_text, v_before.value_numeric::text), v_before.confidence,
    v_new_fact,
    CASE WHEN p_decision = 'reject' THEN NULL ELSE COALESCE(p_value_text, p_value_numeric::text) END,
    CASE WHEN p_decision IN ('override','waive_gate') THEN COALESCE(p_confidence, 1.0) ELSE NULL END,
    p_reason_code, p_notes,
    COALESCE(v_before_eval, '{}'::jsonb), COALESCE(v_after_eval, '{}'::jsonb),
    auth.uid(), v_email
  ) RETURNING id INTO v_adj;

  RETURN jsonb_build_object(
    'adjudication_id', v_adj,
    'decision', p_decision,
    'attribute', p_attribute,
    'new_fact_id', v_new_fact,
    'evaluation', v_after_eval
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_adjudicate_evidence(uuid, text, text, text, text, numeric, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_adjudicate_evidence(uuid, text, text, text, text, numeric, text, numeric) TO authenticated;

-- Per-batch progress: file uploads, migration steps, screening runs.
CREATE OR REPLACE FUNCTION public.rec_migration_batch_progress(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_batch record;
  v_files jsonb;
  v_records jsonb;
  v_screening jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not authorized to read migration batches';
  END IF;
  SELECT * INTO v_batch FROM public.rec_migration_batches WHERE id = p_batch_id;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'batch not found'; END IF;

  SELECT jsonb_agg(x ORDER BY x->>'file_name')
    INTO v_files
    FROM (
      SELECT jsonb_build_object(
               'file_id', f.id,
               'file_name', f.original_file_name,
               'storage_path', f.storage_path,
               'doc_type', f.doc_type,
               'size_bytes', f.size_bytes,
               'status', f.status,
               'attempts', f.attempts,
               'parse_error', f.parse_error,
               'text_extracted', f.extracted_text IS NOT NULL,
               'linked_record_id', rf.record_id,
               'candidate_name', c.full_name,
               'created_at', f.created_at
             ) AS x
        FROM public.rec_migration_files f
        LEFT JOIN public.rec_migration_record_files rf ON rf.file_id = f.id
        LEFT JOIN public.rec_migration_records r ON r.id = rf.record_id
        LEFT JOIN public.rec_candidates c ON c.id = r.candidate_id
       WHERE f.batch_id = p_batch_id
    ) s;

  SELECT jsonb_build_object(
           'total', count(*),
           'by_state', COALESCE(jsonb_object_agg(state, n), '{}'::jsonb)
         )
    INTO v_records
    FROM (
      SELECT state, count(*) AS n, count(*) OVER () AS ignore
        FROM public.rec_migration_records WHERE batch_id = p_batch_id GROUP BY state
    ) t;

  SELECT jsonb_build_object(
           'applications', count(a.id),
           'evaluated', count(e.id),
           'pending', count(a.id) - count(e.id),
           'eligible', count(*) FILTER (WHERE e.eligibility = 'eligible'),
           'requires_review', count(*) FILTER (WHERE e.eligibility = 'requires_review'),
           'not_eligible', count(*) FILTER (WHERE e.eligibility = 'not_eligible'),
           'avg_score', round(avg(e.weighted_score), 2),
           'adjudications', (
             SELECT count(*) FROM public.rec_evidence_adjudications ad
              JOIN public.rec_applications a2 ON a2.id = ad.application_id
             WHERE a2.migration_batch_id = p_batch_id
           )
         )
    INTO v_screening
    FROM public.rec_applications a
    LEFT JOIN public.rec_application_evaluations e
           ON e.application_id = a.id AND e.is_current
   WHERE a.migration_batch_id = p_batch_id;

  RETURN jsonb_build_object(
    'batch', jsonb_build_object(
      'id', v_batch.id, 'batch_no', v_batch.batch_no, 'name', v_batch.name,
      'status', v_batch.status, 'started_at', v_batch.started_at,
      'completed_at', v_batch.completed_at, 'totals', v_batch.totals
    ),
    'files', COALESCE(v_files, '[]'::jsonb),
    'file_counts', (
      SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
        FROM (SELECT status, count(*) n FROM public.rec_migration_files
               WHERE batch_id = p_batch_id GROUP BY status) q
    ),
    'records', COALESCE(v_records, jsonb_build_object('total', 0, 'by_state', '{}'::jsonb)),
    'screening', COALESCE(v_screening, '{}'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_migration_batch_progress(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_migration_batch_progress(uuid) TO authenticated;

-- Ranked screening report with evidence citations and human decisions.
CREATE OR REPLACE FUNCTION public.rec_screening_report(
  p_vacancy_id uuid,
  p_batch_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_vac record;
  v_rows jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not authorized to read screening results';
  END IF;
  SELECT * INTO v_vac FROM public.rec_vacancies WHERE id = p_vacancy_id;
  IF v_vac IS NULL THEN RAISE EXCEPTION 'vacancy not found'; END IF;

  SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.rank)
    INTO v_rows
    FROM (
      SELECT
        row_number() OVER (ORDER BY COALESCE(e.weighted_score, a.ai_match_score, 0) DESC,
                                    a.applied_at ASC) AS rank,
        a.id AS application_id,
        a.application_no,
        c.full_name,
        c.email,
        c.phone,
        c.location,
        c.years_experience,
        COALESCE(e.weighted_score, a.ai_match_score) AS score,
        e.eligibility,
        e.recommendation,
        e.confidence AS evidence_confidence,
        e.gate_failures,
        e.missing_evidence,
        a.stage,
        a.status,
        a.rejection_reason,
        d.decision AS human_decision,
        d.reason_code AS human_decision_reason,
        d.decided_at AS human_decided_at,
        (SELECT count(*) FROM public.rec_evidence_adjudications ad WHERE ad.application_id = a.id)
          AS adjudications,
        (SELECT string_agg(
                  format('%s: %s [%s%s, conf %s]', f.attribute,
                         COALESCE(f.value_text, f.value_numeric::text),
                         f.source_ref, COALESCE(' · ' || f.source_locator, ''),
                         round(f.confidence, 2)),
                  E'\n' ORDER BY f.confidence DESC)
           FROM public.rec_evidence_facts f
          WHERE f.application_id = a.id AND f.superseded_at IS NULL) AS evidence_citations
      FROM public.rec_applications a
      JOIN public.rec_candidates c ON c.id = a.candidate_id
      LEFT JOIN public.rec_application_evaluations e
             ON e.application_id = a.id AND e.is_current
      LEFT JOIN LATERAL (
        SELECT sd.decision, sd.reason_code, sd.decided_at
          FROM public.rec_selection_decisions sd
         WHERE sd.application_id = a.id
         ORDER BY sd.decided_at DESC LIMIT 1
      ) d ON true
     WHERE a.vacancy_id = p_vacancy_id
       AND (p_batch_id IS NULL OR a.migration_batch_id = p_batch_id)
    ) t;

  RETURN jsonb_build_object(
    'vacancy', jsonb_build_object('id', v_vac.id, 'title', v_vac.title, 'location', v_vac.location),
    'generated_at', now(),
    'batch_id', p_batch_id,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_screening_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_screening_report(uuid, uuid) TO authenticated;