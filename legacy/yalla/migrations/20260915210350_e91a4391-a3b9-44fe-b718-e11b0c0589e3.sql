ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS lost_reason_code text,
  ADD COLUMN IF NOT EXISTS waiting_on text,
  ADD COLUMN IF NOT EXISTS awaiting_item text,
  ADD COLUMN IF NOT EXISTS awaiting_due_date date,
  ADD COLUMN IF NOT EXISTS meeting_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS won_revenue_kes numeric,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid;

DO $$ BEGIN
  ALTER TABLE public.sales_leads ADD CONSTRAINT sales_leads_waiting_on_chk
    CHECK (waiting_on IS NULL OR waiting_on IN ('US','CLIENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sales_leads ADD CONSTRAINT sales_leads_lost_reason_code_chk
    CHECK (lost_reason_code IS NULL OR lost_reason_code IN
      ('PRICE_TOO_HIGH','LOST_TO_COMPETITOR','TIMING','NO_BUDGET','NO_RESPONSE','OTHER'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.sales_lead_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by uuid NOT NULL DEFAULT auth.uid(),
  source text NOT NULL DEFAULT 'PASTE',
  label text,
  rows_submitted integer NOT NULL DEFAULT 0,
  rows_created integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.sales_lead_import_batches TO authenticated;
GRANT ALL ON public.sales_lead_import_batches TO service_role;
ALTER TABLE public.sales_lead_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sales leadership reads lead import batches" ON public.sales_lead_import_batches;
CREATE POLICY "Sales leadership reads lead import batches"
  ON public.sales_lead_import_batches FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.crm.manage'));

DROP POLICY IF EXISTS "Sales leadership records lead import batches" ON public.sales_lead_import_batches;
CREATE POLICY "Sales leadership records lead import batches"
  ON public.sales_lead_import_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_permission('staff.crm.manage') AND imported_by = auth.uid());

CREATE TRIGGER sales_lead_import_batches_touch
  BEFORE UPDATE ON public.sales_lead_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Walk the authoritative stage graph one hop at a time towards a target stage.
-- Nothing can skip a stage: every hop is validated and event-logged.
CREATE OR REPLACE FUNCTION public._sales_lead_walk(_lead uuid, _target text, _note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order text[] := ARRAY['NEW','QUALIFIED','OPPORTUNITY','QUOTED','ACCEPTED','BOOKED','FULFILLED','CLOSED_WON'];
  v_cur text; v_from text; v_i int; v_t int; v_guard int := 0;
BEGIN
  SELECT stage INTO v_cur FROM public.sales_leads WHERE id = _lead;
  v_t := array_position(v_order, _target);
  IF v_t IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TARGET_STAGE: %', _target; END IF;
  LOOP
    v_i := array_position(v_order, v_cur);
    IF v_i IS NULL THEN RAISE EXCEPTION 'LEAD_CLOSED: %', v_cur; END IF;
    EXIT WHEN v_i >= v_t;
    v_guard := v_guard + 1;
    IF v_guard > 10 THEN RAISE EXCEPTION 'STAGE_WALK_GUARD'; END IF;
    v_from := v_cur;
    v_cur := v_order[v_i + 1];
    UPDATE public.sales_leads
       SET stage = v_cur,
           qualified_at = CASE WHEN v_cur = 'QUALIFIED' THEN coalesce(qualified_at, now()) ELSE qualified_at END,
           proposal_sent_at = CASE WHEN v_cur = 'QUOTED' THEN coalesce(proposal_sent_at, now()) ELSE proposal_sent_at END,
           closed_at = CASE WHEN v_cur = 'CLOSED_WON' THEN coalesce(closed_at, now()) ELSE closed_at END,
           updated_at = now()
     WHERE id = _lead;
    INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, note, actor_user_id)
    VALUES (_lead, 'STAGE_CHANGE', v_from, v_cur, _note, auth.uid());
  END LOOP;
  RETURN v_cur;
END $$;

REVOKE ALL ON FUNCTION public._sales_lead_walk(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sales_lead_authorise(_lead uuid)
RETURNS public.sales_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.sales_leads; v_staff uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  v_staff := public._my_staff_member_id();
  SELECT * INTO l FROM public.sales_leads WHERE id = _lead;
  IF l.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF l.sales_staff_id IS DISTINCT FROM v_staff
     AND public.has_staff_permission('staff.crm.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'LEAD_NOT_YOURS';
  END IF;
  RETURN l;
END $$;

REVOKE ALL ON FUNCTION public._sales_lead_authorise(uuid) FROM PUBLIC, anon, authenticated;

-- One button per real-world step. The step is stamped, the stage follows.
CREATE OR REPLACE FUNCTION public.sales_lead_log_step(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.sales_leads; v_kind text; v_note text; v_at timestamptz; v_stage text;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);
  v_kind := upper(trim(coalesce(p->>'kind','')));
  v_note := nullif(trim(coalesce(p->>'note','')),'');
  v_at := coalesce((p->>'occurred_at')::timestamptz, now());
  IF v_kind NOT IN ('MEETING','QUOTE_SHARED','CONTRACT_SHARED','CONTRACT_SIGNED') THEN
    RAISE EXCEPTION 'UNKNOWN_STEP: %', v_kind;
  END IF;
  v_stage := CASE v_kind
    WHEN 'MEETING' THEN 'QUALIFIED'
    WHEN 'QUOTE_SHARED' THEN 'QUOTED'
    WHEN 'CONTRACT_SHARED' THEN 'QUOTED'
    WHEN 'CONTRACT_SIGNED' THEN 'ACCEPTED' END;
  v_stage := public._sales_lead_walk(l.id, v_stage, v_note);

  UPDATE public.sales_leads SET
    meeting_held_at = CASE WHEN v_kind = 'MEETING' THEN v_at ELSE meeting_held_at END,
    quote_shared_at = CASE WHEN v_kind = 'QUOTE_SHARED' THEN v_at ELSE quote_shared_at END,
    contract_shared_at = CASE WHEN v_kind = 'CONTRACT_SHARED' THEN v_at ELSE contract_shared_at END,
    contract_signed_at = CASE WHEN v_kind = 'CONTRACT_SIGNED' THEN v_at ELSE contract_signed_at END,
    updated_at = now()
  WHERE id = l.id;

  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, note, actor_user_id, detail)
  VALUES (l.id, 'STEP_' || v_kind, l.stage, v_stage, v_note, auth.uid(),
          jsonb_build_object('occurred_at', v_at));
  RETURN jsonb_build_object('lead_id', l.id, 'stage', v_stage, 'step', v_kind);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_log_step(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_log_step(jsonb) TO authenticated;

-- Won never closes on a verbal yes: recorded revenue is required.
CREATE OR REPLACE FUNCTION public.sales_lead_mark_won(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.sales_leads; v_rev numeric; v_note text; v_stage text;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);
  v_rev := (p->>'revenue_kes')::numeric;
  v_note := nullif(trim(coalesce(p->>'note','')),'');
  IF v_rev IS NULL OR v_rev <= 0 THEN RAISE EXCEPTION 'REVENUE_REQUIRED_TO_WIN'; END IF;
  IF l.contract_signed_at IS NULL THEN RAISE EXCEPTION 'SIGNED_CONTRACT_REQUIRED_TO_WIN'; END IF;
  v_stage := public._sales_lead_walk(l.id, 'CLOSED_WON', v_note);
  UPDATE public.sales_leads
     SET won_revenue_kes = v_rev, waiting_on = NULL, awaiting_item = NULL, awaiting_due_date = NULL,
         updated_at = now()
   WHERE id = l.id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_to, note, actor_user_id, detail)
  VALUES (l.id, 'WON', v_stage, v_note, auth.uid(), jsonb_build_object('revenue_kes', v_rev));
  RETURN jsonb_build_object('lead_id', l.id, 'stage', v_stage, 'revenue_kes', v_rev);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_mark_won(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_mark_won(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_lead_mark_lost(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.sales_leads; v_code text; v_note text; v_to text;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);
  v_code := upper(trim(coalesce(p->>'reason_code','')));
  v_note := nullif(trim(coalesce(p->>'note','')),'');
  IF v_code NOT IN ('PRICE_TOO_HIGH','LOST_TO_COMPETITOR','TIMING','NO_BUDGET','NO_RESPONSE','OTHER') THEN
    RAISE EXCEPTION 'LOSS_REASON_REQUIRED';
  END IF;
  IF l.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') THEN RAISE EXCEPTION 'LEAD_ALREADY_CLOSED'; END IF;
  v_to := CASE WHEN l.stage = 'NEW' THEN 'DISQUALIFIED' ELSE 'CLOSED_LOST' END;
  UPDATE public.sales_leads
     SET stage = v_to, lost_reason_code = v_code, lost_reason = v_note,
         closed_at = now(), waiting_on = NULL, awaiting_item = NULL, awaiting_due_date = NULL,
         updated_at = now()
   WHERE id = l.id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, note, actor_user_id, detail)
  VALUES (l.id, 'LOST', l.stage, v_to, v_note, auth.uid(), jsonb_build_object('reason_code', v_code));
  RETURN jsonb_build_object('lead_id', l.id, 'stage', v_to, 'reason_code', v_code);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_mark_lost(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_mark_lost(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_lead_set_waiting(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.sales_leads; v_on text; v_item text; v_due date;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);
  v_on := nullif(upper(trim(coalesce(p->>'waiting_on',''))),'');
  v_item := nullif(trim(coalesce(p->>'awaiting_item','')),'');
  v_due := (p->>'awaiting_due_date')::date;
  IF v_on IS NOT NULL AND v_on NOT IN ('US','CLIENT') THEN RAISE EXCEPTION 'UNKNOWN_WAITING_PARTY'; END IF;
  IF v_on IS NOT NULL AND v_item IS NULL THEN RAISE EXCEPTION 'AWAITED_ITEM_REQUIRED'; END IF;
  UPDATE public.sales_leads
     SET waiting_on = v_on,
         awaiting_item = CASE WHEN v_on IS NULL THEN NULL ELSE v_item END,
         awaiting_due_date = CASE WHEN v_on IS NULL THEN NULL ELSE v_due END,
         updated_at = now()
   WHERE id = l.id;
  INSERT INTO public.sales_lead_events (lead_id, action, note, actor_user_id, detail)
  VALUES (l.id, CASE WHEN v_on IS NULL THEN 'WAITING_CLEARED' ELSE 'WAITING_SET' END, v_item, auth.uid(),
          jsonb_build_object('waiting_on', v_on, 'due_date', v_due));
  RETURN jsonb_build_object('lead_id', l.id, 'waiting_on', v_on);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_set_waiting(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_set_waiting(jsonb) TO authenticated;

-- Leadership bulk intake. Owner is set at creation; duplicates are skipped, never merged blindly.
CREATE OR REPLACE FUNCTION public.sales_lead_bulk_import(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows jsonb := coalesce(p->'rows','[]'::jsonb);
  v_owners uuid[]; v_batch uuid; r jsonb; v_i int := 0;
  v_created int := 0; v_skipped int := 0; v_owner uuid; v_ref text; v_id uuid;
  v_org text; v_email text; v_phone text; v_name text; v_service text;
  v_skips jsonb := '[]'::jsonb; v_created_ids jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF public.has_staff_permission('staff.crm.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_IMPORT_LEADS';
  END IF;
  SELECT array_agg((x)::uuid) INTO v_owners
    FROM jsonb_array_elements_text(coalesce(p->'owner_staff_ids','[]'::jsonb)) x;
  IF v_owners IS NULL OR array_length(v_owners,1) = 0 THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
  IF EXISTS (
      SELECT 1 FROM unnest(v_owners) o
       WHERE NOT EXISTS (SELECT 1 FROM public.staff_members s WHERE s.id = o)
  ) THEN RAISE EXCEPTION 'UNKNOWN_OWNER'; END IF;
  IF jsonb_array_length(v_rows) = 0 THEN RAISE EXCEPTION 'NO_ROWS'; END IF;
  IF jsonb_array_length(v_rows) > 500 THEN RAISE EXCEPTION 'TOO_MANY_ROWS'; END IF;

  INSERT INTO public.sales_lead_import_batches (imported_by, source, label, rows_submitted)
  VALUES (auth.uid(), coalesce(nullif(trim(p->>'source'),''),'PASTE'),
          nullif(trim(coalesce(p->>'label','')),''), jsonb_array_length(v_rows))
  RETURNING id INTO v_batch;

  FOR r IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    v_org := nullif(trim(coalesce(r->>'organisation_name','')),'');
    v_name := coalesce(nullif(trim(coalesce(r->>'contact_name','')),''),'Contact to confirm');
    v_email := nullif(lower(trim(coalesce(r->>'contact_email',''))),'');
    v_phone := nullif(trim(coalesce(r->>'contact_phone','')),'');
    v_service := coalesce(nullif(trim(coalesce(r->>'service_interest','')),''),'To be confirmed');
    IF v_org IS NULL THEN
      v_skipped := v_skipped + 1;
      v_skips := v_skips || jsonb_build_object('row', v_i, 'reason', 'MISSING_ORGANISATION');
      v_i := v_i + 1; CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.sales_leads l
       WHERE lower(l.organisation_name) = lower(v_org)
         AND (
           (v_email IS NOT NULL AND lower(coalesce(l.contact_email,'')) = v_email)
           OR (v_phone IS NOT NULL AND regexp_replace(coalesce(l.contact_phone,''),'\D','','g')
                 = regexp_replace(v_phone,'\D','','g'))
           OR (v_email IS NULL AND v_phone IS NULL)
         )
    ) THEN
      v_skipped := v_skipped + 1;
      v_skips := v_skips || jsonb_build_object('row', v_i, 'organisation', v_org, 'reason', 'ALREADY_ON_THE_DESK');
      v_i := v_i + 1; CONTINUE;
    END IF;

    v_owner := coalesce(nullif(r->>'owner_staff_id','')::uuid,
                        v_owners[(v_created % array_length(v_owners,1)) + 1]);
    v_ref := 'LEAD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
    INSERT INTO public.sales_leads (lead_ref, sales_staff_id, created_by, organisation_name, contact_name,
      contact_email, contact_phone, service_interest, estimated_value_kes, notes, source, import_batch_id)
    VALUES (v_ref, v_owner, auth.uid(), v_org, v_name, v_email, v_phone, v_service,
      (nullif(trim(coalesce(r->>'estimated_value_kes','')),''))::numeric,
      nullif(trim(coalesce(r->>'notes','')),''), 'BULK_IMPORT', v_batch)
    RETURNING id INTO v_id;

    INSERT INTO public.sales_lead_events (lead_id, action, stage_to, actor_user_id, detail)
    VALUES (v_id, 'CREATED', 'NEW', auth.uid(),
            jsonb_build_object('lead_ref', v_ref, 'batch_id', v_batch, 'owner_staff_id', v_owner));
    INSERT INTO public.sales_assignment_events (lead_id, from_staff_id, to_staff_id, rule_kind, reason, actor_user_id)
    VALUES (v_id, NULL, v_owner, 'BULK_IMPORT', 'Assigned on bulk import', auth.uid());

    v_created := v_created + 1;
    v_created_ids := v_created_ids || jsonb_build_object('lead_id', v_id, 'organisation', v_org, 'owner_staff_id', v_owner);
    v_i := v_i + 1;
  END LOOP;

  UPDATE public.sales_lead_import_batches
     SET rows_created = v_created, rows_skipped = v_skipped,
         detail = jsonb_build_object('skipped', v_skips, 'created', v_created_ids), updated_at = now()
   WHERE id = v_batch;

  RETURN jsonb_build_object('batch_id', v_batch, 'submitted', jsonb_array_length(v_rows),
    'created', v_created, 'skipped', v_skipped, 'skips', v_skips);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_bulk_import(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_bulk_import(jsonb) TO authenticated;

-- Reassignment: keep the manager rule, add desk-wide CRM authority.
CREATE OR REPLACE FUNCTION public.sales_lead_assign(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_lead uuid := (p->>'lead_id')::uuid; v_to uuid := (p->>'staff_id')::uuid;
        v_me uuid; v_admin boolean; l record;
BEGIN
  v_me := public._my_staff_member_id();
  v_admin := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
             OR public.has_staff_permission('staff.crm.manage') IS TRUE;
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  SELECT * INTO l FROM public.sales_leads WHERE id = v_lead;
  IF l.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF coalesce(trim(p->>'reason'),'') = '' THEN RAISE EXCEPTION 'REASSIGNMENT_REASON_REQUIRED'; END IF;
  IF NOT v_admin AND NOT EXISTS (
      SELECT 1 FROM public.staff_members s WHERE s.id IN (l.sales_staff_id, v_to) AND s.manager_staff_id = v_me
  ) THEN RAISE EXCEPTION 'NOT_AUTHORISED_TO_REASSIGN'; END IF;

  UPDATE public.sales_leads SET sales_staff_id = v_to, updated_at = now() WHERE id = v_lead;
  UPDATE public.sales_sla_clocks SET staff_member_id = v_to
   WHERE entity_type='sales_lead' AND entity_id = v_lead AND completed_at IS NULL;
  UPDATE public.staff_work_items SET staff_id = v_to
   WHERE source_table='sales_leads' AND source_id = v_lead AND status NOT IN ('done','cancelled');

  INSERT INTO public.sales_assignment_events (lead_id, account_id, from_staff_id, to_staff_id, rule_kind, reason, actor_user_id)
  VALUES (v_lead, l.account_id, l.sales_staff_id, v_to, 'MANAGER_OVERRIDE', trim(p->>'reason'), auth.uid());
  INSERT INTO public.sales_lead_events (lead_id, action, note, actor_user_id, detail)
  VALUES (v_lead, 'REASSIGNED', trim(p->>'reason'), auth.uid(),
          jsonb_build_object('from', l.sales_staff_id, 'to', v_to));
  RETURN jsonb_build_object('lead_id', v_lead, 'staff_id', v_to);
END $$;

CREATE OR REPLACE VIEW public.v_sales_lead_loss_reasons
WITH (security_invoker = true) AS
SELECT
  coalesce(l.lost_reason_code, 'UNRECORDED') AS reason_code,
  count(*)::int AS leads_lost,
  coalesce(sum(l.estimated_value_kes), 0) AS value_lost_kes
FROM public.sales_leads l
WHERE l.stage IN ('CLOSED_LOST','DISQUALIFIED') AND coalesce(l.is_test, false) = false
GROUP BY 1;

GRANT SELECT ON public.v_sales_lead_loss_reasons TO authenticated;