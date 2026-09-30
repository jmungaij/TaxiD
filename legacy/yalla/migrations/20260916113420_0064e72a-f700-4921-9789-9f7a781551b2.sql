-- 1. Structured loss detail -------------------------------------------------
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS lost_competitor text,
  ADD COLUMN IF NOT EXISTS lost_expected_price_kes numeric,
  ADD COLUMN IF NOT EXISTS lost_revisit_date date;

CREATE OR REPLACE FUNCTION public.sales_lead_mark_lost(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l public.sales_leads;
  v_code text; v_note text; v_to text;
  v_competitor text; v_price numeric; v_revisit date;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);
  v_code := upper(trim(coalesce(p->>'reason_code','')));
  v_note := nullif(trim(coalesce(p->>'note','')),'');
  v_competitor := nullif(trim(coalesce(p->>'competitor','')),'');
  v_price := nullif(trim(coalesce(p->>'expected_price_kes','')),'')::numeric;
  v_revisit := nullif(trim(coalesce(p->>'revisit_date','')),'')::date;

  IF v_code NOT IN ('PRICE_TOO_HIGH','LOST_TO_COMPETITOR','TIMING','NO_BUDGET','NO_RESPONSE','OTHER') THEN
    RAISE EXCEPTION 'LOSS_REASON_REQUIRED';
  END IF;
  IF l.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') THEN RAISE EXCEPTION 'LEAD_ALREADY_CLOSED'; END IF;

  IF v_code = 'LOST_TO_COMPETITOR' AND v_competitor IS NULL THEN
    RAISE EXCEPTION 'COMPETITOR_NAME_REQUIRED';
  END IF;
  IF v_code = 'PRICE_TOO_HIGH' AND (v_price IS NULL OR v_price <= 0) THEN
    RAISE EXCEPTION 'EXPECTED_PRICE_REQUIRED';
  END IF;
  IF v_code = 'TIMING' AND v_revisit IS NULL THEN
    RAISE EXCEPTION 'REVISIT_DATE_REQUIRED';
  END IF;
  IF v_code IN ('NO_BUDGET','NO_RESPONSE','OTHER') AND (v_note IS NULL OR length(v_note) < 5) THEN
    RAISE EXCEPTION 'EXPLANATION_REQUIRED';
  END IF;
  IF v_revisit IS NOT NULL AND v_revisit < current_date THEN
    RAISE EXCEPTION 'REVISIT_DATE_MUST_BE_FUTURE';
  END IF;

  v_to := CASE WHEN l.stage = 'NEW' THEN 'DISQUALIFIED' ELSE 'CLOSED_LOST' END;
  UPDATE public.sales_leads
     SET stage = v_to, lost_reason_code = v_code, lost_reason = v_note,
         lost_competitor = v_competitor, lost_expected_price_kes = v_price,
         lost_revisit_date = v_revisit,
         closed_at = now(), waiting_on = NULL, awaiting_item = NULL, awaiting_due_date = NULL,
         updated_at = now()
   WHERE id = l.id;
  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, note, actor_user_id, detail)
  VALUES (l.id, 'LOST', l.stage, v_to, v_note, auth.uid(),
          jsonb_build_object('reason_code', v_code, 'competitor', v_competitor,
                             'expected_price_kes', v_price, 'revisit_date', v_revisit));
  RETURN jsonb_build_object('lead_id', l.id, 'stage', v_to, 'reason_code', v_code);
END $function$;

-- 2. Reminder thresholds ----------------------------------------------------
ALTER TABLE public.sales_engine_settings
  ADD COLUMN IF NOT EXISTS reminder_days_to_meeting integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS reminder_days_meeting_to_quote integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS reminder_days_quote_to_contract integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS reminder_days_contract_to_signed integer NOT NULL DEFAULT 7;

-- 3. Visibility helper ------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sales_lead_visible(_lead uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    EXISTS (
      SELECT 1 FROM public.sales_leads l
       WHERE l.id = _lead
         AND (l.sales_staff_id = public._my_staff_member_id()
              OR public.has_staff_permission('staff.crm.manage') IS TRUE)
    ), false)
$function$;

-- 4. Reminder snooze / dismissal state -------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_lead_reminder_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  reminder_kind text NOT NULL,
  snoozed_until date,
  dismissed_at timestamptz,
  note text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, reminder_kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_lead_reminder_state TO authenticated;
GRANT ALL ON public.sales_lead_reminder_state TO service_role;

ALTER TABLE public.sales_lead_reminder_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reminder state readable by lead owner or sales management" ON public.sales_lead_reminder_state;
CREATE POLICY "reminder state readable by lead owner or sales management"
  ON public.sales_lead_reminder_state FOR SELECT TO authenticated
  USING (public._sales_lead_visible(lead_id));

DROP POLICY IF EXISTS "reminder state written by lead owner or sales management" ON public.sales_lead_reminder_state;
CREATE POLICY "reminder state written by lead owner or sales management"
  ON public.sales_lead_reminder_state FOR ALL TO authenticated
  USING (public._sales_lead_visible(lead_id))
  WITH CHECK (public._sales_lead_visible(lead_id));

CREATE OR REPLACE FUNCTION public._sales_reminder_touch()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

DROP TRIGGER IF EXISTS trg_sales_lead_reminder_state_touch ON public.sales_lead_reminder_state;
CREATE TRIGGER trg_sales_lead_reminder_state_touch
  BEFORE UPDATE ON public.sales_lead_reminder_state
  FOR EACH ROW EXECUTE FUNCTION public._sales_reminder_touch();

CREATE OR REPLACE FUNCTION public.sales_lead_reminder_ack(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  l public.sales_leads;
  v_kind text; v_until date; v_dismiss boolean; v_note text;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);
  v_kind := upper(trim(coalesce(p->>'reminder_kind','')));
  IF v_kind NOT IN ('NO_MEETING','NO_QUOTE','NO_CONTRACT','NOT_SIGNED','CLIENT_OVERDUE') THEN
    RAISE EXCEPTION 'UNKNOWN_REMINDER_KIND';
  END IF;
  v_dismiss := coalesce((p->>'dismiss')::boolean, false);
  v_until := nullif(trim(coalesce(p->>'snoozed_until','')),'')::date;
  v_note := nullif(trim(coalesce(p->>'note','')),'');

  IF NOT v_dismiss AND v_until IS NULL THEN RAISE EXCEPTION 'SNOOZE_DATE_REQUIRED'; END IF;
  IF v_until IS NOT NULL AND v_until <= current_date THEN RAISE EXCEPTION 'SNOOZE_DATE_MUST_BE_FUTURE'; END IF;
  IF v_dismiss AND (v_note IS NULL OR length(v_note) < 5) THEN RAISE EXCEPTION 'DISMISS_NOTE_REQUIRED'; END IF;

  INSERT INTO public.sales_lead_reminder_state (lead_id, reminder_kind, snoozed_until, dismissed_at, note, actor_user_id)
  VALUES (l.id, v_kind, v_until, CASE WHEN v_dismiss THEN now() END, v_note, auth.uid())
  ON CONFLICT (lead_id, reminder_kind) DO UPDATE
    SET snoozed_until = EXCLUDED.snoozed_until,
        dismissed_at = EXCLUDED.dismissed_at,
        note = EXCLUDED.note,
        actor_user_id = EXCLUDED.actor_user_id,
        updated_at = now();

  INSERT INTO public.sales_lead_events (lead_id, action, stage_from, stage_to, note, actor_user_id, detail)
  VALUES (l.id, CASE WHEN v_dismiss THEN 'REMINDER_DISMISSED' ELSE 'REMINDER_SNOOZED' END,
          l.stage, l.stage, v_note, auth.uid(),
          jsonb_build_object('reminder_kind', v_kind, 'snoozed_until', v_until));

  RETURN jsonb_build_object('lead_id', l.id, 'reminder_kind', v_kind,
                            'snoozed_until', v_until, 'dismissed', v_dismiss);
END $function$;

REVOKE ALL ON FUNCTION public.sales_lead_reminder_ack(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_reminder_ack(jsonb) TO authenticated;

-- 5. Reminder projection ----------------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_lead_reminders
WITH (security_invoker = on) AS
WITH cfg AS (
  SELECT
    coalesce(max(reminder_days_to_meeting), 5) AS d_meeting,
    coalesce(max(reminder_days_meeting_to_quote), 3) AS d_quote,
    coalesce(max(reminder_days_quote_to_contract), 5) AS d_contract,
    coalesce(max(reminder_days_contract_to_signed), 7) AS d_signed
  FROM public.sales_engine_settings
), base AS (
  SELECT
    l.id AS lead_id, l.lead_ref, l.organisation_name, l.contact_name,
    l.sales_staff_id, l.stage, l.waiting_on, l.awaiting_item, l.awaiting_due_date,
    CASE
      WHEN l.waiting_on = 'CLIENT' AND l.awaiting_due_date IS NOT NULL
           AND l.awaiting_due_date < current_date THEN 'CLIENT_OVERDUE'
      WHEN l.contract_shared_at IS NOT NULL AND l.contract_signed_at IS NULL
           AND l.contract_shared_at < now() - make_interval(days => c.d_signed) THEN 'NOT_SIGNED'
      WHEN l.quote_shared_at IS NOT NULL AND l.contract_shared_at IS NULL
           AND l.quote_shared_at < now() - make_interval(days => c.d_contract) THEN 'NO_CONTRACT'
      WHEN l.meeting_held_at IS NOT NULL AND l.quote_shared_at IS NULL
           AND l.meeting_held_at < now() - make_interval(days => c.d_quote) THEN 'NO_QUOTE'
      WHEN l.meeting_held_at IS NULL
           AND l.created_at < now() - make_interval(days => c.d_meeting) THEN 'NO_MEETING'
      ELSE NULL
    END AS reminder_kind,
    GREATEST(0, (current_date - COALESCE(
      CASE
        WHEN l.waiting_on = 'CLIENT' AND l.awaiting_due_date < current_date THEN l.awaiting_due_date
        WHEN l.contract_shared_at IS NOT NULL AND l.contract_signed_at IS NULL
          THEN (l.contract_shared_at + make_interval(days => c.d_signed))::date
        WHEN l.quote_shared_at IS NOT NULL AND l.contract_shared_at IS NULL
          THEN (l.quote_shared_at + make_interval(days => c.d_contract))::date
        WHEN l.meeting_held_at IS NOT NULL AND l.quote_shared_at IS NULL
          THEN (l.meeting_held_at + make_interval(days => c.d_quote))::date
        ELSE (l.created_at + make_interval(days => c.d_meeting))::date
      END, current_date)))::integer AS days_overdue
  FROM public.sales_leads l CROSS JOIN cfg c
  WHERE coalesce(l.is_test, false) = false
    AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
)
SELECT b.lead_id, b.lead_ref, b.organisation_name, b.contact_name, b.sales_staff_id,
       coalesce(s.full_name,'Unassigned') AS staff_name,
       b.stage, b.reminder_kind, b.days_overdue,
       b.waiting_on, b.awaiting_item, b.awaiting_due_date,
       r.snoozed_until, r.dismissed_at
  FROM base b
  LEFT JOIN public.staff_members s ON s.id = b.sales_staff_id
  LEFT JOIN public.sales_lead_reminder_state r
         ON r.lead_id = b.lead_id AND r.reminder_kind = b.reminder_kind
 WHERE b.reminder_kind IS NOT NULL
   AND r.dismissed_at IS NULL
   AND (r.snoozed_until IS NULL OR r.snoozed_until <= current_date);

GRANT SELECT ON public.v_sales_lead_reminders TO authenticated;

-- 6. Stage detail and loss detail ------------------------------------------
CREATE OR REPLACE VIEW public.v_sales_lead_stage_detail
WITH (security_invoker = on) AS
SELECT l.id AS lead_id, l.lead_ref, l.organisation_name, l.contact_name, l.service_interest,
       l.sales_staff_id, coalesce(s.full_name,'Unassigned') AS staff_name,
       l.stage, l.estimated_value_kes, l.won_revenue_kes,
       l.meeting_held_at, l.quote_shared_at, l.contract_shared_at, l.contract_signed_at,
       l.waiting_on, l.awaiting_item, l.awaiting_due_date,
       l.lost_reason_code, l.lost_reason, l.lost_competitor, l.lost_expected_price_kes,
       l.lost_revisit_date, l.closed_at, l.created_at, l.updated_at
  FROM public.sales_leads l
  LEFT JOIN public.staff_members s ON s.id = l.sales_staff_id
 WHERE coalesce(l.is_test, false) = false;

GRANT SELECT ON public.v_sales_lead_stage_detail TO authenticated;

CREATE OR REPLACE VIEW public.v_sales_loss_detail_by_owner
WITH (security_invoker = on) AS
SELECT l.sales_staff_id, coalesce(s.full_name,'Unassigned') AS staff_name,
       coalesce(l.lost_reason_code,'UNRECORDED') AS reason_code,
       count(*)::integer AS leads_lost,
       coalesce(sum(l.estimated_value_kes),0) AS value_lost_kes,
       count(*) FILTER (WHERE l.lost_competitor IS NOT NULL)::integer AS with_competitor_named,
       coalesce(avg(l.lost_expected_price_kes),0) AS avg_expected_price_kes
  FROM public.sales_leads l
  LEFT JOIN public.staff_members s ON s.id = l.sales_staff_id
 WHERE coalesce(l.is_test, false) = false
   AND l.stage IN ('CLOSED_LOST','DISQUALIFIED')
 GROUP BY l.sales_staff_id, s.full_name, coalesce(l.lost_reason_code,'UNRECORDED');

GRANT SELECT ON public.v_sales_loss_detail_by_owner TO authenticated;