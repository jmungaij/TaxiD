-- ============================================================
-- Work triage foundation: norms, bands, capacity, scoring
-- ============================================================

CREATE TABLE public.work_triage_bands (
  band text PRIMARY KEY,
  rank_order integer NOT NULL,
  label text NOT NULL,
  priority text NOT NULL,
  sla_multiplier numeric NOT NULL DEFAULT 1,
  effort_multiplier numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.work_triage_bands TO authenticated;
GRANT ALL ON public.work_triage_bands TO service_role;
ALTER TABLE public.work_triage_bands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_triage_bands_read" ON public.work_triage_bands
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_triage_bands_admin" ON public.work_triage_bands
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.work_triage_norms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_kind text NOT NULL,
  stage_key text NOT NULL DEFAULT 'DEFAULT',
  label text NOT NULL,
  effort_minutes integer NOT NULL,
  sla_minutes integer,
  default_band text NOT NULL DEFAULT 'P3' REFERENCES public.work_triage_bands(band),
  next_action_template text,
  expected_outcome text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_kind, stage_key)
);
GRANT SELECT ON public.work_triage_norms TO authenticated;
GRANT ALL ON public.work_triage_norms TO service_role;
ALTER TABLE public.work_triage_norms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_triage_norms_read" ON public.work_triage_norms
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_triage_norms_admin" ON public.work_triage_norms
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.work_capacity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text NOT NULL UNIQUE,
  label text NOT NULL,
  working_minutes integer NOT NULL DEFAULT 480,
  meeting_reserve_minutes integer NOT NULL DEFAULT 60,
  break_reserve_minutes integer NOT NULL DEFAULT 45,
  admin_reserve_minutes integer NOT NULL DEFAULT 45,
  focus_block_minutes integer NOT NULL DEFAULT 50,
  productive_minutes integer GENERATED ALWAYS AS
    (GREATEST(working_minutes - meeting_reserve_minutes - break_reserve_minutes - admin_reserve_minutes, 0)) STORED,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.work_capacity_profiles TO authenticated;
GRANT ALL ON public.work_capacity_profiles TO service_role;
ALTER TABLE public.work_capacity_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_capacity_profiles_read" ON public.work_capacity_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_capacity_profiles_admin" ON public.work_capacity_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_work_triage_bands_touch BEFORE UPDATE ON public.work_triage_bands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_work_triage_norms_touch BEFORE UPDATE ON public.work_triage_norms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_work_capacity_profiles_touch BEFORE UPDATE ON public.work_capacity_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- work item triage columns ----------
ALTER TABLE public.staff_work_items
  ADD COLUMN IF NOT EXISTS priority_band text NOT NULL DEFAULT 'P3',
  ADD COLUMN IF NOT EXISTS effort_minutes integer,
  ADD COLUMN IF NOT EXISTS effort_basis text,
  ADD COLUMN IF NOT EXISTS triage_score numeric,
  ADD COLUMN IF NOT EXISTS value_score numeric;

CREATE INDEX IF NOT EXISTS idx_staff_work_items_band ON public.staff_work_items (staff_id, priority_band, status);

-- ---------- seed bands ----------
INSERT INTO public.work_triage_bands (band, rank_order, label, priority, sla_multiplier, effort_multiplier) VALUES
  ('P1', 1, 'Immediate commercial risk', 'critical', 0.5,  1.0),
  ('P2', 2, 'High value',                'high',     0.75, 1.0),
  ('P3', 3, 'Active',                    'medium',   1.0,  1.0),
  ('P4', 4, 'Routine',                   'low',      2.0,  0.75),
  ('P5', 5, 'Nurture',                   'low',      4.0,  0.5);

-- ---------- seed norms ----------
INSERT INTO public.work_triage_norms
  (work_kind, stage_key, label, effort_minutes, sla_minutes, default_band, next_action_template, expected_outcome) VALUES
  ('sales_opportunity','NEW','First response to a new enquiry',10,120,'P3',
   'Owner contacts {org} by {due} to acknowledge the enquiry and confirm the requirement',
   'Requirement confirmed and enquiry either qualified or disqualified'),
  ('sales_opportunity','QUALIFICATION','Qualify the enquiry',20,480,'P3',
   'Owner qualifies {org} by {due} against budget, authority, need and timing',
   'Qualification recorded with a decision to progress or disqualify'),
  ('sales_opportunity','QUALIFIED','Discovery with a qualified enquiry',45,1440,'P3',
   'Owner runs discovery with {org} by {due} to establish scope, volumes and decision process',
   'Documented requirement ready for pricing'),
  ('sales_opportunity','OPPORTUNITY','Prepare a priced proposal',60,2880,'P3',
   'Owner issues a priced proposal to {org} by {due}',
   'Proposal issued from an approved rate card'),
  ('sales_opportunity','QUOTED','Follow up an issued proposal',20,1440,'P2',
   'Owner follows up the proposal with {org} by {due} to confirm receipt and the decision date',
   'Decision date agreed or objection recorded'),
  ('sales_opportunity','ACCEPTED','Conclude contracting',45,1440,'P2',
   'Owner concludes the contract with {org} by {due}',
   'Contract executed and ready for activation'),
  ('sales_opportunity','INFORMATION_RESPONSE','Resume after a customer reply',15,240,'P2',
   'Owner replies to {org} by {due} and resumes the commercial conversation',
   'Conversation resumed with the next commercial step agreed'),
  ('sales_opportunity','DEFAULT','Sales follow-up',20,1440,'P3',
   'Owner progresses {org} by {due} to the next commercial step',
   'Next commercial step recorded'),
  ('customer_case','BOOKED','Activate a contracted account',60,1440,'P2',
   'Owner activates {org} by {due} and hands over to delivery',
   'Account active with delivery briefed'),
  ('customer_case','FULFILLED','Hand over to customer success',30,2880,'P3',
   'Owner hands {org} over to customer success by {due}',
   'Handover accepted by customer success'),
  ('customer_case','DEFAULT','Customer case',30,1440,'P3',
   'Owner resolves the {org} case by {due}',
   'Case resolved with the customer informed'),
  ('admin_task','DEFAULT','Administrative task',10,NULL,'P4',
   'Owner completes this task by {due}','Task completed'),
  ('operations_task','DEFAULT','Operations task',30,480,'P3',
   'Owner completes this operations task by {due}','Task completed and recorded');

-- ---------- seed capacity profiles ----------
INSERT INTO public.work_capacity_profiles
  (role_key, label, working_minutes, meeting_reserve_minutes, break_reserve_minutes, admin_reserve_minutes, focus_block_minutes) VALUES
  ('DEFAULT','Standard staff day',480,60,45,45,50),
  ('sales','Sales specialist day',480,90,45,45,50),
  ('operations','Operations day',480,45,45,60,45),
  ('manager','Manager day',480,180,45,45,45),
  ('intern','Intern day',360,45,45,45,45);

-- ============================================================
-- Lead triage scoring
-- ============================================================
CREATE OR REPLACE FUNCTION public.sales_lead_triage(_lead_id uuid, _stage_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  l record; a record; n record; b record;
  v_stage text; v_score numeric := 0; v_value numeric := 0;
  v_band text; v_sla integer; v_effort integer; v_next text; v_due timestamptz;
  v_reasons jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO l FROM public.sales_leads WHERE id = _lead_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT importance_tier, territory INTO a FROM public.crm_accounts WHERE id = l.account_id;

  v_stage := coalesce(_stage_key, CASE WHEN l.stage IS NULL OR l.stage = '' THEN 'NEW' ELSE l.stage END);

  -- value (0-35): derived from the lead's own recorded estimate
  v_value := coalesce(l.estimated_value_kes, 0);
  v_score := v_score + LEAST(35, CASE
    WHEN v_value >= 3000000 THEN 35
    WHEN v_value >= 1000000 THEN 28
    WHEN v_value >= 300000  THEN 20
    WHEN v_value >= 50000   THEN 12
    WHEN v_value > 0        THEN 6
    ELSE 0 END);
  IF v_value = 0 THEN
    v_reasons := v_reasons || jsonb_build_object('factor','value','note','No value recorded yet');
  ELSE
    v_reasons := v_reasons || jsonb_build_object('factor','value','note','Estimated value KSh ' || round(v_value)::text);
  END IF;

  -- account importance (0-15)
  v_score := v_score + CASE upper(coalesce(a.importance_tier,''))
    WHEN 'STRATEGIC' THEN 15 WHEN 'KEY' THEN 12 WHEN 'GROWTH' THEN 8 WHEN 'STANDARD' THEN 4 ELSE 0 END;

  -- contact quality / reachable decision maker (0-15)
  IF coalesce(l.contact_name,'') <> '' THEN v_score := v_score + 5; END IF;
  IF coalesce(l.contact_email,'') <> '' THEN v_score := v_score + 5; END IF;
  IF coalesce(l.contact_phone,'') <> '' THEN v_score := v_score + 5; END IF;
  IF coalesce(l.contact_name,'') = '' AND coalesce(l.contact_email,'') = '' AND coalesce(l.contact_phone,'') = '' THEN
    v_reasons := v_reasons || jsonb_build_object('factor','contact','note','No usable contact details recorded');
  END IF;

  -- engagement (0-20): the lead has actually replied to us
  IF l.last_reply_at IS NOT NULL AND l.last_reply_at > now() - interval '7 days' THEN
    v_score := v_score + 20;
    v_reasons := v_reasons || jsonb_build_object('factor','engagement','note','Replied in the last 7 days');
  ELSIF l.first_reply_at IS NOT NULL THEN
    v_score := v_score + 12;
    v_reasons := v_reasons || jsonb_build_object('factor','engagement','note','Has replied at least once');
  ELSIF l.first_outreach_at IS NULL THEN
    v_score := v_score + 6;
    v_reasons := v_reasons || jsonb_build_object('factor','engagement','note','Never contacted yet');
  END IF;

  -- urgency (0-15): a dated service commitment approaching
  IF l.service_date IS NOT NULL THEN
    IF l.service_date <= current_date + 3 THEN v_score := v_score + 15;
      v_reasons := v_reasons || jsonb_build_object('factor','urgency','note','Service date within 3 days');
    ELSIF l.service_date <= current_date + 14 THEN v_score := v_score + 9;
    ELSIF l.service_date <= current_date + 45 THEN v_score := v_score + 4;
    END IF;
  END IF;

  -- late-funnel work is inherently closer to revenue
  IF v_stage IN ('QUOTED','ACCEPTED','BOOKED') THEN v_score := v_score + 8; END IF;

  v_score := LEAST(100, GREATEST(0, v_score));

  SELECT * INTO n FROM public.work_triage_norms
   WHERE work_kind = CASE WHEN v_stage IN ('BOOKED','FULFILLED') THEN 'customer_case' ELSE 'sales_opportunity' END
     AND stage_key = v_stage AND is_active
   LIMIT 1;
  IF n IS NULL THEN
    SELECT * INTO n FROM public.work_triage_norms
     WHERE work_kind = CASE WHEN v_stage IN ('BOOKED','FULFILLED') THEN 'customer_case' ELSE 'sales_opportunity' END
       AND stage_key = 'DEFAULT' AND is_active LIMIT 1;
  END IF;

  v_band := CASE
    WHEN v_score >= 78 THEN 'P1'
    WHEN v_score >= 58 THEN 'P2'
    WHEN v_score >= 38 THEN 'P3'
    WHEN v_score >= 18 THEN 'P4'
    ELSE 'P5' END;

  SELECT * INTO b FROM public.work_triage_bands WHERE band = v_band;

  v_effort := GREATEST(5, round(coalesce(n.effort_minutes, 20) * coalesce(b.effort_multiplier, 1))::int);
  v_sla := CASE WHEN n.sla_minutes IS NULL THEN NULL
                ELSE GREATEST(15, round(n.sla_minutes * coalesce(b.sla_multiplier, 1))::int) END;
  v_due := CASE WHEN v_sla IS NULL THEN NULL ELSE now() + make_interval(mins => v_sla) END;

  v_next := replace(
              replace(coalesce(n.next_action_template, 'Owner progresses {org} by {due}'),
                      '{org}', coalesce(nullif(l.organisation_name,''), coalesce(l.lead_ref,'this lead'))),
              '{due}', coalesce(to_char(v_due, 'DD Mon YYYY HH24:MI'), 'the agreed date'));
  IF coalesce(n.expected_outcome,'') <> '' THEN
    v_next := v_next || ' — expected outcome: ' || n.expected_outcome;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', l.id, 'stage_key', v_stage, 'score', v_score, 'band', v_band,
    'priority', coalesce(b.priority,'medium'), 'sla_minutes', v_sla,
    'effort_minutes', v_effort, 'effort_basis', 'norm:' || coalesce(n.stage_key,'DEFAULT'),
    'value_kes', v_value, 'next_action', v_next, 'norm_label', n.label, 'reasons', v_reasons);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_triage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_triage(uuid, text) TO authenticated, service_role;

-- ============================================================
-- Triaged work creation used by the lead orchestrator
-- ============================================================
CREATE OR REPLACE FUNCTION public._sales_work_ensure_triaged(
  _staff uuid, _kind text, _title text, _description text,
  _lead_id uuid, _entity_ref text, _stage_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE t jsonb; v_id uuid; v_sla integer;
BEGIN
  IF _staff IS NULL THEN RETURN NULL; END IF;
  t := public.sales_lead_triage(_lead_id, _stage_key);
  IF t IS NULL THEN
    RETURN public._sales_work_ensure(_staff,_kind,_title,_description,'sales_leads',_lead_id,_entity_ref,'medium',NULL);
  END IF;
  v_sla := nullif(t->>'sla_minutes','')::int;

  v_id := public._sales_work_ensure(_staff,_kind,_title,_description,'sales_leads',_lead_id,_entity_ref,
                                    t->>'priority', v_sla);
  IF v_id IS NOT NULL THEN
    UPDATE public.staff_work_items
       SET priority_band  = t->>'band',
           priority       = t->>'priority',
           effort_minutes = (t->>'effort_minutes')::int,
           effort_basis   = t->>'effort_basis',
           triage_score   = (t->>'score')::numeric,
           value_score    = (t->>'value_kes')::numeric,
           next_action    = t->>'next_action',
           next_action_due = CASE WHEN v_sla IS NOT NULL
                                  THEN (now() + make_interval(mins => v_sla))::date
                                  ELSE next_action_due END,
           updated_at = now()
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public._sales_work_ensure_triaged(uuid,text,text,text,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sales_work_ensure_triaged(uuid,text,text,text,uuid,text,text) TO service_role;

-- ============================================================
-- Lead orchestrator: triage instead of hard-coded 'high' + NULL SLA
-- ============================================================
CREATE OR REPLACE FUNCTION public._sales_lead_orchestrate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_ctx jsonb; v_tier text; v_terr text; v_ref text := NEW.lead_ref; v_wi uuid;
BEGIN
  SELECT importance_tier, territory INTO v_tier, v_terr FROM public.crm_accounts WHERE id = NEW.account_id;
  v_ctx := jsonb_build_object('service', NEW.service_interest, 'source', NEW.source,
                              'tier', v_tier, 'territory', v_terr);

  IF TG_OP = 'INSERT' THEN
    v_wi := public._sales_work_ensure_triaged(NEW.sales_staff_id,'sales_opportunity',
      'Respond to ' || NEW.organisation_name || ' enquiry',
      'First meaningful sales response required for ' || NEW.service_interest || '.',
      NEW.id, v_ref, 'NEW');
    PERFORM public._sales_sla_start('LEAD_RESPONSE','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,v_wi,NEW.is_test);
    INSERT INTO public.sales_assignment_events (lead_id, account_id, to_staff_id, rule_kind, reason, actor_user_id, detail)
    VALUES (NEW.id, NEW.account_id, NEW.sales_staff_id, coalesce(NEW.source,'staff_capture'),
            'Lead created and assigned', auth.uid(), jsonb_build_object('lead_ref', v_ref));
    RETURN NEW;
  END IF;

  IF coalesce(OLD.information_request,'') = '' AND coalesce(NEW.information_request,'') <> '' THEN
    PERFORM public._sales_sla_pause('sales_lead', NEW.id, 'Awaiting customer information');
  ELSIF coalesce(OLD.information_request,'') <> '' AND coalesce(NEW.information_request,'') = '' THEN
    PERFORM public._sales_sla_resume('sales_lead', NEW.id, 'Customer responded');
    PERFORM public._sales_sla_start('INFORMATION_REQUEST','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
    PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'sales_opportunity',
      'Follow up customer response — ' || NEW.organisation_name,
      'The customer has replied; resume the commercial conversation.',
      NEW.id, v_ref, 'INFORMATION_RESPONSE');
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NEW.stage = 'QUALIFIED' THEN
      PERFORM public._sales_sla_complete('LEAD_RESPONSE','sales_lead',NEW.id,'Lead qualified');
      PERFORM public._sales_sla_complete('QUALIFICATION','sales_lead',NEW.id,'Lead qualified');
      PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'sales_opportunity',
        'Run discovery with ' || NEW.organisation_name, 'Qualified enquiry: establish requirement and prepare a proposal.',
        NEW.id, v_ref, 'QUALIFIED');
    ELSIF NEW.stage = 'OPPORTUNITY' THEN
      PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'sales_opportunity',
        'Prepare proposal for ' || NEW.organisation_name, 'Opportunity open: issue a priced proposal.',
        NEW.id, v_ref, 'OPPORTUNITY');
    ELSIF NEW.stage = 'QUOTED' THEN
      PERFORM public._sales_sla_start('PROPOSAL_FOLLOWUP','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
      PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'sales_opportunity',
        'Follow up proposal — ' || NEW.organisation_name, 'Proposal issued: confirm receipt and progress the decision.',
        NEW.id, v_ref, 'QUOTED');
    ELSIF NEW.stage = 'ACCEPTED' THEN
      PERFORM public._sales_sla_complete('PROPOSAL_FOLLOWUP','sales_lead',NEW.id,'Proposal accepted');
      PERFORM public._sales_sla_start('CONTRACT_FOLLOWUP','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
      PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'sales_opportunity',
        'Complete contracting — ' || NEW.organisation_name, 'Proposal accepted: issue and conclude the contract.',
        NEW.id, v_ref, 'ACCEPTED');
    ELSIF NEW.stage = 'BOOKED' THEN
      PERFORM public._sales_sla_complete('CONTRACT_FOLLOWUP','sales_lead',NEW.id,'Contract concluded');
      PERFORM public._sales_sla_start('ACCOUNT_ACTIVATION','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
      PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'customer_case',
        'Activate account — ' || NEW.organisation_name, 'Contract concluded: activate the account and hand over to delivery.',
        NEW.id, v_ref, 'BOOKED');
    ELSIF NEW.stage = 'FULFILLED' THEN
      PERFORM public._sales_sla_complete('ACCOUNT_ACTIVATION','sales_lead',NEW.id,'Account activated');
      PERFORM public._sales_work_ensure_triaged(NEW.sales_staff_id,'customer_case',
        'Hand over to customer success — ' || NEW.organisation_name, 'Service running: complete the customer handover.',
        NEW.id, v_ref, 'FULFILLED');
    ELSIF NEW.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') THEN
      PERFORM public._sales_sla_complete(NULL,'sales_lead',NEW.id,'Lead closed: ' || NEW.stage);
      UPDATE public.staff_work_items
         SET status = 'done', lifecycle_state = 'closed', closed_at = now(),
             resolution = 'Lead ' || NEW.stage
       WHERE source_table = 'sales_leads' AND source_id = NEW.id AND status NOT IN ('done','cancelled');
    END IF;
  END IF;
  RETURN NEW;
END $function$;