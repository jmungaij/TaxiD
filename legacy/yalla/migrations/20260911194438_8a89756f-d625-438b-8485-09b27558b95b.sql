CREATE TABLE public.work_disposition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid,
  decided_by uuid NOT NULL DEFAULT auth.uid(),
  disposition text NOT NULL CHECK (disposition IN (
    'continue','reschedule','waiting','blocked','reassign','automate','nurture','close','disqualify','escalate')),
  reason text NOT NULL,
  business_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Nairobi')::date,
  new_due_date date,
  reassign_to_staff_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.work_disposition_events TO authenticated;
GRANT ALL ON public.work_disposition_events TO service_role;
ALTER TABLE public.work_disposition_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_disposition_own_read" ON public.work_disposition_events
  FOR SELECT TO authenticated
  USING (
    decided_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.staff_members m WHERE m.id = work_disposition_events.staff_id AND m.user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
  );

CREATE POLICY "work_disposition_own_insert" ON public.work_disposition_events
  FOR INSERT TO authenticated
  WITH CHECK (
    decided_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.staff_work_items w
       LEFT JOIN public.staff_members m ON m.id = w.staff_id
       WHERE w.id = work_disposition_events.work_item_id
         AND (m.user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
    )
  );

CREATE OR REPLACE FUNCTION public._work_disposition_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'work_disposition_events is append-only';
END $$;

CREATE TRIGGER trg_work_disposition_append_only
  BEFORE UPDATE OR DELETE ON public.work_disposition_events
  FOR EACH ROW EXECUTE FUNCTION public._work_disposition_append_only();

CREATE INDEX idx_work_disposition_work_date
  ON public.work_disposition_events (work_item_id, business_date DESC);

-- ------------------------------------------------------------------
-- Record a disposition and apply its consequence to the work item.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_disposition_record(
  _work_item_id uuid,
  _disposition text,
  _reason text,
  _new_due_date date DEFAULT NULL,
  _reassign_to uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE w record; v_id uuid; v_allowed boolean;
BEGIN
  IF coalesce(btrim(_reason),'') = '' THEN
    RAISE EXCEPTION 'A reason is required for every disposition';
  END IF;

  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work item not found'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_members m WHERE m.id = w.staff_id AND m.user_id = auth.uid()
  ) OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
  INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'Not authorised to dispose of this work item'; END IF;

  IF _disposition = 'reschedule' AND _new_due_date IS NULL THEN
    RAISE EXCEPTION 'A rescheduled item needs a new date';
  END IF;
  IF _disposition = 'reassign' AND _reassign_to IS NULL THEN
    RAISE EXCEPTION 'A reassigned item needs a new owner';
  END IF;

  INSERT INTO public.work_disposition_events
    (work_item_id, staff_id, decided_by, disposition, reason, new_due_date, reassign_to_staff_id)
  VALUES (_work_item_id, w.staff_id, auth.uid(), _disposition, btrim(_reason), _new_due_date, _reassign_to)
  RETURNING id INTO v_id;

  UPDATE public.staff_work_items SET
    next_action_due = CASE WHEN _new_due_date IS NOT NULL THEN _new_due_date ELSE next_action_due END,
    staff_id = CASE WHEN _disposition = 'reassign' THEN _reassign_to ELSE staff_id END,
    status = CASE
      WHEN _disposition = 'waiting' THEN 'waiting'
      WHEN _disposition = 'blocked' THEN 'blocked'
      WHEN _disposition IN ('close','disqualify') THEN 'done'
      ELSE status END,
    lifecycle_state = CASE
      WHEN _disposition = 'waiting' THEN 'waiting'
      WHEN _disposition = 'blocked' THEN 'blocked'
      WHEN _disposition IN ('close','disqualify') THEN 'closed'
      WHEN _disposition = 'escalate' THEN 'escalated'
      WHEN _disposition = 'reassign' THEN 'assigned'
      ELSE lifecycle_state END,
    escalation_level = CASE WHEN _disposition = 'escalate' THEN escalation_level + 1 ELSE escalation_level END,
    closed_at = CASE WHEN _disposition IN ('close','disqualify') THEN now() ELSE closed_at END,
    resolution = CASE WHEN _disposition IN ('close','disqualify')
                      THEN 'Closed at day close: ' || btrim(_reason) ELSE resolution END,
    updated_at = now()
  WHERE id = _work_item_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.work_disposition_record(uuid,text,text,date,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_disposition_record(uuid,text,text,date,uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- Which of my open items still have no decision for today?
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.work_dispositions_outstanding(_business_date date DEFAULT NULL)
RETURNS TABLE (work_item_id uuid, title text, work_kind text, priority_band text, effort_minutes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT w.id, w.title, w.work_kind, w.priority_band, w.effort_minutes
    FROM public.staff_work_items w
    JOIN public.staff_members m ON m.id = w.staff_id
   WHERE m.user_id = auth.uid()
     AND w.status NOT IN ('done','cancelled')
     AND NOT EXISTS (
       SELECT 1 FROM public.work_disposition_events d
        WHERE d.work_item_id = w.id
          AND d.business_date = coalesce(_business_date, (now() AT TIME ZONE 'Africa/Nairobi')::date))
   ORDER BY w.priority_band, w.sla_due_at NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.work_dispositions_outstanding(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_dispositions_outstanding(date) TO authenticated, service_role;