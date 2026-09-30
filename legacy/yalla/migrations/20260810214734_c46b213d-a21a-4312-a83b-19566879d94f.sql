CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN ('admin','super_admin','finance_admin','compliance_admin','operations_admin','operations_manager','pricing_manager','fleet_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','super_admin')
  );
$$;

CREATE TABLE public.staff_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL DEFAULT 'search',
  name text NOT NULL,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'private',
  shared_roles text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_saved_views TO authenticated;
GRANT ALL ON public.staff_saved_views TO service_role;
ALTER TABLE public.staff_saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_saved_views_select ON public.staff_saved_views
FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR (public.is_staff_member() AND visibility = 'roles' AND shared_roles && public.current_user_role_names())
);

CREATE POLICY staff_saved_views_insert ON public.staff_saved_views
FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid() AND public.is_staff_member());

CREATE POLICY staff_saved_views_update ON public.staff_saved_views
FOR UPDATE TO authenticated
USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY staff_saved_views_delete ON public.staff_saved_views
FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE TABLE public.staff_insight_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_key text NOT NULL,
  insight_title text,
  reporter_id uuid NOT NULL DEFAULT auth.uid(),
  issue_type text NOT NULL,
  source_label text,
  comment text,
  status text NOT NULL DEFAULT 'open',
  confidence_before numeric,
  confidence_after numeric,
  review_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.staff_insight_feedback TO authenticated;
GRANT ALL ON public.staff_insight_feedback TO service_role;
ALTER TABLE public.staff_insight_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_insight_feedback_select ON public.staff_insight_feedback
FOR SELECT TO authenticated USING (public.is_staff_member());

CREATE POLICY staff_insight_feedback_insert ON public.staff_insight_feedback
FOR INSERT TO authenticated
WITH CHECK (reporter_id = auth.uid() AND public.is_staff_member());

CREATE POLICY staff_insight_feedback_update ON public.staff_insight_feedback
FOR UPDATE TO authenticated
USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TABLE public.staff_follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text,
  entity_label text,
  title text NOT NULL,
  notes text,
  workflow_stage text,
  assignee_id uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'open',
  decision_reason text,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.staff_follow_up_tasks TO authenticated;
GRANT ALL ON public.staff_follow_up_tasks TO service_role;
ALTER TABLE public.staff_follow_up_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_follow_up_tasks_select ON public.staff_follow_up_tasks
FOR SELECT TO authenticated USING (public.is_staff_member());

CREATE POLICY staff_follow_up_tasks_insert ON public.staff_follow_up_tasks
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.is_staff_member());

CREATE POLICY staff_follow_up_tasks_update ON public.staff_follow_up_tasks
FOR UPDATE TO authenticated
USING (public.is_platform_admin() OR created_by = auth.uid() OR assignee_id = auth.uid())
WITH CHECK (public.is_platform_admin() OR created_by = auth.uid() OR assignee_id = auth.uid());

CREATE TRIGGER staff_saved_views_touch BEFORE UPDATE ON public.staff_saved_views
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER staff_insight_feedback_touch BEFORE UPDATE ON public.staff_insight_feedback
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER staff_follow_up_tasks_touch BEFORE UPDATE ON public.staff_follow_up_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX staff_saved_views_owner_idx ON public.staff_saved_views(owner_id, kind);
CREATE INDEX staff_follow_up_tasks_entity_idx ON public.staff_follow_up_tasks(entity_type, entity_id);
CREATE INDEX staff_insight_feedback_key_idx ON public.staff_insight_feedback(insight_key, status);