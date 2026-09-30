CREATE TABLE public.staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_staff_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  recipient_user_id uuid,
  actor_user_id uuid,
  actor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('review_requested','review_approved','review_returned','corrective_reported','corrective_resolved')),
  title text NOT NULL,
  body text,
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  review_id uuid REFERENCES public.staff_work_reviews(id) ON DELETE SET NULL,
  source_of_record text NOT NULL DEFAULT 'staff_work_items',
  source_record_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_notifications_recipient ON public.staff_notifications (recipient_staff_id, created_at DESC);
CREATE INDEX idx_staff_notifications_user ON public.staff_notifications (recipient_user_id, created_at DESC);
CREATE INDEX idx_staff_notifications_unread ON public.staff_notifications (recipient_staff_id) WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.staff_notifications TO authenticated;
GRANT ALL ON public.staff_notifications TO service_role;

ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recipients and admins read staff notifications"
ON public.staff_notifications FOR SELECT TO authenticated
USING (
  recipient_user_id = auth.uid()
  OR public.is_my_staff_record(recipient_staff_id)
  OR public.is_platform_admin()
);

CREATE POLICY "staff create staff notifications"
ON public.staff_notifications FOR INSERT TO authenticated
WITH CHECK (public.is_staff_member() OR public.is_platform_admin() OR actor_user_id = auth.uid());

-- Recipients may only mark their own notification read; the body is immutable.
CREATE POLICY "recipients mark staff notifications read"
ON public.staff_notifications FOR UPDATE TO authenticated
USING (recipient_user_id = auth.uid() OR public.is_my_staff_record(recipient_staff_id) OR public.is_platform_admin())
WITH CHECK (recipient_user_id = auth.uid() OR public.is_my_staff_record(recipient_staff_id) OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.staff_notifications_immutable_body()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind <> OLD.kind OR NEW.title <> OLD.title
     OR COALESCE(NEW.body,'') <> COALESCE(OLD.body,'')
     OR NEW.created_at <> OLD.created_at
     OR COALESCE(NEW.work_item_id::text,'') <> COALESCE(OLD.work_item_id::text,'')
     OR COALESCE(NEW.recipient_staff_id::text,'') <> COALESCE(OLD.recipient_staff_id::text,'') THEN
    RAISE EXCEPTION 'staff_notifications is append-only; only read_at may change';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_staff_notifications_immutable
BEFORE UPDATE ON public.staff_notifications
FOR EACH ROW EXECUTE FUNCTION public.staff_notifications_immutable_body();

-- Fan out a notification to the employee and the reviewing manager whenever a
-- review decision (submission, approval or return) is recorded.
CREATE OR REPLACE FUNCTION public.staff_review_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_title text;
  v_item public.staff_work_items;
  v_owner_user uuid;
  v_reviewer_user uuid;
BEGIN
  SELECT * INTO v_item FROM public.staff_work_items WHERE id = NEW.work_item_id;

  v_kind := CASE NEW.decision
    WHEN 'submitted' THEN 'review_requested'
    WHEN 'approved' THEN 'review_approved'
    ELSE 'review_returned' END;

  v_title := CASE v_kind
    WHEN 'review_requested' THEN 'Review requested: ' || COALESCE(v_item.title, 'work item')
    WHEN 'review_approved' THEN 'Work approved: ' || COALESCE(v_item.title, 'work item')
    ELSE 'Work returned: ' || COALESCE(v_item.title, 'work item') END;

  SELECT user_id INTO v_owner_user FROM public.staff_members WHERE id = NEW.staff_id;
  SELECT user_id INTO v_reviewer_user FROM public.staff_members WHERE id = NEW.reviewer_staff_id;

  IF NEW.staff_id IS NOT NULL THEN
    INSERT INTO public.staff_notifications (
      recipient_staff_id, recipient_user_id, actor_user_id, actor_staff_id,
      kind, title, body, work_item_id, review_id, source_of_record, source_record_id
    ) VALUES (
      NEW.staff_id, v_owner_user, NEW.reviewer_user_id, NEW.reviewer_staff_id,
      v_kind, v_title,
      COALESCE(NEW.required_action, NEW.rationale),
      NEW.work_item_id, NEW.id,
      COALESCE(NEW.source_of_record, 'staff_work_items'), NEW.source_record_id
    );
  END IF;

  IF NEW.reviewer_staff_id IS NOT NULL AND NEW.reviewer_staff_id <> COALESCE(NEW.staff_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    INSERT INTO public.staff_notifications (
      recipient_staff_id, recipient_user_id, actor_user_id, actor_staff_id,
      kind, title, body, work_item_id, review_id, source_of_record, source_record_id
    ) VALUES (
      NEW.reviewer_staff_id, v_reviewer_user, NEW.reviewer_user_id, NEW.staff_id,
      v_kind, v_title,
      COALESCE(NEW.required_action, NEW.rationale),
      NEW.work_item_id, NEW.id,
      COALESCE(NEW.source_of_record, 'staff_work_items'), NEW.source_record_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_staff_review_notify
AFTER INSERT ON public.staff_work_reviews
FOR EACH ROW EXECUTE FUNCTION public.staff_review_notify();

ALTER TABLE public.staff_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.staff_work_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_work_items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;