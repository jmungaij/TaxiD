ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff_capture',
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS information_request text,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS sales_leads_submitted_by_idx ON public.sales_leads(submitted_by_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._sales_lead_close_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_close_stamp ON public.sales_leads;
CREATE TRIGGER trg_sales_lead_close_stamp
  BEFORE INSERT OR UPDATE OF stage ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_close_stamp();

-- Customer-safe lifecycle translation: never exposes internal stage names.
CREATE OR REPLACE FUNCTION public.sales_lead_customer_state(_stage text, _info text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN coalesce(btrim(_info),'') <> '' AND _stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
      THEN 'INFORMATION_REQUIRED'
    WHEN _stage = 'NEW' THEN 'UNDER_REVIEW'
    WHEN _stage = 'QUALIFIED' THEN 'QUALIFICATION'
    WHEN _stage IN ('OPPORTUNITY','QUOTED') THEN 'COMMERCIAL_REVIEW'
    WHEN _stage = 'ACCEPTED' THEN 'CONTRACTING'
    WHEN _stage = 'BOOKED' THEN 'ACCOUNT_SETUP'
    WHEN _stage IN ('FULFILLED','CLOSED_WON') THEN 'ACTIVE'
    ELSE 'CLOSED'
  END
$$;

-- Deterministic owner routing for a customer submission.
CREATE OR REPLACE FUNCTION public._sales_route_owner(_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_owner uuid;
BEGIN
  IF _account_id IS NOT NULL THEN
    SELECT owner_staff_id INTO v_owner FROM public.crm_accounts WHERE id = _account_id;
    IF v_owner IS NOT NULL THEN RETURN v_owner; END IF;
  END IF;

  SELECT s.id INTO v_owner
    FROM public.staff_members s
    JOIN public.org_positions p ON p.id = s.position_id
   WHERE s.employment_status IN ('active','onboarding')
     AND p.code IN ('SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')
   ORDER BY (SELECT count(*) FROM public.sales_leads l
              WHERE l.sales_staff_id = s.id
                AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), s.created_at
   LIMIT 1;
  IF v_owner IS NOT NULL THEN RETURN v_owner; END IF;

  SELECT s.id INTO v_owner
    FROM public.staff_members s
    LEFT JOIN public.org_units u ON u.id = s.unit_id
   WHERE s.employment_status IN ('active','onboarding')
     AND coalesce(u.name,'') ILIKE '%sales%'
   ORDER BY s.created_at
   LIMIT 1;
  RETURN v_owner;
END $$;

CREATE OR REPLACE FUNCTION public.customer_request_submit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_org text := btrim(coalesce(p->>'organisation_name',''));
  v_contact text := btrim(coalesce(p->>'contact_name',''));
  v_service text := btrim(coalesce(p->>'service_interest',''));
  v_account uuid;
  v_owner uuid;
  v_ref text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_org = '' OR v_contact = '' OR v_service = '' THEN
    RAISE EXCEPTION 'INCOMPLETE_REQUEST_CONTRACT';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;

  -- identity matching: resolve to an existing account rather than creating a duplicate
  SELECT a.id INTO v_account
    FROM public.crm_accounts a
   WHERE lower(a.name) = lower(v_org) OR lower(coalesce(a.legal_name,'')) = lower(v_org)
   ORDER BY a.created_at
   LIMIT 1;

  -- de-duplicate repeated submissions of the same requirement
  SELECT id, lead_ref INTO v_id, v_ref
    FROM public.sales_leads
   WHERE submitted_by_user_id = v_uid
     AND lower(service_interest) = lower(v_service)
     AND stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
     AND created_at > now() - interval '3 days'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('lead_id', v_id, 'lead_ref', v_ref, 'duplicate', true);
  END IF;

  v_owner := public._sales_route_owner(v_account);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'NO_SALES_OWNER_AVAILABLE'; END IF;

  v_ref := 'REQ-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));

  INSERT INTO public.sales_leads (
    lead_ref, sales_staff_id, created_by, submitted_by_user_id, source, account_id,
    organisation_name, contact_name, contact_email, contact_phone, service_interest,
    origin_label, destination_label, service_date, notes
  ) VALUES (
    v_ref, v_owner, v_uid, v_uid, 'customer_portal', v_account,
    v_org, v_contact, coalesce(nullif(btrim(coalesce(p->>'contact_email','')),''), v_email),
    nullif(btrim(coalesce(p->>'contact_phone','')),''), v_service,
    nullif(btrim(coalesce(p->>'origin_label','')),''),
    nullif(btrim(coalesce(p->>'destination_label','')),''),
    (nullif(p->>'service_date',''))::date,
    nullif(btrim(coalesce(p->>'requirement','')),'')
  ) RETURNING id INTO v_id;

  INSERT INTO public.sales_lead_events (lead_id, action, stage_to, note, actor_user_id, detail)
  VALUES (v_id, 'CUSTOMER_SUBMITTED', 'NEW', nullif(btrim(coalesce(p->>'requirement','')),''), v_uid,
          jsonb_build_object('lead_ref', v_ref, 'account_id', v_account, 'source', 'customer_portal'));

  RETURN jsonb_build_object('lead_id', v_id, 'lead_ref', v_ref, 'duplicate', false,
                            'status', public.sales_lead_customer_state('NEW', NULL));
END $$;

CREATE OR REPLACE FUNCTION public.customer_my_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  SELECT coalesce(jsonb_agg(r ORDER BY r->>'submitted_at' DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'id', l.id,
             'reference', l.lead_ref,
             'organisation_name', l.organisation_name,
             'service_interest', l.service_interest,
             'origin_label', l.origin_label,
             'destination_label', l.destination_label,
             'service_date', l.service_date,
             'status', public.sales_lead_customer_state(l.stage, l.information_request),
             'information_request', CASE
                WHEN coalesce(btrim(l.information_request),'') <> ''
                     AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
                THEN l.information_request ELSE NULL END,
             'relationship_contact', coalesce(s.preferred_name, s.full_name),
             'relationship_email', s.work_email,
             'submitted_at', l.created_at,
             'last_update', l.updated_at,
             'timeline', (
               SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'at', e.created_at,
                        'status', public.sales_lead_customer_state(coalesce(e.stage_to, l.stage), NULL),
                        'customer_note', CASE WHEN e.action IN ('CUSTOMER_SUBMITTED','CUSTOMER_RESPONSE','INFORMATION_REQUESTED')
                                              THEN e.note ELSE NULL END
                      ) ORDER BY e.created_at), '[]'::jsonb)
                 FROM public.sales_lead_events e
                WHERE e.lead_id = l.id
                  AND e.action IN ('CUSTOMER_SUBMITTED','CUSTOMER_RESPONSE','INFORMATION_REQUESTED','STAGE_CHANGE')
             )
           ) AS r
      FROM public.sales_leads l
      LEFT JOIN public.staff_members s ON s.id = l.sales_staff_id
     WHERE l.submitted_by_user_id = v_uid
  ) q;

  RETURN v_rows;
END $$;

CREATE OR REPLACE FUNCTION public.customer_request_respond(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid(); v_lead uuid; v_note text := btrim(coalesce(p->>'note',''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_note = '' THEN RAISE EXCEPTION 'RESPONSE_REQUIRED'; END IF;

  SELECT id INTO v_lead FROM public.sales_leads
   WHERE id = (p->>'request_id')::uuid AND submitted_by_user_id = v_uid;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;

  UPDATE public.sales_leads SET information_request = NULL, updated_at = now() WHERE id = v_lead;

  INSERT INTO public.sales_lead_events (lead_id, action, note, actor_user_id, detail)
  VALUES (v_lead, 'CUSTOMER_RESPONSE', v_note, v_uid, jsonb_build_object('source','customer_portal'));

  RETURN jsonb_build_object('request_id', v_lead, 'recorded', true);
END $$;

-- Staff side: ask the customer for information (shows as "Information required")
CREATE OR REPLACE FUNCTION public.sales_lead_request_information(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lead public.sales_leads; v_staff uuid; v_note text := btrim(coalesce(p->>'note',''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_note = '' THEN RAISE EXCEPTION 'INFORMATION_REQUEST_REQUIRED'; END IF;
  v_staff := public._my_staff_member_id();
  SELECT * INTO v_lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF v_lead.sales_staff_id <> v_staff AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'LEAD_NOT_YOURS';
  END IF;

  UPDATE public.sales_leads SET information_request = v_note, updated_at = now() WHERE id = v_lead.id;
  INSERT INTO public.sales_lead_events (lead_id, action, note, actor_user_id)
  VALUES (v_lead.id, 'INFORMATION_REQUESTED', v_note, auth.uid());

  RETURN jsonb_build_object('lead_id', v_lead.id, 'information_requested', true);
END $$;

-- Commercial performance figures for My Dashboard
CREATE OR REPLACE FUNCTION public.commercial_my_kpis(_scope text DEFAULT 'mine', _days integer DEFAULT 365)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_me uuid;
  v_scope text := lower(coalesce(_scope,'mine'));
  v_days int := greatest(coalesce(_days,365), 7);
  v_ids uuid[];
  v_manages boolean := false;
  v_from timestamptz;
  v_won int := 0; v_lost int := 0; v_open int := 0;
  v_revenue numeric := 0; v_open_value numeric := 0;
  v_avg_days numeric; v_avg_deal numeric;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  v_from := now() - make_interval(days => v_days);

  SELECT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) INTO v_manages;

  IF v_scope = 'team' AND v_manages THEN
    WITH RECURSIVE line AS (
      SELECT id, manager_staff_id, 1 AS depth FROM public.staff_members WHERE manager_staff_id = v_me
      UNION ALL
      SELECT c.id, c.manager_staff_id, l.depth + 1
        FROM public.staff_members c JOIN line l ON c.manager_staff_id = l.id
       WHERE l.depth < 8
    )
    SELECT array_agg(id) INTO v_ids FROM (SELECT id FROM line UNION SELECT v_me) x;
  ELSE
    v_scope := 'mine';
    v_ids := ARRAY[v_me];
  END IF;

  SELECT
    count(*) FILTER (WHERE stage = 'CLOSED_WON'),
    count(*) FILTER (WHERE stage IN ('CLOSED_LOST','DISQUALIFIED')),
    count(*) FILTER (WHERE stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')),
    coalesce(sum(estimated_value_kes) FILTER (WHERE stage = 'CLOSED_WON'), 0),
    coalesce(sum(estimated_value_kes) FILTER (WHERE stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), 0),
    avg(EXTRACT(epoch FROM (coalesce(closed_at, updated_at) - created_at)) / 86400.0)
      FILTER (WHERE stage = 'CLOSED_WON'),
    avg(estimated_value_kes) FILTER (WHERE stage = 'CLOSED_WON' AND estimated_value_kes IS NOT NULL)
  INTO v_won, v_lost, v_open, v_revenue, v_open_value, v_avg_days, v_avg_deal
  FROM public.sales_leads
  WHERE sales_staff_id = ANY(v_ids)
    AND created_at >= v_from;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'can_view_team', v_manages,
    'window_days', v_days,
    'people', coalesce(array_length(v_ids,1), 1),
    'revenue_kes', v_revenue,
    'won_count', v_won,
    'lost_count', v_lost,
    'open_count', v_open,
    'open_pipeline_kes', v_open_value,
    'win_rate_pct', CASE WHEN (v_won + v_lost) > 0 THEN round((v_won::numeric * 100) / (v_won + v_lost), 1) ELSE NULL END,
    'avg_days_to_close', CASE WHEN v_avg_days IS NOT NULL THEN round(v_avg_days, 1) ELSE NULL END,
    'avg_deal_value_kes', CASE WHEN v_avg_deal IS NOT NULL THEN round(v_avg_deal, 0) ELSE NULL END
  );
END $$;

REVOKE ALL ON FUNCTION public.customer_request_submit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_my_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_request_respond(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_lead_request_information(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commercial_my_kpis(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sales_route_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_request_submit(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_my_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_request_respond(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_lead_request_information(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_my_kpis(text, integer) TO authenticated;