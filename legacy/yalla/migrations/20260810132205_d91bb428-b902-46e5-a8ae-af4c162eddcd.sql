-- 1) audit_logs: restrict client-side inserts to trusted admin/compliance roles
DROP POLICY IF EXISTS audit_insert ON public.audit_logs;
CREATE POLICY audit_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'compliance_admin'::app_role])
  );

-- 2) training_answers: hide the answer key (is_correct) from non-admin readers
REVOKE SELECT ON public.training_answers FROM authenticated;
GRANT SELECT (id, question_id, label, sort_order) ON public.training_answers TO authenticated;
GRANT ALL ON public.training_answers TO service_role;