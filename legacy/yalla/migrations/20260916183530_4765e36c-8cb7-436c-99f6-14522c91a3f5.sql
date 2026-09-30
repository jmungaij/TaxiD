-- The audit recorder referenced columns that do not exist on this table
-- (approved_by / rejection_reason), so every decision update aborted.
CREATE OR REPLACE FUNCTION public.audit_corp_ride_approval_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN v_cols := array_append(v_cols,'decided_by'); END IF;
  IF NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN v_cols := array_append(v_cols,'decided_at'); END IF;
  IF NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN v_cols := array_append(v_cols,'decision_note'); END IF;
  IF array_length(v_cols,1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_privileged_update(
    'corporate_ride_approvals', NEW.id::text, v_cols,
    to_jsonb(OLD) - 'updated_at', to_jsonb(NEW) - 'updated_at'
  );
  RETURN NEW;
END; $function$;

-- Separation of duties: the requester never decides their own request, even when
-- they hold a manager or administrator role. Recorded decisions must name the
-- signed-in approver.
CREATE OR REPLACE FUNCTION public.tg_corp_appr_no_self_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by THEN
    RETURN NEW;
  END IF;

  IF v_caller IS NULL THEN
    -- Internal workers (expiry sweeps, service-role consoles) keep their values.
    RETURN NEW;
  END IF;

  IF NEW.status <> 'pending'::corporate_approval_status THEN
    IF OLD.requested_by = v_caller THEN
      RAISE EXCEPTION 'you cannot decide your own approval request'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.decided_by IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'the recorded approver must be the signed-in approver'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_corp_appr_no_self_decision ON public.corporate_ride_approvals;
CREATE TRIGGER trg_corp_appr_no_self_decision
  BEFORE UPDATE ON public.corporate_ride_approvals
  FOR EACH ROW EXECUTE FUNCTION public.tg_corp_appr_no_self_decision();