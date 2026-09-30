-- Recruitment 360 — import audit trail, idempotency & adjudication spine

CREATE TABLE public.rec_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_no text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'document_seed' CHECK (kind IN ('document_seed','candidate_import','evaluation_seed','cv_enrichment')),
  label text NOT NULL,
  initiated_by uuid,
  initiated_by_label text NOT NULL DEFAULT 'Recruitment Operations',
  source_description text,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('running','completed','completed_with_conflicts','failed')),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_import_runs TO authenticated;
GRANT ALL ON public.rec_import_runs TO service_role;
ALTER TABLE public.rec_import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read import runs" ON public.rec_import_runs FOR SELECT USING (rec_can_read());
CREATE POLICY "rec staff insert import runs" ON public.rec_import_runs FOR INSERT WITH CHECK (rec_can_write());
CREATE POLICY "rec staff update import runs" ON public.rec_import_runs FOR UPDATE USING (rec_can_write());
CREATE POLICY "rec admin delete import runs" ON public.rec_import_runs FOR DELETE USING (is_platform_admin());

CREATE TABLE public.rec_import_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.rec_import_runs(id) ON DELETE CASCADE,
  item_no text NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('invitation_letter','evaluation_form','cv','cover_letter','candidate','application','interview','profile_enrichment')),
  extracted_name text,
  extracted_id_number text,
  extracted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_outcome text NOT NULL CHECK (match_outcome IN ('created','updated','matched','skipped','conflict','ambiguous')),
  match_confidence numeric,
  matched_candidate_id uuid REFERENCES public.rec_candidates(id) ON DELETE SET NULL,
  matched_application_id uuid REFERENCES public.rec_applications(id) ON DELETE SET NULL,
  target_table text,
  target_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, item_no, item_kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_import_run_items TO authenticated;
GRANT ALL ON public.rec_import_run_items TO service_role;
ALTER TABLE public.rec_import_run_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read import items" ON public.rec_import_run_items FOR SELECT USING (rec_can_read());
CREATE POLICY "rec staff insert import items" ON public.rec_import_run_items FOR INSERT WITH CHECK (rec_can_write());
CREATE POLICY "rec staff update import items" ON public.rec_import_run_items FOR UPDATE USING (rec_can_write());
CREATE POLICY "rec admin delete import items" ON public.rec_import_run_items FOR DELETE USING (is_platform_admin());
CREATE INDEX rec_import_run_items_run_idx ON public.rec_import_run_items (run_id, match_outcome);

CREATE TABLE public.rec_conflict_adjudications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.rec_candidates(id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT 'evaluation_conflict',
  conflict_summary text NOT NULL,
  evaluation_ids uuid[] NOT NULL DEFAULT '{}',
  ai_recommendation text,
  ai_rationale text,
  ai_model text,
  ai_confidence numeric,
  ai_generated_at timestamptz,
  hr_decision text CHECK (hr_decision IN ('uphold_advance','uphold_reject','blend_scores','re_interview','request_evidence')),
  hr_rationale text,
  decided_by uuid,
  decided_by_label text,
  decided_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ai_recommended','decided')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_conflict_adjudications TO authenticated;
GRANT ALL ON public.rec_conflict_adjudications TO service_role;
ALTER TABLE public.rec_conflict_adjudications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read adjudications" ON public.rec_conflict_adjudications FOR SELECT USING (rec_can_read());
CREATE POLICY "rec staff insert adjudications" ON public.rec_conflict_adjudications FOR INSERT WITH CHECK (rec_can_write());
CREATE POLICY "rec staff update adjudications" ON public.rec_conflict_adjudications FOR UPDATE USING (rec_can_write());
CREATE POLICY "rec admin delete adjudications" ON public.rec_conflict_adjudications FOR DELETE USING (is_platform_admin());

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.rec_import_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_rec_import_runs_touch BEFORE UPDATE ON public.rec_import_runs FOR EACH ROW EXECUTE FUNCTION public.rec_import_touch_updated_at();
CREATE TRIGGER trg_rec_conflict_adjudications_touch BEFORE UPDATE ON public.rec_conflict_adjudications FOR EACH ROW EXECUTE FUNCTION public.rec_import_touch_updated_at();

-- Evaluation completeness — flags letters-without-evaluation before final scoring
CREATE OR REPLACE VIEW public.rec_evaluation_completeness
WITH (security_invoker = true) AS
SELECT
  a.id AS application_id,
  a.vacancy_id,
  c.id AS candidate_id,
  c.full_name AS candidate_name,
  a.stage,
  a.status AS application_status,
  (SELECT count(*) FROM public.rec_comm_requests r
    WHERE r.application_id = a.id AND r.comm_type = 'interview_invitation') AS invitation_letters,
  (SELECT count(*) FROM public.rec_interviews i
    WHERE i.application_id = a.id) AS interviews_total,
  (SELECT count(*) FROM public.rec_interviews i
    WHERE i.application_id = a.id AND i.status = 'completed') AS interviews_completed,
  (SELECT count(*) FROM public.rec_evaluations e
    WHERE e.application_id = a.id AND e.status = 'submitted') AS evaluations_submitted,
  (SELECT count(*) FROM public.rec_interviews i
    WHERE i.application_id = a.id AND i.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM public.rec_evaluations e
        WHERE e.interview_id = i.id AND e.status = 'submitted')) AS interviews_missing_evaluation,
  (SELECT count(*) FROM public.rec_conflict_adjudications ca
    WHERE ca.application_id = a.id AND ca.status <> 'decided') AS open_conflicts
FROM public.rec_applications a
JOIN public.rec_candidates c ON c.id = a.candidate_id;
GRANT SELECT ON public.rec_evaluation_completeness TO authenticated;

-- Idempotency report — what a run created, updated, skipped and conflicted
CREATE OR REPLACE FUNCTION public.rec_import_idempotency_report(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT rec_can_read() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT jsonb_build_object(
    'run', to_jsonb(r),
    'summary', jsonb_build_object(
      'created', count(i.id) FILTER (WHERE i.match_outcome = 'created'),
      'updated', count(i.id) FILTER (WHERE i.match_outcome = 'updated'),
      'matched', count(i.id) FILTER (WHERE i.match_outcome = 'matched'),
      'skipped', count(i.id) FILTER (WHERE i.match_outcome = 'skipped'),
      'conflicts', count(i.id) FILTER (WHERE i.match_outcome = 'conflict'),
      'ambiguous', count(i.id) FILTER (WHERE i.match_outcome = 'ambiguous')
    ),
    'by_kind', coalesce((
      SELECT jsonb_object_agg(item_kind, cnt) FROM (
        SELECT item_kind, count(*) AS cnt FROM public.rec_import_run_items
        WHERE run_id = r.id GROUP BY item_kind
      ) k
    ), '{}'::jsonb),
    'items', coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb),
    'constraint_conflicts', coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.created_at) FILTER (WHERE i.match_outcome IN ('conflict','ambiguous')), '[]'::jsonb)
  ) INTO result
  FROM public.rec_import_runs r
  LEFT JOIN public.rec_import_run_items i ON i.run_id = r.id
  WHERE r.id = p_run_id
  GROUP BY r.id;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rec_import_idempotency_report(uuid) TO authenticated;

-- Record the human HR decision on a conflict (append-only decision fields)
CREATE OR REPLACE FUNCTION public.rec_adjudication_decide(
  p_id uuid,
  p_decision text,
  p_rationale text,
  p_decided_by_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT rec_can_write() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_decision NOT IN ('uphold_advance','uphold_reject','blend_scores','re_interview','request_evidence') THEN
    RAISE EXCEPTION 'invalid_decision';
  END IF;
  UPDATE public.rec_conflict_adjudications
  SET hr_decision = p_decision,
      hr_rationale = p_rationale,
      decided_by = auth.uid(),
      decided_by_label = coalesce(p_decided_by_label, decided_by_label),
      decided_at = now(),
      status = 'decided'
  WHERE id = p_id AND status <> 'decided';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjudication_not_open';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rec_adjudication_decide(uuid, text, text, text) TO authenticated;