DROP TRIGGER IF EXISTS staff_members_audit ON public.staff_members;
CREATE TRIGGER staff_members_audit AFTER DELETE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.org_audit_trigger();

DROP TRIGGER IF EXISTS org_objectives_audit ON public.org_objectives;
CREATE TRIGGER org_objectives_audit AFTER DELETE ON public.org_objectives
  FOR EACH ROW EXECUTE FUNCTION public.org_audit_trigger();

DROP TRIGGER IF EXISTS staff_qualifications_audit ON public.staff_qualifications;
CREATE TRIGGER staff_qualifications_audit AFTER DELETE ON public.staff_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.org_audit_trigger();

DROP TRIGGER IF EXISTS staff_competencies_audit ON public.staff_competencies;
CREATE TRIGGER staff_competencies_audit AFTER DELETE ON public.staff_competencies
  FOR EACH ROW EXECUTE FUNCTION public.org_audit_trigger();

DROP TRIGGER IF EXISTS staff_work_items_audit ON public.staff_work_items;
CREATE TRIGGER staff_work_items_audit AFTER DELETE ON public.staff_work_items
  FOR EACH ROW EXECUTE FUNCTION public.org_audit_trigger();