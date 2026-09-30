CREATE OR REPLACE FUNCTION public.rec_requirement_lifecycle_action(p_set uuid, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  s public.rec_document_requirement_sets;
  v_actor uuid := auth.uid();
  v_compile jsonb;
  v_prev uuid;
  v_after text;
  v_sole boolean := false;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO s FROM public.rec_document_requirement_sets WHERE id = p_set;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Requirement version not found.'; END IF;

  -- Startup governance: a platform admin holds sole approval authority and may
  -- approve/publish a version they created. Recorded explicitly in the audit trail.
  v_sole := public.has_role(v_actor, 'admin'::app_role)
         OR public.has_role(v_actor, 'super_admin'::app_role);

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
    IF NOT v_sole AND s.created_by IS NOT NULL AND s.created_by = v_actor THEN
      RAISE EXCEPTION 'Four-eyes control: the person who created this version cannot approve it. An admin holds sole-approver authority.';
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
    IF NOT v_sole AND s.created_by IS NOT NULL AND s.created_by = v_actor THEN
      RAISE EXCEPTION 'Four-eyes control: the person who created this version cannot publish it. An admin holds sole-approver authority.';
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
    coalesce(v_compile, '{}'::jsonb)
    || jsonb_build_object(
         'sole_approver', (v_sole AND s.created_by IS NOT NULL AND s.created_by = v_actor
                           AND p_action IN ('approve','publish')),
         'approval_model', CASE WHEN v_sole THEN 'admin_sole_approver' ELSE 'four_eyes' END));
  RETURN jsonb_build_object('set_id', p_set, 'status', v_after, 'compile', v_compile,
    'approval_model', CASE WHEN v_sole THEN 'admin_sole_approver' ELSE 'four_eyes' END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.rec_requirement_lifecycle_action(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_requirement_lifecycle_action(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_requirement_lifecycle_action(uuid, text, text) TO service_role;