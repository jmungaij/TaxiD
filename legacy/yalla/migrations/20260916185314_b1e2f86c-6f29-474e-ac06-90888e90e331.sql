-- 1. Link a lead back to the partner application that produced it -------------
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS partner_application_id uuid REFERENCES public.partner_applications(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_partner_application_uq
  ON public.sales_leads(partner_application_id) WHERE partner_application_id IS NOT NULL;

-- 2. Who owns a new partner enquiry ------------------------------------------
-- Active sales specialists only, least loaded first, name as the tie-break so
-- the choice is deterministic and reproducible. NULL when no specialist exists;
-- callers must then decline to create a lead rather than invent an owner.
CREATE OR REPLACE FUNCTION public.sales_partner_enquiry_owner()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id
    FROM public.staff_members s
    JOIN public.org_positions p ON p.id = s.position_id
   WHERE s.employment_status = 'active'
     AND s.provenance = 'LIVE'
     AND (p.code IN ('SLS-PRT','SLS-MOB','SLS-SUP','SLS-LEAD') OR p.code LIKE 'YML-SAL-%')
   ORDER BY (
      SELECT count(*) FROM public.sales_leads l
       WHERE l.sales_staff_id = s.id
         AND l.source = 'PARTNER_APPLICATION'
         AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
   ) ASC, s.full_name ASC, s.id ASC
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.sales_partner_enquiry_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_partner_enquiry_owner() TO service_role;

-- 3. One enquiry, one lead ---------------------------------------------------
CREATE OR REPLACE FUNCTION public._partner_application_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_ref text;
  v_id uuid;
  v_service text;
BEGIN
  v_owner := public.sales_partner_enquiry_owner();
  IF v_owner IS NULL THEN
    RETURN NEW;                     -- no specialist on the register: no lead invented
  END IF;

  v_service := 'Partner enquiry — ' || replace(coalesce(NEW.partner_type::text,'UNSPECIFIED'),'_',' ')
             || ' / ' || replace(coalesce(NEW.commercial_model::text,'UNSPECIFIED'),'_',' ');
  v_ref := 'LEAD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));

  INSERT INTO public.sales_leads (
    lead_ref, sales_staff_id, organisation_name, contact_name, contact_email, contact_phone,
    service_interest, notes, source, partner_application_id
  ) VALUES (
    v_ref, v_owner, NEW.organisation_name,
    coalesce(nullif(trim(NEW.contact_name),''),'Contact to confirm'),
    nullif(lower(trim(coalesce(NEW.contact_email,''))),''),
    nullif(trim(coalesce(NEW.contact_phone,'')),''),
    v_service,
    nullif(trim(coalesce(NEW.requirements,'')),''),
    'PARTNER_APPLICATION', NEW.id
  ) RETURNING id INTO v_id;

  INSERT INTO public.sales_lead_events (lead_id, action, stage_to, detail)
  VALUES (v_id, 'CREATED', 'NEW',
          jsonb_build_object('lead_ref', v_ref, 'source', 'PARTNER_APPLICATION',
                             'partner_reference', NEW.reference, 'owner_staff_id', v_owner));

  INSERT INTO public.sales_assignment_events (lead_id, from_staff_id, to_staff_id, rule_kind, reason)
  VALUES (v_id, NULL, v_owner, 'PARTNER_APPLICATION', 'Assigned on partner application intake');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_partner_application_to_lead ON public.partner_applications;
CREATE TRIGGER trg_partner_application_to_lead
  AFTER INSERT ON public.partner_applications
  FOR EACH ROW EXECUTE FUNCTION public._partner_application_to_lead();

-- 4. Lead-to-revenue pipeline projection -------------------------------------
CREATE OR REPLACE VIEW public.v_sales_lead_stage_flow
WITH (security_invoker = on) AS
SELECT
  l.id                       AS lead_id,
  l.lead_ref,
  l.organisation_name,
  l.contact_name,
  l.service_interest,
  l.source,
  l.sales_staff_id,
  s.full_name                AS owner_name,
  l.estimated_value_kes,
  l.stage,
  CASE
    WHEN l.stage = 'CLOSED_WON' THEN 'WON'
    WHEN l.stage IN ('CLOSED_LOST','DISQUALIFIED') THEN 'LOST'
    WHEN l.contract_shared_at IS NOT NULL OR l.contract_signed_at IS NOT NULL THEN 'CONTRACT'
    WHEN l.quote_shared_at IS NOT NULL THEN 'QUOTE'
    WHEN l.meeting_held_at IS NOT NULL THEN 'MEETING'
    ELSE 'NEW'
  END                        AS step,
  l.created_at,
  l.meeting_held_at,
  l.quote_shared_at,
  l.contract_shared_at,
  l.contract_signed_at,
  l.closed_at,
  greatest(
    l.created_at,
    coalesce(l.meeting_held_at, l.created_at),
    coalesce(l.quote_shared_at, l.created_at),
    coalesce(l.contract_shared_at, l.created_at),
    coalesce(l.contract_signed_at, l.created_at),
    coalesce(l.closed_at, l.created_at)
  )                          AS step_entered_at,
  (date_part('epoch', now() - greatest(
    l.created_at,
    coalesce(l.meeting_held_at, l.created_at),
    coalesce(l.quote_shared_at, l.created_at),
    coalesce(l.contract_shared_at, l.created_at),
    coalesce(l.contract_signed_at, l.created_at),
    coalesce(l.closed_at, l.created_at)
  )) / 86400.0)::numeric(10,1) AS days_in_step,
  (date_part('epoch', now() - l.updated_at) / 86400.0)::numeric(10,1) AS days_since_touched,
  l.won_revenue_kes,
  cl.current_state           AS lifecycle_state,
  cl.recognised_value_kes,
  cl.collected_value_kes,
  l.lost_reason_code,
  l.waiting_on,
  l.awaiting_due_date,
  l.is_test
FROM public.sales_leads l
LEFT JOIN public.staff_members s ON s.id = l.sales_staff_id
LEFT JOIN public.commercial_lifecycle cl ON cl.lead_id = l.id;

GRANT SELECT ON public.v_sales_lead_stage_flow TO authenticated;
GRANT SELECT ON public.v_sales_lead_stage_flow TO service_role;

-- 5. Where the desk is stalling ---------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_stage_bottlenecks
WITH (security_invoker = on) AS
SELECT
  f.step,
  count(*)                                            AS leads,
  round(avg(f.days_in_step), 1)                       AS avg_days_in_step,
  max(f.days_in_step)                                 AS longest_days_in_step,
  count(*) FILTER (WHERE f.days_in_step > 7)          AS older_than_7_days,
  coalesce(sum(f.estimated_value_kes), 0)             AS estimated_value_kes,
  coalesce(sum(f.recognised_value_kes), 0)            AS recognised_value_kes
FROM public.v_sales_lead_stage_flow f
WHERE f.is_test IS NOT TRUE
GROUP BY f.step;

GRANT SELECT ON public.v_sales_stage_bottlenecks TO authenticated;
GRANT SELECT ON public.v_sales_stage_bottlenecks TO service_role;