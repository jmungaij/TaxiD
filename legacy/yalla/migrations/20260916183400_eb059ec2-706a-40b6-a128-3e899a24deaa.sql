-- Employee-initiated requests may only ever enter the queue as pending, with no
-- decision fields pre-filled. Deciding stays with corp_appr_update_manager.
DROP POLICY IF EXISTS corp_appr_insert_self ON public.corporate_ride_approvals;
CREATE POLICY corp_appr_insert_self
  ON public.corporate_ride_approvals FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'pending'::corporate_approval_status
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND decision_note IS NULL
    AND EXISTS (
      SELECT 1 FROM public.corporate_employees e
       WHERE e.id = corporate_ride_approvals.employee_id
         AND e.user_id = auth.uid()
         AND e.corporate_id = corporate_ride_approvals.corporate_id
         AND e.status = 'active'::corporate_employee_status
    )
  );

-- Defence in depth: the same law holds for any signed-in insert path, including
-- future RPCs, so a pre-approved row can never be created by the requester.
CREATE OR REPLACE FUNCTION public.tg_corp_appr_insert_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    -- Service-role / internal workers keep their explicit values.
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending'::corporate_approval_status
     OR NEW.decided_by IS NOT NULL
     OR NEW.decided_at IS NOT NULL
     OR NEW.decision_note IS NOT NULL THEN
    -- Only a manager or administrator of the organisation may create a row that
    -- already carries a decision, and never for their own request.
    IF NOT (
      (public.has_corporate_role(v_caller, NEW.corporate_id, 'corporate_admin'::corporate_employee_role)
       OR public.has_corporate_role(v_caller, NEW.corporate_id, 'corporate_manager'::corporate_employee_role)
       OR public.has_role(v_caller, 'super_admin'::app_role))
      AND NEW.requested_by <> v_caller
    ) THEN
      RAISE EXCEPTION 'approval requests must be created as pending and decided by an approver'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_corp_appr_insert_pending ON public.corporate_ride_approvals;
CREATE TRIGGER trg_corp_appr_insert_pending
  BEFORE INSERT ON public.corporate_ride_approvals
  FOR EACH ROW EXECUTE FUNCTION public.tg_corp_appr_insert_pending();