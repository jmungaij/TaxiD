-- 1. Stage probability register -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_stage_weights (
  stage_key text PRIMARY KEY,
  label text NOT NULL,
  win_probability_pct integer NOT NULL CHECK (win_probability_pct BETWEEN 0 AND 100),
  is_open boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pipeline_stage_weights TO authenticated;
GRANT ALL ON public.pipeline_stage_weights TO service_role;
ALTER TABLE public.pipeline_stage_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stage weights readable by staff" ON public.pipeline_stage_weights;
CREATE POLICY "stage weights readable by staff" ON public.pipeline_stage_weights
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_staff_permission('staff.commercial.read')
         OR public.has_staff_permission('staff.commercial.manage')
         OR public.has_staff_permission('staff.finance.read'));

DROP TRIGGER IF EXISTS trg_pipeline_stage_weights_touch ON public.pipeline_stage_weights;
CREATE TRIGGER trg_pipeline_stage_weights_touch BEFORE UPDATE ON public.pipeline_stage_weights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.pipeline_stage_weights (stage_key, label, win_probability_pct, is_open, sort_order) VALUES
  ('NEW','New — not yet contacted',5,true,10),
  ('CONTACTED','Contacted',10,true,20),
  ('QUALIFIED','Qualified',25,true,30),
  ('QUOTED','Quote sent',45,true,40),
  ('NEGOTIATION','In negotiation',60,true,50),
  ('ACCEPTED','Quote accepted',80,true,60),
  ('CONTRACTED','Contract executed',95,true,70),
  ('BOOKED','Booked',95,true,80),
  ('FULFILLED','Delivered',100,false,90),
  ('WON','Won',100,false,95),
  ('LOST','Lost',0,false,99),
  ('DEFAULT','Stage not recorded',10,true,100)
ON CONFLICT (stage_key) DO NOTHING;

-- 2. Probability-adjusted value ------------------------------------------------
CREATE OR REPLACE FUNCTION public.pipeline_value_of(_value numeric, _stage text, _probability integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH w AS (
    SELECT * FROM public.pipeline_stage_weights
     WHERE stage_key = upper(coalesce(nullif(_stage,''),'DEFAULT'))
    UNION ALL
    SELECT * FROM public.pipeline_stage_weights WHERE stage_key = 'DEFAULT'
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'gross_kes', coalesce(_value,0),
    'stage_key', (SELECT stage_key FROM w),
    'stage_label', (SELECT label FROM w),
    'is_open', (SELECT is_open FROM w),
    'probability_pct', coalesce(_probability, (SELECT win_probability_pct FROM w)),
    'probability_basis', CASE WHEN _probability IS NULL
                              THEN 'pipeline_stage_weights.' || (SELECT stage_key FROM w)
                              ELSE 'recorded probability on the deal' END,
    'weighted_kes', round(coalesce(_value,0) * coalesce(_probability,(SELECT win_probability_pct FROM w)) / 100.0, 2)
  );
$$;
REVOKE ALL ON FUNCTION public.pipeline_value_of(numeric, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pipeline_value_of(numeric, text, integer) TO authenticated, service_role;

-- 3. Push the weighted value onto the open work items of a lead ----------------
CREATE OR REPLACE FUNCTION public.pipeline_work_apply(_lead uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE l record; v jsonb; n integer := 0;
BEGIN
  IF _lead IS NULL THEN RETURN 0; END IF;
  SELECT id, stage, estimated_value_kes INTO l FROM public.sales_leads WHERE id = _lead;
  IF NOT FOUND THEN RETURN 0; END IF;

  v := public.pipeline_value_of(l.estimated_value_kes, l.stage, NULL);

  UPDATE public.staff_work_items
     SET value_score = (v->>'weighted_kes')::numeric,
         updated_at  = now()
   WHERE source_table = 'sales_leads'
     AND source_id = l.id
     AND status NOT IN ('done','closed','cancelled');
  GET DIAGNOSTICS n = ROW_COUNT;

  -- contract work on the same account inherits the same weighted value
  UPDATE public.staff_work_items w
     SET value_score = (v->>'weighted_kes')::numeric, updated_at = now()
    FROM public.commercial_contract_instances c
   WHERE w.source_table = 'commercial_contract_instances'
     AND w.source_id = c.id
     AND c.lead_id = l.id
     AND w.status NOT IN ('done','closed','cancelled')
     AND w.value_score IS DISTINCT FROM (v->>'weighted_kes')::numeric;

  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.pipeline_work_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_work_apply(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._pipeline_lead_value_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.pipeline_work_apply(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pipeline_lead_value_sync ON public.sales_leads;
CREATE TRIGGER trg_pipeline_lead_value_sync
  AFTER UPDATE OF stage, estimated_value_kes ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public._pipeline_lead_value_sync();

-- 4. Dashboard feed -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pipeline_value_dashboard()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_all boolean; v_staff uuid; v_month text := to_char(now(),'YYYY-MM');
BEGIN
  v_staff := public._my_staff_member_id();
  v_all := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
        OR public.has_staff_permission('staff.commercial.read')
        OR public.has_staff_permission('staff.commercial.manage')
        OR public.has_staff_permission('staff.finance.read');
  IF NOT v_all AND v_staff IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;

  RETURN (
    WITH scoped AS (
      SELECT l.*, public.pipeline_value_of(l.estimated_value_kes, l.stage, NULL) AS pv
        FROM public.sales_leads l
       WHERE NOT coalesce(l.is_test,false)
         AND (v_all OR l.sales_staff_id = v_staff)
    ),
    open_leads AS (
      SELECT s.*, (s.pv->>'weighted_kes')::numeric AS weighted,
             coalesce(s.estimated_value_kes,0) AS gross,
             (s.pv->>'probability_pct')::int AS prob,
             (s.pv->>'stage_key') AS stage_key,
             (s.pv->>'stage_label') AS stage_label
        FROM scoped s WHERE (s.pv->>'is_open')::boolean
    ),
    work AS (
      SELECT w.staff_id, count(*) AS open_items,
             coalesce(sum(w.effort_minutes),0) AS effort_minutes,
             coalesce(sum(w.value_score),0) AS work_value
        FROM public.staff_work_items w
       WHERE w.status NOT IN ('done','closed','cancelled')
         AND (v_all OR w.staff_id = v_staff)
       GROUP BY w.staff_id
    )
    SELECT jsonb_build_object(
      'ok', true,
      'scope', CASE WHEN v_all THEN 'all' ELSE 'mine' END,
      'month', v_month,
      'totals', jsonb_build_object(
        'open_deals', (SELECT count(*) FROM open_leads),
        'gross_kes', (SELECT coalesce(sum(gross),0) FROM open_leads),
        'weighted_kes', (SELECT coalesce(sum(weighted),0) FROM open_leads),
        'no_value_recorded', (SELECT count(*) FROM open_leads WHERE gross = 0),
        'revenue_month_kes', (SELECT coalesce(sum(r.amount),0)
                                FROM public.contract_revenue_events r
                                JOIN public.commercial_contract_instances c ON c.id = r.contract_id
                               WHERE NOT c.is_test AND r.revenue_period = v_month
                                 AND (v_all OR r.staff_member_id = v_staff))
      ),
      'by_stage', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'stage_key', t.stage_key, 'stage_label', t.stage_label, 'probability_pct', t.prob,
                     'deals', t.deals, 'gross_kes', t.gross, 'weighted_kes', t.weighted) ORDER BY t.weighted DESC), '[]'::jsonb)
                   FROM (SELECT stage_key, stage_label, max(prob) AS prob, count(*) AS deals,
                                sum(gross) AS gross, sum(weighted) AS weighted
                           FROM open_leads GROUP BY stage_key, stage_label) t),
      'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'account_id', a.account_id, 'account_name', a.account_name,
                     'deals', a.deals, 'gross_kes', a.gross, 'weighted_kes', a.weighted,
                     'best_stage', a.best_stage, 'best_probability_pct', a.prob,
                     'contracted_kes', a.contracted, 'revenue_kes', a.revenue,
                     'next_action', a.next_action) ORDER BY a.weighted DESC), '[]'::jsonb)
                   FROM (
                     SELECT ol.account_id,
                            coalesce(max(ac.name), max(ol.organisation_name), 'Organisation not recorded') AS account_name,
                            count(*) AS deals, sum(ol.gross) AS gross, sum(ol.weighted) AS weighted,
                            (array_agg(ol.stage_label ORDER BY ol.weighted DESC))[1] AS best_stage,
                            max(ol.prob) AS prob,
                            coalesce((SELECT sum(c.value_amount) FROM public.commercial_contract_instances c
                                       WHERE c.account_id = ol.account_id AND NOT c.is_test), 0) AS contracted,
                            coalesce((SELECT sum(r.amount) FROM public.contract_revenue_events r
                                        JOIN public.commercial_contract_instances c2 ON c2.id = r.contract_id
                                       WHERE c2.account_id = ol.account_id AND NOT c2.is_test), 0) AS revenue,
                            (array_agg(w2.next_action ORDER BY w2.updated_at DESC))[1] AS next_action
                       FROM open_leads ol
                       LEFT JOIN public.crm_accounts ac ON ac.id = ol.account_id
                       LEFT JOIN public.staff_work_items w2
                              ON w2.source_table = 'sales_leads' AND w2.source_id = ol.id
                             AND w2.status NOT IN ('done','closed','cancelled')
                      GROUP BY ol.account_id
                      ORDER BY sum(ol.weighted) DESC
                      LIMIT 25) a),
      'owners', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'staff_id', o.sales_staff_id, 'staff_name', o.staff_name,
                   'deals', o.deals, 'gross_kes', o.gross, 'weighted_kes', o.weighted,
                   'open_work_items', coalesce(o.open_items,0),
                   'open_effort_minutes', coalesce(o.effort_minutes,0)) ORDER BY o.weighted DESC), '[]'::jsonb)
                 FROM (SELECT ol.sales_staff_id, max(sm.full_name) AS staff_name, count(*) AS deals,
                              sum(ol.gross) AS gross, sum(ol.weighted) AS weighted,
                              max(wk.open_items) AS open_items, max(wk.effort_minutes) AS effort_minutes
                         FROM open_leads ol
                         LEFT JOIN public.staff_members sm ON sm.id = ol.sales_staff_id
                         LEFT JOIN work wk ON wk.staff_id = ol.sales_staff_id
                        GROUP BY ol.sales_staff_id) o)
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.pipeline_value_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pipeline_value_dashboard() TO authenticated, service_role;