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
      coalesce(NEW.outcome_notes, NEW.topic), 'public_meeting_bookings.followup', NEW.id,
      CASE WHEN NEW.outcome = 'deal' THEN 'high' ELSE 'medium' END, 'open',
      CASE NEW.outcome WHEN 'deal' THEN 'Qualify and open as a deal' WHEN 'no_show' THEN 'Contact client to rebook' ELSE 'Send follow-up' END,
      (now() + interval '1 day')::date, now() + interval '24 hours',
      CASE WHEN NEW.lead_id IS NOT NULL THEN 'sales_lead' ELSE 'meeting' END, coalesce(NEW.lead_id, NEW.id))
    ON CONFLICT (work_kind, source_table, source_id, staff_id) DO NOTHING
    RETURNING id INTO wid;
    NEW.followup_work_item_id := wid;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._pmb_outcome_orchestrate() FROM PUBLIC, anon, authenticated;