DROP POLICY IF EXISTS "managers manage types" ON public.meeting_types;
DROP POLICY IF EXISTS "managers manage hosts" ON public.meeting_type_hosts;
DROP POLICY IF EXISTS "own or manager availability" ON public.meeting_host_availability;
DROP POLICY IF EXISTS "staff read booking history" ON public.meeting_booking_events;
DROP POLICY IF EXISTS "hosts and managers read bookings" ON public.public_meeting_bookings;
DROP POLICY IF EXISTS "hosts and managers record outcome" ON public.public_meeting_bookings;

CREATE POLICY "managers manage types" ON public.meeting_types FOR ALL TO authenticated
  USING (coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false))
  WITH CHECK (coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false));
CREATE POLICY "managers manage hosts" ON public.meeting_type_hosts FOR ALL TO authenticated
  USING (coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false))
  WITH CHECK (coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false));
CREATE POLICY "own or manager availability" ON public.meeting_host_availability FOR ALL TO authenticated
  USING (staff_id IN (SELECT id FROM public.staff_members WHERE user_id = auth.uid()) OR coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false))
  WITH CHECK (staff_id IN (SELECT id FROM public.staff_members WHERE user_id = auth.uid()) OR coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false));
CREATE POLICY "hosts and managers read bookings" ON public.public_meeting_bookings FOR SELECT TO authenticated
  USING (host_staff_id IN (SELECT id FROM public.staff_members WHERE user_id = auth.uid()) OR coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false));
CREATE POLICY "hosts and managers record outcome" ON public.public_meeting_bookings FOR UPDATE TO authenticated
  USING (host_staff_id IN (SELECT id FROM public.staff_members WHERE user_id = auth.uid()) OR coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false))
  WITH CHECK (host_staff_id IN (SELECT id FROM public.staff_members WHERE user_id = auth.uid()) OR coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false));
CREATE POLICY "staff read booking history" ON public.meeting_booking_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.public_meeting_bookings b WHERE b.id = booking_id));

DROP FUNCTION IF EXISTS public._meeting_manager();
DROP FUNCTION IF EXISTS public._meeting_is_host(uuid);

ALTER TABLE public.meeting_type_hosts
  ADD COLUMN calendar_status text NOT NULL DEFAULT 'unknown' CHECK (calendar_status IN ('verified','not_shared','unknown')),
  ADD COLUMN calendar_checked_at timestamptz;

ALTER TABLE public.public_meeting_bookings
  ADD COLUMN routing_reason text,
  ADD COLUMN availability_confidence text,
  ADD COLUMN lead_created boolean NOT NULL DEFAULT false,
  ADD COLUMN prep_work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL,
  ADD COLUMN followup_work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL;

-- Outcome orchestration: close prep task, open follow-up task, stamp the lead.
CREATE OR REPLACE FUNCTION public._pmb_outcome_orchestrate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wid uuid;
BEGIN
  IF NEW.outcome IS NULL OR NEW.outcome IS NOT DISTINCT FROM OLD.outcome THEN RETURN NEW; END IF;
  IF NEW.prep_work_item_id IS NOT NULL THEN
    UPDATE staff_work_items SET status = 'done', completed_at = now(), outcome = NEW.outcome, updated_at = now()
    WHERE id = NEW.prep_work_item_id AND status NOT IN ('done','cancelled');
  END IF;
  IF NEW.outcome IN ('held','follow_up','deal') AND NEW.lead_id IS NOT NULL THEN
    UPDATE sales_leads SET meeting_held_at = coalesce(meeting_held_at, NEW.starts_at) WHERE id = NEW.lead_id;
  END IF;
  IF NEW.outcome IN ('follow_up','deal','no_show') AND NEW.followup_work_item_id IS NULL AND NEW.host_staff_id IS NOT NULL THEN
    INSERT INTO staff_work_items(staff_id, work_kind, title, description, source_table, source_id, priority, status, next_action, next_action_due, sla_due_at, entity_type, entity_id)
    VALUES (NEW.host_staff_id, 'sales_opportunity',
      CASE NEW.outcome WHEN 'deal' THEN 'Open the deal from meeting with ' WHEN 'no_show' THEN 'Rebook no-show: ' ELSE 'Follow up meeting with ' END || coalesce(NEW.company, NEW.client_name),
      coalesce(NEW.outcome_notes, NEW.topic), 'public_meeting_bookings', NEW.id,
      CASE WHEN NEW.outcome = 'deal' THEN 'high' ELSE 'medium' END, 'open',
      CASE NEW.outcome WHEN 'deal' THEN 'Qualify and open as a deal' WHEN 'no_show' THEN 'Contact client to rebook' ELSE 'Send follow-up' END,
      (now() + interval '1 day')::date, now() + interval '24 hours',
      CASE WHEN NEW.lead_id IS NOT NULL THEN 'sales_lead' ELSE 'meeting' END, coalesce(NEW.lead_id, NEW.id))
    RETURNING id INTO wid;
    NEW.followup_work_item_id := wid;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._pmb_outcome_orchestrate() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pmb_outcome_orchestrate BEFORE UPDATE OF outcome ON public.public_meeting_bookings FOR EACH ROW EXECUTE FUNCTION public._pmb_outcome_orchestrate();

-- Cancelling a meeting cancels its open prep task.
CREATE OR REPLACE FUNCTION public._pmb_cancel_prep() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' AND NEW.prep_work_item_id IS NOT NULL THEN
    UPDATE staff_work_items SET status = 'cancelled', updated_at = now() WHERE id = NEW.prep_work_item_id AND status NOT IN ('done','cancelled');
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._pmb_cancel_prep() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pmb_cancel_prep AFTER UPDATE OF status ON public.public_meeting_bookings FOR EACH ROW EXECUTE FUNCTION public._pmb_cancel_prep();