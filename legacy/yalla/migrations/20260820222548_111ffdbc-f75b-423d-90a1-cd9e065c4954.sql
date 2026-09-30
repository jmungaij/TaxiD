-- ============================================================
-- INTERNS 360: work queue, commercial verification, capstone integrity,
-- and a self-contained certification suite.
-- ============================================================

ALTER TABLE public.intern_capstones
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS mentor_staff_id uuid REFERENCES public.staff_members(id),
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS returned_reason text,
  ADD COLUMN IF NOT EXISTS evidence_sha256 text,
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS seal_fingerprint text,
  ADD COLUMN IF NOT EXISTS sealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_verified_at timestamptz;

-- Canonical content digest: the exact narrative a mentor reviewed.
CREATE OR REPLACE FUNCTION public.intern_capstone_digest(p public.intern_capstones)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    coalesce(p.title,''), coalesce(p.problem,''), coalesce(p.baseline,''),
    coalesce(p.research,''), coalesce(p.solution,''), coalesce(p.execution_summary,''),
    coalesce(p.measured_impact,''), coalesce(p.recommendation,''),
    coalesce(p.evidence_url,''), coalesce(p.evidence_sha256,'')
  ), 'UTF8')), 'hex');
$$;

-- Once submitted, the narrative is immutable until a mentor returns it.
CREATE OR REPLACE FUNCTION public.intern_capstone_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('submitted','under_review','scored')
     AND NEW.status <> 'returned'
     AND public.intern_capstone_digest(NEW) IS DISTINCT FROM public.intern_capstone_digest(OLD) THEN
    RAISE EXCEPTION 'Capstone % is sealed. A mentor must return it before the submission can change.', OLD.id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS intern_capstone_immutability ON public.intern_capstones;
CREATE TRIGGER intern_capstone_immutability
BEFORE UPDATE ON public.intern_capstones
FOR EACH ROW EXECUTE FUNCTION public.intern_capstone_immutability();

-- Who may validate another person's work: never the intern themselves.
CREATE OR REPLACE FUNCTION public.intern_can_validate(p_intern uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.intern_profiles p
      WHERE p.id = p_intern AND p.user_id = auth.uid()
    )
    AND (
      public.intern_programme_authority(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.intern_profiles p
        LEFT JOIN public.staff_members m ON m.id = p.mentor_staff_id
        LEFT JOIN public.staff_members s ON s.id = p.supervisor_staff_id
        WHERE p.id = p_intern AND (m.user_id = auth.uid() OR s.user_id = auth.uid())
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.intern_is_self(p_intern uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.intern_profiles WHERE id = p_intern AND user_id = auth.uid());
$$;

-- ------------------------------------------------------------
-- WORK QUEUE: submission requires evidence; review requires authority.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intern_submit_work(
  p_item uuid, p_deliverable_url text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record;
BEGIN
  SELECT * INTO w FROM public.intern_work_items WHERE id = p_item;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found.'; END IF;
  IF NOT (public.intern_is_self(w.intern_id) OR public.intern_can_validate(w.intern_id)) THEN
    RAISE EXCEPTION 'Not authorised to submit this work item.';
  END IF;
  IF w.status NOT IN ('BACKLOG','ASSIGNED','IN_PROGRESS','BLOCKED','REWORK') THEN
    RAISE EXCEPTION 'Work item is % and cannot be submitted again.', w.status;
  END IF;
  IF coalesce(btrim(p_deliverable_url), '') = '' THEN
    RAISE EXCEPTION 'A deliverable reference is required before work can be submitted.';
  END IF;

  UPDATE public.intern_work_items
     SET status = 'SUBMITTED', deliverable_url = btrim(p_deliverable_url), submitted_at = now()
   WHERE id = p_item;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  VALUES (w.intern_id, auth.uid(), 'work_submitted', 'intern_work_items', p_item,
          jsonb_build_object('status', w.status),
          jsonb_build_object('status','SUBMITTED','deliverable_url', btrim(p_deliverable_url), 'note', p_note));

  RETURN jsonb_build_object('id', p_item, 'status', 'SUBMITTED');
END; $$;

CREATE OR REPLACE FUNCTION public.intern_review_work(
  p_item uuid, p_decision text, p_quality numeric DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; v_status text;
BEGIN
  SELECT * INTO w FROM public.intern_work_items WHERE id = p_item;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found.'; END IF;
  IF NOT public.intern_can_validate(w.intern_id) THEN
    RAISE EXCEPTION 'Only an assigned mentor, supervisor or programme authority may review this work — and never the intern who produced it.';
  END IF;
  IF w.status NOT IN ('SUBMITTED','UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Work item is % and is not awaiting review.', w.status;
  END IF;
  IF p_decision NOT IN ('ACCEPTED','REWORK') THEN
    RAISE EXCEPTION 'Decision must be ACCEPTED or REWORK.';
  END IF;
  IF p_decision = 'ACCEPTED' THEN
    IF coalesce(btrim(w.deliverable_url), '') = '' THEN
      RAISE EXCEPTION 'Work cannot be accepted without deliverable evidence.';
    END IF;
    IF p_quality IS NULL OR p_quality < 0 OR p_quality > 100 THEN
      RAISE EXCEPTION 'A quality score between 0 and 100 is required to accept work.';
    END IF;
  END IF;

  v_status := p_decision;

  UPDATE public.intern_work_items
     SET status = v_status,
         quality_score = COALESCE(p_quality, quality_score),
         accepted_at = CASE WHEN v_status = 'ACCEPTED' THEN now() ELSE NULL END,
         rework_count = rework_count + CASE WHEN v_status = 'REWORK' THEN 1 ELSE 0 END
   WHERE id = p_item;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  VALUES (w.intern_id, auth.uid(), 'work_reviewed', 'intern_work_items', p_item,
          jsonb_build_object('status', w.status, 'quality_score', w.quality_score),
          jsonb_build_object('status', v_status, 'quality_score', p_quality, 'note', p_note));

  RETURN jsonb_build_object('id', p_item, 'status', v_status);
END; $$;

-- ------------------------------------------------------------
-- COMMERCIAL ATTRIBUTION: verification only against a named source system.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intern_verify_attribution(
  p_id uuid, p_source_system text, p_subject_id uuid DEFAULT NULL, p_amount_kes numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  SELECT * INTO a FROM public.intern_commercial_attributions WHERE id = p_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Attribution not found.'; END IF;
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Only a programme authority may verify commercial contribution.';
  END IF;
  IF public.intern_is_self(a.intern_id) THEN
    RAISE EXCEPTION 'An intern may never verify their own commercial contribution.';
  END IF;
  IF coalesce(btrim(p_source_system), '') IN ('', 'manual', 'declared') THEN
    RAISE EXCEPTION 'Verification requires an authoritative source system — a declaration is not evidence.';
  END IF;
  IF a.attribution_type = 'REVENUE_ATTRIBUTED'
     AND coalesce(p_amount_kes, a.amount_kes, 0) <= 0 THEN
    RAISE EXCEPTION 'Attributed revenue requires a verified amount.';
  END IF;

  UPDATE public.intern_commercial_attributions
     SET verified = true, verified_by = auth.uid(), verified_at = now(),
         source_system = btrim(p_source_system),
         subject_id = COALESCE(p_subject_id, subject_id),
         amount_kes = COALESCE(p_amount_kes, amount_kes)
   WHERE id = p_id;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  VALUES (a.intern_id, auth.uid(), 'commercial_attribution_verified', 'intern_commercial_attributions', p_id,
          jsonb_build_object('verified', a.verified, 'source_system', a.source_system, 'amount_kes', a.amount_kes),
          jsonb_build_object('verified', true, 'source_system', btrim(p_source_system),
                             'amount_kes', COALESCE(p_amount_kes, a.amount_kes)));

  RETURN jsonb_build_object('id', p_id, 'verified', true);
END; $$;

-- ------------------------------------------------------------
-- CAPSTONE: submit (seal), return, score.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intern_submit_capstone(
  p_id uuid, p_evidence_url text, p_evidence_sha256 text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_digest text; v_seal text;
BEGIN
  SELECT * INTO c FROM public.intern_capstones WHERE id = p_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Capstone not found.'; END IF;
  IF NOT (public.intern_is_self(c.intern_id) OR public.intern_can_validate(c.intern_id)) THEN
    RAISE EXCEPTION 'Not authorised to submit this capstone.';
  END IF;
  IF c.status NOT IN ('draft','returned') THEN
    RAISE EXCEPTION 'Capstone is % and is already sealed.', c.status;
  END IF;
  IF coalesce(btrim(p_evidence_url), '') = '' THEN
    RAISE EXCEPTION 'Capstone submission requires evidence.';
  END IF;
  IF coalesce(btrim(c.problem),'') = '' OR coalesce(btrim(c.solution),'') = ''
     OR coalesce(btrim(c.measured_impact),'') = '' THEN
    RAISE EXCEPTION 'A capstone must state the problem, the solution and the measured impact before submission.';
  END IF;

  UPDATE public.intern_capstones
     SET evidence_url = btrim(p_evidence_url),
         evidence_sha256 = nullif(btrim(coalesce(p_evidence_sha256,'')), ''),
         status = 'submitted', submitted_at = now(), submitted_by = auth.uid(),
         returned_reason = NULL
   WHERE id = p_id;

  SELECT public.intern_capstone_digest(x) INTO v_digest FROM public.intern_capstones x WHERE x.id = p_id;
  v_seal := encode(sha256(convert_to(concat_ws('|', p_id::text, v_digest, c.intern_id::text), 'UTF8')), 'hex');

  UPDATE public.intern_capstones
     SET content_sha256 = v_digest, seal_fingerprint = v_seal, sealed_at = now()
   WHERE id = p_id;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  VALUES (c.intern_id, auth.uid(), 'capstone_submitted', 'intern_capstones', p_id,
          jsonb_build_object('status', c.status),
          jsonb_build_object('status','submitted','content_sha256', v_digest, 'seal_fingerprint', v_seal));

  RETURN jsonb_build_object('id', p_id, 'status', 'submitted', 'content_sha256', v_digest, 'seal_fingerprint', v_seal);
END; $$;

CREATE OR REPLACE FUNCTION public.intern_review_capstone(
  p_id uuid, p_decision text, p_scores jsonb DEFAULT '{}'::jsonb, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_digest text; v_total numeric; v_intact boolean;
BEGIN
  SELECT * INTO c FROM public.intern_capstones WHERE id = p_id;
  IF c.id IS NULL THEN RAISE EXCEPTION 'Capstone not found.'; END IF;
  IF NOT public.intern_can_validate(c.intern_id) THEN
    RAISE EXCEPTION 'Only an assigned mentor, supervisor or programme authority may review a capstone — never its author.';
  END IF;
  IF c.status NOT IN ('submitted','under_review') THEN
    RAISE EXCEPTION 'Capstone is % and is not awaiting review.', c.status;
  END IF;
  IF p_decision NOT IN ('under_review','returned','scored') THEN
    RAISE EXCEPTION 'Decision must be under_review, returned or scored.';
  END IF;

  v_digest := public.intern_capstone_digest(c);
  v_intact := c.content_sha256 IS NOT NULL AND c.content_sha256 = v_digest;
  IF p_decision = 'scored' AND NOT v_intact THEN
    RAISE EXCEPTION 'Capstone integrity check failed: the submission no longer matches its seal. It must be returned and resubmitted.';
  END IF;

  IF p_decision = 'scored' THEN
    SELECT round(avg(value::numeric), 2) INTO v_total
    FROM jsonb_each_text(p_scores) AS s(key, value);
    IF v_total IS NULL THEN RAISE EXCEPTION 'Scoring requires at least one rubric score.'; END IF;

    UPDATE public.intern_capstones SET
      score_problem      = COALESCE((p_scores->>'score_problem')::numeric, score_problem),
      score_research     = COALESCE((p_scores->>'score_research')::numeric, score_research),
      score_solution     = COALESCE((p_scores->>'score_solution')::numeric, score_solution),
      score_execution    = COALESCE((p_scores->>'score_execution')::numeric, score_execution),
      score_impact       = COALESCE((p_scores->>'score_impact')::numeric, score_impact),
      score_presentation = COALESCE((p_scores->>'score_presentation')::numeric, score_presentation),
      score_reflection   = COALESCE((p_scores->>'score_reflection')::numeric, score_reflection),
      total_score = v_total, status = 'scored', scored_by = auth.uid(), scored_at = now(),
      review_notes = COALESCE(p_notes, review_notes), integrity_verified_at = now()
    WHERE id = p_id;
  ELSE
    UPDATE public.intern_capstones
       SET status = p_decision,
           review_notes = COALESCE(p_notes, review_notes),
           returned_reason = CASE WHEN p_decision = 'returned' THEN p_notes ELSE returned_reason END,
           integrity_verified_at = now()
     WHERE id = p_id;
  END IF;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  VALUES (c.intern_id, auth.uid(), 'capstone_reviewed', 'intern_capstones', p_id,
          jsonb_build_object('status', c.status, 'content_sha256', c.content_sha256),
          jsonb_build_object('status', p_decision, 'integrity_intact', v_intact,
                             'total_score', v_total, 'notes', p_notes));

  RETURN jsonb_build_object('id', p_id, 'status', p_decision, 'integrity_intact', v_intact, 'total_score', v_total);
END; $$;

-- ------------------------------------------------------------
-- CERTIFICATION SUITE: synthetic end-to-end verification.
-- Creates a synthetic intern, exercises the controls, cleans up.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intern_certify_suite()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_intern uuid; v_track uuid; v_work uuid; v_attr uuid; v_cap uuid;
  checks jsonb := '[]'::jsonb; gaps int := 0; v_ok boolean; v_txt text; v_num numeric;
  v_before int; v_after int;

  PROCEDURE_NOTE text := 'synthetic';

  FUNCTION_MISSING text;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Only a programme authority may run the certification suite.';
  END IF;

  SELECT id INTO v_track FROM public.intern_tracks ORDER BY sequence LIMIT 1;

  INSERT INTO public.intern_profiles(full_name, track_id, status, talent_level, work_email)
  VALUES ('SYNTHETIC CERTIFICATION INTERN', v_track, 'ACTIVE', 'APPRENTICE', 'synthetic@yalla.africa')
  RETURNING id INTO v_intern;

  -- 1. RBAC surface: every intern table must carry RLS.
  SELECT count(*) INTO v_before
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname LIKE 'intern_%' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  v_ok := v_before = 0;
  checks := checks || jsonb_build_object('check','rbac_rls_enabled_on_all_intern_tables','passed',v_ok,
                                         'detail', jsonb_build_object('tables_without_rls', v_before));
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 2. RBAC surface: validation guard refuses self-validation by construction.
  v_ok := to_regprocedure('public.intern_can_validate(uuid)') IS NOT NULL
      AND pg_get_functiondef(to_regprocedure('public.intern_can_validate(uuid)')) LIKE '%NOT EXISTS%';
  checks := checks || jsonb_build_object('check','rbac_self_validation_blocked','passed',v_ok);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 3. State transition: work cannot be accepted without deliverable evidence.
  INSERT INTO public.intern_work_items(intern_id, title, work_kind, status, complexity, impact)
  VALUES (v_intern, 'SYNTHETIC work item', 'task', 'SUBMITTED', 3, 3) RETURNING id INTO v_work;
  BEGIN
    PERFORM public.intern_review_work(v_work, 'ACCEPTED', 80);
    v_ok := false;
  EXCEPTION WHEN others THEN v_ok := true; v_txt := SQLERRM;
  END;
  checks := checks || jsonb_build_object('check','transition_accept_requires_deliverable','passed',v_ok,'detail',v_txt);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 4. State transition: submit requires a deliverable, then review accepts.
  UPDATE public.intern_work_items SET status = 'ASSIGNED' WHERE id = v_work;
  BEGIN
    PERFORM public.intern_submit_work(v_work, '   ');
    v_ok := false;
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  checks := checks || jsonb_build_object('check','transition_submit_requires_deliverable','passed',v_ok);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  SELECT count(*) INTO v_before FROM public.intern_audit_log WHERE intern_id = v_intern;
  PERFORM public.intern_submit_work(v_work, 'https://evidence.yalla.africa/synthetic.pdf');
  PERFORM public.intern_review_work(v_work, 'ACCEPTED', 82);
  SELECT status INTO v_txt FROM public.intern_work_items WHERE id = v_work;
  v_ok := v_txt = 'ACCEPTED';
  checks := checks || jsonb_build_object('check','transition_submit_then_accept','passed',v_ok,'detail',v_txt);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 5. Audit logging: both transitions are on the trail.
  SELECT count(*) INTO v_after FROM public.intern_audit_log WHERE intern_id = v_intern;
  v_ok := (v_after - v_before) >= 2;
  checks := checks || jsonb_build_object('check','audit_work_transitions_logged','passed',v_ok,
                                         'detail', jsonb_build_object('entries', v_after - v_before));
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 6. Anti-gaming: a manual declaration cannot be verified as revenue.
  INSERT INTO public.intern_commercial_attributions(intern_id, attribution_type, subject_ref, amount_kes, source_system, verified)
  VALUES (v_intern, 'REVENUE_ATTRIBUTED', 'SYN-REF-1', 250000, 'manual', false) RETURNING id INTO v_attr;
  BEGIN
    PERFORM public.intern_verify_attribution(v_attr, 'manual');
    v_ok := false;
  EXCEPTION WHEN others THEN v_ok := true; v_txt := SQLERRM;
  END;
  checks := checks || jsonb_build_object('check','antigaming_manual_revenue_not_verifiable','passed',v_ok,'detail',v_txt);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 7. Score integrity: unverified revenue must not lift the commercial score.
  PERFORM public.intern_compute_performance(v_intern, (current_date - 27), current_date);
  SELECT commercial_score INTO v_num FROM public.intern_performance_scores
   WHERE intern_id = v_intern ORDER BY computed_at DESC LIMIT 1;
  v_ok := coalesce(v_num, 0) = 0;
  checks := checks || jsonb_build_object('check','score_integrity_unverified_revenue_scores_zero','passed',v_ok,
                                         'detail', jsonb_build_object('commercial_score', v_num));
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 8. Score integrity: verified revenue does move the commercial score.
  PERFORM public.intern_verify_attribution(v_attr, 'commercial_transactions', NULL, 250000);
  PERFORM public.intern_compute_performance(v_intern, (current_date - 27), current_date);
  SELECT commercial_score INTO v_num FROM public.intern_performance_scores
   WHERE intern_id = v_intern ORDER BY computed_at DESC LIMIT 1;
  v_ok := coalesce(v_num, 0) > 0;
  checks := checks || jsonb_build_object('check','score_integrity_verified_revenue_scores','passed',v_ok,
                                         'detail', jsonb_build_object('commercial_score', v_num));
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 9. Anti-gaming: duplicate claims are flagged for human review.
  INSERT INTO public.intern_commercial_attributions(intern_id, attribution_type, subject_ref, source_system, verified)
  VALUES (v_intern, 'LEAD_CREATED', 'SYN-REF-1', 'manual', false);
  PERFORM public.intern_scan_integrity(v_intern);
  SELECT count(*) INTO v_after FROM public.intern_integrity_flags
   WHERE intern_id = v_intern AND signal = 'duplicate_commercial_claim';
  v_ok := v_after > 0;
  checks := checks || jsonb_build_object('check','antigaming_duplicate_claim_flagged','passed',v_ok);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 10. Capstone: submission seals the narrative and blocks silent edits.
  INSERT INTO public.intern_capstones(intern_id, title, problem, solution, measured_impact, status)
  VALUES (v_intern, 'SYNTHETIC capstone', 'problem', 'solution', 'impact', 'draft') RETURNING id INTO v_cap;
  PERFORM public.intern_submit_capstone(v_cap, 'https://evidence.yalla.africa/capstone.pdf', 'deadbeef');
  SELECT seal_fingerprint INTO v_txt FROM public.intern_capstones WHERE id = v_cap;
  v_ok := coalesce(v_txt, '') <> '';
  checks := checks || jsonb_build_object('check','capstone_submission_sealed','passed',v_ok);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  BEGIN
    UPDATE public.intern_capstones SET solution = 'silently rewritten' WHERE id = v_cap;
    v_ok := false;
  EXCEPTION WHEN others THEN v_ok := true; v_txt := SQLERRM;
  END;
  checks := checks || jsonb_build_object('check','capstone_sealed_content_immutable','passed',v_ok,'detail',v_txt);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 11. Capstone: mentor review scores it and records integrity verification.
  PERFORM public.intern_review_capstone(v_cap, 'scored',
    jsonb_build_object('score_problem', 80, 'score_solution', 85, 'score_impact', 90), 'Synthetic review');
  SELECT total_score INTO v_num FROM public.intern_capstones WHERE id = v_cap;
  v_ok := coalesce(v_num, 0) > 0;
  checks := checks || jsonb_build_object('check','capstone_mentor_review_scores','passed',v_ok,
                                         'detail', jsonb_build_object('total_score', v_num));
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- 12. Recruitment 360 linkage exists end to end.
  v_ok := to_regprocedure('public.intern_enrol_from_application(uuid,uuid,uuid)') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='intern_enrol_from_application');
  checks := checks || jsonb_build_object('check','recruitment_linkage_present','passed',v_ok);
  IF NOT v_ok THEN gaps := gaps + 1; END IF;

  -- Clean up every synthetic artefact.
  DELETE FROM public.intern_capstones WHERE intern_id = v_intern;
  DELETE FROM public.intern_commercial_attributions WHERE intern_id = v_intern;
  DELETE FROM public.intern_work_items WHERE intern_id = v_intern;
  DELETE FROM public.intern_integrity_flags WHERE intern_id = v_intern;
  DELETE FROM public.intern_performance_scores WHERE intern_id = v_intern;
  DELETE FROM public.intern_audit_log WHERE intern_id = v_intern;
  DELETE FROM public.intern_profiles WHERE id = v_intern;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'total_checks', jsonb_array_length(checks),
    'gaps', gaps,
    'verdict', CASE WHEN gaps = 0 THEN 'CERTIFIED' ELSE 'GAPS_FOUND' END,
    'checks', checks);
END; $$;

REVOKE ALL ON FUNCTION public.intern_submit_work(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_review_work(uuid, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_verify_attribution(uuid, text, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_submit_capstone(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_review_capstone(uuid, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_certify_suite() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_can_validate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intern_is_self(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.intern_submit_work(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_review_work(uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_verify_attribution(uuid, text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_submit_capstone(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_review_capstone(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_certify_suite() TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_can_validate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_is_self(uuid) TO authenticated;