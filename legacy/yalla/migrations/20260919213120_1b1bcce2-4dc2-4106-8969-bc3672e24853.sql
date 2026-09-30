-- 1. Daily operational reality per customer account -------------------------
CREATE TABLE IF NOT EXISTS public.commercial_account_service_volumes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  service_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Nairobi')::date,
  airport_transfers integer NOT NULL DEFAULT 0 CHECK (airport_transfers >= 0),
  staff_transport_trips integer NOT NULL DEFAULT 0 CHECK (staff_transport_trips >= 0),
  parcel_deliveries integer NOT NULL DEFAULT 0 CHECK (parcel_deliveries >= 0),
  declared_value_kes numeric(14,2) CHECK (declared_value_kes IS NULL OR declared_value_kes >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, service_date)
);

COMMENT ON TABLE public.commercial_account_service_volumes IS
  'Operational reality per customer per day, entered by the account owner: airport transfers, staff transport trips, parcel deliveries and the value declared for that day. Feeds the daily KPI close and the forecast.';

GRANT SELECT, INSERT, UPDATE ON public.commercial_account_service_volumes TO authenticated;
GRANT ALL ON public.commercial_account_service_volumes TO service_role;

ALTER TABLE public.commercial_account_service_volumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Linked commercial staff read account volumes"
  ON public.commercial_account_service_volumes FOR SELECT TO authenticated
  USING (public.is_linked_commercial_staff());

CREATE POLICY "Linked commercial staff record account volumes"
  ON public.commercial_account_service_volumes FOR INSERT TO authenticated
  WITH CHECK (public.is_linked_commercial_staff());

CREATE POLICY "Linked commercial staff correct account volumes"
  ON public.commercial_account_service_volumes FOR UPDATE TO authenticated
  USING (public.is_linked_commercial_staff())
  WITH CHECK (public.is_linked_commercial_staff());

CREATE POLICY "Service role manages account volumes"
  ON public.commercial_account_service_volumes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_account_volumes_date ON public.commercial_account_service_volumes(service_date DESC);
CREATE INDEX IF NOT EXISTS idx_account_volumes_staff ON public.commercial_account_service_volumes(staff_member_id, service_date DESC);

CREATE OR REPLACE FUNCTION public._account_volume_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public._account_volume_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_account_volume_touch ON public.commercial_account_service_volumes;
CREATE TRIGGER trg_account_volume_touch BEFORE UPDATE ON public.commercial_account_service_volumes
FOR EACH ROW EXECUTE FUNCTION public._account_volume_touch();

-- 2. Record one day's volumes for one account -------------------------------
CREATE OR REPLACE FUNCTION public.sales_account_volume_record(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid; v_date date; v_me uuid;
  v_air int; v_staff int; v_parcel int; v_value numeric; v_notes text;
  v_row public.commercial_account_service_volumes;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  v_account := nullif(p->>'account_id','')::uuid;
  IF v_account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_accounts WHERE id = v_account) THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  v_date  := coalesce(nullif(p->>'service_date','')::date, (now() AT TIME ZONE 'Africa/Nairobi')::date);
  IF v_date > (now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'DATE_IN_THE_FUTURE'; END IF;

  v_air    := coalesce(nullif(p->>'airport_transfers','')::int, 0);
  v_staff  := coalesce(nullif(p->>'staff_transport_trips','')::int, 0);
  v_parcel := coalesce(nullif(p->>'parcel_deliveries','')::int, 0);
  v_value  := nullif(p->>'declared_value_kes','')::numeric;
  v_notes  := nullif(trim(coalesce(p->>'notes','')),'');

  IF v_air < 0 OR v_staff < 0 OR v_parcel < 0 THEN RAISE EXCEPTION 'VOLUME_NOT_VALID'; END IF;
  IF v_air = 0 AND v_staff = 0 AND v_parcel = 0 AND v_value IS NULL THEN
    RAISE EXCEPTION 'NOTHING_TO_RECORD';
  END IF;

  v_me := public._my_staff_member_id();

  INSERT INTO public.commercial_account_service_volumes AS v
    (account_id, staff_member_id, service_date, airport_transfers, staff_transport_trips,
     parcel_deliveries, declared_value_kes, notes, created_by)
  VALUES (v_account, v_me, v_date, v_air, v_staff, v_parcel, v_value, v_notes, auth.uid())
  ON CONFLICT (account_id, service_date) DO UPDATE
    SET airport_transfers = EXCLUDED.airport_transfers,
        staff_transport_trips = EXCLUDED.staff_transport_trips,
        parcel_deliveries = EXCLUDED.parcel_deliveries,
        declared_value_kes = EXCLUDED.declared_value_kes,
        notes = coalesce(EXCLUDED.notes, v.notes),
        staff_member_id = coalesce(EXCLUDED.staff_member_id, v.staff_member_id)
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END $$;

REVOKE ALL ON FUNCTION public.sales_account_volume_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_account_volume_record(jsonb) TO authenticated, service_role;

-- 3. The board: my accounts, today, this month, and the gap ------------------
CREATE OR REPLACE FUNCTION public.sales_account_volume_board(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid; v_staff uuid; v_date date; v_month_start date; v_month_end date;
  v_accounts jsonb; v_target jsonb; v_target_kes numeric; v_figures jsonb;
  v_recognised numeric; v_month_value numeric; v_days_recorded int;
  v_air int; v_trips int; v_parcels int; v_projected numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  v_staff := coalesce(nullif(p->>'staff','')::uuid, v_me);
  IF v_staff <> v_me AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_YOUR_BOOK';
  END IF;

  v_date        := coalesce(nullif(p->>'date','')::date, (now() AT TIME ZONE 'Africa/Nairobi')::date);
  v_month_start := date_trunc('month', v_date)::date;
  v_month_end   := (v_month_start + interval '1 month')::date;

  WITH mine AS (
    SELECT a.id, a.name, a.lifecycle_stage
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
    UNION
    SELECT a.id, a.name, a.lifecycle_stage
      FROM public.crm_accounts a
      JOIN public.sales_leads l ON l.account_id = a.id
     WHERE l.sales_staff_id = v_staff AND NOT l.is_test
  ), day AS (
    SELECT * FROM public.commercial_account_service_volumes WHERE service_date = v_date
  ), mon AS (
    SELECT account_id,
           sum(airport_transfers) air,
           sum(staff_transport_trips) trips,
           sum(parcel_deliveries) parcels,
           sum(coalesce(declared_value_kes,0)) value_kes,
           count(*) days_recorded
      FROM public.commercial_account_service_volumes
     WHERE service_date >= v_month_start AND service_date < v_month_end
     GROUP BY account_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'account_id', m.id,
           'name', m.name,
           'lifecycle_stage', m.lifecycle_stage,
           'today', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
              'airport_transfers', d.airport_transfers,
              'staff_transport_trips', d.staff_transport_trips,
              'parcel_deliveries', d.parcel_deliveries,
              'declared_value_kes', d.declared_value_kes,
              'notes', d.notes) END,
           'month', CASE WHEN mo.account_id IS NULL THEN NULL ELSE jsonb_build_object(
              'airport_transfers', mo.air,
              'staff_transport_trips', mo.trips,
              'parcel_deliveries', mo.parcels,
              'declared_value_kes', nullif(mo.value_kes, 0),
              'days_recorded', mo.days_recorded) END
         ) ORDER BY m.name), '[]'::jsonb)
    INTO v_accounts
    FROM mine m
    LEFT JOIN day d ON d.account_id = m.id
    LEFT JOIN mon mo ON mo.account_id = m.id;

  SELECT coalesce(sum(coalesce(v.declared_value_kes,0)),0),
         count(DISTINCT v.service_date),
         coalesce(sum(v.airport_transfers),0),
         coalesce(sum(v.staff_transport_trips),0),
         coalesce(sum(v.parcel_deliveries),0)
    INTO v_month_value, v_days_recorded, v_air, v_trips, v_parcels
    FROM public.commercial_account_service_volumes v
   WHERE v.service_date >= v_month_start AND v.service_date < v_month_end
     AND v.account_id IN (
       SELECT a.id FROM public.crm_accounts a WHERE a.owner_staff_id = v_staff
       UNION
       SELECT a.id FROM public.crm_accounts a JOIN public.sales_leads l ON l.account_id = a.id
        WHERE l.sales_staff_id = v_staff AND NOT l.is_test);

  v_target     := public.sales_target_for(v_staff, v_month_start);
  v_target_kes := nullif((v_target->>'target_kes')::numeric, 0);
  v_figures    := public._sales_person_figures(v_staff, v_month_start::timestamptz, v_month_end::timestamptz, false);
  v_recognised := coalesce((v_figures->>'revenue_won_kes')::numeric, 0);

  IF v_days_recorded > 0 THEN
    v_projected := round(v_month_value / v_days_recorded
                     * (v_month_end - v_month_start)::numeric, 2);
  END IF;

  RETURN jsonb_build_object(
    'staff_id', v_staff,
    'date', v_date,
    'month_start', v_month_start,
    'accounts', v_accounts,
    'month', jsonb_build_object(
      'airport_transfers', v_air,
      'staff_transport_trips', v_trips,
      'parcel_deliveries', v_parcels,
      'declared_value_kes', nullif(v_month_value, 0),
      'days_recorded', v_days_recorded,
      'projected_month_value_kes', v_projected),
    'target_kes', v_target_kes,
    'target_source', v_target->>'source',
    'recognised_revenue_kes', v_recognised,
    'gap_revenue_only_kes', CASE WHEN v_target_kes IS NULL THEN NULL
                                 ELSE greatest(0, v_target_kes - v_recognised) END,
    'gap_after_operations_kes', CASE WHEN v_target_kes IS NULL THEN NULL
                                 ELSE greatest(0, v_target_kes - v_recognised - coalesce(v_month_value,0)) END
  );
END $$;

REVOKE ALL ON FUNCTION public.sales_account_volume_board(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_account_volume_board(jsonb) TO authenticated, service_role;

-- 4. Qualify a lead and open it as a real deal in one step -------------------
CREATE OR REPLACE FUNCTION public.sales_lead_qualify_open_deal(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lead public.sales_leads; v_value numeric; v_note text; v_ref text; v_opp uuid; v_me uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_lead FROM public.sales_leads WHERE id = nullif(p->>'lead_id','')::uuid;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  v_me := public._my_staff_member_id();
  IF v_lead.sales_staff_id <> v_me AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'LEAD_NOT_YOURS';
  END IF;
  IF v_lead.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') THEN
    RAISE EXCEPTION 'LEAD_ALREADY_CLOSED';
  END IF;
  IF v_lead.opportunity_id IS NOT NULL THEN
    RETURN jsonb_build_object('lead_id', v_lead.id, 'opportunity_id', v_lead.opportunity_id, 'idempotent', true);
  END IF;

  v_value := nullif(p->>'estimated_value_kes','')::numeric;
  IF v_value IS NULL OR v_value <= 0 THEN RAISE EXCEPTION 'VALUE_REQUIRED'; END IF;
  v_note := nullif(trim(coalesce(p->>'note','')),'');
  IF v_note IS NULL OR length(v_note) < 5 THEN RAISE EXCEPTION 'QUALIFICATION_NOTE_REQUIRED'; END IF;

  v_ref := 'OPP-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));

  INSERT INTO public.commercial_opportunities (opportunity_ref, stage, title, customer_kind, customer_label,
    source, source_ref, expected_value_cents, currency, owner_user_id, provenance)
  VALUES (v_ref, 'qualified',
    v_lead.organisation_name || ' — ' || coalesce(v_lead.service_interest,'Corporate mobility'),
    'corporate', v_lead.organisation_name, 'sales_lead', v_lead.lead_ref,
    (v_value * 100)::bigint, coalesce(v_lead.currency,'KES'), auth.uid(), 'LIVE')
  RETURNING id INTO v_opp;

  UPDATE public.sales_leads
     SET opportunity_id = v_opp,
         estimated_value_kes = v_value,
         qualification_notes = v_note,
         stage = CASE WHEN stage IN ('NEW','QUALIFIED') THEN 'OPPORTUNITY' ELSE stage END
   WHERE id = v_lead.id;

  IF v_lead.account_id IS NOT NULL THEN
    INSERT INTO public.crm_opportunity_links (opportunity_id, account_id, owner_staff_id, created_by)
    VALUES (v_opp, v_lead.account_id, v_lead.sales_staff_id, auth.uid())
    ON CONFLICT (opportunity_id) DO NOTHING;
  END IF;

  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, actor_user_id, note, detail)
  VALUES (v_lead.id, 'QUALIFIED_AND_OPENED_AS_DEAL', v_lead.stage,
    CASE WHEN v_lead.stage IN ('NEW','QUALIFIED') THEN 'OPPORTUNITY' ELSE v_lead.stage END,
    auth.uid(), v_note,
    jsonb_build_object('opportunity_id', v_opp, 'opportunity_ref', v_ref, 'estimated_value_kes', v_value));

  RETURN jsonb_build_object('lead_id', v_lead.id, 'opportunity_id', v_opp,
    'opportunity_ref', v_ref, 'estimated_value_kes', v_value);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_qualify_open_deal(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_qualify_open_deal(jsonb) TO authenticated, service_role;