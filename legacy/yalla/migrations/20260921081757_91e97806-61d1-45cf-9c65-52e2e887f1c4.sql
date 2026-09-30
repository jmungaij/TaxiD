-- =============================================================
-- Competitive Pricing Engine — upgrade of the existing rate card
-- Recommended price != selling price
-- =============================================================

/* ---------- 1. Configurable service types ---------- */
CREATE TABLE IF NOT EXISTS public.pricing_service_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_service_types TO authenticated;
GRANT ALL ON public.pricing_service_types TO service_role;
ALTER TABLE public.pricing_service_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read service types" ON public.pricing_service_types
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.commercial.read'));
CREATE POLICY "admin write service types" ON public.pricing_service_types
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

INSERT INTO public.pricing_service_types (code, label, sort_order) VALUES
  ('day_trip','Day trip charges',10),
  ('executive','Executive categories',20),
  ('pwd','PWD category',30),
  ('offroad','Offroad categories',40),
  ('airport_transfer','Airport transfers',50),
  ('monthly_long_term','Monthly / long-term',60)
ON CONFLICT (code) DO NOTHING;

/* ---------- 2. Rate items: configurable basis, distance, time ---------- */
ALTER TABLE public.commercial_rate_lines
  ADD COLUMN IF NOT EXISTS distance_unit text NOT NULL DEFAULT 'km',
  ADD COLUMN IF NOT EXISTS excess_distance_rate numeric(14,2),
  ADD COLUMN IF NOT EXISTS included_hours numeric(8,2),
  ADD COLUMN IF NOT EXISTS excess_hour_rate numeric(14,2),
  ADD COLUMN IF NOT EXISTS waiting_rate_per_hour numeric(14,2),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE public.commercial_rate_lines DROP CONSTRAINT IF EXISTS commercial_rate_lines_pricing_basis_check;
ALTER TABLE public.commercial_rate_lines ADD CONSTRAINT commercial_rate_lines_pricing_basis_check
  CHECK (pricing_basis = ANY (ARRAY['per_day','per_trip','per_month','per_hour','per_km','per_route','hybrid']));
ALTER TABLE public.commercial_rate_lines DROP CONSTRAINT IF EXISTS commercial_rate_lines_service_code_check;
ALTER TABLE public.commercial_rate_lines ADD CONSTRAINT commercial_rate_lines_service_code_fkey
  FOREIGN KEY (service_code) REFERENCES public.pricing_service_types(code) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public._pricing_rate_line_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public._pricing_rate_line_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pricing_rate_line_touch() TO service_role;
DROP TRIGGER IF EXISTS trg_rate_lines_touch ON public.commercial_rate_lines;
CREATE TRIGGER trg_rate_lines_touch BEFORE UPDATE ON public.commercial_rate_lines
  FOR EACH ROW EXECUTE FUNCTION public._pricing_rate_line_touch();

/* ---------- 3. Rate cards: effective_to, scheduled state, change summary ---------- */
ALTER TABLE public.commercial_rate_cards
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS change_summary text,
  ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES public.commercial_rate_cards(id) ON DELETE SET NULL;
ALTER TABLE public.commercial_rate_cards DROP CONSTRAINT IF EXISTS commercial_rate_cards_status_check;
ALTER TABLE public.commercial_rate_cards ADD CONSTRAINT commercial_rate_cards_status_check
  CHECK (status = ANY (ARRAY['source','draft','pending_approval','approved','scheduled','retired']));
DROP POLICY IF EXISTS "admin delete rate lines" ON public.commercial_rate_lines;
CREATE POLICY "admin delete rate lines" ON public.commercial_rate_lines
  FOR DELETE TO authenticated USING (public.is_platform_admin());

/* ---------- 4. Configurable negotiation guardrails ---------- */
CREATE TABLE IF NOT EXISTS public.pricing_guardrails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('discount','premium')),
  variance_from numeric(6,2) NOT NULL,
  variance_to numeric(6,2),
  action text NOT NULL CHECK (action IN ('none','notify','approve')),
  required_role text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_guardrails TO authenticated;
GRANT ALL ON public.pricing_guardrails TO service_role;
ALTER TABLE public.pricing_guardrails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read guardrails" ON public.pricing_guardrails
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.commercial.read'));
CREATE POLICY "admin write guardrails" ON public.pricing_guardrails
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

INSERT INTO public.pricing_guardrails (code,label,direction,variance_from,variance_to,action,required_role,notes) VALUES
  ('discount_0_10','Within commercial discretion','discount',0,10,'none',NULL,'Salesperson may close at this level'),
  ('discount_10_20','Manager notification','discount',10,20,'notify','sales_manager','Team leader is informed'),
  ('discount_20_30','Manager approval','discount',20,30,'approve','sales_manager',NULL),
  ('discount_30_plus','Commercial approval','discount',30,NULL,'approve','commercial_director',NULL),
  ('premium_0_25','Above recommended — no approval','premium',0,25,'none',NULL,'Premium pricing is permitted'),
  ('premium_25_plus','Premium notification','premium',25,NULL,'notify','sales_manager','Recorded for pricing intelligence')
ON CONFLICT (code) DO NOTHING;

/* ---------- 5. Customer / contract / volume pricing ---------- */
CREATE TABLE IF NOT EXISTS public.pricing_customer_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  contract_instance_id uuid REFERENCES public.commercial_contract_instances(id) ON DELETE SET NULL,
  rate_kind text NOT NULL CHECK (rate_kind IN ('contract','customer','volume','promotional','project','seasonal','competitive','spot')),
  service_code text NOT NULL REFERENCES public.pricing_service_types(code) ON DELETE RESTRICT,
  scope_label text NOT NULL DEFAULT '',
  category_code text NOT NULL REFERENCES public.commercial_vehicle_categories(code) ON DELETE RESTRICT,
  pricing_basis text NOT NULL DEFAULT 'per_day',
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES',
  min_quantity numeric(10,2) NOT NULL DEFAULT 1,
  effective_from date,
  effective_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','expired','withdrawn')),
  reason text,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_rates_lookup
  ON public.pricing_customer_rates (account_id, service_code, category_code, scope_label, status);
GRANT SELECT, INSERT, UPDATE ON public.pricing_customer_rates TO authenticated;
GRANT ALL ON public.pricing_customer_rates TO service_role;
ALTER TABLE public.pricing_customer_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read customer rates" ON public.pricing_customer_rates
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.commercial.read'));
CREATE POLICY "commercial write customer rates" ON public.pricing_customer_rates
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());
CREATE POLICY "commercial update customer rates" ON public.pricing_customer_rates
  FOR UPDATE TO authenticated USING (public.is_platform_admin() OR public.is_commercial_staff())
  WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());

/* ---------- 6. Cost baselines (margin intelligence) ---------- */
CREATE TABLE IF NOT EXISTS public.pricing_cost_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code text NOT NULL REFERENCES public.pricing_service_types(code) ON DELETE RESTRICT,
  scope_label text NOT NULL DEFAULT '',
  category_code text NOT NULL REFERENCES public.commercial_vehicle_categories(code) ON DELETE RESTRICT,
  pricing_basis text NOT NULL DEFAULT 'per_day',
  driver_cost numeric(14,2) NOT NULL DEFAULT 0,
  fuel_cost numeric(14,2) NOT NULL DEFAULT 0,
  tolls_parking numeric(14,2) NOT NULL DEFAULT 0,
  supplier_cost numeric(14,2) NOT NULL DEFAULT 0,
  operational_cost numeric(14,2) NOT NULL DEFAULT 0,
  platform_cost numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  effective_from date,
  effective_to date,
  source text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_baselines_lookup
  ON public.pricing_cost_baselines (service_code, category_code, scope_label);
GRANT SELECT ON public.pricing_cost_baselines TO authenticated;
GRANT ALL ON public.pricing_cost_baselines TO service_role;
ALTER TABLE public.pricing_cost_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read cost baselines" ON public.pricing_cost_baselines
  FOR SELECT TO authenticated USING (public.is_platform_admin() OR public.has_staff_permission('staff.finance.read'));
CREATE POLICY "admin write cost baselines" ON public.pricing_cost_baselines
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

/* ---------- 7. Competitor observations ---------- */
CREATE TABLE IF NOT EXISTS public.pricing_competitor_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor text NOT NULL,
  service_code text NOT NULL REFERENCES public.pricing_service_types(code) ON DELETE RESTRICT,
  scope_label text NOT NULL DEFAULT '',
  category_code text,
  pricing_basis text NOT NULL DEFAULT 'per_day',
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES',
  observed_on date NOT NULL,
  source text NOT NULL,
  customer_segment text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_competitor_obs_lookup
  ON public.pricing_competitor_observations (service_code, scope_label, category_code, observed_on DESC);
GRANT SELECT, INSERT ON public.pricing_competitor_observations TO authenticated;
GRANT ALL ON public.pricing_competitor_observations TO service_role;
ALTER TABLE public.pricing_competitor_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read competitor obs" ON public.pricing_competitor_observations
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.commercial.read'));
CREATE POLICY "commercial write competitor obs" ON public.pricing_competitor_observations
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin() OR public.is_commercial_staff());

/* ---------- 8. Negotiations (recommended vs proposed vs final) ---------- */
CREATE TABLE IF NOT EXISTS public.pricing_negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.commercial_quotations(id) ON DELETE SET NULL,
  rate_card_id uuid REFERENCES public.commercial_rate_cards(id) ON DELETE SET NULL,
  rate_card_version text,
  service_code text NOT NULL,
  scope_label text NOT NULL DEFAULT '',
  category_code text NOT NULL,
  pricing_basis text NOT NULL DEFAULT 'per_day',
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  recommended_amount numeric(14,2) NOT NULL,
  customer_rate_amount numeric(14,2),
  proposed_amount numeric(14,2) NOT NULL CHECK (proposed_amount >= 0),
  final_amount numeric(14,2),
  variance_amount numeric(14,2) NOT NULL,
  variance_percent numeric(8,2) NOT NULL,
  price_source text NOT NULL,
  commercial_reason text,
  estimated_cost numeric(14,2),
  margin_amount numeric(14,2),
  margin_percent numeric(8,2),
  guardrail_code text,
  guardrail_action text NOT NULL DEFAULT 'none',
  required_role text,
  approval_status text NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_negotiations_account ON public.pricing_negotiations (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_negotiations_approval ON public.pricing_negotiations (approval_status, created_at DESC);
GRANT SELECT ON public.pricing_negotiations TO authenticated;
GRANT ALL ON public.pricing_negotiations TO service_role;
ALTER TABLE public.pricing_negotiations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read negotiations" ON public.pricing_negotiations
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.commercial.read'));

/* ---------- 9. Quotation lines carry recommended + negotiated ---------- */
ALTER TABLE public.commercial_quotation_lines
  ADD COLUMN IF NOT EXISTS recommended_unit_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'RECOMMENDED',
  ADD COLUMN IF NOT EXISTS variance_percent numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commercial_reason text;

CREATE OR REPLACE FUNCTION public.update_pricing_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.update_pricing_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_pricing_touch() TO service_role;
DROP TRIGGER IF EXISTS trg_guardrails_touch ON public.pricing_guardrails;
CREATE TRIGGER trg_guardrails_touch BEFORE UPDATE ON public.pricing_guardrails
  FOR EACH ROW EXECUTE FUNCTION public.update_pricing_touch();
DROP TRIGGER IF EXISTS trg_customer_rates_touch ON public.pricing_customer_rates;
CREATE TRIGGER trg_customer_rates_touch BEFORE UPDATE ON public.pricing_customer_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_pricing_touch();
DROP TRIGGER IF EXISTS trg_negotiations_touch ON public.pricing_negotiations;
CREATE TRIGGER trg_negotiations_touch BEFORE UPDATE ON public.pricing_negotiations
  FOR EACH ROW EXECUTE FUNCTION public.update_pricing_touch();

/* ---------- 10. Guardrail resolution ---------- */
CREATE OR REPLACE FUNCTION public.pricing_guardrail_for(p_variance_percent numeric)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('code',g.code,'label',g.label,'action',g.action,'required_role',g.required_role)
       FROM public.pricing_guardrails g
      WHERE g.active
        AND g.direction = CASE WHEN p_variance_percent < 0 THEN 'discount' ELSE 'premium' END
        AND abs(p_variance_percent) >= g.variance_from
        AND (g.variance_to IS NULL OR abs(p_variance_percent) < g.variance_to)
      ORDER BY g.variance_from DESC LIMIT 1),
    jsonb_build_object('code',NULL,'label','No guardrail configured','action','none','required_role',NULL));
$$;
REVOKE EXECUTE ON FUNCTION public.pricing_guardrail_for(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_guardrail_for(numeric) TO authenticated, service_role;

/* ---------- 11. Deterministic price resolution ---------- */
CREATE OR REPLACE FUNCTION public.pricing_resolve(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_service text := p_input->>'service_code';
  v_scope text := coalesce(p_input->>'scope_label','');
  v_category text := p_input->>'category_code';
  v_basis text := coalesce(p_input->>'pricing_basis','per_day');
  v_qty numeric := greatest(coalesce((p_input->>'quantity')::numeric,1),1);
  v_account uuid := nullif(p_input->>'account_id','')::uuid;
  v_proposed numeric := nullif(p_input->>'proposed_amount','')::numeric;
  v_card public.commercial_rate_cards;
  v_line public.commercial_rate_lines;
  v_cust public.pricing_customer_rates;
  v_cost numeric;
  v_recommended numeric;
  v_applied numeric;
  v_source text;
  v_variance numeric := 0;
  v_variance_pct numeric := 0;
  v_guard jsonb;
  v_can_see_cost boolean;
  v_explain jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  IF v_service IS NULL OR v_category IS NULL THEN
    RAISE EXCEPTION 'invalid_input: service_code and category_code are required';
  END IF;

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE code = coalesce(p_input->>'rate_card_code','corporate_charter_rate_card')
     AND status = 'approved' AND retired_at IS NULL
   ORDER BY coalesce(effective_from,'1900-01-01') DESC, created_at DESC LIMIT 1;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_PUBLISHED_RATE_CARD');
  END IF;

  SELECT * INTO v_line FROM public.commercial_rate_lines
   WHERE rate_card_id = v_card.id AND service_code = v_service
     AND category_code = v_category AND pricing_basis = v_basis
     AND (v_scope = '' OR scope_label = v_scope)
   ORDER BY (scope_label = v_scope) DESC LIMIT 1;
  IF v_line.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_VALID_RATE','rate_card_version',v_card.version);
  END IF;

  v_recommended := v_line.amount;
  v_applied := v_recommended;
  v_source := 'RECOMMENDED';
  v_explain := v_explain || jsonb_build_array(jsonb_build_object(
    'label','Recommended rate card rate','amount',v_recommended,
    'detail', v_card.name || ' ' || v_card.version));

  -- hierarchy: contract > customer/segment > promotional > volume
  SELECT * INTO v_cust FROM public.pricing_customer_rates r
   WHERE r.status = 'active' AND r.account_id = v_account
     AND r.service_code = v_service AND r.category_code = v_category
     AND (r.scope_label = '' OR r.scope_label = v_scope)
     AND r.pricing_basis = v_basis
     AND (r.effective_from IS NULL OR r.effective_from <= current_date)
     AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND v_qty >= r.min_quantity
   ORDER BY CASE r.rate_kind
              WHEN 'contract' THEN 1 WHEN 'customer' THEN 2 WHEN 'project' THEN 3
              WHEN 'promotional' THEN 4 WHEN 'seasonal' THEN 5 WHEN 'volume' THEN 6
              WHEN 'competitive' THEN 7 ELSE 8 END,
            r.min_quantity DESC
   LIMIT 1;

  IF v_cust.id IS NOT NULL THEN
    v_applied := v_cust.amount;
    v_source := upper(v_cust.rate_kind);
    v_explain := v_explain || jsonb_build_array(jsonb_build_object(
      'label', initcap(v_cust.rate_kind) || ' rate',
      'amount', v_cust.amount - v_recommended,
      'detail', coalesce(v_cust.reason,'Agreed customer pricing')));
  END IF;

  IF v_proposed IS NOT NULL THEN
    v_explain := v_explain || jsonb_build_array(jsonb_build_object(
      'label','Negotiated adjustment','amount', v_proposed - v_applied,
      'detail', coalesce(p_input->>'commercial_reason','Commercially negotiated price')));
    v_applied := v_proposed;
    v_source := 'NEGOTIATED';
  END IF;

  v_variance := round(v_applied - v_recommended, 2);
  IF v_recommended > 0 THEN
    v_variance_pct := round((v_applied - v_recommended) / v_recommended * 100, 2);
  END IF;
  v_guard := public.pricing_guardrail_for(v_variance_pct);

  v_can_see_cost := public.is_platform_admin() OR public.has_staff_permission('staff.finance.read');
  SELECT (driver_cost + fuel_cost + tolls_parking + supplier_cost + operational_cost + platform_cost)
    INTO v_cost
    FROM public.pricing_cost_baselines
   WHERE service_code = v_service AND category_code = v_category
     AND (scope_label = '' OR scope_label = v_scope) AND pricing_basis = v_basis
     AND (effective_from IS NULL OR effective_from <= current_date)
     AND (effective_to IS NULL OR effective_to >= current_date)
   ORDER BY (scope_label = v_scope) DESC, created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'status','OK',
    'currency', v_line.currency,
    'recommended_price', v_recommended,
    'customer_rate_price', v_cust.amount,
    'applied_price', v_applied,
    'quantity', v_qty,
    'line_total', round(v_applied * v_qty, 2),
    'variance_amount', v_variance,
    'variance_percent', v_variance_pct,
    'pricing_source', v_source,
    'rate_card_id', v_card.id,
    'rate_card_code', v_card.code,
    'rate_card_version', v_card.version,
    'rate_line_id', v_line.id,
    'pricing_basis', v_line.pricing_basis,
    'included_distance_km', v_line.included_distance_km,
    'distance_unit', v_line.distance_unit,
    'excess_distance_rate', v_line.excess_distance_rate,
    'included_hours', v_line.included_hours,
    'excess_hour_rate', v_line.excess_hour_rate,
    'waiting_rate_per_hour', v_line.waiting_rate_per_hour,
    'guardrail', v_guard,
    'approval_required', (v_guard->>'action') = 'approve',
    'estimated_cost', CASE WHEN v_can_see_cost THEN v_cost ELSE NULL END,
    'margin_amount', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL THEN round(v_applied - v_cost,2) ELSE NULL END,
    'margin_percent', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL AND v_applied > 0
                           THEN round((v_applied - v_cost) / v_applied * 100, 2) ELSE NULL END,
    'market_reference', (SELECT round(avg(amount),2) FROM public.pricing_competitor_observations o
                          WHERE o.service_code = v_service
                            AND (o.category_code IS NULL OR o.category_code = v_category)
                            AND (o.scope_label = '' OR o.scope_label = v_scope)
                            AND o.observed_on >= current_date - 365),
    'explanation', v_explain);
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_resolve(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_resolve(jsonb) TO authenticated, service_role;

/* ---------- 12. Rate card authoring ---------- */
CREATE OR REPLACE FUNCTION public.pricing_rate_card_open_draft(p_code text, p_reason text, p_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src public.commercial_rate_cards; v_new uuid; v_version text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised: pricing administration only';
  END IF;
  SELECT * INTO v_src FROM public.commercial_rate_cards
   WHERE code = p_code AND retired_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'rate_card_missing: %', p_code; END IF;
  IF v_src.status IN ('draft','source','pending_approval') THEN
    RETURN jsonb_build_object('rate_card_id', v_src.id, 'version', v_src.version, 'reused', true);
  END IF;
  v_version := coalesce(nullif(p_version,''), 'v' || to_char(now(),'YYYY.MM.DD-HH24MI'));

  INSERT INTO public.commercial_rate_cards (
    code,name,product_domain,version,status,currency,effective_from,source_note,source_reference,
    owner_staff_id,created_by,change_reason,change_summary,provenance,supersedes_id)
  SELECT code,name,product_domain,v_version,'draft',currency,NULL,source_note,source_reference,
         owner_staff_id,auth.uid(),p_reason,p_reason,provenance,v_src.id
    FROM public.commercial_rate_cards WHERE id = v_src.id
  RETURNING id INTO v_new;

  INSERT INTO public.commercial_rate_lines (
    rate_card_id,service_code,scope_label,category_code,pricing_basis,amount,currency,
    included_distance_km,included_distance_period,drive_mode,min_days,inclusion_note,conditions,
    distance_unit,excess_distance_rate,included_hours,excess_hour_rate,waiting_rate_per_hour,updated_by)
  SELECT v_new,service_code,scope_label,category_code,pricing_basis,amount,currency,
         included_distance_km,included_distance_period,drive_mode,min_days,inclusion_note,conditions,
         distance_unit,excess_distance_rate,included_hours,excess_hour_rate,waiting_rate_per_hour,auth.uid()
    FROM public.commercial_rate_lines WHERE rate_card_id = v_src.id;

  INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,new_value,reason)
  VALUES (auth.uid(),'rate_card.draft_opened','commercial_rate_cards',v_new,
          jsonb_build_object('from_version',v_src.version,'version',v_version), coalesce(p_reason,''));

  RETURN jsonb_build_object('rate_card_id', v_new, 'version', v_version, 'reused', false);
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_rate_card_open_draft(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_rate_card_open_draft(text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_rate_item_save(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_card public.commercial_rate_cards; v_old public.commercial_rate_lines; v_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised: pricing administration only';
  END IF;
  SELECT * INTO v_card FROM public.commercial_rate_cards WHERE id = (p_payload->>'rate_card_id')::uuid;
  IF v_card.id IS NULL THEN RAISE EXCEPTION 'rate_card_missing'; END IF;
  IF v_card.status NOT IN ('draft','source','pending_approval') THEN
    RAISE EXCEPTION 'rate_card_immutable: open a draft version before editing published rates';
  END IF;

  SELECT * INTO v_old FROM public.commercial_rate_lines
   WHERE rate_card_id = v_card.id
     AND service_code = p_payload->>'service_code'
     AND scope_label = coalesce(p_payload->>'scope_label','')
     AND category_code = p_payload->>'category_code'
     AND pricing_basis = coalesce(p_payload->>'pricing_basis','per_day');

  IF v_old.id IS NULL THEN
    INSERT INTO public.commercial_rate_lines (
      rate_card_id,service_code,scope_label,category_code,pricing_basis,amount,currency,
      included_distance_km,included_distance_period,distance_unit,excess_distance_rate,
      included_hours,excess_hour_rate,waiting_rate_per_hour,drive_mode,min_days,inclusion_note,conditions,updated_by)
    VALUES (v_card.id, p_payload->>'service_code', coalesce(p_payload->>'scope_label',''),
      p_payload->>'category_code', coalesce(p_payload->>'pricing_basis','per_day'),
      (p_payload->>'amount')::numeric, coalesce(p_payload->>'currency', v_card.currency),
      nullif(p_payload->>'included_distance_km','')::integer,
      nullif(p_payload->>'included_distance_period',''), coalesce(nullif(p_payload->>'distance_unit',''),'km'),
      nullif(p_payload->>'excess_distance_rate','')::numeric,
      nullif(p_payload->>'included_hours','')::numeric,
      nullif(p_payload->>'excess_hour_rate','')::numeric,
      nullif(p_payload->>'waiting_rate_per_hour','')::numeric,
      nullif(p_payload->>'drive_mode',''), nullif(p_payload->>'min_days','')::integer,
      nullif(p_payload->>'inclusion_note',''), nullif(p_payload->>'conditions',''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.commercial_rate_lines SET
      amount = coalesce(nullif(p_payload->>'amount','')::numeric, amount),
      included_distance_km = CASE WHEN p_payload ? 'included_distance_km'
        THEN nullif(p_payload->>'included_distance_km','')::integer ELSE included_distance_km END,
      included_distance_period = CASE WHEN p_payload ? 'included_distance_period'
        THEN nullif(p_payload->>'included_distance_period','') ELSE included_distance_period END,
      distance_unit = coalesce(nullif(p_payload->>'distance_unit',''), distance_unit),
      excess_distance_rate = CASE WHEN p_payload ? 'excess_distance_rate'
        THEN nullif(p_payload->>'excess_distance_rate','')::numeric ELSE excess_distance_rate END,
      included_hours = CASE WHEN p_payload ? 'included_hours'
        THEN nullif(p_payload->>'included_hours','')::numeric ELSE included_hours END,
      excess_hour_rate = CASE WHEN p_payload ? 'excess_hour_rate'
        THEN nullif(p_payload->>'excess_hour_rate','')::numeric ELSE excess_hour_rate END,
      waiting_rate_per_hour = CASE WHEN p_payload ? 'waiting_rate_per_hour'
        THEN nullif(p_payload->>'waiting_rate_per_hour','')::numeric ELSE waiting_rate_per_hour END,
      inclusion_note = CASE WHEN p_payload ? 'inclusion_note' THEN nullif(p_payload->>'inclusion_note','') ELSE inclusion_note END,
      conditions = CASE WHEN p_payload ? 'conditions' THEN nullif(p_payload->>'conditions','') ELSE conditions END,
      updated_by = auth.uid()
    WHERE id = v_old.id RETURNING id INTO v_id;
  END IF;

  INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,previous_value,new_value,reason)
  VALUES (auth.uid(),'rate_item.saved','commercial_rate_lines',v_id,
          CASE WHEN v_old.id IS NULL THEN NULL ELSE to_jsonb(v_old) END,
          (SELECT to_jsonb(l) FROM public.commercial_rate_lines l WHERE l.id = v_id),
          coalesce(p_payload->>'reason',''));

  RETURN jsonb_build_object('rate_line_id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_rate_item_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_rate_item_save(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_rate_item_delete(p_rate_line_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_line public.commercial_rate_lines; v_status text;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorised: pricing administration only'; END IF;
  SELECT * INTO v_line FROM public.commercial_rate_lines WHERE id = p_rate_line_id;
  IF v_line.id IS NULL THEN RAISE EXCEPTION 'rate_line_missing'; END IF;
  SELECT status INTO v_status FROM public.commercial_rate_cards WHERE id = v_line.rate_card_id;
  IF v_status NOT IN ('draft','source','pending_approval') THEN
    RAISE EXCEPTION 'rate_card_immutable: published rates cannot be deleted';
  END IF;
  INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,previous_value,reason)
  VALUES (auth.uid(),'rate_item.deleted','commercial_rate_lines',p_rate_line_id,to_jsonb(v_line),coalesce(p_reason,''));
  DELETE FROM public.commercial_rate_lines WHERE id = p_rate_line_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_rate_item_delete(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_rate_item_delete(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_rate_card_bulk_adjust(
  p_rate_card_id uuid, p_filters jsonb, p_percent numeric DEFAULT NULL,
  p_included_distance_km integer DEFAULT NULL, p_apply boolean DEFAULT false, p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_rows jsonb; v_count integer := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorised: pricing administration only'; END IF;
  SELECT status INTO v_status FROM public.commercial_rate_cards WHERE id = p_rate_card_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'rate_card_missing'; END IF;
  IF p_apply AND v_status NOT IN ('draft','source','pending_approval') THEN
    RAISE EXCEPTION 'rate_card_immutable: open a draft version before bulk editing';
  END IF;

  WITH target AS (
    SELECT l.* FROM public.commercial_rate_lines l
     WHERE l.rate_card_id = p_rate_card_id
       AND (NOT (p_filters ? 'service_code') OR l.service_code = p_filters->>'service_code')
       AND (NOT (p_filters ? 'scope_label') OR l.scope_label = p_filters->>'scope_label')
       AND (NOT (p_filters ? 'category_code') OR l.category_code = p_filters->>'category_code')
  )
  SELECT jsonb_agg(jsonb_build_object(
           'rate_line_id',id,'service_code',service_code,'scope_label',scope_label,
           'category_code',category_code,'current_amount',amount,
           'proposed_amount', CASE WHEN p_percent IS NULL THEN amount
                                   ELSE round(amount * (1 + p_percent/100), 2) END,
           'current_included_km',included_distance_km,
           'proposed_included_km', coalesce(p_included_distance_km, included_distance_km))
         ORDER BY service_code, scope_label, category_code), count(*)
    INTO v_rows, v_count FROM target;

  IF p_apply THEN
    UPDATE public.commercial_rate_lines l SET
      amount = CASE WHEN p_percent IS NULL THEN l.amount ELSE round(l.amount * (1 + p_percent/100), 2) END,
      included_distance_km = coalesce(p_included_distance_km, l.included_distance_km),
      updated_by = auth.uid()
     WHERE l.rate_card_id = p_rate_card_id
       AND (NOT (p_filters ? 'service_code') OR l.service_code = p_filters->>'service_code')
       AND (NOT (p_filters ? 'scope_label') OR l.scope_label = p_filters->>'scope_label')
       AND (NOT (p_filters ? 'category_code') OR l.category_code = p_filters->>'category_code');

    INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,new_value,reason)
    VALUES (auth.uid(),'rate_card.bulk_adjusted','commercial_rate_cards',p_rate_card_id,
            jsonb_build_object('percent',p_percent,'included_km',p_included_distance_km,
                               'affected',v_count,'filters',p_filters), coalesce(p_reason,''));
  END IF;

  RETURN jsonb_build_object('affected', v_count, 'applied', p_apply, 'rows', coalesce(v_rows,'[]'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_rate_card_bulk_adjust(uuid,jsonb,numeric,integer,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_rate_card_bulk_adjust(uuid,jsonb,numeric,integer,boolean,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_rate_card_publish(
  p_rate_card_id uuid, p_effective_from date, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_card public.commercial_rate_cards; v_status text; v_lines integer;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorised: pricing administration only'; END IF;
  SELECT * INTO v_card FROM public.commercial_rate_cards WHERE id = p_rate_card_id;
  IF v_card.id IS NULL THEN RAISE EXCEPTION 'rate_card_missing'; END IF;
  SELECT count(*) INTO v_lines FROM public.commercial_rate_lines WHERE rate_card_id = p_rate_card_id;
  IF v_lines = 0 THEN RAISE EXCEPTION 'empty_rate_card: add at least one rate before publishing'; END IF;

  v_status := CASE WHEN p_effective_from IS NOT NULL AND p_effective_from > current_date
                   THEN 'scheduled' ELSE 'approved' END;

  UPDATE public.commercial_rate_cards
     SET status = v_status, effective_from = coalesce(p_effective_from, current_date),
         approved_by = auth.uid(), approved_at = now(),
         change_reason = coalesce(nullif(p_reason,''), change_reason),
         change_summary = coalesce(nullif(p_reason,''), change_summary)
   WHERE id = p_rate_card_id;

  IF v_status = 'approved' THEN
    UPDATE public.commercial_rate_cards
       SET status = 'retired', retired_at = now(),
           effective_to = coalesce(effective_to, coalesce(p_effective_from, current_date) - 1)
     WHERE code = v_card.code AND id <> p_rate_card_id AND status IN ('approved','scheduled');
  END IF;

  INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,new_value,reason)
  VALUES (auth.uid(),'rate_card.published','commercial_rate_cards',p_rate_card_id,
          jsonb_build_object('status',v_status,'effective_from',p_effective_from,'lines',v_lines),
          coalesce(p_reason,''));

  RETURN jsonb_build_object('rate_card_id',p_rate_card_id,'status',v_status,'lines',v_lines);
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_rate_card_publish(uuid,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_rate_card_publish(uuid,date,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_activate_due_rate_cards()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; v_row record;
BEGIN
  FOR v_row IN SELECT id, code FROM public.commercial_rate_cards
                WHERE status = 'scheduled' AND effective_from <= current_date LOOP
    UPDATE public.commercial_rate_cards SET status = 'approved' WHERE id = v_row.id;
    UPDATE public.commercial_rate_cards SET status = 'retired', retired_at = now()
      WHERE code = v_row.code AND id <> v_row.id AND status = 'approved';
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_activate_due_rate_cards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_activate_due_rate_cards() TO service_role;

/* ---------- 13. Negotiation recording (never blocks) ---------- */
CREATE OR REPLACE FUNCTION public.pricing_negotiation_record(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb; v_id uuid; v_guard jsonb; v_action text; v_status text;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  v_res := public.pricing_resolve(p_payload);
  IF (v_res->>'status') <> 'OK' THEN RETURN v_res; END IF;

  v_guard := v_res->'guardrail';
  v_action := coalesce(v_guard->>'action','none');
  v_status := CASE WHEN v_action = 'approve' THEN 'pending' ELSE 'not_required' END;

  INSERT INTO public.pricing_negotiations (
    account_id, opportunity_id, quotation_id, rate_card_id, rate_card_version,
    service_code, scope_label, category_code, pricing_basis, quantity,
    recommended_amount, customer_rate_amount, proposed_amount, final_amount,
    variance_amount, variance_percent, price_source, commercial_reason,
    estimated_cost, margin_amount, margin_percent,
    guardrail_code, guardrail_action, required_role, approval_status, created_by)
  VALUES (
    nullif(p_payload->>'account_id','')::uuid, nullif(p_payload->>'opportunity_id','')::uuid,
    nullif(p_payload->>'quotation_id','')::uuid, (v_res->>'rate_card_id')::uuid, v_res->>'rate_card_version',
    p_payload->>'service_code', coalesce(p_payload->>'scope_label',''), p_payload->>'category_code',
    coalesce(p_payload->>'pricing_basis','per_day'), (v_res->>'quantity')::numeric,
    (v_res->>'recommended_price')::numeric, nullif(v_res->>'customer_rate_price','')::numeric,
    (v_res->>'applied_price')::numeric,
    CASE WHEN v_status = 'not_required' THEN (v_res->>'applied_price')::numeric ELSE NULL END,
    (v_res->>'variance_amount')::numeric, (v_res->>'variance_percent')::numeric,
    v_res->>'pricing_source', nullif(p_payload->>'commercial_reason',''),
    nullif(v_res->>'estimated_cost','')::numeric, nullif(v_res->>'margin_amount','')::numeric,
    nullif(v_res->>'margin_percent','')::numeric,
    nullif(v_guard->>'code',''), v_action, nullif(v_guard->>'required_role',''), v_status, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,new_value,reason)
  VALUES (auth.uid(),'negotiation.recorded','pricing_negotiations',v_id,
          jsonb_build_object('recommended',v_res->'recommended_price','proposed',v_res->'applied_price',
                             'variance_percent',v_res->'variance_percent','guardrail',v_guard),
          coalesce(p_payload->>'commercial_reason',''));

  RETURN v_res || jsonb_build_object('negotiation_id', v_id, 'approval_status', v_status);
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_negotiation_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_negotiation_record(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pricing_negotiation_decide(
  p_negotiation_id uuid, p_status text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n public.pricing_negotiations;
BEGIN
  IF p_status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_input: status'; END IF;
  SELECT * INTO v_n FROM public.pricing_negotiations WHERE id = p_negotiation_id;
  IF v_n.id IS NULL THEN RAISE EXCEPTION 'negotiation_missing'; END IF;
  IF NOT (public.is_platform_admin()
          OR public.has_staff_permission('staff.crm.manage')) THEN
    RAISE EXCEPTION 'not_authorised: pricing approval authority required';
  END IF;
  IF v_n.created_by = auth.uid() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'segregation_of_duties: a negotiator cannot approve their own price';
  END IF;

  UPDATE public.pricing_negotiations
     SET approval_status = p_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note,
         final_amount = CASE WHEN p_status = 'approved' THEN proposed_amount ELSE NULL END
   WHERE id = p_negotiation_id;

  INSERT INTO public.pricing_audit_events (actor_id,action,entity,entity_id,previous_value,new_value,reason)
  VALUES (auth.uid(),'negotiation.' || p_status,'pricing_negotiations',p_negotiation_id,
          to_jsonb(v_n), jsonb_build_object('approval_status',p_status), coalesce(p_note,''));
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_negotiation_decide(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_negotiation_decide(uuid,text,text) TO authenticated, service_role;

/* ---------- 14. Pricing intelligence ---------- */
CREATE OR REPLACE FUNCTION public.pricing_intelligence_summary(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'negotiations', coalesce((SELECT count(*) FROM public.pricing_negotiations n
        WHERE n.created_at::date BETWEEN p_from AND p_to),0),
    'approval_required', coalesce((SELECT count(*) FROM public.pricing_negotiations n
        WHERE n.created_at::date BETWEEN p_from AND p_to AND n.guardrail_action = 'approve'),0),
    'pending_approval', coalesce((SELECT count(*) FROM public.pricing_negotiations n
        WHERE n.approval_status = 'pending'),0),
    'by_lane', coalesce((SELECT jsonb_agg(x ORDER BY x->>'service_code', x->>'scope_label') FROM (
        SELECT jsonb_build_object(
                 'service_code', n.service_code, 'scope_label', n.scope_label,
                 'category_code', n.category_code, 'deals', count(*),
                 'recommended_avg', round(avg(n.recommended_amount),2),
                 'sold_avg', round(avg(n.proposed_amount),2),
                 'sold_min', min(n.proposed_amount), 'sold_max', max(n.proposed_amount),
                 'avg_variance_percent', round(avg(n.variance_percent),2),
                 'discount_deals', count(*) FILTER (WHERE n.variance_percent < 0),
                 'premium_deals', count(*) FILTER (WHERE n.variance_percent > 0),
                 'margin_avg_percent', round(avg(n.margin_percent),2)) AS x
          FROM public.pricing_negotiations n
         WHERE n.created_at::date BETWEEN p_from AND p_to
         GROUP BY n.service_code, n.scope_label, n.category_code) s),'[]'::jsonb),
    'by_owner', coalesce((SELECT jsonb_agg(y) FROM (
        SELECT jsonb_build_object('created_by', n.created_by, 'deals', count(*),
                 'avg_variance_percent', round(avg(n.variance_percent),2),
                 'value', round(sum(n.proposed_amount * n.quantity),2)) AS y
          FROM public.pricing_negotiations n
         WHERE n.created_at::date BETWEEN p_from AND p_to
         GROUP BY n.created_by) t),'[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE EXECUTE ON FUNCTION public.pricing_intelligence_summary(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_intelligence_summary(date,date) TO authenticated, service_role;

/* ---------- 15. Quotations consume the pricing engine ---------- */
CREATE OR REPLACE FUNCTION public.commercial_create_quotation(
  p_account_id uuid, p_lines jsonb, p_opportunity_id uuid DEFAULT NULL::uuid,
  p_contract_instance_id uuid DEFAULT NULL::uuid,
  p_rate_card_code text DEFAULT 'corporate_charter_rate_card'::text,
  p_valid_until date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card public.commercial_rate_cards;
  v_quote_id uuid; v_number text; v_staff uuid; v_line jsonb;
  v_res jsonb; v_qty numeric; v_total numeric := 0;
  v_unpriced jsonb := '[]'::jsonb; v_needs_approval boolean := false;
  v_unit numeric; v_recommended numeric; v_neg uuid;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  IF p_account_id IS NULL OR p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invalid_input: account and at least one line are required';
  END IF;

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE code = p_rate_card_code AND retired_at IS NULL
   ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1;
  IF v_card.id IS NULL THEN RAISE EXCEPTION 'rate_card_missing: %', p_rate_card_code; END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  v_number := public.commercial_next_quote_number();

  INSERT INTO public.commercial_quotations (
    quote_number, account_id, opportunity_id, contract_instance_id,
    rate_card_id, rate_card_version, owner_staff_id, currency,
    total_amount, status, approval_status, valid_until, notes)
  VALUES (v_number, p_account_id, p_opportunity_id, p_contract_instance_id,
    v_card.id, v_card.version, v_staff, v_card.currency,
    0, 'draft', 'not_required', p_valid_until, p_notes)
  RETURNING id INTO v_quote_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := coalesce(nullif(v_line->>'quantity','')::numeric, 1);
    IF v_qty <= 0 THEN v_qty := 1; END IF;

    v_res := public.pricing_negotiation_record(
      v_line
      || jsonb_build_object('account_id', p_account_id, 'opportunity_id', p_opportunity_id,
                            'quotation_id', v_quote_id, 'quantity', v_qty,
                            'rate_card_code', p_rate_card_code));

    IF (v_res->>'status') <> 'OK' THEN
      v_unpriced := v_unpriced || jsonb_build_array(v_line);
      CONTINUE;
    END IF;

    v_unit := (v_res->>'applied_price')::numeric;
    v_recommended := (v_res->>'recommended_price')::numeric;
    v_neg := nullif(v_res->>'negotiation_id','')::uuid;
    IF (v_res->>'approval_status') = 'pending' THEN v_needs_approval := true; END IF;

    INSERT INTO public.commercial_quotation_lines (
      quotation_id, rate_line_id, service_code, scope_label, category_code,
      pricing_basis, unit_amount, quantity, line_total, included_distance_km, conditions,
      recommended_unit_amount, price_source, variance_percent, commercial_reason)
    VALUES (v_quote_id, nullif(v_res->>'rate_line_id','')::uuid,
      v_line->>'service_code', coalesce(v_line->>'scope_label',''), v_line->>'category_code',
      v_res->>'pricing_basis', v_unit, v_qty, round(v_unit * v_qty, 2),
      nullif(v_res->>'included_distance_km','')::integer,
      nullif(v_line->>'conditions',''),
      v_recommended, v_res->>'pricing_source', (v_res->>'variance_percent')::numeric,
      nullif(v_line->>'commercial_reason',''));

    v_total := v_total + round(v_unit * v_qty, 2);
    IF v_neg IS NOT NULL THEN
      UPDATE public.pricing_negotiations SET quotation_id = v_quote_id WHERE id = v_neg;
    END IF;
  END LOOP;

  UPDATE public.commercial_quotations
     SET total_amount = v_total,
         approval_status = CASE
           WHEN v_needs_approval OR jsonb_array_length(v_unpriced) > 0 OR v_card.status <> 'approved'
           THEN 'pending' ELSE 'not_required' END
   WHERE id = v_quote_id;

  PERFORM public.ops_enqueue_event(
    v_quote_id::text, 'commercial.quotation.created', 'staff_portal',
    'quotation', v_quote_id, v_number, 'corporate_charter',
    jsonb_build_object('amountKes', v_total, 'needsApproval', v_needs_approval),
    jsonb_build_object('accountId', p_account_id, 'rateCardVersion', v_card.version,
                       'unpricedRequests', v_unpriced));

  RETURN jsonb_build_object(
    'quotation_id', v_quote_id, 'quote_number', v_number, 'total_amount', v_total,
    'currency', v_card.currency, 'rate_card_version', v_card.version,
    'rate_card_status', v_card.status, 'approval_required', v_needs_approval,
    'unpriced', v_unpriced);
END $$;
REVOKE EXECUTE ON FUNCTION public.commercial_create_quotation(uuid,jsonb,uuid,uuid,text,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_create_quotation(uuid,jsonb,uuid,uuid,text,date,text) TO authenticated, service_role;

/* ---------- 16. Backfill: existing quote lines keep their applied price ---------- */
UPDATE public.commercial_quotation_lines
   SET recommended_unit_amount = unit_amount
 WHERE recommended_unit_amount IS NULL;