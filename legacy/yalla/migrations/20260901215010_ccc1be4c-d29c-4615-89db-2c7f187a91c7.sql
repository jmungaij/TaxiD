CREATE OR REPLACE FUNCTION public.rec_requirement_lifecycle_withdraw(p_set uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s record; v_actor uuid := auth.uid();
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.write') THEN
    RAISE EXCEPTION 'Not authorised to change requirement versions.';
  END IF;

  SELECT * INTO s FROM public.rec_document_requirement_sets WHERE id = p_set;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Requirement version not found.'; END IF;
  IF s.status NOT IN ('review','approved') THEN
    RAISE EXCEPTION 'Only a version awaiting review or publication can be withdrawn.';
  END IF;

  UPDATE public.rec_document_requirement_sets
     SET status = 'draft',
         reviewed_by = NULL, reviewed_at = NULL,
         approved_by = NULL, approved_at = NULL,
         updated_at = now()
   WHERE id = p_set;

  PERFORM public._rec_requirement_log(p_set, 'withdrawn', s.status, 'draft', p_note,
    jsonb_build_object('withdrawn_by', v_actor));

  RETURN jsonb_build_object('set_id', p_set, 'status', 'draft');
END; $$;

REVOKE ALL ON FUNCTION public.rec_requirement_lifecycle_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_requirement_lifecycle_withdraw(uuid, text) TO authenticated;