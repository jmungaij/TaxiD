ALTER TABLE public.driver_self_reports
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE OR REPLACE FUNCTION public._self_report_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('app.self_report_review', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending'; NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;
  IF OLD.verification_status <> 'pending' THEN
    RAISE EXCEPTION 'This entry has been checked by finance and can no longer be changed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.verification_status := 'pending'; NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_self_report_guard ON public.driver_self_reports;
CREATE TRIGGER trg_self_report_guard BEFORE INSERT OR UPDATE OR DELETE ON public.driver_self_reports
FOR EACH ROW EXECUTE FUNCTION public._self_report_guard();

CREATE OR REPLACE FUNCTION public.review_self_report(_id uuid, _decision text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.driver_self_reports;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(
     public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'), false) THEN
    RAISE EXCEPTION 'Only finance or admin can check entries';
  END IF;
  IF _decision NOT IN ('verified','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _decision = 'rejected' AND length(trim(COALESCE(_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required to reject'; END IF;
  SELECT * INTO r FROM public.driver_self_reports WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF r.user_id = auth.uid() THEN RAISE EXCEPTION 'You cannot check your own entry'; END IF;
  IF r.verification_status <> 'pending' THEN RAISE EXCEPTION 'Entry already checked'; END IF;
  PERFORM set_config('app.self_report_review','on', true);
  UPDATE public.driver_self_reports SET verification_status = _decision, verified_by = auth.uid(), verified_at = now(),
    rejection_reason = CASE WHEN _decision='rejected' THEN trim(_reason) END WHERE id = _id;
  PERFORM set_config('app.self_report_review','off', true);
END $$;

REVOKE ALL ON FUNCTION public.review_self_report(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_self_report(uuid,text,text) TO authenticated;