CREATE OR REPLACE VIEW public.v_sales_lead_stage_flow
WITH (security_invoker = on) AS
 SELECT l.id AS lead_id,
    l.lead_ref,
    l.organisation_name,
    l.contact_name,
    l.service_interest,
    l.source,
    l.sales_staff_id,
    s.full_name AS owner_name,
    l.estimated_value_kes,
    l.stage,
        CASE
            WHEN l.stage = 'CLOSED_WON'::text THEN 'WON'::text
            WHEN l.stage = ANY (ARRAY['CLOSED_LOST'::text, 'DISQUALIFIED'::text]) THEN 'LOST'::text
            WHEN l.contract_shared_at IS NOT NULL OR l.contract_signed_at IS NOT NULL THEN 'CONTRACT'::text
            WHEN l.quote_shared_at IS NOT NULL THEN 'QUOTE'::text
            WHEN l.meeting_held_at IS NOT NULL THEN 'MEETING'::text
            ELSE 'NEW'::text
        END AS step,
    l.created_at,
    l.meeting_held_at,
    l.quote_shared_at,
    l.contract_shared_at,
    l.contract_signed_at,
    l.closed_at,
    GREATEST(l.created_at, COALESCE(l.meeting_held_at, l.created_at), COALESCE(l.quote_shared_at, l.created_at), COALESCE(l.contract_shared_at, l.created_at), COALESCE(l.contract_signed_at, l.created_at), COALESCE(l.closed_at, l.created_at)) AS step_entered_at,
    (date_part('epoch'::text, now() - GREATEST(l.created_at, COALESCE(l.meeting_held_at, l.created_at), COALESCE(l.quote_shared_at, l.created_at), COALESCE(l.contract_shared_at, l.created_at), COALESCE(l.contract_signed_at, l.created_at), COALESCE(l.closed_at, l.created_at))) / 86400.0::double precision)::numeric(10,1) AS days_in_step,
    (date_part('epoch'::text, now() - l.updated_at) / 86400.0::double precision)::numeric(10,1) AS days_since_touched,
    l.won_revenue_kes,
    cl.current_state AS lifecycle_state,
    cl.recognised_value_kes,
    cl.collected_value_kes,
    l.lost_reason_code,
    l.waiting_on,
    l.awaiting_due_date,
    l.is_test,
    l.awaiting_item,
    l.contact_state,
    l.last_outreach_at,
    l.contact_email,
    l.contact_phone
   FROM sales_leads l
     LEFT JOIN staff_members s ON s.id = l.sales_staff_id
     LEFT JOIN commercial_lifecycle cl ON cl.lead_id = l.id;