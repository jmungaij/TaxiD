-- 1. Widen the status vocabulary
ALTER TABLE public.proforma_invoices DROP CONSTRAINT IF EXISTS proforma_invoices_status_check;
ALTER TABLE public.proforma_invoices ADD CONSTRAINT proforma_invoices_status_check
  CHECK (status IN ('draft','pending_approval','approved','issued','sent','accepted','expired','void'));

ALTER TABLE public.proforma_invoices
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approval_note text,
  ADD COLUMN IF NOT EXISTS sole_approver boolean NOT NULL DEFAULT false;

-- 2. Approval authority
CREATE OR REPLACE FUNCTION public._proforma_can_approve()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.is_platform_admin()
      OR public.has_staff_permission('staff.commercial.approve')
      OR public.has_staff_permission('staff.commercial.write');
END $$;
REVOKE ALL ON FUNCTION public._proforma_can_approve() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._proforma_can_approve() TO authenticated;

-- 3. Readiness checks shared by submit and issue
CREATE OR REPLACE FUNCTION public._proforma_assert_complete(_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.proforma_invoices;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF COALESCE(TRIM(r.customer_company),'') = '' THEN RAISE EXCEPTION 'CUSTOMER_NAME_REQUIRED'; END IF;
  IF COALESCE(r.customer_email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'CUSTOMER_EMAIL_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proforma_invoice_lines WHERE proforma_id = _id) THEN
    RAISE EXCEPTION 'AT_LEAST_ONE_LINE_REQUIRED';
  END IF;
  IF r.total_cents <= 0 THEN RAISE EXCEPTION 'TOTAL_MUST_BE_GREATER_THAN_ZERO'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._proforma_assert_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._proforma_assert_complete(uuid) TO authenticated;

-- 4. Submit for approval
CREATE OR REPLACE FUNCTION public.proforma_submit(_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.proforma_invoices;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'ONLY_A_DRAFT_CAN_BE_SENT_FOR_REVIEW'; END IF;
  PERFORM public._proforma_assert_complete(_id);

  UPDATE public.proforma_invoices
     SET status = 'pending_approval', submitted_at = now(), submitted_by = auth.uid(),
         approved_at = NULL, approved_by = NULL, approval_note = NULL, sole_approver = false
   WHERE id = _id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, note)
    VALUES (_id, 'SENT_FOR_APPROVAL', 'draft', 'pending_approval', auth.uid(), NULLIF(TRIM(_note),''));

  RETURN public.proforma_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_submit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_submit(uuid, text) TO authenticated;

-- 5. Approve / send back
CREATE OR REPLACE FUNCTION public.proforma_decide(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.proforma_invoices; v_sole boolean := false;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_approve() THEN RAISE EXCEPTION 'NOT_AUTHORISED_TO_APPROVE'; END IF;
  IF r.status <> 'pending_approval' THEN RAISE EXCEPTION 'ONLY_A_PROFORMA_IN_REVIEW_CAN_BE_DECIDED'; END IF;

  IF _approve AND COALESCE(r.submitted_by, r.created_by) = auth.uid() THEN
    IF public.is_platform_admin() THEN
      v_sole := true;
    ELSE
      RAISE EXCEPTION 'FOUR_EYES_REQUIRED';
    END IF;
  END IF;

  IF NOT _approve AND COALESCE(TRIM(_note),'') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  IF _approve THEN
    PERFORM public._proforma_assert_complete(_id);
    UPDATE public.proforma_invoices
       SET status = 'approved', approved_at = now(), approved_by = auth.uid(),
           approval_note = NULLIF(TRIM(_note),''), sole_approver = v_sole
     WHERE id = _id;
    INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, note, detail)
      VALUES (_id, 'APPROVED', 'pending_approval', 'approved', auth.uid(), NULLIF(TRIM(_note),''),
              jsonb_build_object('sole_approver', v_sole));
  ELSE
    UPDATE public.proforma_invoices
       SET status = 'draft', submitted_at = NULL, submitted_by = NULL
     WHERE id = _id;
    INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, note)
      VALUES (_id, 'SENT_BACK', 'pending_approval', 'draft', auth.uid(), TRIM(_note));
  END IF;

  RETURN public.proforma_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_decide(uuid, boolean, text) TO authenticated;

-- 6. Issue: approval required, official YAL-PFI numbering
CREATE OR REPLACE FUNCTION public.proforma_issue(_id uuid, _valid_days integer DEFAULT 14)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.proforma_invoices; v_no text;
BEGIN
  SELECT * INTO r FROM public.proforma_invoices WHERE id = _id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'PROFORMA_NOT_FOUND'; END IF;
  IF NOT public._proforma_can_write(r.owner_staff_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF r.status = 'draft' THEN RAISE EXCEPTION 'MUST_BE_SENT_FOR_APPROVAL_FIRST'; END IF;
  IF r.status = 'pending_approval' THEN RAISE EXCEPTION 'APPROVAL_REQUIRED_BEFORE_ISSUE'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'ALREADY_ISSUED'; END IF;
  PERFORM public._proforma_assert_complete(_id);

  v_no := 'YAL-PFI-' || to_char(now(), 'YYYY') || '-'
          || lpad(nextval('public.proforma_no_seq')::text, 6, '0');

  UPDATE public.proforma_invoices
     SET status = 'issued', proforma_no = v_no, issued_at = now(),
         issue_date = COALESCE(issue_date, current_date),
         valid_until = COALESCE(valid_until, current_date + GREATEST(COALESCE(_valid_days,14),1))
   WHERE id = _id;

  INSERT INTO public.proforma_invoice_events (proforma_id, event, status_before, status_after, actor_id, detail)
    VALUES (_id, 'ISSUED', 'approved', 'issued', auth.uid(), jsonb_build_object('proforma_no', v_no));

  RETURN public.proforma_get(_id);
END $$;
REVOKE ALL ON FUNCTION public.proforma_issue(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_issue(uuid, integer) TO authenticated;

-- 7. Approval state is visible to the workspace
CREATE OR REPLACE FUNCTION public.proforma_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v jsonb; v_staff uuid := public._my_staff_member_id(); v_wide boolean;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin();
  IF NOT v_wide AND v_staff IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'can_create', public._proforma_can_write(v_staff),
    'can_approve', public._proforma_can_approve(),
    'scope', CASE WHEN v_wide THEN 'all' ELSE 'mine' END,
    'invoices', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object(
               'line_count', (SELECT count(*) FROM public.proforma_invoice_lines l WHERE l.proforma_id = i.id))
             ORDER BY i.created_at DESC)
      FROM public.proforma_invoices i
      WHERE v_wide OR i.owner_staff_id = v_staff), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.proforma_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_list() TO authenticated;