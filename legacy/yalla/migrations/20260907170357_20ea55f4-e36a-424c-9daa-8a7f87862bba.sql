CREATE OR REPLACE FUNCTION public.customer_portal_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_accounts uuid[];
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT coalesce(array_agg(DISTINCT id), '{}'::uuid[]) INTO v_accounts
  FROM (
    SELECT a.id
      FROM public.crm_accounts a
      JOIN public.sales_leads l ON l.account_id = a.id
     WHERE l.submitted_by_user_id = v_uid
    UNION
    SELECT a.id
      FROM public.crm_accounts a
      JOIN public.corporate_employees ce ON ce.corporate_id = a.corporate_id
     WHERE ce.user_id = v_uid AND coalesce(ce.status, 'active') = 'active'
    UNION
    SELECT c.account_id
      FROM public.crm_contacts c
     WHERE v_email IS NOT NULL AND lower(c.email) = v_email AND c.account_id IS NOT NULL
  ) s;

  SELECT jsonb_build_object(
    'accounts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'reference', a.account_ref,
        'name', coalesce(a.legal_name, a.name),
        'industry', a.industry,
        'city', a.city,
        'country', a.country,
        'relationship_stage', CASE
          WHEN a.lifecycle_stage IN ('customer','active') THEN 'Active customer'
          WHEN a.lifecycle_stage IN ('opportunity','qualified') THEN 'In onboarding'
          ELSE 'In review' END,
        'relationship_contact', sm.full_name,
        'relationship_email', sm.work_email
      ) ORDER BY a.created_at)
      FROM public.crm_accounts a
      LEFT JOIN public.staff_members sm ON sm.id = a.owner_staff_id
      WHERE a.id = ANY(v_accounts)
    ), '[]'::jsonb),

    'opportunities', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'reference', o.opportunity_ref,
        'title', o.title,
        'status', CASE
          WHEN o.stage IN ('new') THEN 'Received'
          WHEN o.stage IN ('qualified') THEN 'In review'
          WHEN o.stage IN ('proposal','negotiation') THEN 'Proposal in progress'
          WHEN o.stage = 'won' THEN 'Confirmed'
          ELSE 'Closed' END,
        'updated_at', o.updated_at
      ) ORDER BY o.updated_at DESC)
      FROM public.commercial_opportunities o
      WHERE o.corporate_id IS NOT NULL
        AND o.corporate_id IN (SELECT corporate_id FROM public.crm_accounts WHERE id = ANY(v_accounts) AND corporate_id IS NOT NULL)
    ), '[]'::jsonb),

    'proposals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id,
        'reference', q.quote_number,
        'total_amount', q.total_amount,
        'currency', coalesce(q.currency, 'KES'),
        'valid_until', q.valid_until,
        'status', CASE
          WHEN q.status = 'draft' THEN 'Being prepared'
          WHEN q.status IN ('accepted','won') THEN 'Accepted'
          WHEN q.status IN ('rejected','expired','void') THEN 'Closed'
          WHEN coalesce(q.approval_status,'') = 'approved' THEN 'Ready for your review'
          ELSE 'Being prepared' END,
        'updated_at', q.updated_at
      ) ORDER BY q.created_at DESC)
      FROM public.commercial_quotations q
      WHERE q.account_id = ANY(v_accounts)
    ), '[]'::jsonb),

    'service_orders', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'services', s.services,
        'locations', s.locations,
        'validity', s.validity,
        'status', CASE
          WHEN s.approval_status = 'approved' THEN 'Active'
          WHEN s.approval_status IN ('rejected','declined') THEN 'Closed'
          ELSE 'Being set up' END,
        'updated_at', s.updated_at
      ) ORDER BY s.created_at DESC)
      FROM public.commercial_schedules s
      JOIN public.commercial_contract_instances ci ON ci.id = s.contract_instance_id
      WHERE ci.account_id = ANY(v_accounts)
    ), '[]'::jsonb),

    'contracts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'name', ci.customer_legal_name,
        'term', ci.contract_term,
        'effective_date', ci.effective_date,
        'services', ci.selected_services,
        'status', CASE
          WHEN ci.status IN ('active','executed') THEN 'Active'
          WHEN ci.status IN ('terminated','expired','void') THEN 'Closed'
          ELSE 'Being prepared' END,
        'updated_at', ci.updated_at
      ) ORDER BY ci.created_at DESC)
      FROM public.commercial_contract_instances ci
      WHERE ci.account_id = ANY(v_accounts)
    ), '[]'::jsonb),

    'feed', coalesce((
      SELECT jsonb_agg(f ORDER BY (f->>'at') DESC)
      FROM (
        SELECT jsonb_build_object('at', e.created_at, 'kind', 'Request',
                 'label', coalesce(e.note, replace(initcap(replace(e.action,'_',' ')), 'Stage Change', 'Progress update')),
                 'reference', l.lead_ref) AS f
          FROM public.sales_lead_events e
          JOIN public.sales_leads l ON l.id = e.lead_id
         WHERE l.submitted_by_user_id = v_uid OR l.account_id = ANY(v_accounts)
        UNION ALL
        SELECT jsonb_build_object('at', q.updated_at, 'kind', 'Proposal',
                 'label', 'Proposal ' || q.quote_number || ' — ' ||
                   CASE WHEN q.status = 'draft' THEN 'being prepared'
                        WHEN q.status IN ('accepted','won') THEN 'accepted'
                        ELSE 'updated' END,
                 'reference', q.quote_number)
          FROM public.commercial_quotations q WHERE q.account_id = ANY(v_accounts)
        UNION ALL
        SELECT jsonb_build_object('at', s.updated_at, 'kind', 'Service order',
                 'label', s.title || ' — ' || CASE WHEN s.approval_status = 'approved' THEN 'active' ELSE 'being set up' END,
                 'reference', s.title)
          FROM public.commercial_schedules s
          JOIN public.commercial_contract_instances ci ON ci.id = s.contract_instance_id
         WHERE ci.account_id = ANY(v_accounts)
      ) z
      LIMIT 60
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_portal_overview() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_portal_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.customer_portal_overview() TO authenticated;